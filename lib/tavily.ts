import { config } from './config';
import type { Publication } from './types';
import type { Telemetry } from './llm';

const API = 'https://api.tavily.com';

interface SearchHit {
  url: string;
  title: string;
  content: string;
  published_date?: string;
}

/** Regulator sources swept every run. Each has its own domain filter and queries. */
export const SOURCES: { regulator: string; domains: string[]; queries: string[] }[] = [
  {
    regulator: 'FCA',
    domains: ['fca.org.uk'],
    queries: [
      'FCA consultation paper policy statement',
      'FCA press release statement firms lenders',
      'FCA Dear CEO letter consumer credit',
    ],
  },
  {
    regulator: 'PRA',
    domains: ['bankofengland.co.uk'],
    queries: ['PRA consultation paper policy statement supervisory statement'],
  },
  {
    regulator: 'ICO',
    domains: ['ico.org.uk'],
    queries: ['ICO guidance consultation call for evidence AI automated decision making'],
  },
];

async function call<T>(path: string, body: unknown): Promise<T> {
  const { tavilyKey } = config();
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tavilyKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Tavily ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

export async function search(
  query: string,
  domains: string[],
  from: string,
  to: string,
  telemetry: Telemetry
): Promise<SearchHit[]> {
  const t0 = Date.now();
  const data = await call<{ results: SearchHit[] }>('/search', {
    query,
    include_domains: domains,
    start_date: from,
    end_date: to,
    search_depth: 'advanced',
    max_results: 8,
  });
  telemetry.add({
    stage: 'search',
    provider: 'tavily',
    model: 'tavily-search',
    promptTokens: 0,
    completionTokens: 0,
    latencyMs: Date.now() - t0,
    costUsd: 0,
    note: `${query} (${data.results.length} hits)`,
  });
  return data.results || [];
}

export async function extract(urls: string[], telemetry: Telemetry): Promise<Record<string, string>> {
  if (!urls.length) return {};
  const t0 = Date.now();
  const data = await call<{ results: { url: string; raw_content: string }[] }>('/extract', {
    urls,
    format: 'text',
  });
  telemetry.add({
    stage: 'extract',
    provider: 'tavily',
    model: 'tavily-extract',
    promptTokens: 0,
    completionTokens: 0,
    latencyMs: Date.now() - t0,
    costUsd: 0,
    note: `${data.results.length}/${urls.length} pages extracted`,
  });
  const out: Record<string, string> = {};
  for (const r of data.results || []) out[r.url] = r.raw_content;
  return out;
}

// Pages that are indexes, registers, warning lists or corporate pages rather than publications.
const NOISE = /\/(news|publications|search|contact|about-us|careers)\/?$|\/handbook\/|\/register|\.(pdf)$|^https?:\/\/(handbook|register|data)\.fca\.org\.uk|\/(warnings?|scams?|consumers)(\/|$)|\/about(\/|$)|\/about-the-ico\/(who-we-are|jobs|our-information)|\/(fca-board|people|events?|careers)(\/|$)|\/news\/(people|statements\/fos)|warnings|glossary/i;

function guessType(title: string, url: string): string {
  const s = `${title} ${url}`.toLowerCase();
  if (/consultation|\bcp\d/.test(s)) return 'Consultation paper';
  if (/policy statement|\bps\d/.test(s)) return 'Policy statement';
  if (/dear ceo|letter/.test(s)) return 'Letter';
  if (/press-release|press release/.test(s)) return 'Press release';
  if (/speech/.test(s)) return 'Speech';
  if (/call for evidence/.test(s)) return 'Call for evidence';
  if (/guidance/.test(s)) return 'Guidance';
  return 'Publication';
}

const slug = (s: string) => s.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[^a-z0-9]+/g, '-').slice(0, 60);

/** Full live sweep: search every source, de-duplicate, then extract clean text for each page. */
export async function sweep(
  from: string,
  to: string,
  telemetry: Telemetry,
  log: (m: string) => void,
  limit = 14
): Promise<Publication[]> {
  const seen = new Map<string, { hit: SearchHit; regulator: string }>();
  for (const src of SOURCES) {
    for (const q of src.queries) {
      log(`Tavily search · ${src.regulator} · “${q}”`);
      const hits = await search(q, src.domains, from, to, telemetry);
      for (const h of hits) {
        const titleKey = (h.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const dupTitle = !!titleKey && [...seen.values()].some((v) => (v.hit.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === titleKey);
        if (NOISE.test(h.url) || seen.has(h.url) || dupTitle) continue;
        seen.set(h.url, { hit: h, regulator: src.regulator });
      }
    }
  }
  const picked = [...seen.values()].slice(0, limit);
  log(`Tavily extract · ${picked.length} pages`);
  const texts = await extract(picked.map((p) => p.hit.url), telemetry);
  return picked
    .map(({ hit, regulator }) => {
      const cleanTitle = (hit.title || '').replace(/\s*\|\s*(FCA|ICO|Bank of England.*)$/i, '').trim();
      const fromUrl = decodeURIComponent(hit.url.split('/').filter(Boolean).pop() || '').replace(/[-_]+/g, ' ');
      return {
        id: slug(hit.url),
        regulator,
        type: guessType(hit.title || '', hit.url),
        title: cleanTitle || fromUrl.charAt(0).toUpperCase() + fromUrl.slice(1),
        url: hit.url,
        published: hit.published_date?.slice(0, 10) || '',
        text: (texts[hit.url] || hit.content || '').slice(0, 20000),
      };
    })
    .filter((p) => p.text.split(/\s+/).length > 60);
}
