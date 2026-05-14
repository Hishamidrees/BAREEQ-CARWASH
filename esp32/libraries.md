# Required Arduino Libraries

Install all of these via **Arduino IDE → Tools → Manage Libraries**
or with the Arduino CLI before compiling the firmware.

| Library | Purpose |
|---------|---------|
| `WiFi` | Built-in ESP32 WiFi |
| `WiFiClientSecure` | TLS/SSL socket for MQTT |
| `SPI` | SPI bus (RFID, MAX6675) |
| `Wire` | I2C bus (OLED, AHT20, BMP280) |
| `MFRC522` | RC522 RFID reader |
| `PubSubClient` | MQTT client |
| `ArduinoJson` | JSON payloads |
| `U8g2` | OLED display |
| `Adafruit AHTX0` | AHT20 temperature & humidity |
| `Adafruit BMP280` | BMP280 pressure sensor |
| `MAX6675` | Thermocouple amplifier |

## Arduino CLI (batch install)

```bash
arduino-cli lib install "MFRC522" "PubSubClient" "ArduinoJson" \
  "U8g2" "Adafruit AHTX0 library" "Adafruit BMP280 Library" "MAX6675 library"
```
