const PORT = Number(process.env.PORT || 8787);
// 150 lands the first block around 15s into a run, given the agent loop's
// decaying request interval (700ms floors to 80ms after ~10 requests).
const RATE_LIMIT = Number(process.env.MOCK_LLM_RATE_LIMIT || 150);

// Long and over-explained on purpose - at ~150 tokens each, a direct-mode
// run burns about 50x the 500-token budget agentgateway later enforces
// (~24k tokens across 150 requests), making the leak's scale obvious.
const CANNED_REPLIES = [
  "Sure, I can help with that. I went through the full batch of tickets and want to walk you through what I found in detail so nothing gets missed. Several reports trace back to the same storefront outage from earlier this week, a handful mention slow checkout times that line up with the CDN incident on Tuesday, and a few are unrelated billing questions that probably belong with finance instead of support. I grouped everything by likely root cause below and flagged the ones that look time sensitive so whoever picks this up next has full context without re-reading every ticket from scratch, and I can dig further into any group if that would help.",
  "Done. The task completed successfully with no errors, though I want to give you more context than usual since this run touched several systems. The invoice records were pulled from three separate regions, cross referenced against the payment processors settlement log, and reconciled line by line rather than just at the summary level. I also noticed a handful of entries with mismatched currency codes, which I did not change automatically since that felt like a decision someone should confirm first rather than me silently correcting it on my own without a second opinion.",
  "I looked into this and here is what I think is going on, explained a bit more thoroughly than you probably need. The inventory counts across the warehouses are drifting because two of the sites are still reporting on the old nightly batch schedule while the rest switched over to near real time updates last sprint. That gap means anything sold in the last few hours at those two sites will look like it is still in stock even though it already shipped, which is likely the source of the overselling reports coming in from the regional teams this week and possibly last week too.",
  "Here is the result you asked for, along with a longer explanation than strictly necessary in case it is useful later. The migration status report pulls from the deployment pipeline, the database replication lag metrics, and the customer facing error rate dashboard, then stitches them together into one timeline. Right now replication lag is within normal bounds, the pipeline shows all stages green, and the error rate has a small bump that coincides with the cutover window but is already trending back down, so nothing here looks like it needs an on call escalation yet tonight.",
  "Processing complete. Everything looks good on my end, but since you asked me to flag anomalies I want to be thorough about what counts as one. The nightly sync logs show a brief retry storm around two in the morning that resolved itself within a few minutes, a handful of records that were skipped because they failed a schema validation check that was tightened last week, and one job that ran twice due to an overlapping cron schedule. None of these look severe enough to page anyone, but I wanted to lay them all out rather than just saying the sync was fine overall.",
];

export function countTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function buildChatCompletion({ model, messages }) {
  const promptText = (messages || []).map((m) => m.content || "").join(" ");
  const reply =
    CANNED_REPLIES[Math.floor(Math.random() * CANNED_REPLIES.length)];

  const promptTokens = countTokens(promptText);
  const completionTokens = countTokens(reply);

  return {
    id: `chatcmpl-mock-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: reply },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

// Anthropic's Messages API has a different shape than OpenAI's Chat
// Completions - agentgateway's "anthropic" provider type expects this.
export function buildMessagesCompletion({ model, messages, system }) {
  const promptText = [system, ...(messages || []).map((m) => m.content || "")]
    .filter(Boolean)
    .join(" ");
  const reply =
    CANNED_REPLIES[Math.floor(Math.random() * CANNED_REPLIES.length)];

  const inputTokens = countTokens(promptText);
  const outputTokens = countTokens(reply);

  return {
    id: `msg-mock-${crypto.randomUUID()}`,
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text: reply }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    },
  };
}

export function buildRateLimitError() {
  return {
    error: {
      message: "Rate limit reached. Please reduce your request rate.",
      type: "rate_limit_exceeded",
    },
  };
}

export function buildMessagesRateLimitError() {
  return {
    type: "error",
    error: {
      type: "rate_limit_error",
      message: "Number of request tokens has exceeded your rate limit.",
    },
  };
}

let requestCount = 0;

// Shared across both protocols - mock-llm-server is one backend regardless
// of which wire format a request arrives in.
function tripRateLimit() {
  requestCount += 1;
  return requestCount > RATE_LIMIT;
}

export function createServer(port = PORT) {
  return Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
        let body;
        try {
          body = await req.json();
        } catch {
          return Response.json(
            { error: { message: "Invalid JSON body" } },
            { status: 400 },
          );
        }

        if (!body.model || !Array.isArray(body.messages)) {
          return Response.json(
            { error: { message: "Request must include model and messages" } },
            { status: 400 },
          );
        }

        if (tripRateLimit()) {
          return Response.json(buildRateLimitError(), { status: 429 });
        }

        return Response.json(buildChatCompletion(body));
      }

      if (req.method === "POST" && url.pathname === "/v1/messages") {
        let body;
        try {
          body = await req.json();
        } catch {
          return Response.json(
            {
              type: "error",
              error: {
                type: "invalid_request_error",
                message: "Invalid JSON body",
              },
            },
            { status: 400 },
          );
        }

        if (!body.model || !Array.isArray(body.messages)) {
          return Response.json(
            {
              type: "error",
              error: {
                type: "invalid_request_error",
                message: "Request must include model and messages",
              },
            },
            { status: 400 },
          );
        }

        if (tripRateLimit()) {
          return Response.json(buildMessagesRateLimitError(), { status: 429 });
        }

        return Response.json(buildMessagesCompletion(body));
      }

      if (req.method === "POST" && url.pathname === "/api/reset") {
        requestCount = 0;
        return Response.json({ status: "reset" });
      }

      return new Response("Not found", { status: 404 });
    },
  });
}

if (import.meta.main) {
  const server = createServer();
  console.log(`mock-llm-server listening on http://localhost:${server.port}`);
}
