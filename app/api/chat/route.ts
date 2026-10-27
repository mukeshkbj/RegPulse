import { Telemetry } from '@/lib/llm';
import { answer } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const { question, run, history } = await req.json();
    const t = new Telemetry();
    const reply = await answer(String(question || '').slice(0, 1000), run, Array.isArray(history) ? history : [], t);
    return Response.json({ reply, calls: t.calls });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
