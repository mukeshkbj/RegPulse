import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

/**
 * Returns the recorded run for instant replay. Prefers data/recorded-run.json (a run you have chosen
 * to keep), falling back to data/demo-run.json (the last live sweep, overwritten on each run).
 */
export async function GET() {
  for (const name of ['recorded-run.json', 'demo-run.json']) {
    try {
      const raw = await fs.readFile(path.join(process.cwd(), 'data', name), 'utf8');
      return new Response(raw, { headers: { 'Content-Type': 'application/json' } });
    } catch {
      /* try next */
    }
  }
  return Response.json({ error: 'No recorded run yet. Run a sweep with a Token Factory key and RECORD_RUNS=1.' }, { status: 404 });
}
