/**
 * Mock mode: deterministic, rule-based stand-ins for the Nemotron calls, used only when
 * NEBIUS_API_KEY is not set so the UI can be developed and tested offline.
 * Every mock call is logged with provider "mock" and the UI shows a MOCK banner.
 */
import { config } from './config';
import { FIRM, LIBRARY } from './data';
import type { Telemetry } from './llm';
import { verifyImpacts } from './verify';
import type { Assessment, Impact, PolicyDoc, Publication, RunResult, Ticket, Triage } from './types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const est = (s: string) => Math.ceil(s.length / 4);

async function logMock(t: Telemetry, stage: 'triage' | 'assess' | 'ticket' | 'chat', inChars: number, outChars: number, note: string) {
  const cfg = config();
  const tier = stage === 'triage' ? cfg.prices.triage : cfg.prices.reasoning;
  const model = stage === 'triage' ? cfg.triageModel : cfg.reasoningModel;
  const ms = stage === 'triage' ? 250 + Math.random() * 250 : 700 + Math.random() * 600;
  await sleep(ms);
  const p = est('x'.repeat(inChars)), c = est('x'.repeat(outChars));
  t.add({ stage, provider: 'mock', model: `mock:${model}`, promptTokens: p, completionTokens: c, latencyMs: Math.round(ms), costUsd: (p * tier.in + c * tier.out) / 1e6, note });
}

const OUT_OF_SCOPE = /\b(fund|funds|redemption|transaction reporting|trading venue|listed issuer|primary market|defi|decentralised|cryptoasset|insurer|solvency|deposit takers?|credit union)/i;

export async function mockTriage(p: Publication, t: Telemetry): Promise<Triage> {
  await logMock(t, 'triage', 2500 + Math.min(p.text.length, 6000), 260, p.title);
  const hay = `${p.title} ${p.text}`;
  const prudentialOnly = p.regulator === 'PRA';
  const scopeHit = /annex 1|financial crime|fraud|agentic ai|automated decision|third-party|vendor-supplied|certification regime|lender/i.test(hay);
  const outHits = (hay.match(new RegExp(OUT_OF_SCOPE, 'gi')) || []).length;
  const relevant = !prudentialOnly && scopeHit && (outHits < 3 || /financial crime guide|annex 1/i.test(hay));
  const topics = [
    /annex 1|money laundering/i.test(hay) && 'AML',
    /fraud/i.test(hay) && 'fraud',
    /agentic|artificial intelligence|\bAI\b/i.test(hay) && 'AI',
    /automated decision/i.test(hay) && 'ADM',
    /third-party|vendor/i.test(hay) && 'third parties',
    /SM&CR|certification/i.test(hay) && 'SM&CR',
  ].filter(Boolean) as string[];
  const urgency = /press release|restrict/i.test(`${p.type} ${p.title}`) ? 'high' : /consultation|call for evidence/i.test(p.type) ? 'medium' : 'low';
  return {
    pubId: p.id,
    relevant,
    urgency: relevant ? urgency : 'low',
    topics: topics.slice(0, 4),
    summary: p.text.split('\n').find((l) => l.split(' ').length > 8)?.slice(0, 180) || p.title,
    reason: relevant ? 'Touches controls or tools Northbridge uses (mock heuristic).' : prudentialOnly ? 'PRA rules: Northbridge is not PRA-regulated (mock heuristic).' : 'Aimed at business types Northbridge does not carry on (mock heuristic).',
    model: `mock:${config().triageModel}`,
  };
}

interface Rule {
  when: RegExp;
  quote: RegExp;
  policy: string;
  controls: string[];
  type: 'direct' | 'second-order';
  severity: 'high' | 'medium' | 'low';
  gap: string;
  action: string;
}

