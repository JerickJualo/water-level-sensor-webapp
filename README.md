# Sea Water Level Sensor Web App

A school project web app for monitoring sea water level using Node.js, Express, HTML, CSS, and vanilla JavaScript.

The app currently supports mock data and ESP32 sensor data. The ESP32 sends water level readings to the Express API, and the dashboard shows the raw reading, stable final reading, scan progress, alerts, and saved history data.

## Features

- Express backend
- Dashboard served from the `public` folder
- ESP32-ready API endpoint
- Optional mock data fallback when ESP32 is offline
- Two-scan filtering method for wave irregularities
- Raw reading vs stable final reading display
- ESP32 online/offline status
- Health check endpoint for deployment
- API key protection for ESP32 POST requests in production
- SQLite storage for raw and stable readings
- History page with daily and monthly summaries from saved stable readings

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
npm.cmd ci
```

Start the app:

```powershell
npm.cmd start
```

Open the dashboard:

```text
http://localhost:3000
```

Run checks before deploying:

```powershell
npm.cmd test
```

This runs syntax checks and an API smoke test for `/api/health`, protected ESP32 POST requests, and history endpoints.

## Environment Config

Copy `.env.example` to `.env` and edit the values:

```text
PORT=3000
ESP32_API_KEY=change-this-secret-key
DATABASE_FILE=data/water-level.db
DATABASE_URL=
DATABASE_SSL=true
ENABLE_MOCK_DATA=true
ALLOWED_ORIGINS=
SENSOR_FULL_DISTANCE_CM=230
SENSOR_FULL_SCALE_PERCENT=120
READINGS_PER_SCAN=15
SCAN_INTERVAL_MS=2000
TOLERANCE_PERCENT=10
STABLE_DISPLAY_STEPS=5
ESP32_TIMEOUT_MS=30000
```

`.env` is ignored by Git so secret values are not uploaded.

For local testing, `ESP32_API_KEY` may be left empty to disable API key checks. In production (`NODE_ENV=production`), the API key is required, so set a real `ESP32_API_KEY` on the hosting platform and use the same value in the ESP32 device code.

`ENABLE_MOCK_DATA=true` keeps simulated readings running when the ESP32 is offline. In production, mock data is disabled by default unless this variable is explicitly set to `true`.

`ALLOWED_ORIGINS` controls browser CORS in production. Leave it empty for same-origin use only, or set comma-separated deployed frontend origins, for example:

```text
ALLOWED_ORIGINS=https://your-app-name.example.com
```

For deployment with an external hosted PostgreSQL database, set `DATABASE_URL` to the connection string from your database provider. When `DATABASE_URL` is set, the app stores readings in PostgreSQL instead of the local SQLite file.

## Sensor Calibration

Current measured setup:

- Full distance from sensor to sea floor: `230 cm`
- Full distance scale: `120%`
- Usable water level range: `0%` to `100%`

Because `230 cm` represents `120%`, the usable 0% to 100% water height is:

```text
230 / 1.2 = 191.67 cm
```

So the dashboard distance estimate is:

- `0%` water level: sensor reads about `230 cm`
- `100%` water level: sensor reads about `38 cm`

This keeps the sensor away from the water at the 100% level.

## Database Storage

For local development, the app saves readings in a SQLite database file:

```text
data/water-level.db
```

For deployment, use a hosted PostgreSQL database and set:

```text
DATABASE_URL=postgresql://...
DATABASE_SSL=true
```

The database tables are created automatically when the server starts.

Tables:

- `raw_readings`: saves every raw scan reading from mock mode or ESP32 mode.
- `stable_readings`: saves only final accepted values after the two-scan filtering cycle finishes.

The local SQLite database file is ignored by Git because it contains generated runtime data.

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
  "apiKeyRequired": true,
  "mockDataEnabled": false
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

If `distanceCm` is included, the backend calculates the percentage using the current sensor calibration. This keeps the web app calculation consistent even if the ESP32 also sends a percentage.

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

- 0% to 79%: Normal
- 80% to 89%: Warning
- 90% to 100%: Critical

## Deployment Notes

When deployed, update the ESP32 server URL to the public deployed URL:

```cpp
const char* serverUrl = "https://your-app-name.example.com/api/water-level";
```

Also set environment variables on the hosting platform, especially:

```text
NODE_ENV=production
ESP32_API_KEY
PORT
DATABASE_URL
DATABASE_SSL=true
ENABLE_MOCK_DATA=false
ALLOWED_ORIGINS=https://your-app-name.example.com
```

Use Node.js 24 or newer because the app uses the built-in `node:sqlite` module.

For client-facing deployment, use a hosted PostgreSQL database. This avoids losing saved history when a free web service restarts or redeploys. Keep SQLite only for local development or for paid hosts with persistent disk storage.

Keep `ENABLE_MOCK_DATA=false` in production if you only want real ESP32 readings saved to history. This prevents mock readings from filling the database while the ESP32 is offline.

In production, CORS is restricted. If the frontend and API are served from the same deployed app, `ALLOWED_ORIGINS` can be empty. If a separate frontend domain calls the API, add that exact `https://` origin to `ALLOWED_ORIGINS`.

## Future Improvements

- Save alert logs for Warning and Critical events
- Add CSV export
- Add calibration settings page
- Let the backend calculate percentage from distance only
- Add an About/Method page with a system diagram
