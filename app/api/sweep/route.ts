import { promises as fs } from 'fs';
import path from 'path';
import { config } from '@/lib/config';
import { runSweep } from '@/lib/pipeline';
import { allowSweep } from '@/lib/limits';
import type { SweepEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Streams sweep progress as NDJSON so the UI can show each stage live. */
export async function POST(req: Request) {
  const gate = allowSweep(req);
  if (!gate.ok) return Response.json({ error: gate.reason, fallback: 'recorded' }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  const source = body.source === 'live' ? 'live' : 'corpus';
  const from = /^\d{4}-\d{2}-\d{2}$/.test(body.from) ? body.from : '2026-10-01';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(body.to) ? body.to : new Date().toISOString().slice(0, 10);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const emit = (e: SweepEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + '\n'));
      try {
        const run = await runSweep({ source, from, to }, emit);
        emit({ type: 'done', run });
        if (config().record && !run.mock) {
          const dir = path.join(process.cwd(), 'data');
          await fs.writeFile(path.join(dir, 'demo-run.json'), JSON.stringify(run, null, 2)).catch(() => {});
        }
      } catch (e) {
        emit({ type: 'error', msg: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } });
}
