async function loadData() {
  try {
    const res = await fetch("/api/water-level");
    const data = await res.json();
    const percentage = getNumberOrNull(data.percentage);
    const safePercentage =
      percentage === null ? null : Math.max(0, Math.min(100, percentage));
    const status = data.status || "Waiting";

    document.getElementById("level").innerText =
      safePercentage === null ? "--%" : safePercentage + "%";
    document.getElementById("distance").innerText =
      data.distanceCm == null ? "Waiting for stable result" : data.distanceCm + " cm";
    document.getElementById("updated").innerText =
      formatTimeOrWaiting(data.updatedAt, "Waiting for two-scan filtering");

    updatePreviousResult(data);

    const statusElement = document.getElementById("status");
    statusElement.innerText = status;
    statusElement.className = "status status-" + status.toLowerCase();

    document.getElementById("fill").style.width =
      safePercentage === null ? "0%" : safePercentage + "%";
    updateScanDetails(data);
  } catch (error) {
    document.getElementById("status").innerText = "Offline";
    document.getElementById("status").className = "status status-loading";
    document.getElementById("updated").innerText = "Unable to load data";
  }
}

function getNumberOrNull(value) {
  if (value == null) {
    return null;
  }

  const number = Number(value);
  return Number.isNaN(number) ? null : number;
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

function updatePreviousResult(data) {
  const previousPercentage = getNumberOrNull(data.previousPercentage);

  document.getElementById("previous-level").innerText =
    previousPercentage === null ? "No previous result yet" : previousPercentage + "%";
  document.getElementById("previous-updated").innerText = formatTimeOrWaiting(
    data.previousUpdatedAt,
    "Waiting for next completed scan"
  );
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

function updateScanDetails(data) {
  const readingsNeeded = data.readingsNeeded || 15;
  const currentReading = data.currentReading == null ? "--" : data.currentReading + "%";
  const baselineMedian = data.baselineMedian == null ? "Waiting" : data.baselineMedian + "%";
  const acceptedRange =
    data.allowedMin == null || data.allowedMax == null
      ? "Waiting"
      : data.allowedMin + "% to " + data.allowedMax + "%";

  document.getElementById("scan-phase").innerText = formatPhase(data.scanPhase);
  document.getElementById("current-reading").innerText = currentReading;
  document.getElementById("baseline-count").innerText =
    data.baselineCount + " / " + readingsNeeded;
  document.getElementById("baseline-median").innerText = baselineMedian;
  document.getElementById("accepted-range").innerText = acceptedRange;
  document.getElementById("accepted-count").innerText =
    data.acceptedCount + " / " + readingsNeeded;
  document.getElementById("rejected-count").innerText = data.rejectedCount;
}

// Refresh every 2 seconds so the page is ready for live sensor data later.
setInterval(loadData, 2000);

loadData();
