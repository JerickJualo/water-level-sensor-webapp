const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  lines.forEach((line) => {
    const trimmedLine = line.trim();

    if (trimmedLine === "" || trimmedLine.startsWith("#")) {
      return;
    }

    const equalsIndex = trimmedLine.indexOf("=");

    if (equalsIndex === -1) {
      return;
    }

    const key = trimmedLine.slice(0, equalsIndex).trim();
    const value = trimmedLine.slice(equalsIndex + 1).trim();

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}

loadEnvFile();

function getBooleanEnv(name, defaultValue) {
  const value = process.env[name];

  if (value === undefined) {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

const app = express();
const PORT = process.env.PORT || 3000;
const esp32ApiKey = process.env.ESP32_API_KEY || "";
const appIsProduction = process.env.NODE_ENV === "production";
const apiKeyIsRequired = esp32ApiKey !== "" || appIsProduction;
const mockDataEnabled = getBooleanEnv("ENABLE_MOCK_DATA", !appIsProduction);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin !== "");
const databaseFile = process.env.DATABASE_FILE || "data/water-level.db";
const databasePath = path.isAbsolute(databaseFile)
  ? databaseFile
  : path.join(__dirname, databaseFile);

if (!appIsProduction) {
  app.use(cors());
} else if (allowedOrigins.length > 0) {
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    }
  }));
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function getWaterStatus(percentage) {
  if (percentage >= 90) {
    return "Critical";
  }

  if (percentage >= 80) {
    return "Warning";
  }

  return "Normal";
}

function getStatusKey(percentage) {
  if (percentage >= 90) {
    return "flooding";
  }

  if (percentage >= 80) {
    return "veryHigh";
  }

  if (percentage >= 50) {
    return "high";
  }

  return "low";
}

function calculateMedian(values) {
  const sortedValues = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sortedValues.length / 2);

  if (sortedValues.length % 2 === 0) {
    return Math.round((sortedValues[middle - 1] + sortedValues[middle]) / 2);
  }

  return sortedValues[middle];
}

function calculateMean(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round(total / values.length);
}

function calculateDistanceCm(percentage) {
  return Math.round(sensorFullDistanceCm - (percentage / 100) * sensorUsableDistanceCm);
}

function calculatePercentageFromDistance(distanceCm) {
  const waterHeightCm = sensorFullDistanceCm - distanceCm;
  const percentage = (waterHeightCm / sensorUsableDistanceCm) * 100;

  return Math.round(Math.max(0, Math.min(100, percentage)));
}

function calculateAllowedRange(baseline) {
  const toleranceAmount = baseline * (tolerancePercent / 100);

  return {
    min: Math.max(0, Math.round(baseline - toleranceAmount)),
    max: Math.min(100, Math.round(baseline + toleranceAmount))
  };
}

function createMockSensorReading() {
  const stableWaterLevel = 58;
  const normalMovement = Math.round(Math.random() * 8) - 4;
  const waveSpikeChance = Math.random();

  if (waveSpikeChance < 0.2) {
    const waveSpike = Math.round(Math.random() * 30) - 15;
    return Math.max(0, Math.min(100, stableWaterLevel + waveSpike));
  }

  return Math.max(0, Math.min(100, stableWaterLevel + normalMovement));
}

const readingsPerScan = Number(process.env.READINGS_PER_SCAN) || 15;
const scanIntervalMs = Number(process.env.SCAN_INTERVAL_MS) || 2000;
const tolerancePercent = Number(process.env.TOLERANCE_PERCENT) || 10;
const stableDisplaySteps = Number(process.env.STABLE_DISPLAY_STEPS) || 5;
const esp32TimeoutMs = Number(process.env.ESP32_TIMEOUT_MS) || 30000;
const sensorFullDistanceCm = Number(process.env.SENSOR_FULL_DISTANCE_CM) || 230;
const sensorFullScalePercent = Number(process.env.SENSOR_FULL_SCALE_PERCENT) || 120;
const sensorUsableDistanceCm = sensorFullDistanceCm / (sensorFullScalePercent / 100);

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new DatabaseSync(databasePath);

