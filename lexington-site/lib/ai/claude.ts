import "server-only";

import Anthropic from "@anthropic-ai/sdk";

/**
 * Claude, for the parts of the agents that write: the suggested reply to a new
 * enquiry, the words for a construction update, and the note on the daily ads check.
 *
 * Everything that matters is decided in code first (which units, which prices,
 * which alerts). Claude only turns those facts into words, and the words are
 * checked against the same facts before anyone sees them (lib/agents/factcheck.ts).
 * Without ANTHROPIC_API_KEY every agent still works, with fill-in-the-blanks text.
 *
 * Nothing in here throws: a failure is `{ ok: false, error }` in plain words.
 */

export const CLAUDE_MODEL = "claude-opus-5-5";

export function claudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

let cached: Anthropic | null = null;

function anthropic(): Anthropic {
  if (cached) return cached;
  cached = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY?.trim(),
    // A stand-in server is only ever used for testing; production always asks Anthropic.
    baseURL:
      process.env.VERCEL_ENV !== "production" && process.env.ANTHROPIC_BASE_URL
        ? process.env.ANTHROPIC_BASE_URL
        : "https://api.anthropic.com",
    timeout: 120_000,
    maxRetries: 1,
  });
  return cached;
}

export type ClaudeResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type ClaudeContent = Anthropic.Beta.BetaContentBlockParam[];

/** A JSON schema for structured output: every property required, no extra properties. */
export type JsonSchema = Record<string, unknown>;

/**
 * One request, one JSON answer shaped by `schema`.
 * `system` holds the job and its rules (the same for every call of that kind);
 * `content` holds this call's facts and request, and pictures by public URL.
 */
export async function writeWithClaude<T>(opts: {
  system: string;
  content: ClaudeContent;
  schema: JsonSchema;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  /** For the logs only, e.g. "lead reply". */
  purpose: string;
}): Promise<ClaudeResult<T>> {
  if (!claudeConfigured()) return { ok: false, error: "Claude is not connected (no ANTHROPIC_API_KEY)." };
  try {
    const response = await anthropic().beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: opts.maxTokens ?? 16000,
      // If Claude's safety checks ever decline one of these ordinary requests by
      // mistake, Anthropic re-runs it on the stand-in model it recommends.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.system,
      messages: [{ role: "user", content: opts.content }],
      output_config: {
        effort: opts.effort ?? "medium",
        format: { type: "json_schema", schema: opts.schema },
      },
    });

    if (response.stop_reason === "refusal") {
      return { ok: false, error: `Claude declined this one (${response.stop_details?.category ?? "no reason given"}).` };
    }
    if (response.stop_reason === "max_tokens") return { ok: false, error: "Claude's answer was cut off." };

    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    console.log(
      `[claude] ${opts.purpose}: ${response.usage.input_tokens} tokens in, ${response.usage.output_tokens} out (${response.model})`
    );
    return { ok: true, value: JSON.parse(text) as T };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return { ok: false, error: "Anthropic does not accept the API key." };
    if (error instanceof Anthropic.PermissionDeniedError) return { ok: false, error: "The API key is not allowed to use this model." };
    if (error instanceof Anthropic.RateLimitError) return { ok: false, error: "Anthropic is busy right now (rate limit)." };
    if (error instanceof Anthropic.APIConnectionTimeoutError) return { ok: false, error: "Claude took too long to answer." };
    if (error instanceof Anthropic.APIConnectionError) return { ok: false, error: "Claude could not be reached." };
    if (error instanceof Anthropic.APIError) return { ok: false, error: `Anthropic answered ${error.status}: ${error.message}` };
    if (error instanceof SyntaxError) return { ok: false, error: "Claude's answer was not in the expected shape." };
    return { ok: false, error: error instanceof Error ? error.message : "Claude could not be reached." };
  }
}

/** A tiny request that proves the key works (the "Test" button on the Connect page). */
export async function testClaude(): Promise<ClaudeResult<string>> {
  const result = await writeWithClaude<{ reply: string }>({
    system: "You answer connection tests.",
    content: [{ type: "text", text: 'Answer with reply set to "Connected".' }],
    schema: {
      type: "object",
      properties: { reply: { type: "string" } },
      required: ["reply"],
      additionalProperties: false,
    },
    effort: "low",
    maxTokens: 2000,
    purpose: "connection test",
  });
  return result.ok ? { ok: true, value: result.value.reply } : result;
}
