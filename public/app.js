const historyLimit = 36;
const readingsPerScan = 15;
const tolerancePercent = 10;
const stableDisplaySteps = 5;
const sensorFullDistanceCm = 230;
const sensorFullScalePercent = 120;
const sensorUsableDistanceCm = sensorFullDistanceCm / (sensorFullScalePercent / 100);
const demoScenarios = {
  api: {
    name: "ESP32-ready API data",
    base: 58,
    swing: 7,
    noise: 6
  },
  stable: {
    name: "Stable weather",
    base: 42,
    swing: 2,
    noise: 2
  },
  raining: {
    name: "Raining",
    base: 63,
    swing: 5,
    noise: 6
  },
  storming: {
    name: "Storming",
    base: 76,
    swing: 14,
    noise: 12
  },
  rising: {
    name: "Rising tide",
    base: 48,
    swing: 6,
    noise: 4,
    rise: 1.25
  },
  flooding: {
    name: "Flooding risk",
    base: 92,
    swing: 5,
    noise: 5
  }
};

let selectedScenario = "api";
let demoTick = 0;
let demoFilter = createEmptyDemoFilter();
const historyReadings = createMockHistory(demoScenarios.api);
const dailyTableLimit = 31;
const dailyHistoryRecords = createDailyHistoryRecords(186);

function createMockHistory(scenario) {
  const readings = [];

  for (let index = 0; index < historyLimit; index += 1) {
    readings.push(createScenarioReading(scenario, index));
  }

  return readings;
}

async function loadData() {
  try {
    const data = selectedScenario === "api"
      ? await fetchApiData()
      : createDemoData(selectedScenario);
    const level = getDisplayLevel(data);
    const liveGraphLevel = getLiveGraphLevel(data);
    const status = getSeaLevelStatus(level);

    updateCurrentReading(data, level, status);
    updateChart(liveGraphLevel);
  } catch (error) {
    setOfflineState();
  }
}

async function fetchApiData() {
  const res = await fetch("/api/water-level");
  return res.json();
}

function createDemoData(scenarioKey) {
  const scenario = demoScenarios[scenarioKey];
  const currentReading = createScenarioReading(scenario, demoTick);
  advanceDemoFilter(currentReading);
  demoTick += 1;

  return {
    percentage: demoFilter.finalPercentage,
    distanceCm:
      demoFilter.finalPercentage === null ? null : calculateMockDistance(demoFilter.finalPercentage),
    status: getSeaLevelStatus(demoFilter.finalPercentage).text,
    updatedAt: demoFilter.finalUpdatedAt,
    previousPercentage: demoFilter.previousPercentage,
    previousUpdatedAt: demoFilter.previousUpdatedAt,
    scanPhase: demoFilter.phase,
    currentReading,
    baselineCount: demoFilter.baselineReadings.length,
    acceptedCount: demoFilter.filteredReadings.length,
    rejectedCount: demoFilter.rejectedReadings.length,
    readingsNeeded: readingsPerScan,
    dataSource: "demo",
    esp32Status: "offline",
    currentDistanceCm: calculateMockDistance(currentReading)
  };
}

function createEmptyDemoFilter() {
  return {
    baselineReadings: [],
    filteredReadings: [],
    rejectedReadings: [],
    baselineMedian: null,
    phase: "baseline",
    completeStepsRemaining: 0,
    finalPercentage: null,
    finalUpdatedAt: null,
    previousPercentage: null,
    previousUpdatedAt: null
  };
}

