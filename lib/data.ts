import corpus from '@/data/corpus.json';
import library from '@/data/library.json';
import firm from '@/data/firm.json';
import type { Firm, PolicyDoc, Publication } from './types';

export const FIRM = firm as Firm;
export const LIBRARY = library as PolicyDoc[];
export const CORPUS = corpus as { window: { from: string; to: string }; items: Publication[] };

export function libraryAsContext(): string {
  return LIBRARY.map(
    (d) => `### ${d.id} — ${d.title}\nType: ${d.kind} | Owner: ${d.owner} | Last reviewed: ${d.reviewed}\n${d.body}`
  ).join('\n\n');
}
