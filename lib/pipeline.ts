import { config } from './config';
import { CORPUS, FIRM, LIBRARY, fullLibrary, libraryAsContext } from './data';
import { chat, chatJson, pool, Telemetry } from './llm';
import { mockAssess, mockChat, mockTicket, mockTriage } from './mock';
import { sweep as tavilySweep } from './tavily';
import type { Assessment, Impact, PolicyDoc, Publication, RunResult, SweepEvent, Ticket, Triage } from './types';
import { asUrg, verifyImpacts, type RawImpact } from './verify';
export { quoteInSource, normalise } from './verify';

const today = () => new Date().toISOString().slice(0, 10);

// ---------- Stage 1: triage with the fast model ----------

const TRIAGE_SYSTEM = (custom: PolicyDoc[] = []) => `You are a regulatory triage analyst for ${FIRM.name}.
Firm profile: ${FIRM.profile}${custom.length ? `\nThe firm has also added these policies of its own, so publications touching their topics are relevant too: ${custom.map((d) => d.title).join('; ')}.` : ''}

Decide whether a regulatory publication could require any change to this firm's policies, processes, controls, systems or customer journeys.
Count indirect effects (for example guidance on AI, data protection or third parties that affects tools the firm uses, or action against other lenders that changes the due diligence this firm must do on partners).
Mark as not relevant publications aimed only at business types the firm does not carry on: investment funds, asset managers, trading venues, listed issuers, insurers, deposit takers, cryptoassets, DeFi.
${FIRM.short} is regulated by the FCA only. PRA publications (Bank of England / Prudential Regulation Authority) are NOT relevant, even on topics like SM&CR, because they apply to PRA-authorised banks, building societies, insurers and credit unions. The FCA's own version of the same topic is relevant.

Reply with JSON only:
{"relevant": true|false, "urgency": "high"|"medium"|"low", "topics": ["up to 4 short tags"], "summary": "one sentence, max 30 words", "reason": "why it is or is not relevant to this firm, max 25 words"}
Urgency: high = final rules, enforcement or supervisory action aimed at firms like this one, or a deadline within 6 weeks; medium = consultation, call for evidence or draft guidance in scope; low = surveys, speeches, plans and other informational items.`;

function pubBlock(p: Publication, max: number) {
  return `Regulator: ${p.regulator}\nType: ${p.type}\nTitle: ${p.title}\nPublished: ${p.published}\nURL: ${p.url}\n\n${p.text.slice(0, max)}`;
}

export async function triage(p: Publication, t: Telemetry, custom: PolicyDoc[] = []): Promise<Triage> {
  const cfg = config();
  if (cfg.mock) return mockTriage(p, t);
  const j = await chatJson<{ relevant: boolean; urgency: string; topics: string[]; summary: string; reason: string }>({
    tier: 'triage',
    stage: 'triage',
    telemetry: t,
    json: true,
    maxTokens: 2048,
    note: p.title,
    messages: [
      { role: 'system', content: TRIAGE_SYSTEM(custom) },
      { role: 'user', content: pubBlock(p, 6000) },
    ],
  });
  return {
    pubId: p.id,
    relevant: !!j.relevant,
    urgency: asUrg(j.urgency),
    topics: (j.topics || []).slice(0, 4),
    summary: j.summary || '',
    reason: j.reason || '',
    model: cfg.triageModel,
  };
}

// ---------- Stage 2: impact assessment with the reasoning model ----------

const ASSESS_SYSTEM = (lib: PolicyDoc[] = LIBRARY) => `You are a senior regulatory change analyst at ${FIRM.name}. Today is ${today()}.
Map the regulatory publication you are given to the firm's own policy library below. For each policy that needs to change, write one impact.

Rules:
- Cite only policy IDs and control IDs that exist in the library. Valid policy IDs: ${lib.map((d) => d.id).join(', ')}.${lib.some((d) => d.id.startsWith('MY-')) ? ' Policies with IDs starting MY- were added by the user: assess them exactly like the others.' : ''}
- At most ONE impact per policy. If several points hit the same policy, combine them into that one impact and list all the controls.
- "quote" must be copied word for word, character for character, from ONE contiguous passage of the publication text: 8 to 40 words. Never paraphrase, never join separate sentences or list items. Pick the sentence that states the substance (what firms must do or what is changing), not a date line or heading. Impacts without an exact quote are discarded automatically.
- "impact_type": "direct" when the publication addresses the policy's own topic; "second-order" when the effect arrives indirectly (for example AI or data guidance that affects a tool used in collections, or action against other firms that changes the due diligence ${FIRM.short} must do on its partners). Look hard for second-order effects; they are the ones people miss. When a publication touches a system, model or supplier (for example the Nudge assistant M4, the scorecard M1 or the screening vendors), also check the business process or customer journey that uses it (for example PROC-COLL, where Nudge talks to customers in arrears, or POL-CREDIT for automated decisions).
- "gap": what in the current policy wording or controls falls short, naming the control or sentence.
- "action": the concrete next step, starting with a verb.
- "owner": the policy owner exactly as written in the library.
- "due_date": YYYY-MM-DD derived from dates in the publication (response deadline, effective date). "due_basis" explains the date. If the publication has no date, use a date within 90 days and say so.
- "severity": be strict, most impacts are medium or low.
  high = final rules, enforcement or supervisory action that ${FIRM.short} must act on, or a known control gap the publication directly exposes; at most one high per publication.
  medium = a consultation, call for evidence or draft guidance that will likely require a policy change, or a deadline to respond.
  low = surveys, speeches, plans or long-dated proposals: monitor and note.
- Return 0 to 3 impacts, most important first. Fewer, stronger impacts beat many weak ones. If nothing needs to change, return "impacts": [] and explain in "no_impact_reason".

Reply with JSON only:
{"headline": "max 18 words: what this means for ${FIRM.short}", "impacts": [{"policy_id": "", "control_ids": [""], "impact_type": "direct", "gap": "", "action": "", "severity": "medium", "owner": "", "due_date": "", "due_basis": "", "quote": "", "rationale": ""}], "no_impact_reason": ""}

FIRM PROFILE
${FIRM.profile}

POLICY LIBRARY
${libraryAsContext(lib)}`;

