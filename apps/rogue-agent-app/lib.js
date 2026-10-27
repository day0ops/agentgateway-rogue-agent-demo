// How long to wait before firing the next request, in milliseconds.
// Starts at startMs and decays toward floorMs as more requests go out, so the
// runaway loop visibly speeds up the longer it runs instead of looping at a
// constant rate.
export function nextIntervalMs(
  requestCount,
  { startMs = 700, floorMs = 80, decayPerRequest = 60 } = {},
) {
  return Math.max(floorMs, startMs - requestCount * decayPerRequest);
}

// Builds the outbound request target for the agent's current routing mode.
// 'direct' bypasses agentgateway entirely (no API key, nothing governing it).
// 'gateway' routes through agentgateway using the rogue-agent virtual key.
// userAgent identifies whose machine this traffic is from, both in
// agentgateway's own request logs and the terminal scene's narration.
export function buildOutboundRequest(
  mode,
  { directUrl, gatewayUrl, apiKey, userAgent },
) {
  if (mode === "gateway") {
    return {
      url: gatewayUrl,
      headers: { "x-api-key": apiKey, "user-agent": userAgent },
    };
  }
  return { url: directUrl, headers: { "user-agent": userAgent } };
}
