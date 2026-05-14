# BAREEQ – Smart IoT Car Wash Management System

BAREEQ is an IoT-based smart car wash management system that connects ESP32-S3 wash stations, RFID users, MQTT communication, a cloud backend, a database, and a React dashboard into one complete platform.

The system is designed to automate the car wash process, manage user wallet balances, collect real-time sensor readings, store wash history, and display analytics for revenue, consumption, and station performance.

---

## Overview

BAREEQ allows a user to scan an RFID card at a car wash station. The ESP32-S3 reads the RFID UID and sends a wallet request to the backend through MQTT. The backend checks the user balance, validates the selected service, and sends a response back to the station.

If the user has enough balance, the ESP32-S3 starts the wash cycle. During the cycle, the station collects sensor readings such as water flow, air flow, TDS, turbidity, temperature, humidity, and water temperature. The data is sent to the backend and displayed on the React dashboard.

---

## Main Features

- RFID-based user authentication
- ESP32-S3 car wash station controller
- MQTT communication over TLS
- Cloud backend
- MySQL database storage
- React frontend dashboard
- User wallet balance system
- Automatic balance deduction
- Wash cycle tracking
- Real-time sensor monitoring
- Water flow measurement
- Air flow measurement
- TDS water quality monitoring
- Turbidity water quality monitoring
- Environmental temperature and humidity monitoring
- Water temperature monitoring
- Revenue and consumption analytics
- User management
- Service type management
- Discount support
- WebSocket live dashboard updates
- Mission-based reporting

---

## System Architecture

```text
RFID Card
   |
   v
ESP32-S3 Car Wash Station
   |
   | MQTT over TLS
   v
Cloud Backend
   |
   | MySQL Database
   v
React Dashboard
```

---

## How It Works

1. The user scans an RFID card.
2. The ESP32-S3 reads the card UID.
3. The ESP32-S3 sends a wallet request to the backend through MQTT.
4. The backend checks the user balance and service price.
5. The backend sends an approval or rejection response.
6. If approved, the ESP32-S3 starts the wash mission.
7. The water pump runs.
8. The system takes a short break.
9. The air pump runs.
10. Sensor readings are collected during the mission.
11. A mission summary is sent to the backend.
12. The frontend dashboard updates with the latest data.

---

## Hardware Used

### Controller

| Hardware | Description |
|---|---|
| ESP32-S3 DevKitC | Main microcontroller used to control the car wash station |

### RFID

| Hardware | Description |
|---|---|
| RC522 RFID Reader | Reads RFID cards used to identify users |

### Sensors

| Hardware | Description |
|---|---|
| YF-S201 Flow Sensor | Measures water flow |
| YF-S201 Flow Sensor | Measures air flow |
| TDS Analog Sensor | Measures total dissolved solids in water |
| Turbidity Sensor | Measures water turbidity / clarity |
| AHT20 Sensor | Measures environmental temperature and humidity |
| BMP280 Sensor | Measures pressure and environmental data |
| MAX6675 Module | Thermocouple amplifier module |
| K-Type Thermocouple | Measures water temperature |

### Display

| Hardware | Description |
|---|---|
| OLED Display | Displays status messages, RFID status, balance, and mission updates |

### Actuators

| Hardware | Description |
|---|---|
| Relay Module | Controls pumps |
| Water Pump | Runs during the washing stage |
| Air Pump | Runs during the drying stage |

---

## ESP32-S3 Pin Configuration

> Note: This pinout is based on the BAREEQ ESP32-S3 station configuration.

### RC522 RFID Reader

| RC522 Pin | ESP32-S3 Pin |
|---|---|
| SCK | GPIO 12 |
| MISO | GPIO 13 |
| MOSI | GPIO 11 |
| SDA / SS | GPIO 10 |
| RST | GPIO 14 |
| 3.3V | 3.3V |
| GND | GND |

### I2C Bus

Used for OLED display, AHT20, and BMP280.