export async function assess(p: Publication, t: Telemetry, lib: PolicyDoc[] = LIBRARY): Promise<Assessment> {
  const cfg = config();
  if (cfg.mock) return mockAssess(p, t);
  const j = await chatJson<{ headline?: string; impacts?: RawImpact[]; no_impact_reason?: string }>({
    tier: 'reasoning',
    stage: 'assess',
    telemetry: t,
    json: true,
    maxTokens: 8192,
    note: p.title,
    messages: [
      { role: 'system', content: ASSESS_SYSTEM(lib) },
      { role: 'user', content: pubBlock(p, 14000) },
    ],
  });
  return verifyImpacts(p, j.impacts || [], cfg.reasoningModel, j.headline || p.title, j.no_impact_reason, lib);
}

// ---------- Change ticket ----------

export async function draftTicket(impact: Impact, p: Publication, t: Telemetry, lib: PolicyDoc[] = LIBRARY): Promise<Ticket> {
  const cfg = config();
  const doc = lib.find((d) => d.id === impact.policyId);
  if (cfg.mock) return mockTicket(impact, p, doc, t);
  const j = await chatJson<{ title: string; user_story: string; acceptance_criteria: string[]; tasks: string[]; priority: string; labels: string[] }>({
    tier: 'reasoning',
    stage: 'ticket',
    telemetry: t,
    json: true,
    maxTokens: 4096,
    note: `${impact.policyId} ← ${p.title}`,
    messages: [
      {
        role: 'system',
        content: `You write regulatory change tickets for ${FIRM.name}'s change team (Jira or Pega case). Be specific to the policy and controls named. Reply with JSON only:
{"title": "max 12 words", "user_story": "As a <role>, I want <change>, so that <regulatory outcome>.", "acceptance_criteria": ["3 to 6 items, each Given/When/Then"], "tasks": ["3 to 6 concrete tasks"], "priority": "P1|P2|P3", "labels": ["2 to 4 short labels"]}`,
      },
      {
        role: 'user',
        content: `IMPACT\n${JSON.stringify(impact, null, 2)}\n\nPOLICY ${doc?.id} — ${doc?.title} (owner ${doc?.owner})\n${doc?.body}\n\nPUBLICATION\n${pubBlock(p, 5000)}`,
      },
    ],
  });
  return {
    title: j.title,
    userStory: j.user_story,
    acceptanceCriteria: j.acceptance_criteria || [],
    tasks: j.tasks || [],
    priority: j.priority || 'P2',
    labels: j.labels || [],
  };
}

// ---------- Chat over results ----------

