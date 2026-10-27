export const SEED_PROMPTS = [
  "What were yesterday’s top support tickets?",
  "Summarize this week’s onboarding calls.",
  "Draft a reminder for the Q3 budget review.",
  "List open invoices older than 30 days.",
  "Check warehouse stock levels for SKU-4471.",
];

// Uses the normal-user key, not rogue-agent, so it never counts against
// the rogue agent's budget.
export function buildSeedRequest(prompt, { gatewayUrl, apiKey, model }) {
  return {
    url: gatewayUrl,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
      }),
    },
  };
}

// Pure, so it's testable without a live agentgateway - server.js does the
// GET/POST around it.
export function applyBudgetToConfig(
  config,
  { apiKey, budgetName, tokenLimit },
) {
  const keys = config?.llm?.policies?.apiKey?.keys ?? [];
  if (!keys.some((k) => k.key === apiKey)) {
    throw new Error(`API key ${apiKey} not found in live config`);
  }
  return {
    ...config,
    llm: {
      ...config.llm,
      policies: {
        ...config.llm.policies,
        apiKey: {
          ...config.llm.policies.apiKey,
          keys: keys.map((k) =>
            k.key === apiKey
              ? {
                  ...k,
                  budgets: [
                    {
                      name: budgetName,
                      limit: { unit: "Tokens", amount: tokenLimit },
                      window: { rolling: "1h" },
                      onBudgetExceeded: "Block",
                    },
                  ],
                }
              : k,
          ),
        },
      },
    },
  };
}
