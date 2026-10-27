import { test, expect, describe } from "bun:test";
import { SEED_PROMPTS, buildSeedRequest, applyBudgetToConfig } from "./lib.js";

describe("SEED_PROMPTS", () => {
  test("has multiple distinct normal-looking prompts", () => {
    expect(SEED_PROMPTS.length).toBeGreaterThan(1);
    expect(new Set(SEED_PROMPTS).size).toBe(SEED_PROMPTS.length);
  });
});

describe("buildSeedRequest", () => {
  test("targets the gateway URL with the normal-user key, not the rogue-agent key", () => {
    const { url, init } = buildSeedRequest("hi", {
      gatewayUrl: "http://localhost:4000/v1/chat/completions",
      apiKey: "sk-normal-user-demo",
      model: "mock-model",
    });
    expect(url).toBe("http://localhost:4000/v1/chat/completions");
    expect(init.headers["x-api-key"]).toBe("sk-normal-user-demo");
    expect(JSON.parse(init.body).messages[0].content).toBe("hi");
    expect(JSON.parse(init.body).model).toBe("mock-model");
  });
});

describe("applyBudgetToConfig", () => {
  const baseConfig = {
    config: { adminAddr: "0.0.0.0:15000" },
    llm: {
      port: 4000,
      policies: {
        apiKey: {
          mode: "strict",
          keys: [
            {
              key: "sk-rogue-agent-demo",
              metadata: { name: "rogue-agent" },
              budgets: [],
            },
            {
              key: "sk-normal-user-demo",
              metadata: { name: "normal-user" },
              budgets: [],
            },
          ],
        },
      },
      models: [{ name: "mock-model" }],
    },
  };

  test("attaches a budget to the matching key only", () => {
    const updated = applyBudgetToConfig(baseConfig, {
      apiKey: "sk-rogue-agent-demo",
      budgetName: "rogue-agent-budget",
      tokenLimit: 500,
    });

    const rogue = updated.llm.policies.apiKey.keys.find(
      (k) => k.key === "sk-rogue-agent-demo",
    );
    expect(rogue.budgets).toEqual([
      {
        name: "rogue-agent-budget",
        limit: { unit: "Tokens", amount: 500 },
        window: { rolling: "1h" },
        onBudgetExceeded: "Block",
      },
    ]);

    const normal = updated.llm.policies.apiKey.keys.find(
      (k) => k.key === "sk-normal-user-demo",
    );
    expect(normal.budgets).toEqual([]);
  });

  test("leaves unrelated config untouched", () => {
    const updated = applyBudgetToConfig(baseConfig, {
      apiKey: "sk-rogue-agent-demo",
      budgetName: "rogue-agent-budget",
      tokenLimit: 500,
    });
    expect(updated.config).toEqual(baseConfig.config);
    expect(updated.llm.port).toBe(4000);
    expect(updated.llm.models).toEqual(baseConfig.llm.models);
  });

  test("does not mutate the original config", () => {
    applyBudgetToConfig(baseConfig, {
      apiKey: "sk-rogue-agent-demo",
      budgetName: "rogue-agent-budget",
      tokenLimit: 500,
    });
    expect(
      baseConfig.llm.policies.apiKey.keys.find(
        (k) => k.key === "sk-rogue-agent-demo",
      ).budgets,
    ).toEqual([]);
  });

  test("throws when the key is not found in the live config", () => {
    expect(() =>
      applyBudgetToConfig(baseConfig, {
        apiKey: "sk-does-not-exist",
        budgetName: "x",
        tokenLimit: 500,
      }),
    ).toThrow(/sk-does-not-exist/);
  });
});
