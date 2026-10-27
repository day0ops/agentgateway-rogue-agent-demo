import { Database } from "bun:sqlite";
import {
  HISTORY_PROMPTS,
  HISTORY_MODELS,
  buildHistoryUpdates,
  formatAgentgatewayTimestamp,
} from "./lib.js";

const PORT = Number(process.env.PORT || 5176);
const GATEWAY_LLM_URL =
  process.env.GATEWAY_LLM_URL || "http://localhost:4000/v1/chat/completions";
const HISTORY_SEEDER_API_KEY =
  process.env.HISTORY_SEEDER_API_KEY || "sk-history-seeder-demo";
const HISTORY_SEEDER_KEY_NAME =
  process.env.HISTORY_SEEDER_KEY_NAME || "history-seeder";
const HISTORY_REQUEST_COUNT = Number(process.env.HISTORY_REQUEST_COUNT || 1000);
const AGENTGATEWAY_DB_PATH =
  process.env.AGENTGATEWAY_DB_PATH || "/data/agentgateway.db";
// Resets mock-llm-server's shared rate-limit counter before, during, and
// after the replay, so it doesn't collide with the live demo's own
// rate-limit narrative.
const MOCK_LLM_URL = process.env.MOCK_LLM_URL || "http://localhost:8787";

function jsonResponse(data, init) {
  return Response.json(data, init);
}

async function resetMockLlmRateLimit() {
  try {
    await fetch(`${MOCK_LLM_URL}/api/reset`, { method: "POST" });
  } catch {
    // Best-effort - a stale rate limit is cosmetic, not fatal to seeding.
  }
}

// Keeps the replay well under mock-llm-server's own rate limit regardless
// of how large HISTORY_REQUEST_COUNT is - the replay has no pacing, so it
// would otherwise trip that limit mid-batch.
const MOCK_LLM_RESET_INTERVAL = 100;

async function replayHistoryTraffic() {
  let sent = 0;
  for (let i = 0; i < HISTORY_REQUEST_COUNT; i += 1) {
    if (i > 0 && i % MOCK_LLM_RESET_INTERVAL === 0) {
      await resetMockLlmRateLimit();
    }
    const prompt = HISTORY_PROMPTS[i % HISTORY_PROMPTS.length];
    const model = HISTORY_MODELS[i % HISTORY_MODELS.length];
    try {
      const res = await fetch(GATEWAY_LLM_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": HISTORY_SEEDER_API_KEY,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (res.ok) sent += 1;
    } catch {
      // Best-effort replay; one failed request shouldn't abort the rest.
    }
  }
  return sent;
}

// Replays traffic under the history-seeder key, then backdates those rows
// across the past week. Runs as a sidecar sharing agentgateway's own data
// volume, so there's no cross-process file-locking boundary to worry about.
async function seedHistory() {
  await resetMockLlmRateLimit();
  const replayStartedAt = new Date();
  const sent = await replayHistoryTraffic();
  await resetMockLlmRateLimit();
  if (sent === 0) {
    throw new Error(
      "no history requests succeeded; is agentgateway reachable?",
    );
  }

  const db = new Database(AGENTGATEWAY_DB_PATH, { readwrite: true });
  // agentgateway may still be flushing the replay's last log entries to
  // this file - without this, a lock collision fails immediately instead
  // of waiting.
  db.exec("PRAGMA busy_timeout = 15000;");
  try {
    // Filters by http_status = 200 and started_at >= replayStartedAt,
    // not a `sent`-based LIMIT - `sent` can undercount what agentgateway
    // actually logged, and rejected rows land interleaved with real ones
    // by timestamp rather than cleanly before or after them.
    const rows = db
      .query(
        `SELECT id, duration_ms as durationMs, started_at as startedAt
         FROM request_logs
         WHERE agentgateway_user = ? AND http_status = 200 AND started_at >= ?
         ORDER BY started_at ASC, id ASC`,
      )
      .all(
        HISTORY_SEEDER_KEY_NAME,
        formatAgentgatewayTimestamp(replayStartedAt),
      );
    if (rows.length === 0) {
      throw new Error("the replay produced no log rows to backdate");
    }

    const updates = buildHistoryUpdates(rows, new Date());
    const applyUpdates = db.transaction((items) => {
      for (const u of items) {
        db.run(
          "UPDATE request_logs SET started_at = ?, completed_at = ? WHERE id = ?",
          [u.startedAt, u.completedAt, u.id],
        );
      }
    });
    applyUpdates(updates);

    return updates.length;
  } finally {
    db.close();
  }
}

export function createServer(port = PORT) {
  return Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "POST" && url.pathname === "/seed-history") {
        try {
          const count = await seedHistory();
          return jsonResponse({ status: "seeded", count });
        } catch (err) {
          return jsonResponse(
            { status: "error", error: err.message },
            { status: 502 },
          );
        }
      }

      return new Response("Not found", { status: 404 });
    },
  });
}

if (import.meta.main) {
  const server = createServer();
  console.log(`history-seeder listening on http://localhost:${server.port}`);
}
