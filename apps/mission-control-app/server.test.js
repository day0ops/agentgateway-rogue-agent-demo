import { test, expect, describe } from "bun:test";

// Must be set before server.js is imported, pointed at locations nothing
// can reach, so "unreachable" outcomes don't depend on what's running
// elsewhere on the machine (e.g. a leftover lok8s port-forward).
process.env.ROGUE_AGENT_URL = "http://localhost:1";
process.env.GATEWAY_ADMIN_URL = "http://localhost:2";
process.env.GATEWAY_LLM_URL = "http://localhost:3/v1/chat/completions";
process.env.HISTORY_SEEDER_URL = "http://localhost:4";
const { createServer } = await import("./server.js");

describe("mission-control-app HTTP contract", () => {
  test("GET /api/links returns the agentgateway UI URL", async () => {
    const server = createServer(0);
    try {
      const res = await fetch(`http://localhost:${server.port}/api/links`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.agentgatewayUiUrl).toMatch(/\/ui$/);
    } finally {
      server.stop(true);
    }
  });

  test("unknown route returns 404", async () => {
    const server = createServer(0);
    try {
      const res = await fetch(`http://localhost:${server.port}/nope`);
      expect(res.status).toBe(404);
    } finally {
      server.stop(true);
    }
  });

  test("POST /api/route-through-gateway returns 502 when rogue-agent-app is unreachable", async () => {
    const server = createServer(0);
    try {
      const res = await fetch(
        `http://localhost:${server.port}/api/route-through-gateway`,
        {
          method: "POST",
        },
      );
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.status).toBe("error");
    } finally {
      server.stop(true);
    }
  });

  test("POST /api/apply-budget returns 502 when agentgateway is unreachable", async () => {
    const server = createServer(0);
    try {
      const res = await fetch(
        `http://localhost:${server.port}/api/apply-budget`,
        {
          method: "POST",
        },
      );
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.status).toBe("error");
    } finally {
      server.stop(true);
    }
  });

  test("POST /api/apply-model-costs returns 502 when agentgateway is unreachable", async () => {
    const server = createServer(0);
    try {
      const res = await fetch(
        `http://localhost:${server.port}/api/apply-model-costs`,
        {
          method: "POST",
        },
      );
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.status).toBe("error");
    } finally {
      server.stop(true);
    }
  });

  test("POST /api/seed-history returns 502 when history-seeder is unreachable", async () => {
    const server = createServer(0);
    try {
      const res = await fetch(
        `http://localhost:${server.port}/api/seed-history`,
        {
          method: "POST",
        },
      );
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.status).toBe("error");
    } finally {
      server.stop(true);
    }
  });
});
