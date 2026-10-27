'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Assessment, CallLog, Firm, Impact, PolicyDoc, Publication, RunResult, SweepEvent, Ticket, Triage } from '@/lib/types';

interface Status {
  mock: boolean;
  liveSearch: boolean;
  baseUrl: string;
  triageModel: string;
  reasoningModel: string;
  prices: { triage: { in: number; out: number }; reasoning: { in: number; out: number } };
  firm: Firm;
  library: PolicyDoc[];
  corpusWindow: { from: string; to: string };
  corpusCount: number;
}

type StageKey = 'search' | 'triage' | 'assess' | 'verify';
type StageState = { status: 'idle' | 'active' | 'done'; count?: number };
type Tab = 'board' | 'pubs' | 'library' | 'telemetry' | 'ask' | 'log';

const STAGES: { key: StageKey; name: string; sub: (s: Status | null) => string }[] = [
  { key: 'search', name: 'Search and extract', sub: (s) => (s?.liveSearch ? 'Tavily, live' : 'Tavily corpus') },
  { key: 'triage', name: 'Triage', sub: (s) => shortModel(s?.triageModel) },
  { key: 'assess', name: 'Impact assessment', sub: (s) => shortModel(s?.reasoningModel) },
  { key: 'verify', name: 'Verify citations', sub: () => 'Quote must match source' },
];

const SEV_ORDER = { high: 0, medium: 1, low: 2 } as const;

