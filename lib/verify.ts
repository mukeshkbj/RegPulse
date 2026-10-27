import { LIBRARY } from './data';
import type { Assessment, Impact, PolicyDoc, Publication, Urgency } from './types';

const URG: Urgency[] = ['high', 'medium', 'low'];
export const asUrg = (v: unknown): Urgency => (URG.includes(v as Urgency) ? (v as Urgency) : 'medium');

// ---------- Quote verification: the guardrail against invented citations ----------

/**
 * Word-level normalisation for citation checks: lower case, unify quote marks and dashes,
 * then keep only letters and digits. The words must match exactly and in order; punctuation,
 * bullets and line breaks may differ (a list quoted inline still matches the bulleted source).
 */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/'/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** True if the quote (or each part of an elided quote) appears word for word in the source text. */
export function quoteInSource(quote: string, source: string): boolean {
  const src = ` ${normalise(source)} `;
  const parts = quote
    .split(/\.\.\.|…/)
    .map((p) => normalise(p))
    .filter((p) => p.length > 0);
  if (!parts.length) return false;
  if (parts.join(' ').split(' ').length < 4) return false;
  return parts.every((p) => src.includes(` ${p} `));
}

export interface RawImpact {
  policy_id: string;
  control_ids?: string[];
  impact_type?: string;
  gap?: string;
  action?: string;
  severity?: string;
  owner?: string;
  due_date?: string;
  due_basis?: string;
  quote?: string;
  rationale?: string;
}

export function verifyImpacts(p: Publication, raw: RawImpact[], model: string, headline: string, noImpactReason?: string, lib: PolicyDoc[] = LIBRARY): Assessment {
  const impacts: Impact[] = [];
  const rejected: Assessment['rejected'] = [];
  raw.forEach((r, i) => {
    const doc = lib.find((d) => d.id === r.policy_id);
    const quote = (r.quote || '').trim();
    if (!doc) return rejected.push({ policyId: r.policy_id, quote, why: 'Policy ID not in library' });
    if (!quoteInSource(quote, p.text)) return rejected.push({ policyId: r.policy_id, quote, why: 'Quote not found verbatim in source' });
    const knownControls = (r.control_ids || []).filter((c) => doc.body.includes(c));
    // One impact per policy: fold duplicates into the first (keeps its quote, merges controls).
    const dup = impacts.find((x) => x.policyId === doc.id);
    if (dup) {
      dup.controlIds = [...new Set([...dup.controlIds, ...knownControls])];
      return;
    }
    impacts.push({
      id: `${p.id}::${i}`,
      pubId: p.id,
      policyId: doc.id,
      controlIds: knownControls,
      impactType: r.impact_type === 'second-order' ? 'second-order' : 'direct',
      gap: r.gap || '',
      action: r.action || '',
      severity: asUrg(r.severity),
      owner: r.owner && r.owner.trim() ? r.owner : doc.owner,
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(r.due_date || '') ? (r.due_date as string) : '',
      dueBasis: r.due_basis || '',
      quote,
      rationale: r.rationale || '',
      verified: true,
    });
  });
  return { pubId: p.id, headline, noImpactReason, impacts, rejected, model };
}

