import { test, expect, describe, beforeEach, afterAll } from "bun:test";

// Set before server.js is imported, so the HTTP tests below can cross the
// rate limit in a handful of requests instead of matching the production
// default (1100) request for request.
process.env.MOCK_LLM_RATE_LIMIT = "5";

const {
  countTokens,
  buildChatCompletion,
  buildMessagesCompletion,
  buildRateLimitError,
  buildMessagesRateLimitError,
  createServer,
} = await import("./server.js");

describe("countTokens", () => {
  test("returns 0 for empty input", () => {
    expect(countTokens("")).toBe(0);
    expect(countTokens(undefined)).toBe(0);
  });

  test("returns at least 1 for non-empty input", () => {
    expect(countTokens("hi")).toBe(1);
  });

  test("scales roughly with character count", () => {
    expect(countTokens("a".repeat(40))).toBe(10);
  });
});

describe("buildChatCompletion", () => {
  test("echoes the requested model", () => {
    const result = buildChatCompletion({
      model: "mock-model",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.model).toBe("mock-model");
  });

  test("returns a valid OpenAI-shaped chat completion", () => {
    const result = buildChatCompletion({
      model: "mock-model",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.object).toBe("chat.completion");
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0].message.role).toBe("assistant");
    expect(typeof result.choices[0].message.content).toBe("string");
    expect(result.usage.total_tokens).toBe(
      result.usage.prompt_tokens + result.usage.completion_tokens,
    );
  });

  test("usage scales with longer prompts", () => {
    const short = buildChatCompletion({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
    });
    const long = buildChatCompletion({
      model: "m",
      messages: [{ role: "user", content: "a".repeat(400) }],
    });
    expect(long.usage.prompt_tokens).toBeGreaterThan(short.usage.prompt_tokens);
  });
});

describe("buildMessagesCompletion", () => {
  test("echoes the requested model", () => {
    const result = buildMessagesCompletion({
      model: "claude-3-5-sonnet",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.model).toBe("claude-3-5-sonnet");
  });

  test("returns a valid Anthropic-shaped message", () => {
    const result = buildMessagesCompletion({
      model: "claude-3-5-sonnet",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.type).toBe("message");
    expect(result.role).toBe("assistant");
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(typeof result.content[0].text).toBe("string");
    expect(result.usage.input_tokens).toBeGreaterThan(0);
    expect(result.usage.output_tokens).toBeGreaterThan(0);
  });

  test("counts a top-level system prompt toward input tokens", () => {
    const withoutSystem = buildMessagesCompletion({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
    });
    const withSystem = buildMessagesCompletion({
      model: "m",
      system: "a".repeat(400),
      messages: [{ role: "user", content: "hi" }],
    });
    expect(withSystem.usage.input_tokens).toBeGreaterThan(
      withoutSystem.usage.input_tokens,
    );
  });
});

describe("buildRateLimitError", () => {
  test("returns an OpenAI-shaped rate limit error", () => {
    const result = buildRateLimitError();
    expect(result.error.type).toBe("rate_limit_exceeded");
    expect(typeof result.error.message).toBe("string");
  });
});

describe("buildMessagesRateLimitError", () => {
  test("returns an Anthropic-shaped rate limit error", () => {
    const result = buildMessagesRateLimitError();
    expect(result.type).toBe("error");
    expect(result.error.type).toBe("rate_limit_error");
    expect(typeof result.error.message).toBe("string");
  });
});

describe("HTTP server", () => {
  // server.js tracks its request counter at module level (shared across every
  // Bun.serve() instance in this process), so reset it before each test
  // instead of relying on test execution order to leave it in a known state.
  const server = createServer(0);
  const base = `http://localhost:${server.port}`;

  beforeEach(async () => {
    await fetch(`${base}/api/reset`, { method: "POST" });
  });

  afterAll(() => {
    server.stop(true);
  });

  function completionRequest() {
    return fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
  }

  function messagesRequest() {
    return fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-3-5-sonnet",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
  }

  test("POST /v1/chat/completions returns 200 with a valid completion", async () => {
    const res = await completionRequest();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model).toBe("mock-model");
    expect(body.usage.total_tokens).toBeGreaterThan(0);
  });

  test("POST /v1/messages returns 200 with a valid message", async () => {
    const res = await messagesRequest();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model).toBe("claude-3-5-sonnet");
    expect(body.type).toBe("message");
    expect(body.usage.output_tokens).toBeGreaterThan(0);
  });

  test("POST /v1/messages with missing fields returns 400", async () => {
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-3-5-sonnet" }),
    });
    expect(res.status).toBe(400);
  });

  test("the rate limit counter is shared across both protocols", async () => {
    // MOCK_LLM_RATE_LIMIT is set to 5 above - mix both endpoints and confirm
    // the 6th request overall is the one that gets rejected, regardless of
    // which protocol it arrives on.
    for (let i = 0; i < 3; i += 1) {
      expect((await completionRequest()).status).toBe(200);
    }
    for (let i = 0; i < 2; i += 1) {
      expect((await messagesRequest()).status).toBe(200);
    }
    const blocked = await messagesRequest();
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.error.type).toBe("rate_limit_error");
  });

  test("POST with missing fields returns 400", async () => {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "mock-model" }),
    });
    expect(res.status).toBe(400);
  });

  test("unknown route returns 404", async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });

  test("requests beyond MOCK_LLM_RATE_LIMIT return 429", async () => {
    // MOCK_LLM_RATE_LIMIT is set to 5 above - send exactly that many
    // successful requests, then confirm the next one is rejected.
    for (let i = 0; i < 5; i += 1) {
      const res = await completionRequest();
      expect(res.status).toBe(200);
    }

    const blocked = await completionRequest();
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.error.type).toBe("rate_limit_exceeded");
  });

  test("POST /api/reset clears the rate limit counter", async () => {
    for (let i = 0; i < 5; i += 1) {
      await completionRequest();
    }
    expect((await completionRequest()).status).toBe(429);

    const resetRes = await fetch(`${base}/api/reset`, { method: "POST" });
    expect(resetRes.status).toBe(200);
    expect(await resetRes.json()).toEqual({ status: "reset" });

    expect((await completionRequest()).status).toBe(200);
  });
});
