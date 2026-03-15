import { fetchYahooQuotes } from '../../src/server/marketProxy';

export default async function handler(req: any, res: any) {
  try {
    const symbols = String(req.query?.symbols ?? '');

    if (!symbols) {
      res.status(400).json({ error: 'symbols is required' });
      return;
    }

    const payload = await fetchYahooQuotes(symbols);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json(payload);
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Unable to fetch quote data.',
    });
  }
}
