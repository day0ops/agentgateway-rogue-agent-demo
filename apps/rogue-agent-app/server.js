import { nextIntervalMs, buildOutboundRequest } from "./lib.js";

const PORT = Number(process.env.PORT || 5173);
const DIRECT_URL =
  process.env.DIRECT_URL || "http://localhost:8787/v1/chat/completions";
const GATEWAY_URL =
  process.env.GATEWAY_URL || "http://localhost:4000/v1/chat/completions";
const API_KEY = process.env.ROGUE_AGENT_API_KEY || "sk-rogue-agent-demo";
const MODEL = process.env.MODEL || "mock-model";
const AGENT_USER_AGENT =
  process.env.AGENT_USER_AGENT || "akshay@home-office";

const TASK_PROMPTS = [
  "Summarize the latest batch of support tickets.",
  "Draft a follow-up email for the open invoices.",
  "Check inventory levels across all warehouses.",
  "Generate a status report for the ongoing migration.",
];

const state = {
  mode: "direct", // 'direct' | 'gateway'
  taskRunning: false,
  requestCount: 0,
  totalTokens: 0,
};

const sseClients = new Set();

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const controller of sseClients) {
    try {
      controller.enqueue(payload);
    } catch {
      // Abruptly-killed connections don't always fire cancel() - drop here
      // too so a stale controller can't crash a later broadcast.
      sseClients.delete(controller);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLoop() {
  // Each run starts its own counters fresh so the UI's pacing is
  // consistent, but mock-llm-server's own rate limit is left untouched -
  // like a real provider's quota, it persists across your own restarts.
  state.requestCount = 0;
  state.totalTokens = 0;
  state.taskRunning = true;
  broadcast({ type: "task-started" });

  while (state.taskRunning) {
    state.requestCount += 1;
    const { url, headers } = buildOutboundRequest(state.mode, {
      directUrl: DIRECT_URL,
      gatewayUrl: GATEWAY_URL,
      apiKey: API_KEY,
      userAgent: AGENT_USER_AGENT,
    });
    const prompt = TASK_PROMPTS[state.requestCount % TASK_PROMPTS.length];

    let status = "error";
    let tokens = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let requestId = null;
    let message = null;
    const startedAt = Date.now();

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (res.status === 200) {
        const data = await res.json();
        promptTokens = data.usage?.prompt_tokens ?? 0;
        completionTokens = data.usage?.completion_tokens ?? 0;
        tokens = data.usage?.total_tokens ?? 0;
        state.totalTokens += tokens;
        status = "ok";
        message = data.choices?.[0]?.message?.content ?? "";
        requestId = data.id ?? null;
      } else if (res.status === 429) {
        status = "blocked";
      } else {
        status = "error";
      }
    } catch {
      status = "error";
    }

    broadcast({
      type: "request",
      n: state.requestCount,
      status,
      tokens,
      promptTokens,
      completionTokens,
      totalTokens: state.totalTokens,
      durationMs: Date.now() - startedAt,
      requestId,
      model: MODEL,
      message,
      mode: state.mode,
    });

    // No backoff, no circuit breaker - that's the bug. A 429 doesn't stop
    // the loop; only an explicit stop or reset does.
    await sleep(nextIntervalMs(state.requestCount));
  }
}

async function resetMockLlmRateLimit() {
  try {
    await fetch(`${new URL(DIRECT_URL).origin}/api/reset`, { method: "POST" });
  } catch {
    // Best-effort - a stale rate limit is cosmetic, not fatal to the demo.
  }
}

async function resetState() {
  state.taskRunning = false;
  state.mode = "direct";
  state.requestCount = 0;
  state.totalTokens = 0;
  await resetMockLlmRateLimit();
  broadcast({ type: "reset", mode: state.mode });
}

function jsonResponse(data, init) {
  return Response.json(data, init);
}

function serveStatic(pathname) {
  const file = Bun.file(
    `${import.meta.dir}/public${pathname === "/" ? "/index.html" : pathname}`,
  );
  return file;
}

export function createServer(port = PORT) {
  return Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/api/mode") {
        return jsonResponse({ mode: state.mode });
      }

      if (req.method === "POST" && url.pathname === "/api/mode") {
        const body = await req.json().catch(() => ({}));
        if (body.mode !== "direct" && body.mode !== "gateway") {
          return jsonResponse(
            { error: 'mode must be "direct" or "gateway"' },
            { status: 400 },
          );
        }
        state.mode = body.mode;

        if (state.mode === "gateway") {
          // Routing through agentgateway hands control back to the
          // presenter - stop any run in progress and reset the scene so
          // "Run locally" can be clicked again, now targeting agentgateway.
          state.taskRunning = false;
          state.requestCount = 0;
          state.totalTokens = 0;
          await resetMockLlmRateLimit();
          broadcast({ type: "reset", mode: state.mode });
        } else {
          broadcast({ type: "mode-changed", mode: state.mode });
        }

        return jsonResponse({ mode: state.mode });
      }

      if (req.method === "POST" && url.pathname === "/api/run-task") {
        if (state.taskRunning) {
          return jsonResponse({ status: "already-running" });
        }
        runLoop();
        return jsonResponse({ status: "started" });
      }

      if (req.method === "POST" && url.pathname === "/api/stop-task") {
        state.taskRunning = false;
        broadcast({ type: "task-stopped", reason: "manual" });
        return jsonResponse({ status: "stopped" });
      }

      if (req.method === "POST" && url.pathname === "/api/reset") {
        await resetState();
        return jsonResponse({ status: "reset" });
      }

      if (req.method === "GET" && url.pathname === "/api/events") {
        const stream = new ReadableStream({
          start(controller) {
            sseClients.add(controller);
            controller.enqueue(
              `data: ${JSON.stringify({ type: "state", mode: state.mode, requestCount: state.requestCount, totalTokens: state.totalTokens, taskRunning: state.taskRunning })}\n\n`,
            );
          },
          cancel(controller) {
            sseClients.delete(controller);
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        });
      }

      if (req.method === "GET") {
        const file = serveStatic(url.pathname);
        if (await file.exists()) {
          return new Response(file);
        }
        return new Response("Not found", { status: 404 });
      }

      return new Response("Not found", { status: 404 });
    },
  });
}

if (import.meta.main) {
  const server = createServer();
  console.log(`rogue-agent-app listening on http://localhost:${server.port}`);
}