const RULES: Rule[] = [
  { when: /annex 1/i, quote: /when dealing with Annex 1 firms/i, policy: 'POL-INTRO', controls: ['C-INT-01'], type: 'second-order', severity: 'high', gap: 'Non-authorised introducers include asset-finance firms that may be Annex 1 firms; their MLR registration is accepted on self-declaration, the open 2025 audit gap.', action: 'Add independent verification of MLR registration status to introducer onboarding and re-check all current non-authorised introducers.' },
  { when: /annex 1/i, quote: /not a substitute for regulated firms carrying out their own/i, policy: 'POL-ONB', controls: ['C-ONB-03'], type: 'direct', severity: 'medium', gap: 'C-ONB-03 covers customer documents but not due diligence on the introducing firm itself.', action: 'Extend C-ONB-03 so introduced applications are blocked if the introducer\'s registration check is out of date.' },
  { when: /financial crime guide/i, quote: /keep pace with emerging risks/i, policy: 'POL-AML', controls: ['C-AML-01'], type: 'direct', severity: 'medium', gap: 'The business-wide risk assessment is mapped to the current Financial Crime Guide chapters and does not assess proliferation financing.', action: 'Prepare a gap analysis of the risk assessment against the proposed Guide chapters and decide whether to respond to CP26/38.' },
  { when: /financial crime guide/i, quote: /AI and third-party tools for financial crime controls/i, policy: 'POL-TPRM', controls: ['C-TPR-03'], type: 'second-order', severity: 'medium', gap: 'KYC and screening vendors are tested annually, but the policy does not cover AI-based features inside those tools.', action: 'Add AI capability questions to the annual review of the KYC and screening vendors.' },
  { when: /agentic ai/i, quote: /distinctive capabilities and risks of agentic AI/i, policy: 'POL-AI', controls: ['C-AI-03'], type: 'second-order', severity: 'medium', gap: 'Nudge (M4) is an agentic system; the policy has no transparency or accountability standard specific to agentic AI.', action: 'Draft agentic AI standards for M4 covering transparency, accountability and ADM, and consider responding to the ICO by the deadline.' },
  { when: /agentic ai/i, quote: /Section 5: Automated Decision Making/i, policy: 'PROC-COLL', controls: ['C-COL-04'], type: 'second-order', severity: 'medium', gap: 'Nudge proposes payment plans; whether that is a solely automated decision with significant effect is not assessed in the collections process.', action: 'Map which Nudge actions are decisions and confirm human review points in steps 1–2 of the collections process.' },
  { when: /automated decision-making and profiling/i, quote: /automated decision-making and profiling including amendments/i, policy: 'POL-DATA', controls: ['C-DAT-02'], type: 'direct', severity: 'low', gap: 'Privacy notice and ADM approach pre-date updated ICO guidance on the Data (Use and Access) Act.', action: 'Diary a privacy notice and DPIA review for when the ICO publishes the final ADM guidance.' },
  { when: /vendor-supplied models/i, quote: /Applying model risk management principles to third-party or vendor-supplied models/i, policy: 'POL-AI', controls: ['C-AI-01'], type: 'direct', severity: 'low', gap: 'Vendor scorecard M1 relies on vendor validation reports only; no independent validation.', action: 'Scope a light-touch independent validation of the M1 vendor scorecard.' },
  { when: /certification regime/i, quote: /Removing the Certification Regime/i, policy: 'POL-GOV', controls: ['C-GOV-01'], type: 'direct', severity: 'low', gap: 'Annual certification of 38 staff each October may no longer be required if proposals are confirmed.', action: 'Note the proposal; keep the October 2026 cycle and reassess after the Policy Statement in H1 2027.' },
];

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function deadline(text: string): { date: string; basis: string } {
  const m = text.match(/(?:by|until the end of|closing date)\s+(\d{1,2}) (\w+) (\d{4})/i);
  if (m) {
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    if (mi >= 0) return { date: `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`, basis: `Response deadline stated in the publication (${m[1]} ${m[2]} ${m[3]})` };
  }
  const d = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
  return { date: d, basis: 'No date in the publication; set 90 days out' };
}

export async function mockAssess(p: Publication, t: Telemetry): Promise<Assessment> {
  await logMock(t, 'assess', 30000 + Math.min(p.text.length, 14000), 1600, p.title);
  const lines = p.text.split(/\n|(?<=\.)\s+/);
  const dl = deadline(p.text);
  const raw = RULES.filter((r) => r.when.test(p.text) && lines.some((l) => r.quote.test(l))).slice(0, 4).map((r) => {
    const line = lines.find((l) => r.quote.test(l)) || '';
    const doc = LIBRARY.find((d) => d.id === r.policy)!;
    return { policy_id: r.policy, control_ids: r.controls, impact_type: r.type, gap: r.gap, action: r.action, severity: r.severity, owner: doc.owner, due_date: dl.date, due_basis: dl.basis, quote: line.split(' ').slice(0, 40).join(' '), rationale: 'Mock rule match.' };
  });
  return verifyImpacts(p, raw, `mock:${config().reasoningModel}`, raw.length ? `${raw.length} ${FIRM.short} polic${raw.length > 1 ? 'ies' : 'y'} affected (mock)` : p.title, raw.length ? undefined : 'No mock rule matched.');
}

export async function mockTicket(i: Impact, p: Publication, doc: PolicyDoc | undefined, t: Telemetry): Promise<Ticket> {
  await logMock(t, 'ticket', 6000, 900, i.policyId);
  return {
    title: `Update ${doc?.title ?? i.policyId} for ${p.title.split(':')[0]}`,
    userStory: `As the ${i.owner}, I want ${doc?.title ?? i.policyId} updated so that ${i.gap.charAt(0).toLowerCase()}${i.gap.slice(1).replace(/\.$/, '')} is resolved and Northbridge meets ${p.regulator} expectations.`,
    acceptanceCriteria: [
      `Given ${p.title.split(':')[0]}, when the policy is reviewed, then ${i.controlIds.join(', ') || 'the relevant controls'} reflect the new expectation.`,
      `Given the updated policy, when it is approved, then the ${i.owner} signs it off by ${i.dueDate}.`,
      `Given the change, when staff are briefed, then training records show completion.`,
    ],
    tasks: [i.action, 'Update policy wording and control descriptions', 'Brief affected teams', 'Record evidence for the compliance monitoring plan'],
    priority: i.severity === 'high' ? 'P1' : i.severity === 'medium' ? 'P2' : 'P3',
    labels: ['reg-change', p.regulator.toLowerCase(), i.impactType],
  };
}

export async function mockChat(q: string, run: RunResult, t: Telemetry): Promise<string> {
  await logMock(t, 'chat', 20000, 500, q.slice(0, 80));
  const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const all = run.assessments.flatMap((a) => a.impacts);
  const hits = all.filter((i) => words.some((w) => `${i.gap} ${i.action} ${i.policyId}`.toLowerCase().includes(w)));
  const list = (hits.length ? hits : all).slice(0, 3);
  if (!list.length) return 'Mock mode: no impacts in this run yet. Run a sweep first.';
  return `Mock mode answer (set NEBIUS_API_KEY for Nemotron Ultra):\n` + list.map((i) => `- [POL:${i.policyId}] ${i.action} Owner: ${i.owner}, due ${i.dueDate}. [PUB:${i.pubId}]`).join('\n');
}
