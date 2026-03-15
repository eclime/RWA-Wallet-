import { config } from '../config';
import type { Asset } from '../types';

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

type RaydiumPool = {
  tvl?: number;
  day?: {
    apr?: number;
  };
  week?: {
    apr?: number;
  };
  month?: {
    apr?: number;
  };
};

export async function createRaydiumClient(owner?: string) {
  if (!owner) {
    return null;
  }

  const [{ Raydium }, { Connection, PublicKey }] = await Promise.all([
    import('@raydium-io/raydium-sdk-v2'),
    import('@solana/web3.js'),
  ]);

  const connection = new Connection(config.heliusRpcUrl, 'confirmed');
  const ownerPublicKey = new PublicKey(owner);

  const raydium = await Raydium.load({
    connection,
    owner: ownerPublicKey,
    cluster: config.raydiumCluster === 'devnet' ? 'devnet' : 'mainnet',
    disableFeatureCheck: true,
    disableLoadToken: false,
  });

  return raydium;
}

export async function getSwapTerminalState({
  owner,
  fromAsset,
  toAsset,
  amount,
}: {
  owner?: string;
  fromAsset: Asset;
  toAsset: Asset;
  amount: number;
}) {
  if (!owner) {
    return {
      status: 'Connect wallet to load Raydium routes.',
      estimatedOutput: 0,
      minimumReceived: 0,
      priceImpact: 0,
    };
  }

  if (toAsset.category === 'xstocks' && (!toAsset.tokenAddress || !isLikelySolanaAddress(toAsset.tokenAddress))) {
    return {
      status: `Route preview unavailable for ${toAsset.symbol} yet.`,
      estimatedOutput: amount > 0 ? (amount * fromAsset.price) / toAsset.price : 0,
      minimumReceived: amount > 0 ? ((amount * fromAsset.price) / toAsset.price) * 0.992 : 0,
      priceImpact: 0,
    };
  }

  let raydium = null;

  try {
    raydium = await createRaydiumClient(owner);
  } catch {
    return {
      status: `Route preview unavailable for ${fromAsset.symbol}/${toAsset.symbol} right now.`,
      estimatedOutput: amount > 0 ? (amount * fromAsset.price) / toAsset.price : 0,
      minimumReceived: amount > 0 ? ((amount * fromAsset.price) / toAsset.price) * 0.992 : 0,
      priceImpact: 0,
    };
  }

  if (!raydium) {
    return {
      status: 'Raydium SDK unavailable.',
      estimatedOutput: 0,
      minimumReceived: 0,
      priceImpact: 0,
    };
  }

  const estimatedOutput = amount > 0 ? (amount * fromAsset.price) / toAsset.price : 0;
  const minimumReceived = estimatedOutput * 0.992;
  const priceImpact = Math.min(0.85, 0.12 + amount * 0.04);

  return {
    status: `Raydium SDK connected on ${config.raydiumCluster}. Route discovery placeholder ready for ${fromAsset.symbol}/${toAsset.symbol}.`,
    estimatedOutput,
    minimumReceived,
    priceImpact,
  };
}

export async function fetchRaydiumPairYield(fromAsset: Asset, toAsset: Asset) {
  if (!fromAsset.tokenAddress || !toAsset.tokenAddress || fromAsset.id === toAsset.id) {
    return 0;
  }

  const pools = await Promise.all([
    fetchRaydiumPoolsByType('Standard', fromAsset.tokenAddress, toAsset.tokenAddress),
    fetchRaydiumPoolsByType('Concentrated', fromAsset.tokenAddress, toAsset.tokenAddress),
  ]);

  const bestPool = pools
    .flat()
    .sort((left, right) => (right.tvl ?? 0) - (left.tvl ?? 0))[0];

  if (!bestPool) {
    return 0;
  }

  return Number(bestPool.week?.apr ?? bestPool.day?.apr ?? bestPool.month?.apr ?? 0);
}

async function fetchRaydiumPoolsByType(poolType: 'Standard' | 'Concentrated', mint1: string, mint2: string) {
  const params = new URLSearchParams({
    poolType,
    mint1,
    mint2,
    size: '20',
  });
  const response = await fetch(`${config.raydiumApiBase}/pools/info/list-v2?${params.toString()}`);
  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.success) {
    return [];
  }

  return ((payload.data?.data ?? []) as RaydiumPool[]);
}

function isLikelySolanaAddress(value: string) {
  return value.length >= 32 && value.length <= 44 && BASE58_RE.test(value);
}
