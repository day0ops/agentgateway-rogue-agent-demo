// Mundane-sounding prompts for the history-seeder key's history seed.
export const HISTORY_PROMPTS = [
  "Summarize the latest batch of support tickets.",
  "Draft a follow-up email for the open invoices.",
  "Check inventory levels across all warehouses.",
  "Generate a status report for the ongoing migration.",
  "Reconcile yesterday's shipment records.",
  "Flag any anomalies in the nightly sync logs.",
];

// Must match agentgateway/config.yaml's llm.models entries exactly - real
// first-class provider types (not just distinct model names) are what let
// the dashboard's Models/Providers breakdowns show a believable mix.
export const HISTORY_MODELS = [
  "gpt-4o-mini",
  "gpt-4o",
  "claude-sonnet-5",
  "claude-haiku-4-5",
];

const DAY_MS = 24 * 60 * 60 * 1000;

// Matches agentgateway's own stored format, e.g. "2026-10-24T08:15:27.984905+00:00" -
// its range filters are a string comparison, so this must match exactly.
export function formatAgentgatewayTimestamp(date) {
  const iso = date.toISOString();
  const [datePart, timePart] = iso.split("T");
  const [time, ms] = timePart.replace("Z", "").split(".");
  return `${datePart}T${time}.${ms}000+00:00`;
}

// Spreads `count` timestamps evenly across the full past week, covering the
// whole 24-hour range each day - the chart buckets by hour even in its
// 7-day view, so a narrow window leaves most buckets empty. Takes `now` as
// a param instead of reading the clock, so it's deterministic to test.
export function historyTimestamps(now, count) {
  if (count <= 0) return [];

  const latest = now.getTime() - 60_000;
  const windowStart = now.getTime() - 7 * DAY_MS;
  const windowMs = latest - windowStart;
  const JITTER_MS = 10 * 60 * 1000; // +/- up to 10 minutes, deterministic per index

  const times = [];
  for (let i = 0; i < count; i += 1) {
    const fraction = count > 1 ? i / (count - 1) : 1;
    const base = windowStart + fraction * windowMs;
    const jitter = ((i * 2654435761) % (2 * JITTER_MS + 1)) - JITTER_MS;
    const clamped = Math.min(Math.max(base + jitter, windowStart), latest);
    times.push(new Date(clamped));
  }
  return times.sort((a, b) => a - b);
}

// Pairs rows (each { id, durationMs }) with timestamps to UPDATE
// started_at/completed_at with - no other column changes.
export function buildHistoryUpdates(rows, now) {
  const times = historyTimestamps(now, rows.length);
  return rows.map((row, i) => {
    const startedAt = times[i];
    const completedAt = new Date(startedAt.getTime() + (row.durationMs || 0));
    return {
      id: row.id,
      startedAt: formatAgentgatewayTimestamp(startedAt),
      completedAt: formatAgentgatewayTimestamp(completedAt),
    };
  });
}
