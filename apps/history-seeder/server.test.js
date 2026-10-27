import { test, expect, describe } from "bun:test";

// Must be set before server.js is imported, pointed at locations nothing
// can reach, so "unreachable" outcomes don't depend on what's running
// elsewhere on the machine.
process.env.GATEWAY_LLM_URL = "http://localhost:1/v1/chat/completions";
process.env.AGENTGATEWAY_DB_PATH = "/nonexistent-dir-xyz/agentgateway.db";
const { createServer } = await import("./server.js");

describe("history-seeder HTTP contract", () => {
  test("unknown route returns 404", async () => {
    const server = createServer(0);
    try {
      const res = await fetch(`http://localhost:${server.port}/nope`);
      expect(res.status).toBe(404);
    } finally {
      server.stop(true);
    }
  });

  test("POST /seed-history returns 502 when agentgateway is unreachable", async () => {
    const server = createServer(0);
    try {
      const res = await fetch(`http://localhost:${server.port}/seed-history`, {
        method: "POST",
      });
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.status).toBe("error");
      expect(body.error).toMatch(/no history requests succeeded/);
    } finally {
      server.stop(true);
    }
  });
});
