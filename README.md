# Why Can't I Have More Tokens, Rob?

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-fbf0df)

This is a demo built for a talk title "Why Can't I Have More Tokens, Rob?" that was presented at [Cloud Native AI Summit](https://www.cloudnative.ai/events/melbourne) conference.

The premise: A developer built an AI agent which has nasty bug leaking tokens; the CFO, Rob, who reins it in with agentgateway and his magic !

Runs entirely on a local Kubernetes cluster, such [lok8s](https://github.com/day0ops/lok8s) or plain [kind](https://kind.sigs.k8s.io).

## The story

1. The colleague's "Acme Agent" app calls a mock LLM **directly** - no gateway, no limits.
2. They click **Run locally**. The agent's bug triggers: a runaway loop, firing request after request, visibly escalating, until it trips the mock LLM's own rate limit and they kill it.
3. Rob opens **Mission Control**, which explains the fix (route through agentgateway, then apply a budget), and clicks **Route through agentgateway**. The Rogue Agent app's request path animates to show the takeover.
4. Rob clicks **Apply budget policy**, attaching a budget to the `rogue-agent` key live. agentgateway's own dashboard shows the same usage spike and the applied policy.
5. The agent's next requests get blocked (429).

## Components

| Directory                         | What it is                                                                                                    | Port                      |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------| ------------------------- |
| `agentgateway/`                   | agentgateway's config, deployed as a Pod.                                                                     | 4000, 15000, 19001, 19002 |
| `apps/mock-llm-server/`           | OpenAI-compatible fake chat-completions server. Zero cost, deterministic.                                     | 8787                      |
| `apps/history-seeder/`            | Sidecar in agentgateway's pod. Backdates real request_logs rows to fake a week of history.                    | 5176                      |
| `apps/rogue-agent-app/`           | "Acme Agent" - the developer's buggy tool. Direct-vs-gateway routing, SSE-driven UI.                          | 5173                      |
| `apps/mission-control-app/`       | Rob's console - 3-beat explainer, routes the agent, links to the real dashboard. Hidden reset/seed controls.  | 5174                      |
| `k8s/`                            | Kubernetes manifests for all four components.                                                                 | -                         |
| `scripts/`                        | Makefile targets' implementation: cluster lifecycle, deploy, port-forward.                                    | -                         |

## Prerequisites

- [Bun](https://bun.sh)
- A container runtime to build images: `podman` or `docker`. Scripts default to `podman`; set `CONTAINER_RUNTIME=docker` to use Docker instead.
- `kubectl`, plus one of:
  - [lok8s](https://github.com/day0ops/lok8s) (v0.7.1+) - on macOS/Apple Silicon this uses its `native` environment (Apple's `container` CLI), no Docker Desktop VM needed.
  - [kind](https://kind.sigs.k8s.io) - more commonly already installed. Note `kind` itself runs on top of Docker (or Podman, via `KIND_EXPERIMENTAL_PROVIDER=podman`) under the hood.

## Running it

Everything is wrapped by the `Makefile`. Run `make help` for the full list.

```bash
make up-kind   # or: make up-lok8s
make forward
```

Either creates the cluster (if needed), builds all four images, loads them in, and deploys the stack. The three user-facing Services are `type: LoadBalancer`:

- On **lok8s**, which ships MetalLB, each gets a real external IP right away - the deploy output prints the direct URLs, no port-forward needed.
- On **kind**, which has no LoadBalancer implementation by default, they stay pending forever. Run `make forward` instead, which opens:
  - **Rogue Agent app**: http://localhost:5173
  - **Mission Control**: http://localhost:5174
  - **agentgateway dashboard**: http://localhost:15000/ui

Either way, Mission Control's "open agentgateway dashboard" link resolves the right address on its own - it looks up agentgateway's Service through the Kubernetes API rather than assuming one fixed URL.

Tear down with `make down-lok8s` / `make down-kind`.

### Prepping the environment with seed data or reset

The operator panel is genuinely hidden, not just unobtrusive: click the "Rob · CFO" badge in Mission Control's topbar (it has no visible affordance marking it as clickable) to open it. From there:

- **Set up cost catalog** - registers a custom cost override for `mock-model`, since it isn't a real model agentgateway's built-in cost catalog recognizes. Cost is computed once, when a request is logged, and never recalculated later - so this must run before any traffic (seeded or live), not just before viewing the dashboard. Anything sent beforehand is permanently stuck at $0.
- **Seed a week of history** - replays traffic through its own `history-seeder` key, then backdates it across the past 7 days so the dashboard already shows a believable backlog.
- **Seed normal traffic** - sends a few ordinary-looking requests through the `normal-user` key, so the dashboard shows a believable baseline instead of an empty graph.
- **Reset demo** - restarts agentgateway with a clean config (empty budgets, empty usage, empty history, empty cost catalog) and returns the Rogue Agent app to direct mode. Safe to run as many times as you need while rehearsing (`make reset` also calls it directly) - just re-run "Set up cost catalog" and the seed actions afterward.

### To demonstrate

1. On the Rogue Agent app, click **Run locally**. It calls the mock LLM directly with no governance, succeeds for a while, then trips the mock LLM's own rate limit - click **Kill process** once you see it start failing.
2. On Mission Control, click **Route through agentgateway**, then **Apply budget policy**. Routing through agentgateway kills the current run and resets the Rogue Agent app's scene back to its code view, clearing the mock LLM's rate limit in the process.
3. Back on the Rogue Agent app, click **Run locally** again - it's now targeting agentgateway with the `rogue-agent` key.
4. Open the agentgateway dashboard to show the key's usage and the budget that was just applied.
5. Watch both apps react once the budget is exceeded - much sooner than the mock LLM's own rate limit would have allowed.

## Tests

```bash
make test
```
