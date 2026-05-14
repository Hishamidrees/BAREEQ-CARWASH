# BAREEQ ESP32-S3 Pin Reference

## RC522 RFID Reader (SPI)

| RC522 | ESP32-S3 |
|-------|----------|
| SCK   | GPIO 12  |
| MISO  | GPIO 13  |
| MOSI  | GPIO 11  |
| SDA/SS| GPIO 10  |
| RST   | GPIO 14  |
| 3.3V  | 3.3V     |
| GND   | GND      |

## I2C Bus (OLED, AHT20, BMP280)

| Signal | ESP32-S3 |
|--------|----------|
| SDA    | GPIO 8   |
| SCL    | GPIO 9   |

## Flow & Analog Sensors

| Sensor              | ESP32-S3 |
|---------------------|----------|
| Air Flow (YF-S201)  | GPIO 4   |
| Water Flow (YF-S201)| GPIO 5   |
| TDS Sensor          | GPIO 1   |
| Turbidity Sensor    | GPIO 3   |

## MAX6675 Thermocouple (separate SPI)

| MAX6675 | ESP32-S3 |
|---------|----------|
| CS      | GPIO 2   |
| SCK     | GPIO 36  |
| SO/MISO | GPIO 37  |

## Relay Outputs

| Relay       | ESP32-S3 |
|-------------|----------|
| Water Pump  | GPIO 17  |
| Air Pump    | GPIO 45  |
