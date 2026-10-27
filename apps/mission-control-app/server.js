import { SEED_PROMPTS, buildSeedRequest, applyBudgetToConfig } from "./lib.js";

const PORT = Number(process.env.PORT || 5174);
const ROGUE_AGENT_URL = process.env.ROGUE_AGENT_URL || "http://localhost:5173";
const GATEWAY_LLM_URL =
  process.env.GATEWAY_LLM_URL || "http://localhost:4000/v1/chat/completions";
// Fallback "open dashboard" link when agentgateway has no LoadBalancer IP
// (e.g. kind without MetalLB) - reached via port-forward instead. Actual
// server-to-server calls use GATEWAY_ADMIN_API_URL, the real in-cluster
// address.
const GATEWAY_ADMIN_URL =
  process.env.GATEWAY_ADMIN_URL || "http://localhost:15000";
const GATEWAY_ADMIN_API_URL =
  process.env.GATEWAY_ADMIN_API_URL || GATEWAY_ADMIN_URL;
const HISTORY_SEEDER_URL =
  process.env.HISTORY_SEEDER_URL || "http://localhost:5176";
const NORMAL_USER_API_KEY =
  process.env.NORMAL_USER_API_KEY || "sk-normal-user-demo";
const ROGUE_AGENT_API_KEY =
  process.env.ROGUE_AGENT_API_KEY || "sk-rogue-agent-demo";
const BUDGET_TOKEN_LIMIT = Number(process.env.BUDGET_TOKEN_LIMIT || 500);
const MODEL = process.env.MODEL || "mock-model";
// Matches gpt-4o-mini's real rate (USD per 1M tokens) - mock-model isn't a
// catalog model, so without this its traffic always shows $0 cost.
const MODEL_COST_INPUT_RATE = process.env.MODEL_COST_INPUT_RATE || "0.15";
const MODEL_COST_OUTPUT_RATE = process.env.MODEL_COST_OUTPUT_RATE || "0.60";
const K8S_NAMESPACE = process.env.K8S_NAMESPACE || "default";
const K8S_AGENTGATEWAY_DEPLOYMENT =
  process.env.K8S_AGENTGATEWAY_DEPLOYMENT || "agentgateway";

function jsonResponse(data, init) {
  return Response.json(data, init);
}

async function runCommand(args) {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`${args.join(" ")} exited ${exitCode}: ${stderr}`);
  }
}

async function runCommandOutput(args) {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
  ]);
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`${args.join(" ")} exited ${exitCode}: ${stderr}`);
  }
  return stdout.trim();
}

// On lok8s, agentgateway's Service is a real LoadBalancer (MetalLB), so the
// dashboard link should point at its actual external IP rather than the
// localhost fallback, which only works when a kind user is port-forwarding.
async function getAgentgatewayDashboardUrl() {
  try {
    const ip = await runCommandOutput([
      "kubectl",
      "get",
      "svc",
      K8S_AGENTGATEWAY_DEPLOYMENT,
      "-n",
      K8S_NAMESPACE,
      "-o",
      "jsonpath={.status.loadBalancer.ingress[0].ip}",
    ]);
    if (ip) {
      return `http://${ip}:15000/ui`;
    }
  } catch {
    // Fall through to the static fallback below.
  }
  return `${GATEWAY_ADMIN_URL}/ui`;
}

async function resetAgentgateway() {
  await runCommand([
    "kubectl",
    "rollout",
    "restart",
    `deployment/${K8S_AGENTGATEWAY_DEPLOYMENT}`,
    "-n",
    K8S_NAMESPACE,
  ]);
  await runCommand([
    "kubectl",
    "rollout",
    "status",
    `deployment/${K8S_AGENTGATEWAY_DEPLOYMENT}`,
    "-n",
    K8S_NAMESPACE,
    "--timeout=60s",
  ]);
}

async function routeAgentThroughGateway() {
  const res = await fetch(`${ROGUE_AGENT_URL}/api/mode`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "gateway" }),
  });
  if (!res.ok) {
    throw new Error(`rogue-agent-app returned ${res.status}`);
  }
  return res.json();
}

async function resetRogueAgent() {
  const res = await fetch(`${ROGUE_AGENT_URL}/api/reset`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`rogue-agent-app returned ${res.status}`);
  }
  return res.json();
}