export async function answer(question: string, run: RunResult, history: { role: 'user' | 'assistant'; content: string }[], t: Telemetry, lib: PolicyDoc[] = LIBRARY): Promise<string> {
  const cfg = config();
  if (cfg.mock) return mockChat(question, run, t);
  const pubs = run.publications.map((p) => {
    const tr = run.triage.find((x) => x.pubId === p.id);
    return `[PUB:${p.id}] ${p.regulator} · ${p.type} · ${p.title} (${p.published}) — ${tr?.relevant ? 'relevant' : 'not relevant'}: ${tr?.summary || ''}`;
  });
  const impacts = run.assessments.flatMap((a) =>
    a.impacts.map((i) => `- [PUB:${i.pubId}] → [POL:${i.policyId}] ${i.impactType}, ${i.severity}, owner ${i.owner}, due ${i.dueDate}. Gap: ${i.gap} Action: ${i.action} Quote: "${i.quote}"`)
  );
  const relevantText = run.assessments
    .map((a) => run.publications.find((p) => p.id === a.pubId))
    .filter(Boolean)
    .map((p) => `[PUB:${p!.id}]\n${p!.text.slice(0, 3000)}`)
    .join('\n\n');
  const raw = await chat({
    tier: 'reasoning',
    stage: 'chat',
    telemetry: t,
    maxTokens: 3000,
    temperature: 0.2,
    note: question.slice(0, 80),
    messages: [
      {
        role: 'system',
        content: `You are RegPulse, a regulatory change assistant for ${FIRM.name}. Answer the compliance team's question using only the sweep results, publications and policy library below. Be concise: at most 150 words, plain sentences or short bullets. Cite sources inline as [PUB:id] and [POL:id]. If the answer is not in the material, say so.

FIRM: ${FIRM.profile}

PUBLICATIONS SCANNED
${pubs.join('\n')}

IMPACTS FOUND
${impacts.join('\n') || 'none'}

POLICY LIBRARY
${libraryAsContext(lib)}

RELEVANT PUBLICATION TEXT
${relevantText}`,
      },
      ...history.slice(-6),
      { role: 'user', content: question },
    ],
  });
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

// ---------- Orchestrator ----------

export async function runSweep(opts: { source: 'live' | 'corpus'; from: string; to: string; custom?: PolicyDoc[] }, emit: (e: SweepEvent) => void): Promise<RunResult> {
  const cfg = config();
  const custom = opts.custom || [];
  const lib = fullLibrary(custom);
  const t = new Telemetry((c) => emit({ type: 'call', item: c }));
  const log = (msg: string, level: 'info' | 'warn' | 'ok' = 'info') => emit({ type: 'log', level, msg });
  const run: RunResult = {
    id: `run-${Date.now()}`,
    startedAt: new Date().toISOString(),
    source: opts.source,
    mock: cfg.mock,
    window: { from: opts.from, to: opts.to },
    publications: [],
    triage: [],
    assessments: [],
    calls: t.calls,
    customPolicies: custom.length ? custom : undefined,
  };
  if (custom.length) log(`Including ${custom.length} of your own polic${custom.length > 1 ? 'ies' : 'y'}: ${custom.map((d) => `${d.id} ${d.title}`).join(', ')}`);
  if (cfg.mock) log('No NEBIUS_API_KEY set: running in mock mode (heuristic stand-ins for Nemotron).', 'warn');

  // 1. Search + extract
  emit({ type: 'stage', stage: 'search', status: 'active' });
  if (opts.source === 'live' && cfg.liveSearch) {
    run.publications = await tavilySweep(opts.from, opts.to, t, (m) => log(m));
  } else {
    if (opts.source === 'live') log('No TAVILY_API_KEY set: using the bundled corpus captured with Tavily.', 'warn');
    else log(`Loading bundled corpus (${CORPUS.items.length} publications captured with Tavily).`);
    run.publications = CORPUS.items.filter((p) => !p.published || (p.published >= opts.from && p.published <= opts.to));
    if (!run.publications.length) run.publications = CORPUS.items;
  }
  emit({ type: 'publications', items: run.publications });
  emit({ type: 'stage', stage: 'search', status: 'done', count: run.publications.length });
  log(`${run.publications.length} publications in window ${opts.from} → ${opts.to}`, 'ok');

  // 2. Triage every publication with the fast model
  emit({ type: 'stage', stage: 'triage', status: 'active' });
  log(`Triage with ${cfg.mock ? 'mock' : cfg.triageModel} · ${run.publications.length} items, 4 in parallel`);
  await pool(run.publications, 4, async (p) => {
    try {
      const tr = await triage(p, t, custom);
      run.triage.push(tr);
      emit({ type: 'triage', item: tr });
    } catch (e) {
      log(`Triage failed for “${p.title}”: ${(e as Error).message}`, 'warn');
    }
  });
  const relevant = run.publications.filter((p) => run.triage.find((x) => x.pubId === p.id)?.relevant);
  emit({ type: 'stage', stage: 'triage', status: 'done', count: relevant.length });
  log(`${relevant.length} of ${run.publications.length} relevant to ${FIRM.short}`, 'ok');

  // 3. Assess only relevant items with the reasoning model
  emit({ type: 'stage', stage: 'assess', status: 'active' });
  log(`Impact assessment with ${cfg.mock ? 'mock' : cfg.reasoningModel} · ${relevant.length} items against ${lib.length} policies`);
  await pool(relevant, 3, async (p) => {
    try {
      const a = await assess(p, t, lib);
      run.assessments.push(a);
      emit({ type: 'assessment', item: a });
      if (a.rejected.length) log(`Dropped ${a.rejected.length} uncited claim(s) for “${p.title}”`, 'warn');
    } catch (e) {
      log(`Assessment failed for “${p.title}”: ${(e as Error).message}`, 'warn');
    }
  });
  const nImpacts = run.assessments.reduce((s, a) => s + a.impacts.length, 0);
  emit({ type: 'stage', stage: 'assess', status: 'done', count: nImpacts });

  // 4. Verification summary
  emit({ type: 'stage', stage: 'verify', status: 'active' });
  const nRejected = run.assessments.reduce((s, a) => s + a.rejected.length, 0);
  log(`${nImpacts} impacts verified against source text; ${nRejected} rejected`, 'ok');
  emit({ type: 'stage', stage: 'verify', status: 'done', count: nImpacts });

  run.finishedAt = new Date().toISOString();
  return run;
}
