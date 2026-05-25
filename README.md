# Sea Water Level Sensor Web App

A school project web app for monitoring sea water level using Node.js, Express, HTML, CSS, and vanilla JavaScript.

The app currently supports mock data and ESP32 sensor data. The ESP32 sends water level readings to the Express API, and the dashboard shows the raw reading, stable final reading, scan progress, alerts, and history mock data.

## Features

- Express backend
- Dashboard served from the `public` folder
- ESP32-ready API endpoint
- Mock data fallback when ESP32 is offline
- Two-scan filtering method for wave irregularities
- Raw reading vs stable final reading display
- ESP32 online/offline status
- Health check endpoint for deployment
- Optional API key protection for ESP32 POST requests
- SQLite storage for raw and stable readings
- Mock History page with daily and monthly summaries

## Project Structure

```text
server.js
package.json
package-lock.json
public/
  index.html
  style.css
  app.js
```

## Setup

Install dependencies:

```powershell
npm.cmd install
```

Start the app:

```powershell
npm.cmd start
```

Open the dashboard:

```text
http://localhost:3000
```

## Environment Config

Copy `.env.example` to `.env` and edit the values:

```text
PORT=3000
ESP32_API_KEY=change-this-secret-key
DATABASE_FILE=data/water-level.db
READINGS_PER_SCAN=15
SCAN_INTERVAL_MS=2000
TOLERANCE_PERCENT=10
STABLE_DISPLAY_STEPS=5
ESP32_TIMEOUT_MS=30000
```

`.env` is ignored by Git so secret values are not uploaded.

If `ESP32_API_KEY` is empty or missing, the API key check is disabled. For deployment, set a real API key.

## SQLite Database

The app saves readings in a SQLite database file:

```text
data/water-level.db
```

The database is created automatically when the server starts.

Tables:

- `raw_readings`: saves every raw scan reading from mock mode or ESP32 mode.
- `stable_readings`: saves only final accepted values after the two-scan filtering cycle finishes.

The database file is ignored by Git because it contains generated runtime data.

## API Endpoints

### Health Check

```text
GET /api/health
```

Example response:

```json
{
  "status": "ok",
  "uptimeSeconds": 120,
  "dataSource": "esp32",
  "esp32Status": "online",
  "lastEsp32ReadingAt": "2026-05-25T07:30:00.000Z",
  "apiKeyRequired": true
}
```

### Get Current Water Level

```text
GET /api/water-level
```

### Send ESP32 Reading

```text
POST /api/water-level
```

Headers when API key is enabled:

```text
Content-Type: application/json
x-api-key: your-secret-key
```

Body:

```json
{
  "percentage": 42,
  "distanceCm": 202.3
}
```

### Get Recent Raw Readings

```text
GET /api/readings/recent
GET /api/readings/recent?limit=10
```

### Get Recent Stable Readings

```text
GET /api/stable-readings/recent
GET /api/stable-readings/recent?limit=10
```

## ESP32 HTTP Header Example

When `ESP32_API_KEY` is set in `.env`, add this header in the ESP32 code before sending the POST request:

```cpp
http.addHeader("Content-Type", "application/json");
http.addHeader("x-api-key", "your-secret-key");
```

The server URL should include the full API route:

```cpp
const char* serverUrl = "http://YOUR_LAPTOP_IP:3000/api/water-level";
```

For local Wi-Fi testing, do not use `localhost` in the ESP32 code. Use the laptop IP address.

## Two-Scan Filtering Method

The app reduces unstable wave readings using two scans:

1. Collect 15 baseline readings.
2. Calculate the median baseline value.
3. Collect 15 more readings.
4. Accept only readings inside baseline median +/- 10%.
5. Reject outside readings as wave irregularities.
6. Average accepted readings to calculate the final stable value.

The raw reading can update every ESP32 send, but the Current Level updates only after the full two-scan cycle finishes.

## Alert Thresholds

- 0% to 49%: Low Sea Level
- 50% to 79%: High Sea Level
- 80% to 89%: Very High Sea Level
- 90% to 100%: Flooding Level

## Deployment Notes

When deployed, update the ESP32 server URL to the public deployed URL:

```cpp
const char* serverUrl = "https://your-app-name.example.com/api/water-level";
```

Also set environment variables on the hosting platform, especially:

```text
ESP32_API_KEY
PORT
```

## Future Improvements

- Save alert logs for Very High and Flooding events
- Add CSV export
- Add calibration settings page
- Let the backend calculate percentage from distance only
- Add an About/Method page with a system diagram