function shortModel(m?: string) {
  return (m || '').split('/').pop() || '';
}
const usd = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`);
const fmtDate = (d: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d || '—';
  return new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const emptyRun = (): RunResult => ({ id: '', startedAt: '', source: 'corpus', mock: false, window: { from: '', to: '' }, publications: [], triage: [], assessments: [], calls: [] });

/** Find the quote inside the original text, matching words only (same rule as the server-side check). Returns [start, end] in original indices. */
function locate(text: string, quote: string): [number, number] | null {
  const isWord = (ch: string) => /[\p{L}\p{N}]/u.test(ch);
  const map: number[] = [];
  let norm = ' ';
  map.push(-1);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/['‘’‛′]/.test(ch)) continue;
    if (isWord(ch)) { norm += ch.toLowerCase(); map.push(i); }
    else if (!norm.endsWith(' ')) { norm += ' '; map.push(i); }
  }
  norm += ' ';
  map.push(text.length);
  const q = ' ' + (quote.split(/\.\.\.|…/)[0] || '').toLowerCase().replace(/['‘’‛′]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' ';
  if (q.trim().length === 0) return null;
  const at = norm.indexOf(q);
  if (at < 0) return null;
  const start = map[at + 1];
  const end = map[at + q.length - 2] + 1;
  return start >= 0 && end > start ? [start, end] : null;
}

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);
  const [run, setRun] = useState<RunResult>(emptyRun());
  const [stages, setStages] = useState<Record<StageKey, StageState>>({ search: { status: 'idle' }, triage: { status: 'idle' }, assess: { status: 'idle' }, verify: { status: 'idle' } });
  const [logs, setLogs] = useState<{ t: string; level: string; msg: string }[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('board');
  const [source, setSource] = useState<'corpus' | 'live'>('corpus');
  const [from, setFrom] = useState('2026-10-01');
  const [to, setTo] = useState('2026-10-27');
  const [selected, setSelected] = useState<Impact | null>(null);
  const [sevFilter, setSevFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [secondOnly, setSecondOnly] = useState(false);
  const [libSel, setLibSel] = useState<string>('POL-INTRO');
  const [extraCalls, setExtraCalls] = useState<CallLog[]>([]);

  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json())
      .then((s: Status) => {
        setStatus(s);
        setSource(s.liveSearch ? 'live' : 'corpus');
        if (!s.liveSearch) { setFrom(s.corpusWindow.from); setTo(s.corpusWindow.to); }
      })
      .catch(() => setError('Could not reach the RegPulse server.'));
  }, []);

  const pubById = useMemo(() => new Map(run.publications.map((p) => [p.id, p])), [run.publications]);
  const triageById = useMemo(() => new Map(run.triage.map((t) => [t.pubId, t])), [run.triage]);
  const policyById = useMemo(() => new Map((status?.library || []).map((d) => [d.id, d])), [status]);
  const allImpacts = useMemo(() => run.assessments.flatMap((a) => a.impacts), [run.assessments]);
  const rejectedCount = useMemo(() => run.assessments.reduce((s, a) => s + a.rejected.length, 0), [run.assessments]);
  const calls = useMemo(() => [...run.calls, ...extraCalls], [run.calls, extraCalls]);

  const log = (level: string, msg: string) => setLogs((l) => [...l, { t: new Date().toLocaleTimeString('en-GB'), level, msg }]);

  async function startSweep() {
    setRunning(true);
    setError('');
    setSelected(null);
    setExtraCalls([]);
    setLogs([]);
    setRun({ ...emptyRun(), source, window: { from, to } });
    setStages({ search: { status: 'idle' }, triage: { status: 'idle' }, assess: { status: 'idle' }, verify: { status: 'idle' } });
    setTab('board');
    const t0 = Date.now();
    try {
      const res = await fetch('/api/sweep', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, from, to }) });
      if (!res.body) throw new Error('No response stream');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) if (line.trim()) handle(JSON.parse(line) as SweepEvent);
      }
      log('ok', `Sweep finished in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (e) {
      setError(`The sweep stopped: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  function handle(e: SweepEvent) {
    switch (e.type) {
      case 'log': return log(e.level, e.msg);
      case 'stage': return setStages((s) => ({ ...s, [e.stage]: { status: e.status, count: e.count } }));
      case 'publications': return setRun((r) => ({ ...r, publications: e.items }));
      case 'triage': return setRun((r) => ({ ...r, triage: [...r.triage, e.item] }));
      case 'assessment': return setRun((r) => ({ ...r, assessments: [...r.assessments, e.item] }));
      case 'call': return setRun((r) => ({ ...r, calls: [...r.calls, e.item] }));
      case 'done': return setRun(e.run);
      case 'error': return setError(e.msg);
    }
  }

  async function loadRecorded() {
    setError('');
    const r = await fetch('/api/demo');
    if (!r.ok) return setError((await r.json()).error);
    const data: RunResult = await r.json();
    setRun(data);
    setExtraCalls([]);
    setStages({ search: { status: 'done', count: data.publications.length }, triage: { status: 'done', count: data.triage.filter((t) => t.relevant).length }, assess: { status: 'done', count: data.assessments.reduce((s, a) => s + a.impacts.length, 0) }, verify: { status: 'done', count: data.assessments.reduce((s, a) => s + a.impacts.length, 0) } });
    log('ok', `Loaded recorded run from ${new Date(data.startedAt).toLocaleString('en-GB')}`);
  }

  const relevantCount = run.triage.filter((t) => t.relevant).length;
  const affectedPolicies = new Set(allImpacts.map((i) => i.policyId)).size;
  const highCount = allImpacts.filter((i) => i.severity === 'high').length;
  const secondCount = allImpacts.filter((i) => i.impactType === 'second-order').length;
  const totalCost = calls.reduce((s, c) => s + c.costUsd, 0);
  const hasRun = run.publications.length > 0;
  const finished = !!run.finishedAt;

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#22325a" /><path d="M9 6h10l5 5v15H9z" fill="none" stroke="#dfe6f0" strokeWidth="1.6" strokeLinejoin="round" /><path d="M5 19h6l2-5 3 9 2.5-6H27" fill="none" stroke="#ffe066" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span className="brand-name">RegPulse</span>
        </div>
        <div className="rail-firm">
          <strong>{status?.firm.name || 'Loading firm…'}</strong>
          SME lender, FCA consumer credit. {status?.library.length ?? 15} policies and process maps in scope.
        </div>
        <section className="pipeline" aria-label="Pipeline">
          <h2>This sweep</h2>
          <ol className="steps">
            {STAGES.map((s, i) => {
              const st = stages[s.key];
              return (
                <li key={s.key} className={`step ${st.status}`}>
                  <span className="step-num">{i + 1}</span>
                  <span>{s.name}</span>
                  <span className="step-count">{st.count ?? ''}</span>
                  <span className="step-sub">{s.sub(status)}</span>
                </li>
              );
            })}
          </ol>
        </section>
        <section className="engine" aria-label="Engines">
          <h2>Running on</h2>
          <div className="engine-row"><span className={`dot ${status?.mock ? 'warn' : 'live'}`} /><div><b>Nebius Token Factory{status?.mock ? ' (mock mode)' : ''}</b><code>{status?.triageModel}</code><br /><code>{status?.reasoningModel}</code></div></div>
          <div className="engine-row"><span className={`dot ${status?.liveSearch ? 'live' : 'warn'}`} /><div><b>Tavily {status?.liveSearch ? 'live search' : 'captured corpus'}</b><code>fca.org.uk, bankofengland.co.uk, ico.org.uk</code></div></div>
        </section>
        <div className="rail-foot">Open source under Apache 2.0. Sample firm is fictional.</div>
      </aside>

      <main className="main">
        <div className="runbar">
          <label className="field">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label className="field">Source
            <select value={source} onChange={(e) => setSource(e.target.value as 'corpus' | 'live')}>
              <option value="live">Live regulator search (Tavily)</option>
              <option value="corpus">Captured corpus, {status?.corpusCount ?? 12} publications</option>
            </select>
          </label>
          <button className="btn" onClick={startSweep} disabled={running || !status}>
            {running ? <><span className="spinner" />Sweeping…</> : 'Run sweep'}
          </button>
          <span className="runbar-spacer" />
          <button className="btn ghost" onClick={loadRecorded} disabled={running}>Load recorded run</button>
        </div>

        {status?.mock && <div className="banner">Mock mode: no Token Factory key is set, so triage and assessment use rule-based stand-ins. Add NEBIUS_API_KEY to .env.local to run Nemotron.</div>}
        {error && <div className="banner error">{error}</div>}

        <Verdict hasRun={hasRun} running={running} finished={finished} firm={status?.firm.short || 'Northbridge'} scanned={run.publications.length} relevant={relevantCount} impacts={allImpacts.length} policies={affectedPolicies} high={highCount} second={secondCount} />

        {hasRun && (
          <div className="facts" aria-label="Sweep facts">
            <div className="fact"><b>{run.publications.length}</b><span>publications scanned</span></div>
            <div className="fact"><b>{relevantCount}</b><span>relevant after triage</span></div>
            <div className="fact"><b>{allImpacts.length}</b><span>verified impacts</span></div>
            <div className="fact"><b>{rejectedCount}</b><span>uncited claims dropped</span></div>
            <div className="fact"><b>{usd(totalCost)}</b><span>model cost{run.mock ? ' (estimate)' : ''}</span></div>
          </div>
        )}

        <div className="tabs" role="tablist">
          {([
            ['board', 'Impact board', allImpacts.length],
            ['pubs', 'Publications', run.publications.length],
            ['library', 'Policy library', status?.library.length],
            ['telemetry', 'Models and cost', calls.length],
            ['ask', 'Ask RegPulse', undefined],
            ['log', 'Run log', logs.length],
          ] as [Tab, string, number | undefined][]).map(([k, label, n]) => (
            <button key={k} role="tab" aria-selected={tab === k} className="tab" onClick={() => setTab(k)}>
              {label}{n ? <span className="count">{n}</span> : null}
            </button>
          ))}
        </div>

        <div className="panel">
          {tab === 'board' && (
            <Board
              run={run} running={running} pubById={pubById} policyById={policyById} sevFilter={sevFilter} setSevFilter={setSevFilter}
              secondOnly={secondOnly} setSecondOnly={setSecondOnly} selected={selected} onSelect={setSelected} onRun={startSweep}
            />
          )}
          {tab === 'pubs' && <Pubs pubs={run.publications} triageById={triageById} assessments={run.assessments} running={running} />}
          {tab === 'library' && status && <Library docs={status.library} impacts={allImpacts} sel={libSel} setSel={setLibSel} />}
          {tab === 'telemetry' && status && <Telemetry calls={calls} status={status} mock={run.mock || status.mock} />}
          {tab === 'ask' && <Ask run={run} onCalls={(c) => setExtraCalls((x) => [...x, ...c])} />}
          {tab === 'log' && (
            <div className="log" aria-live="polite">
              {logs.length ? logs.map((l, i) => <div key={i} className={l.level}><time>{l.t}</time>{l.msg}</div>) : 'No sweep yet.'}
            </div>
          )}
        </div>
      </main>

      {selected && pubById.get(selected.pubId) && (
        <Evidence
          impact={selected}
          pub={pubById.get(selected.pubId)!}
          policy={policyById.get(selected.policyId)}
          onClose={() => setSelected(null)}
          onCalls={(c) => setExtraCalls((x) => [...x, ...c])}
        />
      )}
    </div>
  );
}

function Verdict(p: { hasRun: boolean; running: boolean; finished: boolean; firm: string; scanned: number; relevant: number; impacts: number; policies: number; high: number; second: number }) {
  if (!p.hasRun) {
    return (
      <div className="verdict empty">
        <h1>Which new rules touch {p.firm} this week?</h1>
        <p>RegPulse reads what the FCA, PRA and ICO have published, keeps only what applies to this firm, and maps each change to the policy and control it affects. Every finding quotes the regulator word for word.</p>
      </div>
    );
  }
  if (!p.finished) {
    return (
      <div className="verdict">
        <h1>Reading <span className="n">{p.scanned}</span> publications{p.relevant ? <>; <span className="n">{p.relevant}</span> look relevant so far</> : ''}.</h1>
        <p>Triage runs on the fast model first, so only the publications that matter reach the reasoning model.</p>
      </div>
    );
  }
  return (
    <div className="verdict">
      <h1>
        <span className="n">{p.relevant}</span> of <span className="n">{p.scanned}</span> publications affect {p.firm}: <span className="n">{p.impacts}</span> changes across <span className="n">{p.policies}</span> {p.policies === 1 ? 'policy' : 'policies'}, <span className="n">{p.high}</span> high priority.
      </h1>
      <p>{p.second ? `${p.second} of these are second-order: the publication is about something else, but it still lands on one of ${p.firm}’s processes.` : 'Open any row to see the regulator’s wording next to the policy it affects.'}</p>
    </div>
  );
}

function Board(p: {
  run: RunResult; running: boolean; pubById: Map<string, Publication>; policyById: Map<string, PolicyDoc>;
  sevFilter: 'all' | 'high' | 'medium' | 'low'; setSevFilter: (v: 'all' | 'high' | 'medium' | 'low') => void;
  secondOnly: boolean; setSecondOnly: (v: boolean) => void; selected: Impact | null; onSelect: (i: Impact) => void; onRun: () => void;
}) {
  if (!p.run.publications.length) {
    return (
      <div className="empty-state">
        <h3>No sweep yet</h3>
        <p>Run a sweep to see which publications change {`Northbridge`}’s policies.</p>
        <button className="btn" onClick={p.onRun} disabled={p.running}>Run sweep</button>
      </div>
    );
  }
  const groups = [...p.run.assessments]
    .map((a) => ({ a, pub: p.pubById.get(a.pubId)!, impacts: a.impacts.filter((i) => (p.sevFilter === 'all' || i.severity === p.sevFilter) && (!p.secondOnly || i.impactType === 'second-order')).sort((x, y) => SEV_ORDER[x.severity] - SEV_ORDER[y.severity]) }))
    .filter((g) => g.pub)
    .sort((x, y) => (x.impacts[0] ? SEV_ORDER[x.impacts[0].severity] : 3) - (y.impacts[0] ? SEV_ORDER[y.impacts[0].severity] : 3));
  if (!groups.length) {
    return <div className="empty-state"><h3>{p.running ? 'Assessing relevant publications…' : 'No relevant publications in this window'}</h3><p>{p.running ? 'Impacts appear here as soon as each assessment finishes.' : 'Try a wider date range.'}</p></div>;
  }
  return (
    <>
      <div className="filters" role="group" aria-label="Filter impacts">
        {(['all', 'high', 'medium', 'low'] as const).map((s) => (
          <button key={s} className="chip" aria-pressed={p.sevFilter === s} onClick={() => p.setSevFilter(s)}>{s === 'all' ? 'All priorities' : s[0].toUpperCase() + s.slice(1)}</button>
        ))}
        <button className="chip" aria-pressed={p.secondOnly} onClick={() => p.setSecondOnly(!p.secondOnly)}>Second-order only</button>
      </div>
      <div className="board-head" aria-hidden="true"><span>Priority</span><span>Policy</span><span>What has to change</span><span className="c-owner">Owner</span><span className="c-due">Due</span></div>
      <div className="docket">
        {groups.map(({ a, pub, impacts }) => (
          <section className="pubgroup" key={a.pubId}>
            <header className="pubhead">
              <h3><span className="reg">{pub.regulator}</span><a href={pub.url} target="_blank" rel="noreferrer">{pub.title}</a></h3>
              <span className="meta">{pub.type}, {fmtDate(pub.published)}</span>
              <div className="headline">{a.headline}</div>
            </header>
            {impacts.length ? impacts.map((i) => {
              const doc = p.policyById.get(i.policyId);
              return (
                <button key={i.id} className="impact-row" aria-current={p.selected?.id === i.id} onClick={() => p.onSelect(i)}>
                  <span><span className={`sev ${i.severity}`}>{i.severity[0].toUpperCase() + i.severity.slice(1)}</span><span className={`kind ${i.impactType === 'second-order' ? 'second' : ''}`}>{i.impactType === 'second-order' ? 'Second-order' : 'Direct'}</span></span>
                  <span><span className="pol-id">{i.policyId}{i.controlIds.length ? `, ${i.controlIds.join(', ')}` : ''}</span><span className="pol-title">{doc?.title}</span></span>
                  <span className="gap">{i.gap}</span>
                  <span className="owner">{i.owner}</span>
                  <span className="due">{fmtDate(i.dueDate)}</span>
                </button>
              );
            }) : <div className="noimpact">{a.impacts.length ? 'No impacts match the filter.' : a.noImpactReason || 'Relevant, but no policy change needed.'}</div>}
          </section>
        ))}
      </div>
    </>
  );
}

function Evidence({ impact, pub, policy, onClose, onCalls }: { impact: Impact; pub: Publication; policy?: PolicyDoc; onClose: () => void; onCalls: (c: CallLog[]) => void }) {
  const [full, setFull] = useState(false);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');
  const markRef = useRef<HTMLElement>(null);
  const loc = locate(pub.text, impact.quote);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  useEffect(() => { if (full) markRef.current?.scrollIntoView({ block: 'center' }); }, [full]);

  let before = '', hit = '', after = '';
  if (loc) {
    const [s, e] = loc;
    const ws = full ? 0 : Math.max(0, pub.text.lastIndexOf('\n', Math.max(0, s - 500)));
    const we = full ? pub.text.length : Math.min(pub.text.length, (pub.text.indexOf('\n', e + 400) + 1 || pub.text.length));
    before = (ws > 0 ? '… ' : '') + pub.text.slice(ws, s).replace(/^\n/, '');
    hit = pub.text.slice(s, e);
    after = pub.text.slice(e, we) + (we < pub.text.length ? ' …' : '');
  }

  const bodyWithControls = (policy?.body || '').split(/(C-[A-Z]{2,4}-\d{2})/g).map((part, i) =>
    impact.controlIds.includes(part) ? <span key={i} className="ctl">{part}</span> : <span key={i}>{part}</span>
  );

  async function makeTicket() {
    setBusy(true);
    setErr('');
    try {
      const r = await fetch('/api/ticket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ impact, publication: pub }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setTicket(j.ticket);
      onCalls(j.calls || []);
    } catch (e) {
      setErr(`Could not draft the ticket: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const ticketMd = ticket ? `## ${ticket.title}\n\n${ticket.userStory}\n\n### Acceptance criteria\n${ticket.acceptanceCriteria.map((a) => `- ${a}`).join('\n')}\n\n### Tasks\n${ticket.tasks.map((t) => `- [ ] ${t}`).join('\n')}\n\nPriority: ${ticket.priority}\nLabels: ${ticket.labels.join(', ')}\nSource: ${pub.title} (${pub.url})\nPolicy: ${impact.policyId}\nOwner: ${impact.owner}\nDue: ${impact.dueDate}` : '';
  const copy = async (what: string, text: string) => { try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 1600); } catch { setCopied(''); } };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" aria-label={`${impact.policyId} evidence`}>
        <div className="drawer-head">
          <div>
            <h2>{policy?.title}</h2>
            <div className="sub"><span className={`sev ${impact.severity}`}>{impact.severity[0].toUpperCase() + impact.severity.slice(1)}</span>{'  '}{impact.impactType === 'second-order' ? 'Second-order impact' : 'Direct impact'} from {pub.title}</div>
          </div>
          <button className="btn ghost small" onClick={onClose}>Close</button>
        </div>
        <div className="drawer-body">
          <dl className="analysis sheet">
            <dt>What has to change</dt><dd>{impact.gap}</dd>
            <dt>Next step</dt><dd>{impact.action}</dd>
            <dt>Why</dt><dd>{impact.rationale || '—'}</dd>
            <dt>Owner</dt><dd>{impact.owner}</dd>
            <dt>Due</dt><dd>{fmtDate(impact.dueDate)}{impact.dueBasis ? <span style={{ color: 'var(--slate)' }}>. {impact.dueBasis}</span> : null}</dd>
          </dl>

          <div className="split">
            <section className="sheet">
              <h3>What the regulator says</h3>
              <div className="src"><a href={pub.url} target="_blank" rel="noreferrer">{pub.url.replace(/^https?:\/\/(www\.)?/, '')}</a>{loc ? <span className="verified" style={{ marginLeft: 10 }}>✓ Quote found verbatim in source</span> : null}</div>
              <div className="regtext">
                {loc ? <>{before}<mark ref={markRef}>{hit}</mark>{after}</> : <><mark>{impact.quote}</mark></>}
              </div>
              {loc && <button className="linkbtn" style={{ marginTop: 10 }} onClick={() => setFull(!full)}>{full ? 'Show passage only' : 'Show full text'}</button>}
            </section>
            <section className="sheet">
              <h3>{policy?.id}: {policy?.title}</h3>
              <div className="src">Owner {policy?.owner}, last reviewed {fmtDate(policy?.reviewed || '')}</div>
              <div className="poltext">{bodyWithControls}</div>
            </section>
          </div>

          {!ticket && (
            <div>
              <button className="btn" onClick={makeTicket} disabled={busy}>{busy ? <><span className="spinner" />Drafting with Nemotron…</> : 'Draft change ticket'}</button>
              {err && <div className="banner error">{err}</div>}
            </div>
          )}
          {ticket && (
            <section className="sheet ticket">
              <h3>{ticket.title}</h3>
              <p className="story">{ticket.userStory}</p>
              <h4>Acceptance criteria</h4>
              <ul>{ticket.acceptanceCriteria.map((a, i) => <li key={i}>{a}</li>)}</ul>
              <h4>Tasks</h4>
              <ol>{ticket.tasks.map((t, i) => <li key={i}>{t}</li>)}</ol>
              <div className="labels"><span className="label">{ticket.priority}</span>{ticket.labels.map((l) => <span className="label" key={l}>{l}</span>)}</div>
              <div className="row-actions">
                <button className="btn small" onClick={() => copy('md', ticketMd)}>{copied === 'md' ? 'Copied' : 'Copy as Markdown'}</button>
                <button className="btn ghost small" onClick={() => copy('json', JSON.stringify({ ...ticket, policyId: impact.policyId, owner: impact.owner, dueDate: impact.dueDate, source: pub.url }, null, 2))}>{copied === 'json' ? 'Copied' : 'Copy as JSON'}</button>
                <button className="btn ghost small" onClick={makeTicket} disabled={busy}>Redraft</button>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function Pubs({ pubs, triageById, assessments, running }: { pubs: Publication[]; triageById: Map<string, Triage>; assessments: Assessment[]; running: boolean }) {
  if (!pubs.length) return <div className="empty-state"><h3>No publications yet</h3><p>Run a sweep to pull this window’s regulator output.</p></div>;
  const sorted = [...pubs].sort((a, b) => Number(!!triageById.get(b.id)?.relevant) - Number(!!triageById.get(a.id)?.relevant));
  return (
    <table className="table">
      <thead><tr><th>Publication</th><th>Relevant?</th><th>Why</th><th>Urgency</th><th className="num">Impacts</th></tr></thead>
      <tbody>
        {sorted.map((p) => {
          const t = triageById.get(p.id);
          const a = assessments.find((x) => x.pubId === p.id);
          return (
            <tr key={p.id}>
              <td style={{ maxWidth: 380 }}><span className="reg">{p.regulator}</span><a href={p.url} target="_blank" rel="noreferrer">{p.title}</a><div className="muted">{p.type}, {fmtDate(p.published)}</div></td>
              <td>{t ? (t.relevant ? <span className="yes">Yes</span> : <span className="no">No</span>) : running ? <span className="muted">…</span> : '—'}</td>
              <td className="muted" style={{ maxWidth: 360 }}>{t?.reason}{t?.topics.length ? <div className="labels">{t.topics.map((x) => <span key={x} className="label">{x}</span>)}</div> : null}</td>
              <td>{t?.relevant ? <span className={`sev ${t.urgency}`}>{t.urgency}</span> : ''}</td>
              <td className="num">{a ? a.impacts.length : ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Library({ docs, impacts, sel, setSel }: { docs: PolicyDoc[]; impacts: Impact[]; sel: string; setSel: (s: string) => void }) {
  const doc = docs.find((d) => d.id === sel) || docs[0];
  const hits = (id: string) => impacts.filter((i) => i.policyId === id).length;
  return (
    <div className="lib">
      <nav className="lib-list" aria-label="Policies">
        {docs.map((d) => (
          <button key={d.id} className="lib-item" aria-current={d.id === doc.id} onClick={() => setSel(d.id)}>
            <span className="pol-id">{d.id}</span>
            <span className="t">{d.title}</span>
            {hits(d.id) ? <span className="hits">{hits(d.id)} change{hits(d.id) > 1 ? 's' : ''} needed</span> : null}
          </button>
        ))}
      </nav>
      <section className="sheet">
        <h3>{doc.id}: {doc.title}</h3>
        <div className="src">{doc.kind}. Owner {doc.owner}. Last reviewed {fmtDate(doc.reviewed)}.</div>
        <div className="poltext">{doc.body}</div>
      </section>
    </div>
  );
}

function Telemetry({ calls, status, mock }: { calls: CallLog[]; status: Status; mock: boolean }) {
  if (!calls.length) return <div className="empty-state"><h3>No calls yet</h3><p>Every Token Factory and Tavily call is logged here with tokens, latency and cost.</p></div>;
  const llm = calls.filter((c) => c.provider !== 'tavily');
  const byModel = new Map<string, { calls: number; pin: number; pout: number; ms: number; cost: number; stages: Set<string> }>();
  for (const c of llm) {
    const m = byModel.get(c.model) || { calls: 0, pin: 0, pout: 0, ms: 0, cost: 0, stages: new Set<string>() };
    m.calls++; m.pin += c.promptTokens; m.pout += c.completionTokens; m.ms += c.latencyMs; m.cost += c.costUsd; m.stages.add(c.stage);
    byModel.set(c.model, m);
  }
  const tri = llm.filter((c) => c.stage === 'triage');
  const triCost = tri.reduce((s, c) => s + c.costUsd, 0);
  const triAtUltra = tri.reduce((s, c) => s + (c.promptTokens * status.prices.reasoning.in + c.completionTokens * status.prices.reasoning.out) / 1e6, 0);
  const total = llm.reduce((s, c) => s + c.costUsd, 0);
  const tavilyCalls = calls.filter((c) => c.provider === 'tavily').length;
  return (
    <>
      {tri.length > 0 && (
        <div className="callout">
          Triage ran <b>{tri.length}</b> calls on {shortModel(status.triageModel)} for <b>{usd(triCost)}</b>. Sending the same tokens to {shortModel(status.reasoningModel)} would have cost <b>{usd(triAtUltra)}</b>, so routing saved <b>{triAtUltra > 0 ? Math.round((1 - triCost / triAtUltra) * 100) : 0}%</b> on triage. The whole sweep cost <b>{usd(total)}</b>{tavilyCalls ? <> plus <b>{tavilyCalls}</b> Tavily calls</> : null}.{mock ? ' Figures are estimates in mock mode.' : ''}
        </div>
      )}
      <table className="table" style={{ marginBottom: 18 }}>
        <thead><tr><th>Model</th><th>Used for</th><th className="num">Calls</th><th className="num">Tokens in</th><th className="num">Tokens out</th><th className="num">Avg latency</th><th className="num">Cost</th></tr></thead>
        <tbody>
          {[...byModel.entries()].map(([m, v]) => (
            <tr key={m}><td><code>{m}</code></td><td className="muted">{[...v.stages].join(', ')}</td><td className="num">{v.calls}</td><td className="num">{v.pin.toLocaleString()}</td><td className="num">{v.pout.toLocaleString()}</td><td className="num">{(v.ms / v.calls / 1000).toFixed(1)}s</td><td className="num">{usd(v.cost)}</td></tr>
          ))}
        </tbody>
      </table>
      <table className="table">
        <thead><tr><th className="num">#</th><th>Stage</th><th>Provider</th><th>Detail</th><th className="num">Tokens</th><th className="num">Latency</th><th className="num">Cost</th></tr></thead>
        <tbody>
          {calls.map((c) => (
            <tr key={`${c.stage}-${c.id}-${c.model}-${c.note}`}><td className="num muted">{c.id}</td><td>{c.stage}</td><td className="muted">{c.provider === 'token-factory' ? 'Token Factory' : c.provider === 'tavily' ? 'Tavily' : 'Mock'}</td><td style={{ maxWidth: 380 }}>{c.note}</td><td className="num">{c.promptTokens + c.completionTokens ? (c.promptTokens + c.completionTokens).toLocaleString() : ''}</td><td className="num">{(c.latencyMs / 1000).toFixed(1)}s</td><td className="num">{c.costUsd ? usd(c.costUsd) : ''}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Ask({ run, onCalls }: { run: RunResult; onCalls: (c: CallLog[]) => void }) {
  const [msgs, setMsgs] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const suggestions = ['What do we need to do about introducers after the Annex 1 action?', 'Does the ICO agentic AI work affect the Nudge pilot?', 'Which changes are due before the end of the year?'];
  async function send(text: string) {
    if (!text.trim() || busy) return;
    const history = msgs;
    setMsgs([...history, { role: 'user', content: text }]);
    setQ('');
    setBusy(true);
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: text, run, history }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setMsgs((m) => [...m, { role: 'assistant', content: j.reply }]);
      onCalls(j.calls || []);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: `Could not answer: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }
  if (!run.publications.length) return <div className="empty-state"><h3>Run a sweep first</h3><p>RegPulse answers from this sweep’s publications and the firm’s policy library.</p></div>;
  // Light formatting for model answers: [PUB:x]/[POL:x] citation chips and **bold**.
  const render = (s: string) =>
    s.split(/(\[(?:PUB|POL):[^\]]+\]|\*\*[^*]+\*\*)/g).map((part, i) =>
      /^\[(PUB|POL):/.test(part) ? <span key={i} className="cite">{part.slice(1, -1)}</span>
      : /^\*\*[^*]+\*\*$/.test(part) ? <strong key={i}>{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>
    );
  return (
    <div className="chat">
      <div className="msgs" aria-live="polite">
        {msgs.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.role === 'assistant' ? render(m.content) : m.content}</div>)}
        {busy && <div className="msg assistant"><span className="spinner" />Thinking with Nemotron…</div>}
      </div>
      {!msgs.length && <div className="suggest">{suggestions.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}</div>}
      <form className="ask" onSubmit={(e) => { e.preventDefault(); send(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this sweep, a policy or a deadline" aria-label="Question" />
        <button className="btn" type="submit" disabled={busy || !q.trim()}>Ask</button>
      </form>
    </div>
  );
}
