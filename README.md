# RegPulse

**Which new rules touch your firm this week?**

RegPulse is an agent for compliance teams at UK financial firms. It reads what the FCA, PRA and ICO have published, keeps only what applies to *your* firm, and maps each change to the specific policy and control it affects. Each finding comes with an owner, a due date and a draft change ticket. Every finding quotes the regulator word for word, and the app rejects any claim whose quote it cannot find in the source.

Built for the [Nebius x NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com/), Best Apps and Agents track. Runs on **NVIDIA Nemotron** models served by **Nebius Token Factory**, with **Tavily** for live regulator search.

**Live demo:** https://regpulse-one.vercel.app. Click **Load recorded run** for an instant result, or **Run sweep** to run the full pipeline (about a minute).

License: [Apache 2.0](LICENSE)

---

## The problem

A UK lender's compliance team has to read hundreds of regulator publications a month: consultations, policy statements, Dear CEO letters, press releases and guidance from the FCA, the PRA and the ICO. For each one, someone has to work out:

1. Does this apply to us?
2. Which of our policies, processes and controls does it change?
3. Who owns that change, and when is it due?

The hard part is the second-order hit. That is a publication about something else that still lands on one of your processes. Two examples from the October 2026 sweep:

- An FCA press release about AML restrictions on six *unregulated* lenders also reminds regulated firms to check the registration status of the Annex 1 firms they deal with. That changes how a lender onboards its introducers.
- An ICO call for evidence on *agentic AI* changes what a lender should document about the AI assistant it is piloting in collections.

RegPulse is built to catch exactly these.

## What it does

| Step | What happens | Engine |
| --- | --- | --- |
| 1. Search and extract | Searches fca.org.uk, bankofengland.co.uk and ico.org.uk for the chosen date window, de-duplicates the results, then extracts clean text from each page | Tavily Search + Extract |
| 2. Triage | Reads every publication against the firm profile and decides relevant or not, with urgency, topic tags and a reason | **Nemotron Nano** on Token Factory |
| 3. Impact assessment | Reads each relevant publication against the firm's full policy library (15 documents) and returns impacts: policy, controls, direct or second-order, gap, next step, owner, due date and a verbatim quote | **Nemotron Ultra** on Token Factory |
| 4. Verify citations | Rejects any impact whose quote is not in the source text verbatim, whose policy ID does not exist, or whose control ID is not in that policy | Deterministic code |
| 5. Act | Evidence view shows the regulator's words highlighted next to the affected policy; **Draft change ticket** writes a user story with acceptance criteria; **Ask RegPulse** answers questions with citations | **Nemotron Ultra** |

**Exports:** **Download CSV** gives the impact board for a spreadsheet or GRC tool. **Download Pega cases** gives one Pega DX API v2 create-case payload per impact, so findings can open regulatory-change cases in a Pega application. The case type ID is an example; map it to your own.

**Public demo protection:** live sweeps are rate-limited per visitor (3 per hour) and per day. When a limit is reached, the app shows the recorded run instead of failing. Tune this with `SWEEPS_PER_HOUR_PER_VISITOR`, `SWEEPS_PER_DAY` (0 = recorded run only) and `CALLS_PER_HOUR_PER_VISITOR`.

The **Models and cost** tab logs every call with model, tokens, latency and cost. It also shows how much the two-tier routing saved compared with running everything on Ultra.

### Results from a real run

From the recorded run in `data/recorded-run.json` (captured corpus, 1–27 October 2026):

| Measure | Result |
| --- | --- |
| Publications scanned | 11 |
| Relevant after Nano triage | 6 (fund, transaction-reporting, DeFi and PRA-only items correctly excluded) |
| Verified impacts | 14 across 8 policies: 2 high priority, 5 second-order |
| Uncited claims dropped | 0 (an earlier, untuned run dropped 4, including an invented policy ID) |
| Wall time | 33 seconds |
| Model cost | $0.08 in total: triage $0.0024 for 11 Nano calls, assessment $0.078 for 6 Ultra calls |
| Triage saving from routing | 93% compared with running triage on Ultra |

**Load recorded run** in the app replays this run instantly.

## How we use NVIDIA Nemotron and Nebius Token Factory