database.exec(`
  CREATE TABLE IF NOT EXISTS raw_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    source TEXT NOT NULL,
    percentage INTEGER NOT NULL,
    distance_cm REAL,
    scan_phase TEXT NOT NULL,
    filter_result TEXT NOT NULL,
    baseline_median INTEGER,
    allowed_min INTEGER,
    allowed_max INTEGER
  );

  CREATE TABLE IF NOT EXISTS stable_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    source TEXT NOT NULL,
    percentage INTEGER NOT NULL,
    distance_cm REAL,
    status TEXT NOT NULL,
    accepted_count INTEGER NOT NULL,
    rejected_count INTEGER NOT NULL,
    baseline_median INTEGER
  );
`);

const insertRawReading = database.prepare(`
  INSERT INTO raw_readings (
    created_at,
    source,
    percentage,
    distance_cm,
    scan_phase,
    filter_result,
    baseline_median,
    allowed_min,
    allowed_max
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertStableReading = database.prepare(`
  INSERT INTO stable_readings (
    created_at,
    source,
    percentage,
    distance_cm,
    status,
    accepted_count,
    rejected_count,
    baseline_median
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

let baselineReadings = [];
let filteredReadings = [];
let filteredDistances = [];
let rejectedReadings = [];
let baselineMedian = null;
let scanPhase = "baseline";
let completeStepsRemaining = 0;
let finalAcceptedPercentage = null;
let finalAcceptedDistanceCm = null;
let finalAcceptedUpdatedAt = null;
let previousFinalAcceptedPercentage = null;
let previousFinalAcceptedUpdatedAt = null;
let dataSource = "mock";
let lastEsp32ReadingAt = null;

let waterData = {
  percentage: null,
  distanceCm: null,
  status: "Waiting",
  updatedAt: null,
  previousPercentage: null,
  previousUpdatedAt: null,
  scanPhase,
  currentReading: null,
  currentDistanceCm: null,
  dataSource,
  esp32Status: "offline",
  lastEsp32ReadingAt: null,
  baselineMedian,
  allowedMin: null,
  allowedMax: null,
  baselineCount: 0,
  acceptedCount: 0,
  rejectedCount: 0,
  readingsNeeded: readingsPerScan
};

function getCleanDistanceCm(distanceCm) {
  const cleanDistance = Number(distanceCm);

  if (Number.isNaN(cleanDistance) || cleanDistance < 0) {
    return null;
  }

  return cleanDistance;
}

function getEsp32Status() {
  const isOnline =
    lastEsp32ReadingAt !== null && Date.now() - lastEsp32ReadingAt < esp32TimeoutMs;

  return isOnline ? "online" : "offline";
}

function isValidApiKey(req) {
  if (!apiKeyIsRequired) {
    return true;
  }

  return req.get("x-api-key") === esp32ApiKey;
}

function saveRawReading(reading, distanceCm, filterResult) {
  const allowedRange = baselineMedian === null ? null : calculateAllowedRange(baselineMedian);

  insertRawReading.run(
    new Date().toISOString(),
    dataSource,
    reading,
    distanceCm,
    scanPhase,
    filterResult,
    baselineMedian,
    allowedRange === null ? null : allowedRange.min,
    allowedRange === null ? null : allowedRange.max
  );
}

function saveStableReading() {
  if (finalAcceptedPercentage === null) {
    return;
  }

  insertStableReading.run(
    finalAcceptedUpdatedAt,
    dataSource,
    finalAcceptedPercentage,
    finalAcceptedDistanceCm,
    getWaterStatus(finalAcceptedPercentage),
    filteredReadings.length,
    rejectedReadings.length,
    baselineMedian
  );
}

function getSafeLimit(value, defaultLimit) {
  const limit = Number(value);

  if (Number.isNaN(limit) || limit < 1) {
    return defaultLimit;
  }

  return Math.min(Math.round(limit), 200);
}

function getSafeDays(value, defaultDays) {
  const days = Number(value);

  if (Number.isNaN(days) || days < 1) {
    return defaultDays;
  }

  return Math.min(Math.round(days), 31);
}

function getTimeBlockLabel(index) {
  return ["12AM-6AM", "6AM-12PM", "12PM-6PM", "6PM-12AM"][index];
}

function getTimeBlockIndex(date) {
  const hour = date.getHours();

  if (hour < 6) {
    return 0;
  }

  if (hour < 12) {
    return 1;
  }

  if (hour < 18) {
    return 2;
  }

  return 3;
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return year + "-" + month + "-" + day;
}

function createEmptyCounts() {
  return {
    low: 0,
    high: 0,
    veryHigh: 0,
    flooding: 0
  };
}

function getStableRowsForDays(days) {
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);

  return database
    .prepare(
      "SELECT * FROM stable_readings WHERE created_at >= ? ORDER BY created_at DESC"
    )
    .all(since.toISOString());
}

function buildDailyHistory(days) {
  const rows = getStableRowsForDays(days);
  const map = new Map();

  rows.forEach((row) => {
    const date = new Date(row.created_at);
    const dateKey = formatDateKey(date);

    if (!map.has(dateKey)) {
      map.set(dateKey, {
        dateKey,
        displayDate: date.toLocaleDateString(),
        blocks: [0, 1, 2, 3].map((index) => ({
          label: getTimeBlockLabel(index),
          samples: []
        })),
        samples: [],
        counts: createEmptyCounts()
      });
    }

    const record = map.get(dateKey);
    const level = Number(row.percentage);
    const statusKey = getStatusKey(level);
    const blockIndex = getTimeBlockIndex(date);

    record.blocks[blockIndex].samples.push(level);
    record.samples.push(level);
    record.counts[statusKey] += 1;
  });

  return Array.from(map.values()).map((record) => {
    const highest = Math.max(...record.samples);
    const lowest = Math.min(...record.samples);
    const average = calculateMean(record.samples);

    return {
      dateKey: record.dateKey,
      displayDate: record.displayDate,
      blocks: record.blocks.map((block) => ({
        label: block.label,
        average: block.samples.length === 0 ? null : calculateMean(block.samples)
      })),
      average,
      highest,
      lowest,
      counts: record.counts,
      reached: Object.keys(record.counts).filter((key) => record.counts[key] > 0),
      dailyRisk: getStatusKey(highest),
      readingCount: record.samples.length
    };
  });
}

function buildMonthlyHistory() {
  const rows = database
    .prepare("SELECT * FROM stable_readings ORDER BY created_at DESC LIMIT 1000")
    .all();
  const map = new Map();

  rows.forEach((row) => {
    const date = new Date(row.created_at);
    const monthKey =
      date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");

    if (!map.has(monthKey)) {
      map.set(monthKey, {
        monthKey,
        displayMonth: date.toLocaleDateString(undefined, {
          month: "long",
          year: "numeric"
        }),
        samples: [],
        floodingDays: new Set(),
        veryHighDays: new Set()
      });
    }

    const record = map.get(monthKey);
    const level = Number(row.percentage);
    const dateKey = formatDateKey(date);

    record.samples.push(level);

    if (level >= 90) {
      record.floodingDays.add(dateKey);
    } else if (level >= 80) {
      record.veryHighDays.add(dateKey);
    }
  });

  return Array.from(map.values()).map((record) => {
    const highest = Math.max(...record.samples);
    const lowest = Math.min(...record.samples);

    return {
      monthKey: record.monthKey,
      displayMonth: record.displayMonth,
      average: calculateMean(record.samples),
      highest,
      lowest,
      floodingDays: record.floodingDays.size,
      veryHighDays: record.veryHighDays.size,
      monthlyRisk: getStatusKey(highest),
      readingCount: record.samples.length
    };
  });
}

function updateWaterData(currentReading, currentDistanceCm) {
  const allowedRange = baselineMedian === null ? null : calculateAllowedRange(baselineMedian);

  waterData = {
    percentage: finalAcceptedPercentage,
    distanceCm: finalAcceptedDistanceCm,
    status: finalAcceptedPercentage === null
      ? "Waiting"
      : scanPhase === "complete"
        ? getWaterStatus(finalAcceptedPercentage)
        : "Scanning",
    updatedAt: finalAcceptedUpdatedAt,
    previousPercentage: previousFinalAcceptedPercentage,
    previousUpdatedAt: previousFinalAcceptedUpdatedAt,
    scanPhase,
    currentReading,
    currentDistanceCm,
    dataSource,
    esp32Status: getEsp32Status(),
    lastEsp32ReadingAt:
      lastEsp32ReadingAt === null ? null : new Date(lastEsp32ReadingAt).toISOString(),
    baselineMedian,
    allowedMin: allowedRange === null ? null : allowedRange.min,
    allowedMax: allowedRange === null ? null : allowedRange.max,
    baselineCount: baselineReadings.length,
    acceptedCount: filteredReadings.length,
    rejectedCount: rejectedReadings.length,
    readingsNeeded: readingsPerScan
  };
}

function resetScanCycle() {
  baselineReadings = [];
  filteredReadings = [];
  filteredDistances = [];
  rejectedReadings = [];
  baselineMedian = null;
  scanPhase = "baseline";
  completeStepsRemaining = 0;
}

function processWaterReading(reading, distanceCm) {
  let filterResult = "waiting";
  let stableReadingIsReady = false;

  if (scanPhase === "baseline") {
    baselineReadings.push(reading);
    filterResult = "baseline";

    if (baselineReadings.length === readingsPerScan) {
      baselineMedian = calculateMedian(baselineReadings);
      scanPhase = "filtered";
    }
  } else if (scanPhase === "filtered") {
    const allowedRange = calculateAllowedRange(baselineMedian);

    if (reading >= allowedRange.min && reading <= allowedRange.max) {
      filteredReadings.push(reading);
      filterResult = "accepted";
      if (distanceCm !== null) {
        filteredDistances.push(distanceCm);
      }
    } else {
      rejectedReadings.push(reading);
      filterResult = "rejected";
    }

    if (filteredReadings.length + rejectedReadings.length === readingsPerScan) {
      scanPhase = "complete";
      completeStepsRemaining = stableDisplaySteps;
      previousFinalAcceptedPercentage = finalAcceptedPercentage;
      previousFinalAcceptedUpdatedAt = finalAcceptedUpdatedAt;
      finalAcceptedPercentage =
        filteredReadings.length > 0 ? calculateMean(filteredReadings) : baselineMedian;
      finalAcceptedDistanceCm =
        filteredDistances.length > 0
          ? calculateMean(filteredDistances)
          : calculateDistanceCm(finalAcceptedPercentage);
      finalAcceptedUpdatedAt = new Date().toISOString();
      stableReadingIsReady = true;
    }
  } else if (scanPhase === "complete" && completeStepsRemaining > 0) {
    completeStepsRemaining -= 1;
    filterResult = "stable_display";
  } else {
    resetScanCycle();
    filterResult = "cycle_restart";
  }

  updateWaterData(reading, distanceCm);
  saveRawReading(reading, distanceCm, filterResult);

  if (stableReadingIsReady) {
    saveStableReading();
  }
}

function switchDataSource(nextSource) {
  if (dataSource !== nextSource) {
    dataSource = nextSource;
    resetScanCycle();
  }
}

function runMockScanStep() {
  const esp32IsRecentlyActive =
    lastEsp32ReadingAt !== null && Date.now() - lastEsp32ReadingAt < esp32TimeoutMs;

  if (dataSource === "esp32" && esp32IsRecentlyActive) {
    return;
  }

  switchDataSource("mock");
  processWaterReading(createMockSensorReading(), null);
}

if (mockDataEnabled) {
  runMockScanStep();
  setInterval(runMockScanStep, scanIntervalMs);
}

app.get("/api/water-level", (req, res) => {
  waterData.esp32Status = getEsp32Status();
  res.json(waterData);
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
    dataSource,
    esp32Status: getEsp32Status(),
    lastEsp32ReadingAt:
      lastEsp32ReadingAt === null ? null : new Date(lastEsp32ReadingAt).toISOString(),
    apiKeyRequired: apiKeyIsRequired,
    mockDataEnabled,
    corsAllowedOrigins: appIsProduction ? allowedOrigins : ["*"],
    databaseFile,
    calibration: {
      sensorFullDistanceCm,
      sensorFullScalePercent,
      sensorUsableDistanceCm: Math.round(sensorUsableDistanceCm)
    }
  });
});