async function applyBudgetPolicy() {
  const configRes = await fetch(`${GATEWAY_ADMIN_API_URL}/api/config`);
  if (!configRes.ok) {
    throw new Error(`agentgateway returned ${configRes.status} reading config`);
  }
  const config = await configRes.json();
  const updated = applyBudgetToConfig(config, {
    apiKey: ROGUE_AGENT_API_KEY,
    budgetName: "rogue-agent-budget",
    tokenLimit: BUDGET_TOKEN_LIMIT,
  });

  const writeRes = await fetch(`${GATEWAY_ADMIN_API_URL}/api/config`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(updated),
  });
  if (!writeRes.ok) {
    const text = await writeRes.text();
    throw new Error(
      `agentgateway returned ${writeRes.status} applying budget: ${text}`,
    );
  }
}

async function applyModelCosts() {
  const res = await fetch(
    `${GATEWAY_ADMIN_API_URL}/api/config/resources/modelCatalog`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resources: [
          {
            value: {
              custom: {
                providers: {
                  custom: {
                    models: {
                      [MODEL]: {
                        rates: {
                          input: MODEL_COST_INPUT_RATE,
                          output: MODEL_COST_OUTPUT_RATE,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `agentgateway returned ${res.status} setting model costs: ${text}`,
    );
  }
}

async function seedFakeData() {
  let seeded = 0;
  for (const prompt of SEED_PROMPTS) {
    const { url, init } = buildSeedRequest(prompt, {
      gatewayUrl: GATEWAY_LLM_URL,
      apiKey: NORMAL_USER_API_KEY,
      model: MODEL,
    });
    try {
      const res = await fetch(url, init);
      if (res.ok) seeded += 1;
    } catch {
      // Best-effort seeding; one failed request shouldn't abort the rest.
    }
  }
  return seeded;
}

async function seedHistory() {
  const res = await fetch(`${HISTORY_SEEDER_URL}/seed-history`, {
    method: "POST",
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || `history-seeder returned ${res.status}`);
  }
  return body.count;
}

function serveStatic(pathname) {
  return Bun.file(
    `${import.meta.dir}/public${pathname === "/" ? "/index.html" : pathname}`,
  );
}

export function createServer(port = PORT) {
  return Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      if (
        req.method === "POST" &&
        url.pathname === "/api/route-through-gateway"
      ) {
        try {
          const result = await routeAgentThroughGateway();
          return jsonResponse({ status: "routed", rogueAgent: result });
        } catch (err) {
          return jsonResponse(
            { status: "error", error: err.message },
            { status: 502 },
          );
        }
      }

      if (req.method === "POST" && url.pathname === "/api/apply-budget") {
        try {
          await applyBudgetPolicy();
          return jsonResponse({
            status: "applied",
            tokenLimit: BUDGET_TOKEN_LIMIT,
          });
        } catch (err) {
          return jsonResponse(
            { status: "error", error: err.message },
            { status: 502 },
          );
        }
      }

      if (req.method === "POST" && url.pathname === "/api/apply-model-costs") {
        try {
          await applyModelCosts();
          return jsonResponse({ status: "applied" });
        } catch (err) {
          return jsonResponse(
            { status: "error", error: err.message },
            { status: 502 },
          );
        }
      }

      if (req.method === "POST" && url.pathname === "/api/reset") {
        try {
          await resetAgentgateway();
          await resetRogueAgent();
          return jsonResponse({ status: "reset" });
        } catch (err) {
          return jsonResponse(
            { status: "error", error: err.message },
            { status: 502 },
          );
        }
      }

      if (req.method === "POST" && url.pathname === "/api/seed-fake-data") {
        try {
          const seeded = await seedFakeData();
          return jsonResponse({ status: "seeded", count: seeded });
        } catch (err) {
          return jsonResponse(
            { status: "error", error: err.message },
            { status: 502 },
          );
        }
      }

      if (req.method === "POST" && url.pathname === "/api/seed-history") {
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

      if (req.method === "GET" && url.pathname === "/api/links") {
        return jsonResponse({
          agentgatewayUiUrl: await getAgentgatewayDashboardUrl(),
        });
      }

      if (req.method === "GET") {
        const file = serveStatic(url.pathname);
        if (await file.exists()) {
          return new Response(file);
        }
        return new Response("Not found", { status: 404 });
      }

      return new Response("Not found", { status: 404 });
    },
  });
}

if (import.meta.main) {
  const server = createServer();
  console.log(
    `mission-control-app listening on http://localhost:${server.port}`,
  );
}
