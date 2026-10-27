// Lists models available to your Token Factory key and highlights NVIDIA Nemotron ones.
// Usage: NEBIUS_API_KEY=... npm run check-models   (or put the key in .env.local)
import { readFileSync, existsSync } from 'fs';
if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const key = process.env.NEBIUS_API_KEY;
const base = (process.env.NEBIUS_BASE_URL || 'https://api.tokenfactory.nebius.com/v1').replace(/\/$/, '');
if (!key) { console.error('Set NEBIUS_API_KEY first.'); process.exit(1); }
const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } });
if (!res.ok) { console.error(res.status, await res.text()); process.exit(1); }
const { data } = await res.json();
const ids = data.map((m) => m.id).sort();
const nv = ids.filter((id) => /nemotron|nvidia/i.test(id));
console.log('NVIDIA / Nemotron models:\n  ' + (nv.join('\n  ') || '(none found)'));
console.log(`\n${ids.length} models in total. Put your choices in .env.local as TRIAGE_MODEL and REASONING_MODEL.`);
