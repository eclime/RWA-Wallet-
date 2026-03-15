const YAHOO_BASE_URL = 'https://query1.finance.yahoo.com';

export async function fetchYahooQuotes(symbols: string) {
  const params = new URLSearchParams({
    symbols,
  });
  const response = await fetch(`${YAHOO_BASE_URL}/v7/finance/quote?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Quote request failed with status ${response.status}.`);
  }

  return response.json();
}

export async function fetchYahooChart(symbol: string, range: string, interval: string) {
  const params = new URLSearchParams({
    range,
    interval,
    includePrePost: 'false',
    events: 'div,splits',
  });
  const response = await fetch(
    `${YAHOO_BASE_URL}/v8/finance/chart/${encodeURIComponent(symbol)}?${params.toString()}`,
    {
      headers: {
        Accept: 'application/json',
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Chart request failed with status ${response.status}.`);
  }

  return response.json();
}
