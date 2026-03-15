import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fetchYahooChart, fetchYahooQuotes } from './src/server/marketProxy';

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function marketProxyPlugin() {
  return {
    name: 'market-proxy',
    configureServer(server: { middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');

        try {
          if (url.pathname === '/api/market/quote') {
            const symbols = url.searchParams.get('symbols') ?? '';

            if (!symbols) {
              sendJson(res, 400, { error: 'symbols is required' });
              return;
            }

            const payload = await fetchYahooQuotes(symbols);
            sendJson(res, 200, payload);
            return;
          }

          if (url.pathname === '/api/market/chart') {
            const symbol = url.searchParams.get('symbol') ?? '';
            const range = url.searchParams.get('range') ?? '';
            const interval = url.searchParams.get('interval') ?? '';

            if (!symbol || !range || !interval) {
              sendJson(res, 400, { error: 'symbol, range, and interval are required' });
              return;
            }

            const payload = await fetchYahooChart(symbol, range, interval);
            sendJson(res, 200, payload);
            return;
          }
        } catch (error) {
          sendJson(res, 502, {
            error: error instanceof Error ? error.message : 'Unable to fetch market data.',
          });
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), marketProxyPlugin()],
});
