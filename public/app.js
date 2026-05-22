async function loadData() {
  try {
    const res = await fetch("/api/water-level");
    const data = await res.json();
    const percentage = Number(data.percentage);
    const safePercentage = Math.max(0, Math.min(100, percentage));
    const status = data.status || "Loading";

    document.getElementById("level").innerText = safePercentage + "%";
    document.getElementById("distance").innerText =
      data.distanceCm === null ? "Not available" : data.distanceCm + " cm";
    document.getElementById("updated").innerText =
      new Date(data.updatedAt).toLocaleTimeString();

    const statusElement = document.getElementById("status");
    statusElement.innerText = status;
    statusElement.className = "status status-" + status.toLowerCase();

    document.getElementById("fill").style.width = safePercentage + "%";
  } catch (error) {
    document.getElementById("status").innerText = "Offline";
    document.getElementById("status").className = "status status-loading";
    document.getElementById("updated").innerText = "Unable to load data";
  }
}

// Refresh every 2 seconds so the page is ready for live sensor data later.
setInterval(loadData, 2000);

loadData();
