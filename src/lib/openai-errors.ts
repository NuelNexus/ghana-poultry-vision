// Plain-language wording for OpenAI's usage-limit errors, shared by the server
// (chat, translation, speech) and the browser (the live voice call, which
// talks to OpenAI directly). Anything else keeps OpenAI's own message.

/**
 * A farmer-readable message for an OpenAI error response, or null when it
 * isn't a limit problem. `body` is the raw response text.
 */
export function openAiLimitMessage(status: number, body: string): string | null {
  if (status !== 429) return null;
  let code = "";
  try {
    const e = JSON.parse(body).error ?? {};
    code = `${e.code ?? ""} ${e.type ?? ""}`;
  } catch {
    /* not JSON */
  }
  if (/insufficient_quota|spend_limit|billing/.test(code))
    return "Ama is paused: the farm’s OpenAI account has reached its spending limit. An admin can raise the limit or add credit at platform.openai.com (Settings → Limits / Billing).";
  return "Ama is getting too many requests right now. Wait a minute and try again.";
}
