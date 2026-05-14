#pragma once

// ── Station identity ─────────────────────────────────────────
#define STATION_ID  "station-01"
#define DEVICE_ID   "esp32s3-01"

// ── Pin definitions ──────────────────────────────────────────
// RC522 RFID (SPI)
#define RFID_SCK   12
#define RFID_MISO  13
#define RFID_MOSI  11
#define RFID_SS    10
#define RFID_RST   14

// I2C (OLED, AHT20, BMP280)
#define I2C_SDA  8
#define I2C_SCL  9

// Flow sensors
#define PIN_AIR_FLOW    4
#define PIN_WATER_FLOW  5

// Analog sensors
#define PIN_TDS        1
#define PIN_TURBIDITY  3

// MAX6675 thermocouple (separate SPI bus)
#define MAX_CS   2
#define MAX_SCK  36
#define MAX_MISO 37

// Relays
#define RELAY_WATER  17
#define RELAY_AIR    45

// ── Wash cycle timing (ms) ───────────────────────────────────
#define WASH_DURATION_MS   30000
#define BREAK_DURATION_MS   5000
#define DRY_DURATION_MS    30000

// ── Sensor sampling ──────────────────────────────────────────
#define SAMPLE_INTERVAL_MS  1000   // 1 sample per second
