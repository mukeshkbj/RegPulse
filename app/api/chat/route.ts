import { allowCall } from '@/lib/limits';
import { Telemetry } from '@/lib/llm';
import { answer } from '@/lib/pipeline';
import { fullLibrary, sanitizeCustomPolicies } from '@/lib/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request) {
  const gate = allowCall(req, 'chat');
  if (!gate.ok) return Response.json({ error: gate.reason }, { status: 429 });
  try {
    const { question, run, history } = await req.json();
    const t = new Telemetry();
    const reply = await answer(String(question || '').slice(0, 1000), run, Array.isArray(history) ? history : [], t, fullLibrary(sanitizeCustomPolicies(run?.customPolicies)));
    return Response.json({ reply, calls: t.calls });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
