const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== '' ? n : d;
};

export function config() {
  const nebiusKey = process.env.NEBIUS_API_KEY || '';
  const tavilyKey = process.env.TAVILY_API_KEY || '';
  return {
    nebiusKey,
    tavilyKey,
    baseUrl: (process.env.NEBIUS_BASE_URL || 'https://api.tokenfactory.nebius.com/v1').replace(/\/$/, ''),
    triageModel: process.env.TRIAGE_MODEL || 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',
    reasoningModel: process.env.REASONING_MODEL || 'nvidia/Nemotron-3-Ultra-550b-a55b',
    prices: {
      triage: { in: num(process.env.TRIAGE_PRICE_IN, 0.06), out: num(process.env.TRIAGE_PRICE_OUT, 0.24) },
      reasoning: { in: num(process.env.REASONING_PRICE_IN, 1), out: num(process.env.REASONING_PRICE_OUT, 3) },
    },
    mock: !nebiusKey || process.env.MOCK_LLM === '1',
    liveSearch: !!tavilyKey,
    record: process.env.RECORD_RUNS === '1',
  };
}

export type Config = ReturnType<typeof config>;
