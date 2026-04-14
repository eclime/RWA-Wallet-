import { config } from '../config';
import type { Asset } from '../types';

const decimalCache = new Map<string, number>();

export type JupiterQuoteResponse = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan?: Array<{
    swapInfo?: {
      label?: string;
    };
  }>;
};

type JupiterSwapResponse = {
  swapTransaction: string;
  lastValidBlockHeight?: number;
};

export type JupiterTerminalState = {
  status: string;
  estimatedOutput: number;
  minimumReceived: number;
  priceImpact: number;
  routeLabel: string;
  quote: JupiterQuoteResponse | null;
};

export async function getJupiterTerminalState({
  fromAsset,
  toAsset,
  amount,
}: {
  fromAsset: Asset;
  toAsset: Asset;
  amount: string;
}): Promise<JupiterTerminalState> {
  if (fromAsset.id === toAsset.id) {
    return {
      status: 'Choose two different assets to preview a Jupiter route.',
      estimatedOutput: 0,
      minimumReceived: 0,
      priceImpact: 0,
      routeLabel: `${fromAsset.symbol} / ${toAsset.symbol}`,
      quote: null,
    };
  }

  if (!fromAsset.tokenAddress || !toAsset.tokenAddress) {
    return {
      status: 'Swap token metadata is incomplete for this pair.',
      estimatedOutput: 0,
      minimumReceived: 0,
      priceImpact: 0,
      routeLabel: `${fromAsset.symbol} / ${toAsset.symbol}`,
      quote: null,
    };
  }

  const [fromDecimals, toDecimals] = await Promise.all([
    getTokenDecimals(fromAsset),
    getTokenDecimals(toAsset),
  ]);
  const atomicAmount = toAtomicAmount(amount, fromDecimals);

  if (atomicAmount <= 0n) {
    return {
      status: 'Enter an amount to preview the Jupiter route.',
      estimatedOutput: 0,
      minimumReceived: 0,
      priceImpact: 0,
      routeLabel: `${fromAsset.symbol} / ${toAsset.symbol}`,
      quote: null,
    };
  }

  const params = new URLSearchParams({
    inputMint: fromAsset.tokenAddress,
    outputMint: toAsset.tokenAddress,
    amount: atomicAmount.toString(),
    slippageBps: '50',
    restrictIntermediateTokens: 'true',
  });

  const response = await fetch(`${config.jupiterApiBase}/quote?${params.toString()}`);
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      typeof payload?.error === 'string'
        ? payload.error
        : `Jupiter quote failed with status ${response.status}.`,
    );
  }

  const quote = payload as JupiterQuoteResponse;
  const estimatedOutput = fromAtomicAmount(quote.outAmount, toDecimals);
  const minimumReceived = fromAtomicAmount(quote.otherAmountThreshold, toDecimals);
  const sendUsdValue = Number(amount || '0') * fromAsset.price;
  const receiveUsdValue = estimatedOutput * toAsset.price;
  const routeHops =
    quote.routePlan
      ?.map((route) => route.swapInfo?.label)
      .filter((label): label is string => Boolean(label)) ?? [];

  if (
    sendUsdValue > 0 &&
    receiveUsdValue > sendUsdValue * 2
  ) {
    return {
      status: `Jupiter returned an implausible quote for ${fromAsset.symbol}/${toAsset.symbol}.`,
      estimatedOutput: 0,
      minimumReceived: 0,
      priceImpact: 0,
      routeLabel: `${fromAsset.symbol} / ${toAsset.symbol}`,
      quote: null,
    };
  }

  return {
    status: routeHops.length
      ? `Jupiter route ready via ${routeHops.join(' -> ')}.`
      : `Jupiter route ready for ${fromAsset.symbol}/${toAsset.symbol}.`,
    estimatedOutput,
    minimumReceived,
    priceImpact: Number(quote.priceImpactPct || '0') * 100,
    routeLabel: routeHops.length ? routeHops.join(' -> ') : `${fromAsset.symbol} / ${toAsset.symbol}`,
    quote,
  };
}

export async function executeJupiterSwap({
  walletAddress,
  quote,
  wallet,
}: {
  walletAddress: string;
  quote: JupiterQuoteResponse;
  wallet: {
    sendTransaction?: (
      transaction: import('@solana/web3.js').VersionedTransaction,
      connection: import('@solana/web3.js').Connection,
      options?: {
        skipPreflight?: boolean;
        maxRetries?: number;
      },
    ) => Promise<string>;
  };
}) {
  if (!wallet.sendTransaction) {
    throw new Error('Your Privy Solana wallet cannot send transactions yet.');
  }

  const swapResponse = await fetch(`${config.jupiterApiBase}/swap`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: walletAddress,
      dynamicComputeUnitLimit: true,
      dynamicSlippage: true,
    }),
  });
  const swapPayload = await swapResponse.json().catch(() => null);

  if (!swapResponse.ok || !swapPayload?.swapTransaction) {
    throw new Error(
      typeof swapPayload?.error === 'string'
        ? swapPayload.error
        : 'Jupiter could not build the swap transaction.',
    );
  }

  const { Connection, VersionedTransaction } = await import('@solana/web3.js');
  const connection = new Connection(config.heliusRpcUrl, 'confirmed');
  const { swapTransaction, lastValidBlockHeight } = swapPayload as JupiterSwapResponse;
  const transaction = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));

  const signature = await wallet.sendTransaction(transaction, connection, {
    skipPreflight: false,
    maxRetries: 2,
  });

  await connection.confirmTransaction(
    {
      signature,
      blockhash: transaction.message.recentBlockhash,
      lastValidBlockHeight: lastValidBlockHeight ?? (await connection.getLatestBlockhash()).lastValidBlockHeight,
    },
    'confirmed',
  );

  return {
    signature,
  };
}

function toAtomicAmount(value: string, decimals: number) {
  const normalized = value.trim().replace(/,/g, '');
  if (!normalized || normalized === '.') {
    return 0n;
  }

  const [wholePart = '0', fractionalPart = ''] = normalized.split('.');
  const whole = wholePart.replace(/\D/g, '') || '0';
  const fractional = fractionalPart.replace(/\D/g, '').slice(0, decimals).padEnd(decimals, '0');

  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fractional || '0');
}

function fromAtomicAmount(value: string, decimals: number) {
  const amount = BigInt(value || '0');
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fractional = amount % divisor;

  return Number(whole) + Number(fractional) / Number(divisor);
}

async function getTokenDecimals(asset: Asset) {
  if (asset.symbol === 'SOL') {
    return 9;
  }

  if (!asset.tokenAddress) {
    return asset.tokenDecimals ?? 6;
  }

  const cached = decimalCache.get(asset.tokenAddress);
  if (typeof cached === 'number') {
    return cached;
  }

  try {
    const response = await fetch(config.heliusRpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'jupiter-token-decimals',
        method: 'getTokenSupply',
        params: [asset.tokenAddress],
      }),
    });

    const payload = await response.json().catch(() => null);
    const decimals = payload?.result?.value?.decimals;

    if (response.ok && typeof decimals === 'number') {
      decimalCache.set(asset.tokenAddress, decimals);
      return decimals;
    }
  } catch {
    // Fall back to configured decimals below.
  }

  return asset.tokenDecimals ?? 6;
}
