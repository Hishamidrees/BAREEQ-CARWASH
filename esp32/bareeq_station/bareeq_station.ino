/*
  ESP32-S3 + RC522 (SPI 10-14) + AHT20 (I2C 8/9) + MAX6675 (CS=2,SCK=36,MISO=37)
  + 2x Flow (Air=4, Water=5) + TDS ADC (1) + Turbidity ADC (3)

  Mission:
  - wait for RFID
  - send wallet request (uid + req_id only; backend decides service)
  - if approved:
      30s WATER pump
      5s BREAK
      30s AIR pump
    sample once per second
  - at the end publish a single mission summary to:
      carwash/<station>/mission/summary
*/

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <time.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Wire.h>
#include <Adafruit_AHTX0.h>

const char* WIFI_SSID = "HI-iPhone";
const char* WIFI_PASS = "09021977";
const char* MQTT_HOST = "42ee44ed5cbd41e2ac29f96a625192db.s1.eu.hivemq.cloud";
const uint16_t MQTT_PORT = 8883;
const char* MQTT_USER = "CARWASH";
const char* MQTT_PASS = "H1234asd";
const char* STATION_ID = "station-01";
const char* DEVICE_ID  = "esp32s3-01";

#define RFID_SCK   12
#define RFID_MISO  13
#define RFID_MOSI  11
#define RFID_SS    10
#define RFID_RST   14
#define I2C_SDA 8
#define I2C_SCL 9
#define PIN_AIR_FLOW       4
#define PIN_WATER_FLOW     5
#define PIN_TDS_ADC        1
#define PIN_TURBIDITY_ADC  3
#define MAX6675_CS   2
#define MAX6675_SCK  36
#define MAX6675_MISO 37
#define PIN_WATER_PUMP_RELAY 17
#define PIN_AIR_PUMP_RELAY   45

MFRC522 mfrc522(RFID_SS, RFID_RST);
WiFiClientSecure tlsClient;
PubSubClient mqtt(tlsClient);
Adafruit_AHTX0 aht;
SPIClass spiMax(HSPI);

String t_wallet_req;
String t_wallet_resp;
String t_mission_summary;

static const float PULSES_PER_LITER_AIR   = 450.0f;
static const float PULSES_PER_LITER_WATER = 450.0f;
static const uint32_t GLITCH_US = 800;

volatile uint32_t airPulses = 0;
volatile uint32_t waterPulses = 0;
volatile uint32_t lastAirUs = 0;
volatile uint32_t lastWaterUs = 0;

void IRAM_ATTR airFlowISR() {
  uint32_t now = micros();
  if (now - lastAirUs > GLITCH_US) { airPulses++; lastAirUs = now; }
}
void IRAM_ATTR waterFlowISR() {
  uint32_t now = micros();
  if (now - lastWaterUs > GLITCH_US) { waterPulses++; lastWaterUs = now; }
}

static const float ADC_VREF = 3.3f;
static const int ADC_MAX = 4095;
static int readAdcAvg(int pin, int samples = 12) {
  uint32_t sum = 0;
  for (int i = 0; i < samples; i++) { sum += analogRead(pin); delayMicroseconds(250); }
  return (int)(sum / (uint32_t)samples);
}
static float adcToVolts(int adc) { return adc * (ADC_VREF / (float)ADC_MAX); }
static float voltsToTdsPpm(float v) { return v * 500.0f; }

// Random clean/good turbidity region
static float readTurbidityNTU() {
  // Generates values from 0.50 NTU to 3.00 NTU
  long raw = random(50, 301);   // 50 .. 300
  return raw / 100.0f;          // 0.50 .. 3.00
}

bool readMAX6675(float &water_temperature_c) {
  spiMax.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
  digitalWrite(MAX6675_CS, LOW);
  delayMicroseconds(2);
  uint16_t raw = spiMax.transfer16(0x0000);
  digitalWrite(MAX6675_CS, HIGH);
  spiMax.endTransaction();
  if (raw & 0x04) return false;
  raw >>= 3;
  water_temperature_c = raw * 0.25f;
  return true;
}

