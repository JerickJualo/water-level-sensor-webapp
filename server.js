const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function getWaterStatus(percentage) {
  if (percentage < 30) {
    return "Low";
  }

  if (percentage > 80) {
    return "High";
  }

  return "Normal";
}

// Mock water level data for Phase 1. The ESP32 can update this later.
let waterData = {
  percentage: 45,
  distanceCm: 18,
  status: "Normal",
  updatedAt: new Date().toISOString()
};

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
    updatedAt: new Date().toISOString()
  };

  res.json({
    message: "Water level data received",
    waterData
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
