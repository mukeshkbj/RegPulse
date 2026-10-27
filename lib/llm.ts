import { config } from './config';
import type { CallLog } from './types';

export type Tier = 'triage' | 'reasoning';
export interface Msg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Collects every model and search call so the UI can show tokens, latency and cost. */
export class Telemetry {
  calls: CallLog[] = [];
  private n = 0;
  constructor(private onCall?: (c: CallLog) => void) {}
  add(c: Omit<CallLog, 'id'>) {
    const call = { ...c, id: ++this.n };
    this.calls.push(call);
    this.onCall?.(call);
    return call;
  }
}

/** Remove reasoning traces some models emit before the answer. */
export function stripThinking(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();
}

/** Parse the first JSON object in a model reply, tolerating code fences and stray prose. */
export function parseJson<T>(raw: string): T {
  const s = stripThinking(raw).replace(/```(?:json)?/gi, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in model reply');
  return JSON.parse(s.slice(start, end + 1)) as T;
}

/**
 * Call a Nemotron model on Nebius Token Factory (OpenAI-compatible /chat/completions).
 * Logs model, tokens, latency and estimated cost for every call.
 */
export async function chat(opts: {
  tier: Tier;
  stage: CallLog['stage'];
  messages: Msg[];
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  telemetry: Telemetry;
  note?: string;
}): Promise<string> {
  const cfg = config();
  const model = opts.tier === 'triage' ? cfg.triageModel : cfg.reasoningModel;
  const price = opts.tier === 'triage' ? cfg.prices.triage : cfg.prices.reasoning;
  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature ?? 0.1,
  };
  if (opts.json) body.response_format = { type: 'json_object' };

  const t0 = Date.now();
  let res = await post(cfg.baseUrl, cfg.nebiusKey, body);
  // Some models reject response_format; retry once without it.
  if (!res.ok && opts.json && res.status === 400) {
    delete body.response_format;
    res = await post(cfg.baseUrl, cfg.nebiusKey, body);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token Factory ${res.status} for ${model}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const latencyMs = Date.now() - t0;
  const u = data.usage || {};
  const promptTokens = u.prompt_tokens ?? 0;
  const completionTokens = u.completion_tokens ?? 0;
  opts.telemetry.add({
    stage: opts.stage,
    provider: 'token-factory',
    model,
    promptTokens,
    completionTokens,
    latencyMs,
    costUsd: (promptTokens * price.in + completionTokens * price.out) / 1e6,
    note: opts.note,
  });
  return data.choices?.[0]?.message?.content ?? '';
}

async function post(baseUrl: string, key: string, body: unknown) {
  return fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
}

/** Run async work over items with a fixed concurrency. */
export async function pool<T, R>(items: T[], size: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** chat() + parseJson with one retry if the reply is not valid JSON (e.g. truncated or wrapped in prose). */
export async function chatJson<T>(opts: Parameters<typeof chat>[0]): Promise<T> {
  const first = await chat(opts);
  try {
    return parseJson<T>(first);
  } catch {
    const retry = await chat({
      ...opts,
      note: `${opts.note ?? ''} (retry: invalid JSON)`,
      messages: [...opts.messages, { role: 'assistant', content: first.slice(0, 2000) }, { role: 'user', content: 'That reply was not a valid JSON object. Return only the JSON object, nothing else.' }],
    });
    return parseJson<T>(retry);
  }
}
