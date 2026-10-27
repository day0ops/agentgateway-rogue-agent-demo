import { test, expect, describe } from "bun:test";
import { nextIntervalMs, buildOutboundRequest } from "./lib.js";

describe("nextIntervalMs", () => {
  test("starts at startMs for the first request", () => {
    expect(nextIntervalMs(0)).toBe(700);
  });

  test("decays as request count rises", () => {
    expect(nextIntervalMs(1)).toBe(640);
    expect(nextIntervalMs(5)).toBe(400);
  });

  test("never goes below floorMs", () => {
    expect(nextIntervalMs(100)).toBe(80);
  });

  test("respects custom options", () => {
    expect(
      nextIntervalMs(0, { startMs: 1000, floorMs: 200, decayPerRequest: 100 }),
    ).toBe(1000);
    expect(
      nextIntervalMs(9, { startMs: 1000, floorMs: 200, decayPerRequest: 100 }),
    ).toBe(200);
  });
});

describe("buildOutboundRequest", () => {
  const urls = {
    directUrl: "http://localhost:8787/v1/chat/completions",
    gatewayUrl: "http://localhost:4000/v1/chat/completions",
    apiKey: "sk-test-key",
    userAgent: "akshay@home-office",
  };

  test("direct mode has no auth header and targets the mock LLM directly", () => {
    const result = buildOutboundRequest("direct", urls);
    expect(result.url).toBe(urls.directUrl);
    expect(result.headers).toEqual({ "user-agent": "akshay@home-office" });
  });

  test("gateway mode carries the rogue-agent API key and targets agentgateway", () => {
    const result = buildOutboundRequest("gateway", urls);
    expect(result.url).toBe(urls.gatewayUrl);
    expect(result.headers).toEqual({
      "x-api-key": "sk-test-key",
      "user-agent": "akshay@home-office",
    });
  });
});
