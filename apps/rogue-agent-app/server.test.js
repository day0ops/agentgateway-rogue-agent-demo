import { test, expect, describe, beforeEach, afterAll } from "bun:test";

// DIRECT_URL/GATEWAY_URL must point at a fake upstream before server.js is
// imported, since server.js reads them once at module load. The fake stands
// in for mock-llm-server: it records hits to /api/reset (to verify the
// gateway-mode switch clears the mock LLM's rate limit) and responds to
// /v1/chat/completions (to verify a running loop actually fires requests).
const upstreamHits = { reset: 0, completions: 0 };
const fakeUpstream = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/api/reset") {
      upstreamHits.reset += 1;
      return Response.json({ status: "reset" });
    }
    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      upstreamHits.completions += 1;
      return Response.json({
        id: "chatcmpl-fake",
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }
    return new Response("not found", { status: 404 });
  },
});

process.env.DIRECT_URL = `http://localhost:${fakeUpstream.port}/v1/chat/completions`;
process.env.GATEWAY_URL = `http://localhost:${fakeUpstream.port}/v1/chat/completions`;

const { createServer } = await import("./server.js");

// server.js holds its mode/counters in module-level state (shared across every
// Bun.serve() instance in this process), so reset it before each test instead
// of relying on test execution order to leave it in a known state.
const server = createServer(0);
const base = `http://localhost:${server.port}`;

beforeEach(async () => {
  await fetch(`${base}/api/reset`, { method: "POST" });
  upstreamHits.reset = 0;
  upstreamHits.completions = 0;
});

afterAll(() => {
  server.stop(true);
  fakeUpstream.stop(true);
});

// Polls a condition until it's true or the timeout elapses - the mode-switch
// handler fires the loop's first request asynchronously, so a bare assertion
// right after the fetch would be flaky.
async function waitFor(predicate, { timeoutMs = 500, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return predicate();
}

describe("rogue-agent-app HTTP contract", () => {
  test("GET /api/mode defaults to direct after reset", async () => {
    const res = await fetch(`${base}/api/mode`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: "direct" });
  });

  test("POST /api/mode with an invalid mode returns 400", async () => {
    const res = await fetch(`${base}/api/mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "bogus" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/mode with a valid mode updates and echoes it", async () => {
    const res = await fetch(`${base}/api/mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "gateway" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: "gateway" });

    const check = await fetch(`${base}/api/mode`);
    expect(await check.json()).toEqual({ mode: "gateway" });

    await fetch(`${base}/api/stop-task`, { method: "POST" });
  });

  test("POST /api/reset returns mode to direct", async () => {
    await fetch(`${base}/api/mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "gateway" }),
    });
    const res = await fetch(`${base}/api/reset`, { method: "POST" });
    expect(res.status).toBe(200);

    const check = await fetch(`${base}/api/mode`);
    expect(await check.json()).toEqual({ mode: "direct" });
  });

  test("unknown route returns 404", async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });

  test("switching to gateway mode resets the mock LLM's rate limit", async () => {
    const res = await fetch(`${base}/api/mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "gateway" }),
    });
    expect(res.status).toBe(200);
    // /api/mode awaits the upstream reset before responding, so this is
    // already true by the time the fetch above resolves.
    expect(upstreamHits.reset).toBe(1);

    await fetch(`${base}/api/stop-task`, { method: "POST" });
  });

  test("switching to gateway mode does not auto-start the loop", async () => {
    const res = await fetch(`${base}/api/mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "gateway" }),
    });
    expect(res.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(upstreamHits.completions).toBe(0);
  });

  test("switching to gateway mode while running stops the task so it can be started again", async () => {
    await fetch(`${base}/api/run-task`, { method: "POST" });
    const started = await waitFor(() => upstreamHits.completions > 0);
    expect(started).toBe(true);

    const res = await fetch(`${base}/api/mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "gateway" }),
    });
    expect(res.status).toBe(200);

    // If the switch hadn't stopped the loop, this would return "already-running".
    const runRes = await fetch(`${base}/api/run-task`, { method: "POST" });
    expect(await runRes.json()).toEqual({ status: "started" });

    await fetch(`${base}/api/stop-task`, { method: "POST" });
  });
});