app.get("/api/readings/recent", (req, res) => {
  const limit = getSafeLimit(req.query.limit, 50);
  const readings = database
    .prepare("SELECT * FROM raw_readings ORDER BY id DESC LIMIT ?")
    .all(limit);

  res.json({
    count: readings.length,
    readings
  });
});

app.get("/api/stable-readings/recent", (req, res) => {
  const limit = getSafeLimit(req.query.limit, 31);
  const readings = database
    .prepare("SELECT * FROM stable_readings ORDER BY id DESC LIMIT ?")
    .all(limit);

  res.json({
    count: readings.length,
    readings
  });
});

app.get("/api/history/daily", (req, res) => {
  const days = getSafeDays(req.query.days, 7);
  const records = buildDailyHistory(days);

  res.json({
    count: records.length,
    days,
    records
  });
});

app.get("/api/history/monthly", (req, res) => {
  const records = buildMonthlyHistory();

  res.json({
    count: records.length,
    records
  });
});

app.get("/api/alerts/recent", (req, res) => {
  const limit = getSafeLimit(req.query.limit, 50);
  const alerts = database
    .prepare(
      "SELECT * FROM stable_readings WHERE percentage >= 80 ORDER BY id DESC LIMIT ?"
    )
    .all(limit);

  res.json({
    count: alerts.length,
    alerts
  });
});

