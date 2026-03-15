import { config } from '../config';
import type { Asset } from '../types';

const quoteSymbolsByAssetId: Record<string, string> = {
  gldx: 'GLD',
  slvx: 'SLV',
  nvdax: 'NVDA',
  tslax: 'TSLA',
  spyx: 'SPY',
  googlx: 'GOOGL',
  metax: 'META',
  amznx: 'AMZN',
  coinx: 'COIN',
  mstrx: 'MSTR',
  aaplx: 'AAPL',
  crwdx: 'CRWD',
};

type YahooQuote = {
  symbol: string;
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
};

type HistoryRange = '24h' | '1w' | '1m' | '3m' | '6m' | '1y' | 'all';

type HistoryPoint = {
  timestamp: number;
  price: number;
};

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
    }>;
  };
};

const historyConfigByRange: Record<
  HistoryRange,
  { interval: string; seconds: number; yahooRange: string; yahooInterval: string }
> = {
  '24h': { interval: '15m', seconds: 60 * 60 * 24, yahooRange: '1d', yahooInterval: '15m' },
  '1w': { interval: '1H', seconds: 60 * 60 * 24 * 7, yahooRange: '5d', yahooInterval: '1h' },
  '1m': { interval: '4H', seconds: 60 * 60 * 24 * 30, yahooRange: '1mo', yahooInterval: '1d' },
  '3m': { interval: '1D', seconds: 60 * 60 * 24 * 90, yahooRange: '3mo', yahooInterval: '1d' },
  '6m': { interval: '1D', seconds: 60 * 60 * 24 * 180, yahooRange: '6mo', yahooInterval: '1d' },
  '1y': { interval: '1W', seconds: 60 * 60 * 24 * 365, yahooRange: '1y', yahooInterval: '1wk' },
  all: { interval: '1M', seconds: 60 * 60 * 24 * 365 * 5, yahooRange: '5y', yahooInterval: '1mo' },
};