| Signal | ESP32-S3 Pin |
|---|---|
| SDA | GPIO 8 |
| SCL | GPIO 9 |
| VCC | 3.3V |
| GND | GND |

### Flow Sensors

| Sensor | ESP32-S3 Pin |
|---|---|
| Air Flow Sensor | GPIO 4 |
| Water Flow Sensor | GPIO 5 |

### Analog Sensors

| Sensor | ESP32-S3 Pin |
|---|---|
| TDS Sensor | GPIO 1 |
| Turbidity Sensor | GPIO 3 |

### MAX6675 Thermocouple Module

| MAX6675 Pin | ESP32-S3 Pin |
|---|---|
| CS | GPIO 2 |
| SCK | GPIO 36 |
| SO / MISO | GPIO 37 |
| VCC | 3.3V / 5V depending on module |
| GND | GND |

### Relay Outputs

| Relay | ESP32-S3 Pin |
|---|---|
| Water Pump Relay | GPIO 17 |
| Air Pump Relay | GPIO 45 |

---

## Wash Mission Cycle

The wash mission follows this sequence:

```text
RFID Scan
   |
Wallet Validation
   |
Water Pump ON - 30 seconds
   |
Break - 5 seconds
   |
Air Pump ON - 30 seconds
   |
Mission Summary Sent
```

The station collects approximately 65 samples during each mission.

---

## Data Collected

The ESP32-S3 collects and sends the following data:

| Field | Description | Unit |
|---|---|---|
| uid | RFID card UID | Text |
| station_id | Station identifier | Text |
| device_id | ESP32 device identifier | Text |
| total_water_l | Total water used | Liters |
| total_air_l | Total air used | Liters |
| avg_tds_ppm | Average TDS value | ppm |
| avg_turbidity_ntu | Average turbidity value | NTU |
| avg_env_temperature_c | Average environment temperature | °C |
| avg_env_humidity_pct | Average humidity | % |
| avg_water_temperature_c | Average water temperature | °C |

---

## MQTT Communication

BAREEQ uses MQTT over TLS to communicate between the ESP32-S3 station and the backend.

### Wallet Request Topic

```text
carwash/<stationId>/wallet/request
```

Used when the user scans an RFID card.

### Wallet Response Topic

```text
carwash/<stationId>/wallet/response
```

Used by the backend to approve or reject a wash request.

### Sensor Data Topic

```text
carwash/<stationId>/sensors/all
```

Used to send live sensor readings.

### Mission Summary Topic

```text
carwash/<stationId>/mission/summary
```

Used to send the final mission data after a wash cycle is completed.

---

## Example Wallet Request Payload

```json
{
  "station_id": "station-01",
  "device_id": "esp32s3-01",
  "uid": "A4130307"
}
```

## Example Wallet Response Payload

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

## Example Mission Summary Payload

```json
{
  "station_id": "station-01",
  "device_id": "esp32s3-01",
  "uid": "A4130307",
  "total_air_l": 120.5,
  "total_water_l": 18.3,
  "avg_env_temperature_c": 27.6,
  "avg_env_humidity_pct": 48.2,
  "avg_water_temperature_c": 25.1,
  "avg_tds_ppm": 310.4,
  "avg_turbidity_ntu": 180.7
}
```

---

## RFID UID Format

The RFID reader may display the UID with spaces:

```text
A4 13 03 07
```

The backend stores and matches the UID without spaces:

```text
A4130307
```

This makes matching easier between the ESP32, backend, and database.

---

## Backend

The backend handles communication between the ESP32 stations, MQTT broker, database, and frontend dashboard.

### Backend Technologies

| Technology | Purpose |
|---|---|
| Python | Backend programming language |
| Flask | REST API backend |
| Flask-Sock | WebSocket support |
| Paho MQTT | MQTT client |
| MySQL | Database |
| Google Cloud SQL | Cloud database |
| Google Cloud Run | Backend hosting |
| Cloud SQL Python Connector | Secure MySQL connection |

### Backend Responsibilities

