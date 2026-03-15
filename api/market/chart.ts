import { fetchYahooChart } from '../../src/server/marketProxy';

export default async function handler(req: any, res: any) {
  try {
    const symbol = String(req.query?.symbol ?? '');
    const range = String(req.query?.range ?? '');
    const interval = String(req.query?.interval ?? '');

    if (!symbol || !range || !interval) {
      res.status(400).json({ error: 'symbol, range, and interval are required' });
      return;
    }

    const payload = await fetchYahooChart(symbol, range, interval);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json(payload);
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Unable to fetch chart data.',
    });
  }
}