- **Two Nemotron tiers, each used for what it is good at.** Every publication is triaged by `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` ($0.06 / $0.24 per 1M tokens); Nemotron Super is a one-line swap. Only the relevant ones go to `nvidia/Nemotron-3-Ultra-550b-a55b`, which does the multi-document reasoning: one publication against 15 policies, about 12k tokens of context per call.
- **Token Factory's OpenAI-compatible API** (`https://api.tokenfactory.nebius.com/v1/chat/completions`) is called directly with `fetch`, with no SDK lock-in. See [`lib/llm.ts`](lib/llm.ts).
- **Structured output.** Every call asks for JSON (`response_format: json_object`, falling back automatically if a model rejects it). Reasoning traces (`<think>…</think>`) are stripped, and a malformed reply gets one automatic retry.
- **Telemetry for every call.** Tokens and latency come from Token Factory's `usage` field. Cost uses the per-model prices in `.env`. The UI shows the cost of the triage stage on the fast model next to what the same tokens would have cost on Ultra.
- **Where Token Factory helped us build faster:** one API key and one endpoint gave us several Nemotron sizes, so model routing became a config change rather than an infrastructure project. Open models also mean a firm could later move the same pipeline onto dedicated Nebius endpoints or its own GPUs.

## Guardrail: no quote, no finding

Compliance teams cannot act on a hallucinated rule. [`lib/verify.ts`](lib/verify.ts) normalises whitespace, quote marks and dashes, then checks that each quote (or each part of a quote elided with "…") appears in the extracted publication text. Impacts that fail are dropped and counted in "uncited claims dropped". The evidence view finds the quote in the original text and highlights it.

## Sample firm

`data/firm.json` and `data/library.json` describe **Northbridge Business Finance Ltd**, a fictional Manchester SME lender:

- FCA consumer credit authorisation, plus unregulated commercial loans
- about 60 introducers
- automated credit decisioning
- a pilot LLM collections assistant called "Nudge"

The library holds 15 policies and process maps, each with owners and control IDs. Replace these two files with your own firm's to use RegPulse for real.

`data/corpus.json` holds 12 real regulator publications from 1–27 October 2026, captured with Tavily search and extract. It gives you a repeatable demo with no Tavily key. Live mode searches the web for whatever window you choose.

## Run it

Requirements: Node.js 20 or later.

```bash
git clone <this repo> regpulse && cd regpulse
npm install
cp .env.example .env.local      # then fill in the keys
npm run check-models            # lists the Nemotron model IDs your key can use
npm run dev                     # http://localhost:3000
```

`.env.local`:

```bash
NEBIUS_API_KEY=...              # from tokenfactory.nebius.com
TAVILY_API_KEY=...              # from tavily.com (optional: without it, the bundled corpus is used)
TRIAGE_MODEL=nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B
REASONING_MODEL=nvidia/Nemotron-3-Ultra-550b-a55b
```

What happens when keys are missing:

- **No Nebius key:** the app runs in **mock mode**. Clearly labelled rule-based stand-ins replace the model calls, so you can explore the UI offline.
- **No Tavily key:** the app uses the captured corpus.
- **Recording a demo run:** set `RECORD_RUNS=1` and each sweep is saved to `data/demo-run.json`. Copy a good one to `data/recorded-run.json` to keep it; **Load recorded run** replays that file.

The demo video's script, shot list and ElevenLabs voiceover generator are in [`video/`](video/README.md).

### Deploy

The app is a standard Next.js 15 app with Node.js API routes. Sweeps stream progress as NDJSON and can take a few minutes.

- **Vercel:** import the repo and add the environment variables. A long sweep needs a plan whose function limit is above 60 seconds.
- **Nebius:** build the container (`npm run build && npm start`, port 3000) and run it on a Nebius Serverless Endpoint.

## Project structure

```
app/page.tsx            UI: impact board, evidence view, tickets, library, telemetry, chat
app/api/sweep           Streams the pipeline as NDJSON events
app/api/ticket, chat    Change ticket and Q&A on Nemotron Ultra
lib/pipeline.ts         Prompts and orchestration (triage → assess → verify)
lib/llm.ts              Token Factory client, JSON handling, telemetry
lib/tavily.ts           Regulator sources, search, extract
lib/verify.ts           Citation verification
lib/mock.ts             Offline stand-ins (mock mode only)
data/                   Sample firm, policy library, captured corpus
```

## Limitations

- The firm and its policies are fictional. Real use needs the firm's own policy library, and a document upload flow is the next step.
- RegPulse drafts impact assessments and tickets for a compliance professional to review. It is not legal advice.
- Live search coverage depends on what Tavily indexes for each regulator domain in the chosen window.

## Licence

Apache License 2.0. See [LICENSE](LICENSE).
