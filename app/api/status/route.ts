import { config } from '@/lib/config';
import { CORPUS, FIRM, LIBRARY } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET() {
  const c = config();
  return Response.json({
    mock: c.mock,
    liveSearch: c.liveSearch,
    baseUrl: c.baseUrl,
    triageModel: c.triageModel,
    reasoningModel: c.reasoningModel,
    prices: c.prices,
    firm: FIRM,
    library: LIBRARY,
    corpusWindow: CORPUS.window,
    corpusCount: CORPUS.items.length,
  });
}
