/**
 * Simple in-memory rate limits that protect the public demo (and the owner's Token Factory and Tavily
 * credit) during judging. Per server instance: good enough to stop bursts and runaway loops on a demo;
 * a production deployment would use a shared store (e.g. Redis) instead.
 */
const hits = new Map<string, number[]>();

function take(key: string, limit: number, windowMs: number): { ok: boolean; retryInMin: number } {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    hits.set(key, list);
    return { ok: false, retryInMin: Math.ceil((windowMs - (now - list[0])) / 60000) };
  }
  list.push(now);
  hits.set(key, list);
  return { ok: true, retryInMin: 0 };
}

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export function clientKey(req: Request): string {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
}

/** Live sweeps: per visitor per hour, and per instance per day. Set SWEEPS_PER_DAY=0 to allow only the recorded run. */
export function allowSweep(req: Request) {
  const perDay = num(process.env.SWEEPS_PER_DAY, 60);
  if (perDay <= 0) return { ok: false, reason: 'Live sweeps are paused on this demo.' };
  const ip = take(`sweep:${clientKey(req)}`, num(process.env.SWEEPS_PER_HOUR_PER_VISITOR, 3), 3600_000);
  if (!ip.ok) return { ok: false, reason: `You've run the most live sweeps allowed per hour on this demo. Try again in about ${ip.retryInMin} minutes.` };
  const day = take('sweep:global', perDay, 86_400_000);
  if (!day.ok) return { ok: false, reason: 'This demo has reached its daily limit of live sweeps.' };
  return { ok: true, reason: '' };
}

/** Tickets and chat questions: per visitor per hour. */
export function allowCall(req: Request, kind: 'ticket' | 'chat') {
  const r = take(`${kind}:${clientKey(req)}`, num(process.env.CALLS_PER_HOUR_PER_VISITOR, 30), 3600_000);
  return r.ok ? { ok: true, reason: '' } : { ok: false, reason: `Hourly limit reached on this demo. Try again in about ${r.retryInMin} minutes.` };
}
