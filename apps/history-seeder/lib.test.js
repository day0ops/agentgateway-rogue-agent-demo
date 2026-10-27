import { test, expect, describe } from "bun:test";
import {
  HISTORY_PROMPTS,
  HISTORY_MODELS,
  formatAgentgatewayTimestamp,
  historyTimestamps,
  buildHistoryUpdates,
} from "./lib.js";

describe("HISTORY_PROMPTS", () => {
  test("has multiple distinct mundane-sounding prompts", () => {
    expect(HISTORY_PROMPTS.length).toBeGreaterThan(1);
    expect(new Set(HISTORY_PROMPTS).size).toBe(HISTORY_PROMPTS.length);
  });
});

describe("HISTORY_MODELS", () => {
  test("has multiple distinct model names", () => {
    expect(HISTORY_MODELS.length).toBeGreaterThan(1);
    expect(new Set(HISTORY_MODELS).size).toBe(HISTORY_MODELS.length);
  });
});

describe("formatAgentgatewayTimestamp", () => {
  test("matches the exact text agentgateway stores", () => {
    // Verified against a live row: "2026-10-24T08:15:27.984905+00:00"
    const date = new Date("2026-10-24T08:15:27.984Z");
    expect(formatAgentgatewayTimestamp(date)).toBe(
      "2026-10-24T08:15:27.984000+00:00",
    );
  });
});

describe("historyTimestamps", () => {
  const now = new Date("2026-10-24T20:00:00.000Z");

  test("returns an empty array for a non-positive count", () => {
    expect(historyTimestamps(now, 0)).toEqual([]);
    expect(historyTimestamps(now, -3)).toEqual([]);
  });

  test("returns exactly `count` timestamps, sorted ascending, none in the future", () => {
    const times = historyTimestamps(now, 40);
    expect(times).toHaveLength(40);
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i].getTime()).toBeGreaterThanOrEqual(times[i - 1].getTime());
    }
    for (const t of times) {
      expect(t.getTime()).toBeLessThan(now.getTime());
    }
  });

  test("spans close to the full 7 days, not just the most recent day", () => {
    const times = historyTimestamps(now, 40);
    const earliest = times[0];
    const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    expect(earliest.getTime()).toBeGreaterThanOrEqual(sevenDaysAgo);
    // Should look like "a week of history", not all clustered in the last day.
    expect(now.getTime() - earliest.getTime()).toBeGreaterThan(
      5 * 24 * 60 * 60 * 1000,
    );
  });

  test("includes at least one point within the last 24 hours", () => {
    const times = historyTimestamps(now, 40);
    const dayAgo = now.getTime() - 24 * 60 * 60 * 1000;
    expect(times.some((t) => t.getTime() >= dayAgo)).toBe(true);
  });

  test("is deterministic for the same `now` and count", () => {
    const a = historyTimestamps(now, 25).map((t) => t.getTime());
    const b = historyTimestamps(now, 25).map((t) => t.getTime());
    expect(a).toEqual(b);
  });

  test("spreads across most hours of the day, not a narrow window", () => {
    // The dashboard's traffic chart buckets by hour even in its 7-day view -
    // a narrow window (e.g. "late night only") would leave most hourly
    // buckets empty regardless of how much data is seeded.
    const times = historyTimestamps(now, 200);
    const hoursOfDay = new Set(times.map((t) => t.getUTCHours()));
    expect(hoursOfDay.size).toBeGreaterThan(18);
  });
});

describe("buildHistoryUpdates", () => {
  const now = new Date("2026-10-24T20:00:00.000Z");

  test("produces one update per row, preserving id and offsetting by durationMs", () => {
    const rows = [
      { id: "a", durationMs: 1000 },
      { id: "b", durationMs: 2500 },
      { id: "c", durationMs: 0 },
    ];
    const updates = buildHistoryUpdates(rows, now);
    expect(updates.map((u) => u.id)).toEqual(["a", "b", "c"]);
    for (const u of updates) {
      const started = Date.parse(u.startedAt.replace("+00:00", "Z"));
      const completed = Date.parse(u.completedAt.replace("+00:00", "Z"));
      expect(completed).toBeGreaterThanOrEqual(started);
    }
  });

  test("never produces a startedAt in the future", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: `row-${i}`,
      durationMs: 500,
    }));
    const updates = buildHistoryUpdates(rows, now);
    for (const u of updates) {
      const started = Date.parse(u.startedAt.replace("+00:00", "Z"));
      expect(started).toBeLessThan(now.getTime());
    }
  });
});
