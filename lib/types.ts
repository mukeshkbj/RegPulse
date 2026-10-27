export type Regulator = 'FCA' | 'PRA' | 'ICO' | 'BoE/FCA' | string;

export interface Publication {
  id: string;
  regulator: Regulator;
  type: string;
  title: string;
  url: string;
  published: string;
  text: string;
}

export interface PolicyDoc {
  id: string;
  title: string;
  kind: string;
  owner: string;
  reviewed: string;
  body: string;
}

export interface Firm {
  name: string;
  short: string;
  profile: string;
  owners: string[];
}

export type Urgency = 'high' | 'medium' | 'low';

export interface Triage {
  pubId: string;
  relevant: boolean;
  urgency: Urgency;
  topics: string[];
  summary: string;
  reason: string;
  model: string;
}

export interface Impact {
  id: string;
  pubId: string;
  policyId: string;
  controlIds: string[];
  impactType: 'direct' | 'second-order';
  gap: string;
  action: string;
  severity: Urgency;
  owner: string;
  dueDate: string;
  dueBasis: string;
  quote: string;
  rationale: string;
  verified: boolean;
}

export interface Assessment {
  pubId: string;
  headline: string;
  noImpactReason?: string;
  impacts: Impact[];
  rejected: { policyId: string; quote: string; why: string }[];
  model: string;
}

export interface CallLog {
  id: number;
  stage: 'triage' | 'assess' | 'ticket' | 'chat' | 'search' | 'extract';
  provider: 'token-factory' | 'tavily' | 'mock';
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  costUsd: number;
  note?: string;
}

export interface Ticket {
  title: string;
  userStory: string;
  acceptanceCriteria: string[];
  tasks: string[];
  priority: string;
  labels: string[];
}

export interface RunResult {
  id: string;
  startedAt: string;
  finishedAt?: string;
  source: 'live' | 'corpus';
  mock: boolean;
  window: { from: string; to: string };
  publications: Publication[];
  triage: Triage[];
  assessments: Assessment[];
  calls: CallLog[];
  /** Policies the visitor added with "Try your own policy" (IDs MY-1..MY-3). */
  customPolicies?: PolicyDoc[];
}

export type SweepEvent =
  | { type: 'log'; level: 'info' | 'warn' | 'ok'; msg: string; stage?: string }
  | { type: 'stage'; stage: string; status: 'active' | 'done'; count?: number }
  | { type: 'publications'; items: Publication[] }
  | { type: 'triage'; item: Triage }
  | { type: 'assessment'; item: Assessment }
  | { type: 'call'; item: CallLog }
  | { type: 'done'; run: RunResult }
  | { type: 'error'; msg: string };
