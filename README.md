<div align="center">

# ⚡ BAREEQ

### Smart IoT Car Wash Management System

*Connecting ESP32-S3 stations, RFID authentication, real-time sensors, and a cloud-backed React dashboard into one complete platform.*

![Platform](https://img.shields.io/badge/Platform-ESP32--S3-blue?style=flat-square)
![Protocol](https://img.shields.io/badge/Protocol-MQTT%20%2F%20TLS-green?style=flat-square)
![Backend](https://img.shields.io/badge/Backend-Flask%20%2B%20Python-orange?style=flat-square)
![Frontend](https://img.shields.io/badge/Frontend-React%20%2B%20Vite-61dafb?style=flat-square)
![Database](https://img.shields.io/badge/Database-MySQL%20%2F%20Cloud%20SQL-lightgrey?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)

</div>

---

## Overview

BAREEQ automates the full car wash process — from the moment a user taps an RFID card to the final sensor summary stored in the cloud.

The ESP32-S3 station reads the card UID, sends a wallet request over MQTT/TLS, and receives backend approval or rejection. If approved, the wash cycle starts automatically: the water pump runs, a short break follows, then the air pump runs for drying. Throughout the cycle, sensors collect water quality, flow, temperature, and humidity data — all stored in MySQL and streamed live to the React dashboard.

---

## System Architecture

```
RFID Card
    │
    ▼
ESP32-S3 Car Wash Station
    │  SPI (RC522)
    │
    ▼
MQTT Broker  ←──────────────────────────────────┐
    │  MQTT over TLS                             │
    ▼                                            │
Cloud Backend (Flask · Cloud Run)  ──────────────┘
    │  Cloud SQL Connector
    ▼
MySQL Database (Google Cloud SQL)
    │  REST API · WebSocket
    ▼
React Dashboard (Vite)
```

---

## Features

- **RFID authentication** — RC522 reader, UID-based user lookup
- **Wallet system** — balance check, automatic deduction, transaction history
- **Wash cycle control** — water pump → break → air pump, relay-driven
- **Real-time sensor monitoring** — flow, TDS, turbidity, temperature, humidity
- **MQTT over TLS** — secure, bidirectional station-to-cloud messaging
- **WebSocket dashboard** — live updates without polling
- **Analytics** — revenue, consumption, wash history, sensor graphs
- **Service management** — configurable wash types, pricing, discounts
- **User management** — RFID UIDs, plate numbers, balances, visit counts

---

## Wash Cycle Flow

```
RFID Scan
    │
    ▼
Wallet Validation (backend)
    │
    ├── Rejected ──► OLED shows error, cycle aborted
    │
    └── Approved ──► Wash begins
            │
            ▼
        Water Pump ON  (30 seconds)
            │
            ▼
        Break          (5 seconds)
            │
            ▼
        Air Pump ON    (30 seconds)
            │
            ▼
        ~65 sensor samples collected
            │
            ▼
        Mission Summary → Backend → Dashboard
```

---

## Hardware

### Controller

| Component | Description |
|-----------|-------------|
| ESP32-S3 DevKitC | Main microcontroller |
| RC522 RFID Reader | Card authentication via SPI |
| OLED Display | Status, balance, and mission info (I2C) |

### Sensors

| Sensor | Measurement | Interface |
|--------|-------------|-----------|
| YF-S201 (×2) | Water flow & air flow | Digital (GPIO) |
| TDS Analog Sensor | Total dissolved solids | Analog (ADC) |
| Turbidity Sensor | Water clarity (NTU) | Analog (ADC) |
| AHT20 | Env. temperature & humidity | I2C |
| BMP280 | Atmospheric pressure | I2C |
| MAX6675 + K-Type Thermocouple | Water temperature | SPI |

### Actuators

| Component | Purpose |
|-----------|---------|
| Relay Module | Switches pumps on/off |
| Water Pump | Washing stage |
| Air Pump | Drying stage |

---

## Pin Configuration

### RC522 RFID Reader

| RC522 | ESP32-S3 |
|-------|----------|
| SCK | GPIO 12 |
| MISO | GPIO 13 |
| MOSI | GPIO 11 |
| SDA / SS | GPIO 10 |
| RST | GPIO 14 |
| 3.3V | 3.3V |
| GND | GND |

### I2C Bus (OLED, AHT20, BMP280)

| Signal | ESP32-S3 |
|--------|----------|
| SDA | GPIO 8 |
| SCL | GPIO 9 |

### Flow & Analog Sensors

| Sensor | ESP32-S3 |
|--------|----------|
| Air Flow Sensor (YF-S201) | GPIO 4 |
| Water Flow Sensor (YF-S201) | GPIO 5 |
| TDS Sensor | GPIO 1 |
| Turbidity Sensor | GPIO 3 |

### MAX6675 Thermocouple Module

| MAX6675 | ESP32-S3 |
|---------|----------|
| CS | GPIO 2 |
| SCK | GPIO 36 |
| SO / MISO | GPIO 37 |

### Relay Outputs

| Relay | ESP32-S3 |
|-------|----------|
| Water Pump | GPIO 17 |
| Air Pump | GPIO 45 |

---

## MQTT Topics

| Direction | Topic | Description |
|-----------|-------|-------------|
| ESP32 → Backend | `carwash/<stationId>/wallet/request` | Sent on RFID scan |
| Backend → ESP32 | `carwash/<stationId>/wallet/response` | Approve / reject |
| ESP32 → Backend | `carwash/<stationId>/sensors/all` | Live sensor readings |
| ESP32 → Backend | `carwash/<stationId>/mission/summary` | Final cycle summary |

### Wallet Request Payload

```json
{
  "station_id": "station-01",
  "device_id": "esp32s3-01",
  "uid": "A4130307"
}
```

### Wallet Response Payload

```json
{
  "approved": true,
  "uid": "A4130307",
  "name": "User Name",
  "balance": 90,
  "service": "Basic Wash",
  "price": 10
}
```

### Mission Summary Payload

```json
{
  "station_id": "station-01",
  "device_id": "esp32s3-01",
  "uid": "A4130307",
  "total_water_l": 18.3,
  "total_air_l": 120.5,
  "avg_tds_ppm": 310.4,
  "avg_turbidity_ntu": 180.7,
  "avg_env_temperature_c": 27.6,
  "avg_env_humidity_pct": 48.2,
  "avg_water_temperature_c": 25.1
}
```

> **RFID UID format:** The RC522 may output `A4 13 03 07` (with spaces). The backend stores and matches UIDs without spaces: `A4130307`.

---

## Tech Stack

### Backend

| Technology | Role |
|------------|------|
| Python | Backend language |
| Flask | REST API |
| Flask-Sock | WebSocket support |
| Paho MQTT | MQTT client |
| MySQL | Relational database |
| Google Cloud SQL | Managed database hosting |
| Google Cloud Run | Backend hosting |
| Cloud SQL Python Connector | Secure DB connection |

### Frontend

| Technology | Role |
|------------|------|
| React | UI framework |
| Vite | Build tool |
| JavaScript / JSX | Application logic |
| REST API | Backend communication |
| WebSocket | Real-time updates |

---

## Dashboard Pages

| Page | Description |
|------|-------------|
| **Dashboard** | System overview, station status, live sensor readings |
| **Users** | Manage RFID cards, plate numbers, balances, visit counts |
| **Analytics** | TDS, turbidity, flow, temperature, humidity, cycle history |
| **Revenue & Consumption** | Monthly revenue, transactions, water/air usage |
| **Last Report** | Latest wash report for a selected user or UID |
| **Service Types** | Configure services, pricing, and discounts |

---

## Repository Structure

```
BAREEQ/
├── backend/
│   ├── app.py
│   ├── requirements.txt
│   └── ...
├── frontend/
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── ...
├── esp32/
│   ├── bareeq_station.ino
│   └── ...
└── README.md
```

---

## Setup

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### ESP32 Firmware

Install these Arduino libraries before flashing:

- `WiFi` · `SPI` · `Wire`
- `MFRC522`
- `PubSubClient`
- `WiFiClientSecure`
- `ArduinoJson`
- `U8g2`
- `Adafruit AHTX0`
- `Adafruit BMP280`
- `MAX6675 library`

Then configure your credentials in the sketch:

```cpp
#define STATION_ID "station-01"
#define DEVICE_ID  "esp32s3-01"

const char* WIFI_SSID = "your_wifi_name";
const char* WIFI_PASS = "your_wifi_password";

const char* MQTT_HOST = "your_mqtt_host";
const int   MQTT_PORT = 8883;
const char* MQTT_USER = "your_mqtt_username";
const char* MQTT_PASS = "your_mqtt_password";
```

---

## Environment Variables

Create a `.env` file in the `backend/` directory:

```env
MYSQL_HOST=your_mysql_host
MYSQL_USER=your_mysql_user
MYSQL_PASSWORD=your_mysql_password
MYSQL_DATABASE=your_database_name

MQTT_HOST=your_mqtt_host
MQTT_PORT=8883
MQTT_USERNAME=your_mqtt_username
MQTT_PASSWORD=your_mqtt_password

CORS_ORIGIN=your_frontend_url
```

> ⚠️ Never commit `.env` files or credentials to version control.

---

## Security

- MQTT communication encrypted over TLS (port 8883)
- All credentials stored in environment variables
- RFID user validation performed server-side only
- Balance deduction happens on the backend — never trusted from the device
- CORS restricted to allowed frontend origins
- Secure Cloud SQL connector for database access

---

## Roadmap

- [ ] Admin login system
- [ ] Multi-station monitoring view
- [ ] QR payment support
- [ ] Mobile application
- [ ] Predictive maintenance alerts
- [ ] Automatic PDF / Excel report export
- [ ] AI-based sensor anomaly detection
- [ ] Real-time fault alerts per station
- [ ] Advanced revenue analytics
- [ ] Service recommendation engine

---

## License

This project is released under the [MIT License](LICENSE).

---

<div align="center">

Developed by **Hisham Ideas** · **Hadi AlMansour**

</div>
