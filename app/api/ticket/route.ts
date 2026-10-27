import { allowCall } from '@/lib/limits';
import { Telemetry } from '@/lib/llm';
import { draftTicket } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request) {
  const gate = allowCall(req, 'ticket');
  if (!gate.ok) return Response.json({ error: gate.reason }, { status: 429 });
  try {
    const { impact, publication } = await req.json();
    const t = new Telemetry();
    const ticket = await draftTicket(impact, publication, t);
    return Response.json({ ticket, calls: t.calls });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
