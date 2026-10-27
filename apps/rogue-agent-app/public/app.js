const stage = document.getElementById("stage");
const codePanel = document.getElementById("code-panel");
const runButton = document.getElementById("run-button");
const runNote = document.getElementById("run-note");
const termBody = document.getElementById("terminal-body");
const termLog = document.getElementById("term-log");
const killButton = document.getElementById("kill-button");
const statRequests = document.getElementById("stat-requests");
const statTokens = document.getElementById("stat-tokens");
const statRate = document.getElementById("stat-rate");
const statuslineMode = document.getElementById("statusline-mode");
const statuslineStatus = document.getElementById("statusline-status");

const MAX_LOG_LINES = 300;

let lastRequestAt = null;

function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Captures the terminal body's natural (small, still-empty) height as its
// starting point, before any content is appended.
function resetTerminalHeight() {
  termBody.style.height = `${termBody.scrollHeight}px`;
}

// Fires once, when logging starts - not per line. Once the loop's interval
// hits its 80ms floor, lines arrive faster than any transition could
// finish, so retriggering per line would interrupt the animation mid-flight.
function growTerminalBody() {
  termBody.style.height = `${window.innerHeight * 0.6}px`;
}

function addTermLine(html, level) {
  const li = document.createElement("li");
  if (level) li.dataset.level = level;
  li.innerHTML = html;
  termLog.appendChild(li);
  while (termLog.children.length > MAX_LOG_LINES) {
    termLog.removeChild(termLog.firstChild);
  }
  termBody.scrollTop = termBody.scrollHeight;
}

function setEscalation(blocked) {
  document.body.dataset.escalation = blocked ? "blocked" : "calm";
}

function setStatus(label) {
  statuslineStatus.textContent = label;
}

function setMode(mode) {
  statuslineMode.textContent =
    mode === "gateway" ? "mode: agentgateway" : "mode: direct";
}

// A real-looking host:port on both sides, not a vague "direct" label -
// agentgateway:4000 is the actual in-cluster address; api.openai.com:443
// is where an ungoverned agent would really be calling straight out to.
function targetFor(mode) {
  return mode === "gateway" ? "agentgateway:4000" : "api.openai.com:443";
}

function updateRate() {
  const now = performance.now();
  if (lastRequestAt != null) {
    const deltaSeconds = (now - lastRequestAt) / 1000;
    if (deltaSeconds > 0) {
      statRate.textContent = (1 / deltaSeconds).toFixed(1);
    }
  }
  lastRequestAt = now;
}

// Last 8 chars of the real completion id - a trace-id-shaped detail that's
// still genuine data from the LLM response, not invented for flavor.
function shortId(id) {
  return id ? id.slice(-8) : "--------";
}

function logRequestLine(event) {
  const target = targetFor(event.mode);
  const ts = timestamp();
  const where = `POST /v1/chat/completions &rarr; ${target} &middot; model=${event.model}`;

  if (event.status === "blocked") {
    // A 429 in direct mode can only be the mock LLM's own rate limiter -
    // nothing else sits in that path. A 429 in gateway mode can only be the
    // budget - the provider limiter is reset the moment gateway mode starts.
    const reason =
      event.mode === "gateway"
        ? "budget exceeded"
        : "provider rate limit exceeded";
    addTermLine(
      `<span class="ts">[${ts}]</span> ERROR ${where} &middot; 429 Too Many Requests ${event.durationMs}ms &middot; ${reason}`,
      "blocked",
    );
    return;
  }

  if (event.status === "error") {
    addTermLine(
      `<span class="ts">[${ts}]</span> ERROR ${where} &middot; request failed after ${event.durationMs}ms`,
      "error",
    );
    return;
  }

  // "ERROR" is reserved for genuinely failed/blocked responses (handled
  // above) - a successful response is always INFO, with no escalation
  // ramp in between.
  addTermLine(
    `<span class="ts">[${ts}]</span> INFO  ${where} &middot; 200 OK ${event.durationMs}ms &middot; tokens ${event.promptTokens}+${event.completionTokens}=${event.tokens} &middot; id=${shortId(event.requestId)}`,
  );
}

function resetScene() {
  stage.dataset.scene = "code";
  codePanel.classList.remove("sliding-out");
  runButton.disabled = false;
  runButton.textContent = "Run locally";
  runNote.textContent = "";
  termLog.innerHTML = "";
  termBody.style.height = "";
}

function handleEvent(event) {
  switch (event.type) {
    case "state": {
      setMode(event.mode);
      statRequests.textContent = event.requestCount;
      statTokens.textContent = event.totalTokens;
      setEscalation(false);
      setStatus(event.taskRunning ? "running" : "idle");
      killButton.disabled = !event.taskRunning;
      break;
    }
    case "mode-changed": {
      setMode(event.mode);
      addTermLine(
        `<span class="ts">[${timestamp()}]</span> INFO  routing switched &rarr; ${targetFor(event.mode)}`,
      );
      break;
    }
    case "task-started": {
      setStatus("running");
      killButton.disabled = false;
      break;
    }
    case "request": {
      statRequests.textContent = event.n;
      statTokens.textContent = event.totalTokens;
      updateRate();
      logRequestLine(event);

      if (event.status === "blocked") {
        setEscalation(true);
        setStatus("blocked");
      } else {
        setStatus("running");
      }
      break;
    }
    case "task-stopped": {
      setStatus("idle");
      killButton.disabled = true;
      break;
    }
    case "reset": {
      statRequests.textContent = "0";
      statTokens.textContent = "0";
      statRate.textContent = "0.0";
      lastRequestAt = null;
      setEscalation(false);
      setMode(event.mode);
      setStatus("idle");
      resetScene();
      break;
    }
  }
}

function connect() {
  const source = new EventSource("/api/events");
  source.onmessage = (e) => {
    try {
      handleEvent(JSON.parse(e.data));
    } catch {
      // Ignore malformed events rather than tearing down the connection.
    }
  };
  source.onerror = () => {
    source.close();
    setTimeout(connect, 1000);
  };
}

runButton.addEventListener("click", async () => {
  runButton.disabled = true;
  runButton.textContent = "Running...";
  runNote.textContent = "Starting local run...";

  await sleep(300);
  codePanel.classList.add("sliding-out");
  await sleep(320);
  stage.dataset.scene = "terminal";
  resetTerminalHeight();

  await sleep(500);
  growTerminalBody();
  addTermLine(
    `<span class="term-prompt">akshay@fulfillment-ops ~ %</span> bun run agent.js`,
  );
  await sleep(250);
  addTermLine("fulfillment-agent starting up (model: fulfillment-agent-v2)");
  await sleep(250);
  addTermLine("Agent process started (pid 48213)");
  await sleep(250);
  addTermLine("Connected to upstream: mock-llm-server:8787");
  await sleep(250);

  fetch("/api/run-task", { method: "POST" });
});

killButton.addEventListener("click", () => {
  addTermLine("^C");
  addTermLine("Process terminated (exit code 130)");
  fetch("/api/stop-task", { method: "POST" });
});

connect();