function advanceDemoFilter(reading) {
  if (demoFilter.phase === "baseline") {
    demoFilter.baselineReadings.push(reading);

    if (demoFilter.baselineReadings.length === readingsPerScan) {
      demoFilter.baselineMedian = calculateMedian(demoFilter.baselineReadings);
      demoFilter.phase = "filtered";
    }

    return;
  }

  if (demoFilter.phase === "filtered") {
    const allowedRange = calculateAllowedRange(demoFilter.baselineMedian);

    if (reading >= allowedRange.min && reading <= allowedRange.max) {
      demoFilter.filteredReadings.push(reading);
    } else {
      demoFilter.rejectedReadings.push(reading);
    }

    if (demoFilter.filteredReadings.length + demoFilter.rejectedReadings.length === readingsPerScan) {
      demoFilter.previousPercentage = demoFilter.finalPercentage;
      demoFilter.previousUpdatedAt = demoFilter.finalUpdatedAt;
      demoFilter.finalPercentage = demoFilter.filteredReadings.length > 0
        ? calculateMean(demoFilter.filteredReadings)
        : demoFilter.baselineMedian;
      demoFilter.finalUpdatedAt = new Date().toISOString();
      demoFilter.phase = "complete";
      demoFilter.completeStepsRemaining = stableDisplaySteps;
    }

    return;
  }

  if (demoFilter.phase === "complete" && demoFilter.completeStepsRemaining > 0) {
    demoFilter.completeStepsRemaining -= 1;
    return;
  }

  const finalPercentage = demoFilter.finalPercentage;
  const finalUpdatedAt = demoFilter.finalUpdatedAt;
  const previousPercentage = demoFilter.previousPercentage;
  const previousUpdatedAt = demoFilter.previousUpdatedAt;
  demoFilter = createEmptyDemoFilter();
  demoFilter.finalPercentage = finalPercentage;
  demoFilter.finalUpdatedAt = finalUpdatedAt;
  demoFilter.previousPercentage = previousPercentage;
  demoFilter.previousUpdatedAt = previousUpdatedAt;
  demoFilter.baselineReadings.push(reading);
}

function createScenarioReading(scenario, index) {
  const waveMotion = Math.sin(index / 2.8) * scenario.swing;
  const fastMotion = Math.sin(index / 1.3) * (scenario.swing / 2);
  const randomNoise = Math.round(Math.random() * scenario.noise - scenario.noise / 2);
  const risingAmount = scenario.rise ? index * scenario.rise : 0;
  const reading = scenario.base + waveMotion + fastMotion + randomNoise + risingAmount;

  return Math.round(Math.max(0, Math.min(100, reading)));
}

function calculateMockDistance(percentage) {
  return Math.round(sensorFullDistanceCm - (percentage / 100) * sensorUsableDistanceCm);
}