- Receive MQTT messages from ESP32 stations
- Process RFID wallet requests
- Validate users
- Check user balances
- Deduct service cost
- Store sensor data
- Store mission summaries
- Store user transactions
- Manage stations
- Manage services
- Send live updates to the frontend
- Provide REST API endpoints
- Handle WebSocket dashboard updates

---

## Frontend

The frontend is a React dashboard used to monitor and manage the car wash system.

### Frontend Technologies

| Technology | Purpose |
|---|---|
| React | Frontend framework |
| Vite | Build tool |
| JavaScript / JSX | Frontend logic |
| CSS | Styling |
| REST API | Backend communication |
| WebSocket | Real-time updates |

---

## Dashboard Pages

### Dashboard

Shows the main system overview, station status, latest sensor readings, and live updates.

### Users

Used to manage users, RFID cards, plate numbers, balances, visit count, and account status.

### Analytics

Displays graphs and readings for:

- TDS
- Turbidity
- Water consumption
- Air consumption
- Temperature
- Humidity
- Wash cycle history

### Revenue & Consumption

Displays business and usage information such as:

- Total credit
- User balances
- Monthly revenue
- Transactions
- Water consumption
- Air consumption

### Last Report

Displays the latest wash report for a selected user or UID.

### Service Type

Used to configure available wash services, pricing, and discounts.

---

## Database Concept

The database stores system data such as:

- Users
- RFID UIDs
- Plate numbers
- Balances
- Wash visits
- Sensor readings
- Mission summaries
- Transactions
- Stations
- Services
- Discounts

---

## Example User Record

```json
{
  "name": "User Name",
  "uid": "A4130307",
  "plate_digits": "1234",
  "plate_letters": "ABC",
  "balance": 100,
  "status": "active"
}
```

---

## Environment Variables

The backend uses environment variables for private configuration.

Example:

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

Do not commit real `.env` files or credentials to GitHub.

---

## Local Backend Setup

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

For Linux or macOS:

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

---

## Local Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

---

## ESP32 Setup

The ESP32 firmware requires the following Arduino libraries:

- WiFi
- SPI
- Wire
- MFRC522
- PubSubClient
- WiFiClientSecure
- ArduinoJson
- U8g2
- Adafruit AHTX0
- Adafruit BMP280
- MAX6675 library

---

## ESP32 Configuration Example

```cpp
#define STATION_ID "station-01"
#define DEVICE_ID  "esp32s3-01"

const char* WIFI_SSID = "your_wifi_name";
const char* WIFI_PASS = "your_wifi_password";

const char* MQTT_HOST = "your_mqtt_host";
const int MQTT_PORT = 8883;
const char* MQTT_USER = "your_mqtt_username";
const char* MQTT_PASS = "your_mqtt_password";
```

---

## Repository Structure

```text
BAREEQ/
│
├── backend/
│   ├── app.py
│   ├── requirements.txt
│   └── ...
│
├── frontend/
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── ...
│
├── esp32/
│   ├── bareeq_station.ino
│   └── ...
│
└── README.md
```

---

## Security Notes

- Use MQTT over TLS.
- Store credentials in environment variables.
- Do not commit `.env` files.
- Validate RFID users in the backend.
- Deduct balances on the server side.
- Restrict frontend origins using CORS.
- Use secure database connections.
- Keep cloud credentials private.

---

## Future Improvements

- Admin login system
- Multi-station monitoring
- QR payment support
- Mobile application
- Predictive maintenance
- Advanced revenue analytics
- Automatic report export to PDF or Excel
- AI-based anomaly detection
- More detailed station health monitoring
- Real-time alerts for sensor faults
- Service recommendation based on usage

---

## Project Purpose

BAREEQ was developed to demonstrate how IoT, cloud computing, real-time dashboards, and automation can be used to improve car wash operations.

The project connects physical hardware with a cloud backend and a modern web dashboard, creating a complete smart car wash management system.

---

## Author

Developed by 
Hisham Ideas 
Hadi AlMansour
---

## License

This project can be released under the MIT License or any license preferred by the author.