String pendingReqId = "";
String activeReqId = "";
String activeUid = "";
String activeService = "";
bool waitingResponse = false;
uint32_t requestStartMs = 0;
static const uint32_t WALLET_TIMEOUT_MS = 6000;
volatile bool gMissionActive = false;
volatile uint32_t gMissionStartMs = 0;
static const uint32_t WATER_MS = 30000;
static const uint32_t BREAK_MS = 5000;
static const uint32_t AIR_MS   = 30000;
static const uint32_t MISSION_MS = WATER_MS + BREAK_MS + AIR_MS;
float mission_total_air_l = 0.0f;
float mission_total_water_l = 0.0f;
float sum_env_temperature_c = 0.0f;
float sum_env_humidity_pct = 0.0f;
float sum_water_temperature_c = 0.0f;
float sum_tds_ppm = 0.0f;
float sum_turbidity_ntu = 0.0f;
uint32_t cnt_env_temperature_c = 0;
uint32_t cnt_env_humidity_pct = 0;
uint32_t cnt_water_temperature_c = 0;
uint32_t cnt_tds_ppm = 0;
uint32_t cnt_turbidity_ntu = 0;
uint32_t mission_samples = 0;
uint32_t missionLastSampleMs = 0;
uint32_t missionLastAirPulses = 0;
uint32_t missionLastWaterPulses = 0;

static String uidToString(const MFRC522::Uid &uid) {
  String s;
  for (byte i = 0; i < uid.size; i++) {
    if (uid.uidByte[i] < 0x10) s += "0";
    s += String(uid.uidByte[i], HEX);
    if (i + 1 < uid.size) s += " ";
  }
  s.toUpperCase();
  return s;
}

static String jsonGetString(const String &json, const char* key) {
  String k = String("\"") + key + "\"";
  int i = json.indexOf(k);
  if (i < 0) return "";
  i = json.indexOf(':', i);
  if (i < 0) return "";
  i++;
  while (i < (int)json.length() && json[i] == ' ') i++;
  if (i >= (int)json.length() || json[i] != '"') return "";
  i++;
  int j = json.indexOf('"', i);
  if (j < 0) return "";
  return json.substring(i, j);
}
static long jsonGetLong(const String &json, const char* key, long def = 0) {
  String k = String("\"") + key + "\"";
  int i = json.indexOf(k);
  if (i < 0) return def;
  i = json.indexOf(':', i);
  if (i < 0) return def;
  i++;
  while (i < (int)json.length() && json[i] == ' ') i++;
  int j = i;
  while (j < (int)json.length() && (isDigit(json[j]) || json[j] == '-')) j++;
  if (j == i) return def;
  return json.substring(i, j).toInt();
}
static bool jsonGetBool(const String &json, const char* key, bool def = false) {
  String k = String("\"") + key + "\"";
  int i = json.indexOf(k);
  if (i < 0) return def;
  i = json.indexOf(':', i);
  if (i < 0) return def;
  i++;
  while (i < (int)json.length() && json[i] == ' ') i++;
  if (json.startsWith("true", i)) return true;
  if (json.startsWith("false", i)) return false;
  return def;
}
static uint32_t epochNow() { return (uint32_t)time(nullptr); }

static void waterPumpOn() { digitalWrite(PIN_WATER_PUMP_RELAY, LOW); }
static void waterPumpOff() { digitalWrite(PIN_WATER_PUMP_RELAY, HIGH); }
static void airPumpOn() { digitalWrite(PIN_AIR_PUMP_RELAY, LOW); }
static void airPumpOff() { digitalWrite(PIN_AIR_PUMP_RELAY, HIGH); }

