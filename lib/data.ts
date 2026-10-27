import corpus from '@/data/corpus.json';
import library from '@/data/library.json';
import firm from '@/data/firm.json';
import type { Firm, PolicyDoc, Publication } from './types';

export const FIRM = firm as Firm;
export const LIBRARY = library as PolicyDoc[];
export const CORPUS = corpus as { window: { from: string; to: string }; items: Publication[] };

export function libraryAsContext(lib: PolicyDoc[] = LIBRARY): string {
  return lib.map(
    (d) => `### ${d.id} — ${d.title}\nType: ${d.kind} | Owner: ${d.owner} | Last reviewed: ${d.reviewed}\n${d.body}`
  ).join('\n\n');
}

/**
 * "Try your own policy": visitors can add up to 3 policies of their own, kept in their browser and sent
 * with each request. They are validated and size-capped here before they reach any prompt.
 */
export function sanitizeCustomPolicies(input: unknown): PolicyDoc[] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, 3)
    .map((raw, i) => {
      const r = (raw || {}) as Record<string, unknown>;
      const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : '');
      return {
        id: `MY-${i + 1}`,
        title: str(r.title, 120) || `Your policy ${i + 1}`,
        kind: 'Your policy',
        owner: str(r.owner, 80) || 'Policy owner',
        reviewed: '',
        body: str(r.body, 6000),
      };
    })
    .filter((d) => d.body.split(/\s+/).length >= 15);
}

export function fullLibrary(custom: PolicyDoc[] = []): PolicyDoc[] {
  return [...LIBRARY, ...custom];
}
