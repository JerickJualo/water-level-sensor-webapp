const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const apiKey = "smoke-test-key";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 8000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error("Server exited before the health check was available");
    }

    try {
      const response = await fetch(baseUrl + "/api/health");

      if (response.ok) {
        return response.json();
      }
    } catch {
      await delay(250);
    }
  }

  throw new Error("Timed out waiting for /api/health");
}

async function expectJson(response, label) {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(label + " failed with " + response.status + ": " + body);
  }

  return response.json();
}

async function main() {
  const port = await getFreePort();
  const baseUrl = "http://127.0.0.1:" + port;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "water-level-smoke-"));
  const databaseFile = path.join(tempDir, "water-level.db");
  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      ESP32_API_KEY: apiKey,
      ENABLE_MOCK_DATA: "false",
      DATABASE_FILE: databaseFile,
      ALLOWED_ORIGINS: "http://example.test"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";
  child.stdout.on("data", (data) => {
    output += data.toString();
  });
  child.stderr.on("data", (data) => {
    output += data.toString();
  });

  try {
    const health = await waitForHealth(baseUrl, child);

    if (health.status !== "ok") {
      throw new Error("/api/health did not return status ok");
    }

    if (health.apiKeyRequired !== true) {
      throw new Error("/api/health should report apiKeyRequired=true in production");
    }

    if (health.mockDataEnabled !== false) {
      throw new Error("/api/health should report mockDataEnabled=false");
    }

    if (health.databaseProvider !== "sqlite") {
      throw new Error("/api/health should report sqlite for the local smoke-test database");
    }

    const allowedCors = await fetch(baseUrl + "/api/health", {
      headers: {
        Origin: "http://example.test"
      }
    });

    if (allowedCors.headers.get("access-control-allow-origin") !== "http://example.test") {
      throw new Error("Allowed CORS origin should receive an access-control-allow-origin header");
    }

    const blockedCors = await fetch(baseUrl + "/api/health", {
      headers: {
        Origin: "http://blocked.example"
      }
    });

    if (blockedCors.headers.has("access-control-allow-origin")) {
      throw new Error("Blocked CORS origin should not receive an access-control-allow-origin header");
    }

    const unauthorized = await fetch(baseUrl + "/api/water-level", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ percentage: 50 })
    });

    if (unauthorized.status !== 401) {
      throw new Error("POST /api/water-level without API key should return 401");
    }

    await expectJson(
      await fetch(baseUrl + "/api/water-level", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey
        },
        body: JSON.stringify({ percentage: 82, distanceCm: 72.8 })
      }),
      "Authorized POST /api/water-level"
    );

    await expectJson(await fetch(baseUrl + "/api/water-level"), "GET /api/water-level");
    await expectJson(await fetch(baseUrl + "/api/history/daily?days=7"), "GET /api/history/daily");
    await expectJson(await fetch(baseUrl + "/api/history/monthly"), "GET /api/history/monthly");
    await expectJson(await fetch(baseUrl + "/api/alerts/recent?limit=10"), "GET /api/alerts/recent");

    console.log("Smoke tests passed");
  } finally {
    child.kill();
    await delay(250);
    fs.rmSync(tempDir, { recursive: true, force: true });

    if (child.exitCode !== null && child.exitCode !== 0) {
      process.stderr.write(output);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