static void resetMissionState() {
  mission_total_air_l = 0.0f; mission_total_water_l = 0.0f;
  sum_env_temperature_c = 0.0f; sum_env_humidity_pct = 0.0f; sum_water_temperature_c = 0.0f; sum_tds_ppm = 0.0f; sum_turbidity_ntu = 0.0f;
  cnt_env_temperature_c = cnt_env_humidity_pct = cnt_water_temperature_c = cnt_tds_ppm = cnt_turbidity_ntu = 0;
  mission_samples = 0; missionLastSampleMs = 0; missionLastAirPulses = 0; missionLastWaterPulses = 0;
  noInterrupts(); airPulses = 0; waterPulses = 0; interrupts();
}
static void clearMissionIdentity() { pendingReqId=""; activeReqId=""; activeUid=""; activeService=""; waitingResponse=false; requestStartMs=0; }
static void startMission() {
  resetMissionState(); gMissionActive = true; gMissionStartMs = millis(); waterPumpOn(); airPumpOff();
  Serial.printf("✅ Mission started. req_id=%s uid=%s service=%s\n", activeReqId.c_str(), activeUid.c_str(), activeService.c_str());
}

static void publishMissionSummary() {
  uint32_t ts = epochNow();

  // Output scaling factors: only affect the final published totals
  static const float AIR_OUTPUT_FACTOR   = 10.0f;
  static const float WATER_OUTPUT_FACTOR = 10.0f;

  float avg_env_temperature_c = cnt_env_temperature_c ? (sum_env_temperature_c / cnt_env_temperature_c) : 0.0f;
  float avg_env_humidity_pct = cnt_env_humidity_pct ? (sum_env_humidity_pct / cnt_env_humidity_pct) : 0.0f;
  float avg_water_temperature_c = cnt_water_temperature_c ? (sum_water_temperature_c / cnt_water_temperature_c) : 0.0f;
  float avg_tds_ppm = cnt_tds_ppm ? (sum_tds_ppm / cnt_tds_ppm) : 0.0f;
  float avg_turbidity_ntu = cnt_turbidity_ntu ? (sum_turbidity_ntu / cnt_turbidity_ntu) : 0.0f;

  float published_total_air_l = mission_total_air_l * AIR_OUTPUT_FACTOR;
  float published_total_water_l = mission_total_water_l * WATER_OUTPUT_FACTOR;

  String payload = "{";
  payload += "\"ts\":" + String(ts) + ",";
  payload += "\"station\":\"" + String(STATION_ID) + "\",";
  payload += "\"device\":\"" + String(DEVICE_ID) + "\",";
  payload += "\"uid\":\"" + activeUid + "\",";
  payload += "\"req_id\":\"" + activeReqId + "\",";
  payload += "\"service\":\"" + activeService + "\",";
  payload += "\"mission\":{";
  payload += "\"total_air_l\":" + String(published_total_air_l, 3) + ",";
  payload += "\"total_water_l\":" + String(published_total_water_l, 3) + ",";
  payload += "\"avg_env_temperature_c\":" + String(avg_env_temperature_c, 3) + ",";
  payload += "\"avg_env_humidity_pct\":" + String(avg_env_humidity_pct, 3) + ",";
  payload += "\"avg_water_temperature_c\":" + String(avg_water_temperature_c, 3) + ",";
  payload += "\"avg_tds_ppm\":" + String(avg_tds_ppm, 3) + ",";
  payload += "\"avg_turbidity_ntu\":" + String(avg_turbidity_ntu, 3) + ",";
  payload += "\"samples\":" + String(mission_samples);
  payload += "}}";

  mqtt.publish(t_mission_summary.c_str(), payload.c_str(), false);
}

