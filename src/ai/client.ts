import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../lib/files";

export interface AiCall {
  system: string;
  prompt: string;
  /** JSON schema for the answer (structured output). */
  schema: object;
  effort: "low" | "medium" | "high";
  maxTokens: number;
}

export type AiErrorCode = "no_key" | "refused" | "api" | "network" | "unavailable";

export class AiError extends Error {
  constructor(
    public code: AiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Sends one request to Claude from the Rust side, which holds the API key or runs Claude Code.
 * In a plain browser during development, `mock` answers instead so the UI can be tried.
 */
export async function callClaude<T>(call: AiCall, mock: () => T): Promise<T> {
  if (!isTauri) {
    if (!import.meta.env.DEV) throw new AiError("unavailable", "AI features work in the desktop app.");
    await new Promise((r) => setTimeout(r, 600));
    return mock();
  }
  try {
    return await invoke<T>("ai_request", {
      request: {
        system: call.system,
        prompt: call.prompt,
        schema: call.schema,
        effort: call.effort,
        max_tokens: call.maxTokens,
      },
    });
  } catch (err) {
    const message = String(err);
    const match = /^(no_key|refused|api|network): ([\s\S]*)$/.exec(message);
    throw new AiError((match?.[1] as AiErrorCode) ?? "api", match?.[2] ?? message);
  }
}

export const aiKeyStatus = (): Promise<boolean> =>
  isTauri ? invoke<boolean>("ai_key_status") : Promise.resolve(import.meta.env.DEV);

export const aiSetKey = (key: string) => invoke<void>("ai_set_key", { key });

export const aiClearKey = () => invoke<void>("ai_clear_key");

export interface ClaudeCodeStatus {
  installed: boolean;
  /** Claude Code is signed in. */
  connected: boolean;
  /** The person chose to use their subscription in Undertext. */
  enabled: boolean;
  /** "pro", "max", … when signed in with a Claude subscription */
  plan: string | null;
}

/** Claude Code runs AI requests on the person's Claude subscription when no API key is set and they opted in. */
export const claudeCodeStatus = () => invoke<ClaudeCodeStatus>("claude_code_status");

/** Turns the subscription on or off for Undertext. Never signs Claude Code in or out. */
export const claudeCodeSetEnabled = (enabled: boolean) => invoke<void>("claude_code_set_enabled", { enabled });