function calculateAllowedRange(baseline) {
  const toleranceAmount = baseline * (tolerancePercent / 100);

  return {
    min: Math.max(0, Math.round(baseline - toleranceAmount)),
    max: Math.min(100, Math.round(baseline + toleranceAmount))
  };
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

function getDisplayLevel(data) {
  const finalLevel = getNumberOrNull(data.percentage);

  if (finalLevel !== null) {
    return finalLevel;
  }

  return null;
}

function getLiveGraphLevel(data) {
  const currentReading = getNumberOrNull(data.currentReading);
  const finalLevel = getNumberOrNull(data.percentage);

  if (currentReading !== null) {
    return currentReading;
  }

  return finalLevel;
}

function getNumberOrNull(value) {
  if (value == null) {
    return null;
  }

  const number = Number(value);
  return Number.isNaN(number) ? null : number;
}

function getSeaLevelStatus(level) {
  if (level === null) {
    return {
      text: "Waiting for sea level data",
      className: "status-waiting"
    };
  }

  if (level >= 90) {
    return {
      text: "Flooding Level",
      className: "status-flooding"
    };
  }

  if (level >= 80) {
    return {
      text: "Very High Sea Level",
      className: "status-very-high"
    };
  }

  if (level >= 50) {
    return {
      text: "High Sea Level",
      className: "status-high"
    };
  }

  return {
    text: "Low Sea Level",
    className: "status-low"
  };
}

function getStatusKey(level) {
  if (level >= 90) {
    return "flooding";
  }

  if (level >= 80) {
    return "veryHigh";
  }

  if (level >= 50) {
    return "high";
  }

  return "low";
}

function getStatusLabel(key) {
  const labels = {
    low: "Low Sea Level",
    high: "High Sea Level",
    veryHigh: "Very High Sea Level",
    flooding: "Flooding Level"
  };

  return labels[key];
}

function getStatusChipClass(key) {
  const classes = {
    low: "chip-low",
    high: "chip-high",
    veryHigh: "chip-very-high",
    flooding: "chip-flooding"
  };

  return classes[key];
}

function updateCurrentReading(data, level, status) {
  const percentageText = level === null ? "--%" : level + "%";
  const distanceText = data.distanceCm == null ? "-- cm" : data.distanceCm + " cm";
  const rawReading = getNumberOrNull(data.currentReading);
  const rawDistance = getNumberOrNull(data.currentDistanceCm);
  const rawText = rawReading === null ? "--%" : rawReading + "%";
  const rawDistanceText = rawDistance === null ? "" : " / " + rawDistance + " cm";
  const previousLevel = getNumberOrNull(data.previousPercentage);

  document.getElementById("level").innerText = percentageText;
  document.getElementById("gauge-percent").innerText = percentageText;
  document.getElementById("gauge-fill").style.height = level === null ? "0%" : level + "%";
  document.getElementById("distance").innerText = distanceText;
  document.getElementById("raw-reading").innerText = rawText + rawDistanceText;
  document.getElementById("scan-phase").innerText = formatPhase(data.scanPhase);
  document.getElementById("previous-level").innerText =
    previousLevel === null ? "No previous result" : previousLevel + "%";
  document.getElementById("data-source").innerText = formatDataSource(data.dataSource);
  document.getElementById("esp32-status").innerText = formatEsp32Status(data.esp32Status);
  document.getElementById("last-reading").innerText =
    "Last reading: " + formatTimeOrWaiting(data.updatedAt, "waiting for sensor data");
  updateScanProgress(data);

  const statusElement = document.getElementById("status");
  statusElement.innerText = status.text;
  statusElement.className = "status-text " + status.className;
}

function updateScanProgress(data) {
  const progress = getScanProgress(data);
  const progressBar = document.querySelector(".scan-progress-track");

  document.getElementById("scan-progress-percent").innerText = progress.percent + "%";
  document.getElementById("scan-progress-fill").style.width = progress.percent + "%";
  document.getElementById("scan-progress-text").innerText = progress.text;
  progressBar.setAttribute("aria-valuenow", String(progress.percent));
}

function getScanProgress(data) {
  const needed = Number(data.readingsNeeded) || readingsPerScan;
  const totalNeeded = needed * 2;
  const baselineCount = Math.min(getPositiveNumber(data.baselineCount), needed);
  const secondScanCount = Math.min(
    getPositiveNumber(data.acceptedCount) + getPositiveNumber(data.rejectedCount),
    needed
  );
  const completedReadings = Math.min(baselineCount + secondScanCount, totalNeeded);
  const percent = Math.round((completedReadings / totalNeeded) * 100);
  const remainingReadings = Math.max(0, totalNeeded - completedReadings);
  const secondsRemaining = remainingReadings * 2;

  if (data.scanPhase === "complete") {
    return {
      percent: 100,
      text: "Final accepted value is ready"
    };
  }

  if (data.scanPhase === "filtered") {
    return {
      percent,
      text:
        "Second scan: " +
        secondScanCount +
        " of " +
        needed +
        " readings, about " +
        secondsRemaining +
        " seconds remaining"
    };
  }

  if (data.scanPhase === "baseline") {
    return {
      percent,
      text:
        "First scan: " +
        baselineCount +
        " of " +
        needed +
        " readings, about " +
        secondsRemaining +
        " seconds remaining"
    };
  }

  return {
    percent: 0,
    text: "Waiting for readings"
  };
}

function getPositiveNumber(value) {
  const number = Number(value);

  if (Number.isNaN(number) || number < 0) {
    return 0;
  }

  return number;
}

function formatDataSource(source) {
  if (source === "esp32") {
    return "ESP32";
  }

  if (source === "demo") {
    return "Demo";
  }

  return "Mock";
}

function formatEsp32Status(status) {
  if (status === "online") {
    return "Online";
  }

  return "Offline";
}

function formatPhase(phase) {
  if (phase === "baseline") {
    return "Baseline Scan";
  }

  if (phase === "filtered") {
    return "Filtered Scan";
  }

  if (phase === "complete") {
    return "Stable Result";
  }

  if (phase === "manual") {
    return "Manual Input";
  }

  return "Starting";
}

function formatTimeOrWaiting(value, waitingText) {
  if (value == null) {
    return waitingText;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return waitingText;
  }

  return date.toLocaleTimeString();
}

function updateChart(level) {
  if (level !== null) {
    historyReadings.push(level);
    historyReadings.splice(0, Math.max(0, historyReadings.length - historyLimit));
  }

  drawChart(historyReadings);
  document.getElementById("chart-summary").innerText =
    historyReadings.length + " recent readings";
}

function setScenario(scenarioKey) {
  selectedScenario = scenarioKey;
  demoTick = 0;
  demoFilter = createEmptyDemoFilter();
  const scenario = demoScenarios[scenarioKey];
  document.getElementById("scenario-name").innerText = scenario.name;
  historyReadings.splice(0, historyReadings.length, ...createMockHistory(scenario));
  drawChart(historyReadings);
  loadData();
}

function drawChart(readings) {
  const canvas = document.getElementById("history-chart");
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = 34;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height, padding, chartWidth, chartHeight);

  if (readings.length < 2) {
    return;
  }

  const points = readings.map((reading, index) => {
    const x = padding + (index / (readings.length - 1)) * chartWidth;
    const y = padding + (1 - reading / 100) * chartHeight;
    return { x, y };
  });

  const gradient = ctx.createLinearGradient(0, padding, 0, height - padding);
  gradient.addColorStop(0, "rgba(47, 157, 224, 0.5)");
  gradient.addColorStop(1, "rgba(47, 157, 224, 0.12)");

  ctx.beginPath();
  ctx.moveTo(points[0].x, height - padding);
  points.forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.lineTo(points[points.length - 1].x, height - padding);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.strokeStyle = "#1675bd";
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawGrid(ctx, width, height, padding, chartWidth, chartHeight) {
  ctx.strokeStyle = "#dce8ef";
  ctx.lineWidth = 1;
  ctx.font = "12px Arial";
  ctx.fillStyle = "#6d7c8b";

  [0, 25, 50, 75, 100].forEach((value) => {
    const y = padding + (1 - value / 100) * chartHeight;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
    ctx.fillText(value + "%", 8, y + 4);
  });

  [
    { value: 90, color: "#df4d4d" },
    { value: 80, color: "#ef7b2d" },
    { value: 50, color: "#f1a33a" }
  ].forEach((line) => {
    const y = padding + (1 - line.value / 100) * chartHeight;
    ctx.beginPath();
    ctx.setLineDash([6, 6]);
    ctx.moveTo(padding, y);
    ctx.lineTo(padding + chartWidth, y);
    ctx.strokeStyle = line.color;
    ctx.stroke();
    ctx.setLineDash([]);
  });
}

function setOfflineState() {
  document.getElementById("status").innerText = "Offline";
  document.getElementById("status").className = "status-text status-waiting";
  document.getElementById("last-reading").innerText = "Last reading: unable to load data";
}

function createDailyHistoryRecords(days) {
  const records = [];
  const today = new Date();

  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - dayOffset);
    date.setHours(0, 0, 0, 0);

    const dayPattern = dayOffset % 6;
    const baseLevels = [
      [39, 46, 55, 52],
      [44, 58, 66, 62],
      [52, 68, 79, 73],
      [61, 78, 85, 82],
      [72, 86, 93, 88],
      [36, 50, 64, 57]
    ][dayPattern];

    const blocks = baseLevels.map((base, blockIndex) => {
      const samples = Array.from({ length: 12 }, (_, sampleIndex) => {
        const tideMotion = Math.sin((sampleIndex + blockIndex * 2) / 2) * 5;
        const noise = Math.round(Math.random() * 8 - 4);
        return Math.round(Math.max(0, Math.min(100, base + tideMotion + noise)));
      });

      return {
        label: getTimeBlockLabel(blockIndex),
        average: calculateMean(samples),
        highest: Math.max(...samples),
        lowest: Math.min(...samples),
        samples
      };
    });

    const allSamples = blocks.flatMap((block) => block.samples);
    const counts = allSamples.reduce(
      (result, level) => {
        result[getStatusKey(level)] += 1;
        return result;
      },
      { low: 0, high: 0, veryHigh: 0, flooding: 0 }
    );
    const highest = Math.max(...allSamples);
    const lowest = Math.min(...allSamples);
    const average = calculateMean(allSamples);
    const reached = Object.keys(counts).filter((key) => counts[key] > 0);

    records.push({
      date,
      dateKey: formatDateKey(date),
      displayDate: date.toLocaleDateString(),
      blocks,
      average,
      highest,
      lowest,
      counts,
      reached,
      dailyRisk: getStatusKey(highest)
    });
  }

  return records;
}

