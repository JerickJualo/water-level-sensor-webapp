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

let baselineReadings = [];
let filteredReadings = [];
let rejectedReadings = [];
let baselineMedian = null;
let scanPhase = "baseline";
let completeStepsRemaining = 0;
let finalAcceptedPercentage = null;
let finalAcceptedUpdatedAt = null;
let previousFinalAcceptedPercentage = null;
let previousFinalAcceptedUpdatedAt = null;

let waterData = {
  percentage: null,
  distanceCm: null,
  status: "Waiting",
  updatedAt: null,
  previousPercentage: null,
  previousUpdatedAt: null,
  scanPhase,
  currentReading: null,
  baselineMedian,
  allowedMin: null,
  allowedMax: null,
  baselineCount: 0,
  acceptedCount: 0,
  rejectedCount: 0,
  readingsNeeded: readingsPerScan
};

function updateWaterData(currentReading) {
  const allowedMin =
    baselineMedian === null ? null : Math.max(0, baselineMedian - tolerancePercent);
  const allowedMax =
    baselineMedian === null ? null : Math.min(100, baselineMedian + tolerancePercent);

  waterData = {
    percentage: finalAcceptedPercentage,
    distanceCm:
      finalAcceptedPercentage === null ? null : calculateDistanceCm(finalAcceptedPercentage),
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
    baselineMedian,
    allowedMin,
    allowedMax,
    baselineCount: baselineReadings.length,
    acceptedCount: filteredReadings.length,
    rejectedCount: rejectedReadings.length,
    readingsNeeded: readingsPerScan
  };
}

function resetScanCycle() {
  baselineReadings = [];
  filteredReadings = [];
  rejectedReadings = [];
  baselineMedian = null;
  scanPhase = "baseline";
  completeStepsRemaining = 0;
}

function runMockScanStep() {
  const reading = createMockSensorReading();

  if (scanPhase === "baseline") {
    baselineReadings.push(reading);

    if (baselineReadings.length === readingsPerScan) {
      baselineMedian = calculateMedian(baselineReadings);
      scanPhase = "filtered";
    }
  } else if (scanPhase === "filtered") {
    const allowedMin = Math.max(0, baselineMedian - tolerancePercent);
    const allowedMax = Math.min(100, baselineMedian + tolerancePercent);

    if (reading >= allowedMin && reading <= allowedMax) {
      filteredReadings.push(reading);
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
      finalAcceptedUpdatedAt = new Date().toISOString();
    }
  } else if (scanPhase === "complete" && completeStepsRemaining > 0) {
    completeStepsRemaining -= 1;
  } else {
    resetScanCycle();
  }

  updateWaterData(reading);
}

runMockScanStep();
setInterval(runMockScanStep, scanIntervalMs);

app.get("/api/water-level", (req, res) => {
  res.json(waterData);
});

// Future ESP32 endpoint. Expected body example: { "percentage": 72, "distanceCm": 10 }
app.post("/api/water-level", (req, res) => {
  const percentage = Number(req.body.percentage);
  const distanceCm = Number(req.body.distanceCm);

  if (Number.isNaN(percentage) || percentage < 0 || percentage > 100) {
    return res.status(400).json({
      error: "percentage must be a number from 0 to 100"
    });
  }

  waterData = {
    percentage,
    distanceCm: Number.isNaN(distanceCm) ? null : distanceCm,
    status: getWaterStatus(percentage),
    updatedAt: new Date().toISOString(),
    previousPercentage: finalAcceptedPercentage,
    previousUpdatedAt: finalAcceptedUpdatedAt,
    scanPhase: "manual",
    currentReading: percentage,
    baselineMedian: null,
    allowedMin: null,
    allowedMax: null,
    baselineCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    readingsNeeded: readingsPerScan
  };

  res.json({
    message: "Water level data received",
    waterData
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