function getAssetSeed(asset: Asset) {
  return asset.id.split('').reduce((seed, char) => seed + char.charCodeAt(0), 0);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getRangeChangeRatio(asset: Asset, range: HistoryRange) {
  const seed = getAssetSeed(asset);
  const seedBias = ((seed % 17) - 8) / 100;

  const ratio =
    range === '24h'
      ? asset.change24h / 100
      : range === '1w'
        ? asset.change24h / 100 * 2.8 + seedBias * 0.18
        : range === '1m'
          ? asset.change24h / 100 * 4.4 + seedBias * 0.3
          : range === '3m'
            ? asset.change24h / 100 * 7 + seedBias * 0.45
            : range === '6m'
              ? asset.change24h / 100 * 10 + seedBias * 0.55
              : range === '1y'
                ? asset.change24h / 100 * 13 + seedBias * 0.7
                : asset.change24h / 100 * 16 + seedBias * 0.9;

  return clamp(ratio, -0.65, 0.95);
}

function buildFallbackHistory(asset: Asset, range: HistoryRange): HistoryPoint[] {
  const { seconds } = historyConfigByRange[range];
  const pointCount =
    range === '24h'
      ? 24
      : range === '1w'
        ? 28
        : range === '1m'
          ? 30
          : range === '6m'
            ? 26
            : range === '1y'
              ? 26
              : 36;
  const step = Math.max(Math.floor(seconds / Math.max(pointCount - 1, 1)), 1);
  const end = Math.floor(Date.now() / 1000);
  const seed = getAssetSeed(asset);
  const primaryPhase = (seed % 11) * 0.21;
  const secondaryPhase = (seed % 7) * 0.35;
  const tertiaryPhase = (seed % 5) * 0.48;
  const primaryCycles = 2.2 + (seed % 5) * 0.45;
  const secondaryCycles = 4.4 + (seed % 7) * 0.28;
  const tertiaryCycles = 7.2 + (seed % 3) * 0.55;
  const amplitudeRatio =
    range === '24h'
      ? 0.012
      : range === '1w'
        ? 0.02
      : range === '1m'
        ? 0.026
        : range === '6m'
          ? 0.05
          : range === '1y'
            ? 0.07
            : 0.09;
  const totalChangeRatio = getRangeChangeRatio(asset, range);
  const startPrice = asset.price / (1 + totalChangeRatio || 1);

  return Array.from({ length: pointCount }, (_, index) => {
    const progress = index / Math.max(pointCount - 1, 1);
    const timestamp = end - seconds + step * index;
    const baseline = startPrice + (asset.price - startPrice) * progress;
    const wave =
      Math.sin(progress * Math.PI * primaryCycles + primaryPhase) * amplitudeRatio * asset.price +
      Math.cos(progress * Math.PI * secondaryCycles + secondaryPhase) * amplitudeRatio * 0.55 * asset.price +
      Math.sin(progress * Math.PI * tertiaryCycles + tertiaryPhase) * amplitudeRatio * 0.22 * asset.price;
    const drift =
      Math.sin(progress * Math.PI * 1.2 + secondaryPhase) * amplitudeRatio * 0.2 * asset.price +
      Math.cos(progress * Math.PI * 0.8 + tertiaryPhase) * amplitudeRatio * 0.08 * asset.price;
    const price =
      index === pointCount - 1 ? asset.price : Math.max(0.0001, baseline + wave + drift);

    return {
      timestamp,
      price: Number(price.toFixed(4)),
    };
  });
}

async function fetchYahooHistory(asset: Asset, range: HistoryRange): Promise<HistoryPoint[]> {
  const symbol = asset.marketSymbol ?? quoteSymbolsByAssetId[asset.id];
  const historyConfig = historyConfigByRange[range];

  if (!symbol) {
    return [];
  }

  const params = new URLSearchParams({
    range: historyConfig.yahooRange,
    interval: historyConfig.yahooInterval,
    includePrePost: 'false',
    events: 'div,splits',
  });
  const response = await fetch(
    `/api/market/chart?${new URLSearchParams({
      symbol,
      range: historyConfig.yahooRange,
      interval: historyConfig.yahooInterval,
    }).toString()}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    },
  );

  if (!response.ok) {
    throw new Error('Unable to fetch market history right now.');
  }

  const payload = (await response.json()) as YahooChartResponse;
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];

  return timestamps.reduce<HistoryPoint[]>((points, timestamp, index) => {
    const price = closes[index];

    if (typeof price === 'number' && Number.isFinite(price)) {
      points.push({ timestamp, price });
    }

    return points;
  }, []);
}

export async function fetchLiveXStockPrices(baseAssets: Asset[]) {
  const quoteEligibleAssets = baseAssets.filter(
    (asset) => asset.category === 'xstocks' || Boolean(asset.marketSymbol ?? quoteSymbolsByAssetId[asset.id]),
  );
  const symbols = Array.from(
    new Set(
      quoteEligibleAssets
        .map((asset) => asset.marketSymbol ?? quoteSymbolsByAssetId[asset.id])
        .filter((symbol): symbol is string => Boolean(symbol)),
    ),
  ).join(',');

  if (!symbols) {
    return baseAssets;
  }

  const response = await fetch(
    `/api/market/quote?symbols=${encodeURIComponent(symbols)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    },
  );

  if (!response.ok) {
    throw new Error('Unable to fetch live xStock prices right now.');
  }

  const payload = (await response.json()) as {
    quoteResponse?: {
      result?: YahooQuote[];
    };
  };

  const quotes = payload.quoteResponse?.result ?? [];
  const quoteMap = new Map(quotes.map((quote) => [quote.symbol, quote]));

  return baseAssets.map((asset) => {
    const quoteSymbol = asset.marketSymbol ?? quoteSymbolsByAssetId[asset.id];

    if (!quoteSymbol) {
      return asset;
    }

    const liveQuote = quoteSymbol ? quoteMap.get(quoteSymbol) : undefined;

    if (!liveQuote?.regularMarketPrice) {
      return asset;
    }

    const livePrice = liveQuote.regularMarketPrice;

    return {
      ...asset,
      marketSymbol: quoteSymbol,
      price: livePrice,
      change24h: liveQuote.regularMarketChangePercent ?? asset.change24h,
      value: Number((livePrice * asset.balance).toFixed(2)),
    };
  });
}

export async function fetchXStockHistory(asset: Asset, range: HistoryRange): Promise<HistoryPoint[]> {
  if (asset.category === 'xstocks') {
    try {
      const yahooPoints = await fetchYahooHistory(asset, range);

      if (yahooPoints.length > 1) {
        return yahooPoints;
      }
    } catch {
      // Fall through to onchain history and then a flat fallback.
    }
  }

  if (!asset.tokenAddress || !config.birdeyeApiKey) {
    return buildFallbackHistory(asset, range);
  }

  try {
    const historyConfig = historyConfigByRange[range];
    const timeTo = Math.floor(Date.now() / 1000);
    const timeFrom = timeTo - historyConfig.seconds;
    const params = new URLSearchParams({
      address: asset.tokenAddress,
      address_type: 'token',
      type: historyConfig.interval,
      time_from: String(timeFrom),
      time_to: String(timeTo),
    });
    const response = await fetch(`https://public-api.birdeye.so/defi/history_price?${params.toString()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-API-KEY': config.birdeyeApiKey,
        'x-chain': 'solana',
      },
    });

    if (!response.ok) {
      throw new Error('Birdeye chart request failed.');
    }

    const payload = (await response.json()) as {
      data?: {
        items?: Array<{
          unixTime?: number;
          value?: number;
          price?: number;
          close?: number;
        }>;
      };
    };
    const items = payload.data?.items ?? [];
    const points = items.reduce<HistoryPoint[]>((allPoints, item) => {
      const timestamp = item.unixTime;
      const price = item.value ?? item.price ?? item.close;

      if (typeof timestamp === 'number' && typeof price === 'number' && Number.isFinite(price)) {
        allPoints.push({ timestamp, price });
      }

      return allPoints;
    }, []);

    return points.length > 1 ? points : buildFallbackHistory(asset, range);
  } catch {
    return buildFallbackHistory(asset, range);
  }
}

export type { HistoryPoint, HistoryRange };