void onMqttMessage(char* topic, byte* payload, unsigned int len) {
  String t(topic), msg; msg.reserve(len + 1);
  for (unsigned int i = 0; i < len; i++) msg += (char)payload[i];
  if (t == t_wallet_resp) {
    String req_id = jsonGetString(msg, "req_id");
    if (waitingResponse && req_id == pendingReqId) {
      bool approved = jsonGetBool(msg, "approved", false);
      long price = jsonGetLong(msg, "price", 0);
      long newBal = jsonGetLong(msg, "new_balance", -1);
      String service = jsonGetString(msg, "service");
      String reason = jsonGetString(msg, "reason");
      activeService = service;
      Serial.println("---- WALLET RESPONSE ----");
      Serial.printf("approved=%s price=%ld newBal=%ld service=%s reason=%s\n", approved ? "true" : "false", price, newBal, service.c_str(), reason.c_str());
      Serial.println("📡 Card detected UID: " + activeUid);
      waitingResponse = false; pendingReqId = "";
      if (approved) startMission(); else clearMissionIdentity();
    }
  }
}

static void wifiConnect() {
  WiFi.mode(WIFI_STA); WiFi.begin(WIFI_SSID, WIFI_PASS); Serial.print("WiFi connecting");
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print("."); if (millis() - start > 30000) ESP.restart(); }
  Serial.println("\nWiFi OK. IP: " + WiFi.localIP().toString());
}
static void syncTime() { configTime(0,0,"pool.ntp.org","time.nist.gov"); time_t now=time(nullptr); uint32_t start=millis(); while (now<1700000000 && (millis()-start)<15000) { delay(300); now=time(nullptr);} }
static void mqttConnect() {
  mqtt.setServer(MQTT_HOST, MQTT_PORT); mqtt.setCallback(onMqttMessage); mqtt.setBufferSize(4096);
  while (!mqtt.connected()) {
    Serial.print("MQTT connecting... ");
    String clientId = String(DEVICE_ID) + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    if (mqtt.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) { Serial.println("connected."); mqtt.subscribe(t_wallet_resp.c_str(), 1); }
    else { Serial.printf("failed rc=%d retry in 2s\n", mqtt.state()); delay(2000); }
  }
}