function getTimeBlockLabel(index) {
  return ["12AM-6AM", "6AM-12PM", "12PM-6PM", "6PM-12AM"][index];
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function renderHistoryPage() {
  renderHistoryDateOptions();
  renderHistoryTable();
  renderMonthlyHistory();
  updateSelectedDayHistory();
}

function getFilteredHistoryRecords() {
  const days = Number(document.getElementById("history-range").value);
  return dailyHistoryRecords.slice(0, Math.min(days, dailyTableLimit));
}

function renderHistoryDateOptions() {
  const dateSelect = document.getElementById("history-date");
  const selectedValue = dateSelect.value;
  const records = getFilteredHistoryRecords();

  dateSelect.innerHTML = records
    .map((record) => {
      return '<option value="' + record.dateKey + '">' + record.displayDate + "</option>";
    })
    .join("");

  if (records.some((record) => record.dateKey === selectedValue)) {
    dateSelect.value = selectedValue;
  }
}

function renderHistoryTable() {
  const records = getFilteredHistoryRecords();
  const body = document.getElementById("daily-summary-body");

  body.innerHTML = records
    .map((record) => {
      const blockCells = record.blocks
        .map((block) => "<td>" + block.average + "%</td>")
        .join("");

      return (
        "<tr>" +
        "<td>" + record.displayDate + "</td>" +
        blockCells +
        "<td>" + record.highest + "%</td>" +
        "<td>" + record.lowest + "%</td>" +
        "<td>" + renderReachedChips(record.reached) + "</td>" +
        "<td>" + renderStatusChip(record.dailyRisk) + "</td>" +
        "</tr>"
      );
    })
    .join("");

  document.getElementById("history-table-count").innerText = records.length + " records";
}

function createMonthlyHistoryRecords() {
  const monthMap = new Map();

  dailyHistoryRecords.forEach((record) => {
    const monthKey = record.date.getFullYear() + "-" + String(record.date.getMonth() + 1).padStart(2, "0");

    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, {
        monthKey,
        displayMonth: record.date.toLocaleDateString(undefined, {
          month: "long",
          year: "numeric"
        }),
        days: []
      });
    }

    monthMap.get(monthKey).days.push(record);
  });

  return Array.from(monthMap.values()).map((month) => {
    const averages = month.days.map((day) => day.average);
    const highest = Math.max(...month.days.map((day) => day.highest));
    const lowest = Math.min(...month.days.map((day) => day.lowest));
    const floodingDays = month.days.filter((day) => day.dailyRisk === "flooding").length;
    const veryHighDays = month.days.filter((day) => day.dailyRisk === "veryHigh").length;

    return {
      ...month,
      average: calculateMean(averages),
      highest,
      lowest,
      floodingDays,
      veryHighDays,
      monthlyRisk: getStatusKey(highest)
    };
  });
}