app.get("/api/calibration", (req, res) => {
  res.json({
    sensorFullDistanceCm,
    sensorFullScalePercent,
    sensorUsableDistanceCm: Number(sensorUsableDistanceCm.toFixed(2)),
    sensorDistanceAtZeroPercentCm: sensorFullDistanceCm,
    sensorDistanceAtFullPercentCm: Number(calculateDistanceCm(100).toFixed(2)),
    tolerancePercent,
    readingsPerScan,
    scanIntervalMs,
    esp32TimeoutMs
  });
});

// ESP32 endpoint. Expected body example: { "percentage": 72, "distanceCm": 10 }
app.post("/api/water-level", (req, res) => {
  if (!isValidApiKey(req)) {
    return res.status(401).json({
      error: "Invalid or missing API key"
    });
  }

  const distanceCm = getCleanDistanceCm(req.body.distanceCm);
  const percentage = distanceCm === null
    ? Number(req.body.percentage)
    : calculatePercentageFromDistance(distanceCm);

  if (Number.isNaN(percentage) || percentage < 0 || percentage > 100) {
    return res.status(400).json({
      error: "percentage must be a number from 0 to 100"
    });
  }

  lastEsp32ReadingAt = Date.now();
  switchDataSource("esp32");
  processWaterReading(Math.round(percentage), distanceCm);

  res.json({
    message: "ESP32 water level reading received",
    waterData
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
