const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function getWaterStatus(percentage) {
  if (percentage >= 90) {
    return "Flooding Level";
  }

  if (percentage >= 80) {
    return "Very High Sea Level";
  }

  if (percentage >= 50) {
    return "High Sea Level";
  }

  return "Low Sea Level";
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
  const emptyDistanceCm = 30;
  const fullDistanceCm = 5;
  const distanceRange = emptyDistanceCm - fullDistanceCm;

  return Math.round(emptyDistanceCm - (percentage / 100) * distanceRange);
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

const readingsPerScan = 15;
const scanIntervalMs = 2000;
const tolerancePercent = 10;
const stableDisplaySteps = 5;
const esp32TimeoutMs = 30000;

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
  if (scanPhase === "baseline") {
    baselineReadings.push(reading);

    if (baselineReadings.length === readingsPerScan) {
      baselineMedian = calculateMedian(baselineReadings);
      scanPhase = "filtered";
    }
  } else if (scanPhase === "filtered") {
    const allowedRange = calculateAllowedRange(baselineMedian);

    if (reading >= allowedRange.min && reading <= allowedRange.max) {
      filteredReadings.push(reading);
      if (distanceCm !== null) {
        filteredDistances.push(distanceCm);
      }
    } else {
      rejectedReadings.push(reading);
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
    }
  } else if (scanPhase === "complete" && completeStepsRemaining > 0) {
    completeStepsRemaining -= 1;
  } else {
    resetScanCycle();
  }

  updateWaterData(reading, distanceCm);
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

runMockScanStep();
setInterval(runMockScanStep, scanIntervalMs);

app.get("/api/water-level", (req, res) => {
  res.json(waterData);
});

// ESP32 endpoint. Expected body example: { "percentage": 72, "distanceCm": 10 }
app.post("/api/water-level", (req, res) => {
  const percentage = Number(req.body.percentage);
  const distanceCm = getCleanDistanceCm(req.body.distanceCm);

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