function renderMonthlyHistory() {
  const monthlyRecords = createMonthlyHistoryRecords();
  const body = document.getElementById("monthly-summary-body");

  body.innerHTML = monthlyRecords
    .map((record) => {
      return (
        "<tr>" +
        "<td>" + record.displayMonth + "</td>" +
        "<td>" + record.average + "%</td>" +
        "<td>" + record.highest + "%</td>" +
        "<td>" + record.lowest + "%</td>" +
        "<td>" + record.floodingDays + "</td>" +
        "<td>" + record.veryHighDays + "</td>" +
        "<td>" + renderStatusChip(record.monthlyRisk) + "</td>" +
        "</tr>"
      );
    })
    .join("");

  document.getElementById("monthly-summary-count").innerText =
    monthlyRecords.length + " months";
  drawMonthlyChart(monthlyRecords);
}

function renderReachedChips(keys) {
  return keys.map(renderStatusChip).join("");
}

function renderStatusChip(key) {
  return (
    '<span class="level-chip ' +
    getStatusChipClass(key) +
    '">' +
    getStatusLabel(key) +
    "</span>"
  );
}

function updateSelectedDayHistory() {
  const selectedDate = document.getElementById("history-date").value;
  const records = getFilteredHistoryRecords();
  const record = records.find((item) => item.dateKey === selectedDate) || records[0];

  if (!record) {
    return;
  }

  document.getElementById("day-average").innerText = record.average + "%";
  document.getElementById("day-highest").innerText = record.highest + "%";
  document.getElementById("day-lowest").innerText = record.lowest + "%";
  document.getElementById("day-risk").innerText = getStatusLabel(record.dailyRisk);
  document.getElementById("selected-day-label").innerText = record.displayDate;

  renderWarningCounts(record);
  drawDailyTrendChart(record);
}