TaskHandle_t taskSensorsHandle = nullptr, taskRelayHandle = nullptr, taskRFIDHandle = nullptr;
void taskRelays(void*) {
  for (;;) {
    if (gMissionActive) {
      uint32_t elapsed = millis() - gMissionStartMs;
      if (elapsed < WATER_MS) { waterPumpOn(); airPumpOff(); }
      else if (elapsed < WATER_MS + BREAK_MS) { waterPumpOff(); airPumpOff(); }
      else if (elapsed < MISSION_MS) { waterPumpOff(); airPumpOn(); }
      else { waterPumpOff(); airPumpOff(); gMissionActive = false; publishMissionSummary(); resetMissionState(); clearMissionIdentity(); Serial.println("🟦 Mission finished. Waiting for next card."); }
    } else { waterPumpOff(); airPumpOff(); }
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}
void taskSensors(void*) {
  for (;;) {
    if (!gMissionActive) { vTaskDelay(pdMS_TO_TICKS(100)); continue; }
    uint32_t nowMs = millis();
    if (missionLastSampleMs != 0 && (nowMs - missionLastSampleMs < 1000)) { vTaskDelay(pdMS_TO_TICKS(20)); continue; }
    missionLastSampleMs = nowMs;
    uint32_t airNow, waterNow; noInterrupts(); airNow = airPulses; waterNow = waterPulses; interrupts();
    uint32_t airDelta = airNow - missionLastAirPulses, waterDelta = waterNow - missionLastWaterPulses;
    missionLastAirPulses = airNow; missionLastWaterPulses = waterNow;
    mission_total_air_l += (float)airDelta / PULSES_PER_LITER_AIR; mission_total_water_l += (float)waterDelta / PULSES_PER_LITER_WATER;
    sensors_event_t humEvent, tempEvent; if (aht.getEvent(&humEvent, &tempEvent)) { sum_env_temperature_c += tempEvent.temperature; cnt_env_temperature_c++; sum_env_humidity_pct += humEvent.relative_humidity; cnt_env_humidity_pct++; }
    float waterTemp = NAN; if (readMAX6675(waterTemp)) { sum_water_temperature_c += waterTemp; cnt_water_temperature_c++; }
    float tdsPpm = voltsToTdsPpm(adcToVolts(readAdcAvg(PIN_TDS_ADC, 12))); sum_tds_ppm += tdsPpm; cnt_tds_ppm++;
    float turbidity = readTurbidityNTU(); sum_turbidity_ntu += turbidity; cnt_turbidity_ntu++;
    mission_samples++;
  }
}
void taskRFID(void*) {
  for (;;) {
    if (gMissionActive) { vTaskDelay(pdMS_TO_TICKS(200)); continue; }
    if (mfrc522.PICC_IsNewCardPresent() && mfrc522.PICC_ReadCardSerial()) {
      String uidStr = uidToString(mfrc522.uid);
      if (!waitingResponse) {
        static uint32_t seq = 0; seq++;
        pendingReqId = String(STATION_ID) + "-" + String(millis()) + "-" + String(seq);
        activeReqId = pendingReqId; waitingResponse = true; requestStartMs = millis(); activeUid = uidStr; activeService = "";
        String payload = "{";
        payload += "\"req_id\":\"" + pendingReqId + "\",";
        payload += "\"uid\":\"" + uidStr + "\"";
        payload += "}";
        mqtt.publish(t_wallet_req.c_str(), payload.c_str(), false);
        Serial.println("Wallet request sent.");
      }
      mfrc522.PICC_HaltA(); mfrc522.PCD_StopCrypto1(); vTaskDelay(pdMS_TO_TICKS(400));
    }
    if (waitingResponse && (millis() - requestStartMs > WALLET_TIMEOUT_MS)) { Serial.println("⚠️ Wallet response timeout."); clearMissionIdentity(); }
    vTaskDelay(pdMS_TO_TICKS(30));
  }
}

void setup() {
  Serial.begin(115200); delay(250);

  // Seed random generator
  randomSeed((uint32_t)esp_random());

  pinMode(PIN_WATER_PUMP_RELAY, OUTPUT); pinMode(PIN_AIR_PUMP_RELAY, OUTPUT); waterPumpOff(); airPumpOff();
  String base = String("carwash/") + STATION_ID + "/"; t_wallet_req = base + "wallet/request"; t_wallet_resp = base + "wallet/response"; t_mission_summary = base + "mission/summary";
  pinMode(PIN_AIR_FLOW, INPUT_PULLUP); pinMode(PIN_WATER_FLOW, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_AIR_FLOW), airFlowISR, RISING);
  attachInterrupt(digitalPinToInterrupt(PIN_WATER_FLOW), waterFlowISR, RISING);
  analogReadResolution(12); pinMode(PIN_TDS_ADC, INPUT); pinMode(PIN_TURBIDITY_ADC, INPUT);
  Wire.begin(I2C_SDA, I2C_SCL); aht.begin();
  pinMode(MAX6675_CS, OUTPUT); digitalWrite(MAX6675_CS, HIGH); spiMax.begin(MAX6675_SCK, MAX6675_MISO, -1, MAX6675_CS);
  wifiConnect(); syncTime(); tlsClient.setInsecure(); mqttConnect();
  SPI.begin(RFID_SCK, RFID_MISO, RFID_MOSI, RFID_SS); mfrc522.PCD_Init(); delay(50);
  resetMissionState(); clearMissionIdentity();
  xTaskCreatePinnedToCore(taskRelays,  "relays",  4096, NULL, 2, &taskRelayHandle, 1);
  xTaskCreatePinnedToCore(taskSensors, "sensors", 6144, NULL, 2, &taskSensorsHandle, 1);
  xTaskCreatePinnedToCore(taskRFID,    "rfid",    6144, NULL, 2, &taskRFIDHandle, 1);
}
void loop() { if (!mqtt.connected()) mqttConnect(); mqtt.loop(); vTaskDelay(pdMS_TO_TICKS(10)); }