function renderWarningCounts(record) {
  const counts = [
    ["low", record.counts.low],
    ["high", record.counts.high],
    ["veryHigh", record.counts.veryHigh],
    ["flooding", record.counts.flooding]
  ];

  document.getElementById("warning-counts").innerHTML = counts
    .map(([key, count]) => {
      return (
        "<div>" +
        "<span>" + getStatusLabel(key) + "</span>" +
        "<strong>" + count + " readings</strong>" +
        "</div>"
      );
    })
    .join("");
}

function drawDailyTrendChart(record) {
  const canvas = document.getElementById("daily-trend-chart");
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = 42;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const barGap = 28;
  const barWidth = (chartWidth - barGap * 3) / 4;

  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height, padding, chartWidth, chartHeight);

  record.blocks.forEach((block, index) => {
    const x = padding + index * (barWidth + barGap);
    const barHeight = (block.average / 100) * chartHeight;
    const y = height - padding - barHeight;
    const status = getStatusKey(block.average);

    ctx.fillStyle = getBarColor(status);
    ctx.fillRect(x, y, barWidth, barHeight);
    ctx.fillStyle = "#14212e";
    ctx.font = "bold 14px Arial";
    ctx.fillText(block.average + "%", x + 8, y - 8);
    ctx.fillStyle = "#6d7c8b";
    ctx.font = "12px Arial";
    ctx.fillText(block.label, x, height - 14);
  });
}

function drawMonthlyChart(records) {
  const canvas = document.getElementById("monthly-chart");
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = 42;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const recordsToShow = records.slice(0, 6).reverse();
  const barGap = 18;
  const barWidth = (chartWidth - barGap * (recordsToShow.length - 1)) / recordsToShow.length;

  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height, padding, chartWidth, chartHeight);

  recordsToShow.forEach((record, index) => {
    const x = padding + index * (barWidth + barGap);
    const barHeight = (record.average / 100) * chartHeight;
    const y = height - padding - barHeight;
    const status = getStatusKey(record.average);

    ctx.fillStyle = getBarColor(status);
    ctx.fillRect(x, y, barWidth, barHeight);
    ctx.fillStyle = "#14212e";
    ctx.font = "bold 14px Arial";
    ctx.fillText(record.average + "%", x + 6, y - 8);
    ctx.fillStyle = "#6d7c8b";
    ctx.font = "12px Arial";
    ctx.fillText(record.displayMonth.slice(0, 3), x + 4, height - 14);
  });
}

function getBarColor(status) {
  const colors = {
    low: "#4a93c9",
    high: "#f1a33a",
    veryHigh: "#ef7b2d",
    flooding: "#df4d4d"
  };

  return colors[status];
}

function showPage(pageName) {
  const isHistory = pageName === "history";

  document.getElementById("dashboard-view").classList.toggle("active", !isHistory);
  document.getElementById("history-view").classList.toggle("active", isHistory);
  document.getElementById("dashboard-tab").classList.toggle("active", !isHistory);
  document.getElementById("history-tab").classList.toggle("active", isHistory);

  if (isHistory) {
    renderHistoryPage();
  }
}

drawChart(historyReadings);
renderHistoryPage();
document.getElementById("scenario-select").addEventListener("change", (event) => {
  setScenario(event.target.value);
});
document.getElementById("dashboard-tab").addEventListener("click", () => showPage("dashboard"));
document.getElementById("history-tab").addEventListener("click", () => showPage("history"));
document.getElementById("history-range").addEventListener("change", () => {
  renderHistoryDateOptions();
  renderHistoryTable();
  renderMonthlyHistory();
  updateSelectedDayHistory();
});
document.getElementById("history-date").addEventListener("change", updateSelectedDayHistory);
setInterval(loadData, 2000);
loadData();
