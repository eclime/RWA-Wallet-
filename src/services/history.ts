import { config } from '../config';

export type WalletHistoryItem = {
  signature: string;
  timestamp: number;
  kind: 'swap' | 'send' | 'receive' | 'activity';
  title: string;
  detail: string;
  amountLabel: string;
  usdLabel?: string;
};

type HeliusEnhancedTransaction = {
  signature: string;
  timestamp?: number;
  type?: string;
  description?: string;
  tokenTransfers?: Array<{
    fromUserAccount?: string;
    toUserAccount?: string;
    tokenAmount?: number;
    mint?: string;
    tokenSymbol?: string;
  }>;
  nativeTransfers?: Array<{
    fromUserAccount?: string;
    toUserAccount?: string;
    amount?: number;
  }>;
  events?: {
    swap?: {
      tokenInputs?: Array<{
        tokenAmount?: number;
        mint?: string;
        symbol?: string;
      }>;
      tokenOutputs?: Array<{
        tokenAmount?: number;
        mint?: string;
        symbol?: string;
      }>;
    };
  };
};

const mintSymbolMap = new Map<string, string>([
  ['So11111111111111111111111111111111111111112', 'SOL'],
  ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 'USDT'],
  ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'USDC'],
]);

function formatUsd(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return undefined;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

function formatTokenAmount(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '0';
  }

  if (value >= 1000) {
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  if (value >= 1) {
    return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }

  return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function getSymbol(symbol?: string, mint?: string) {
  return symbol || (mint ? mintSymbolMap.get(mint) : undefined) || 'token';
}

function extractSwapItem(transaction: HeliusEnhancedTransaction): WalletHistoryItem | null {
  const tokenIn = transaction.events?.swap?.tokenInputs?.[0];
  const tokenOut = transaction.events?.swap?.tokenOutputs?.[0];

  if (!tokenIn || !tokenOut) {
    return null;
  }

  const inSymbol = getSymbol(tokenIn.symbol, tokenIn.mint);
  const outSymbol = getSymbol(tokenOut.symbol, tokenOut.mint);
  const inAmount = formatTokenAmount(tokenIn.tokenAmount);
  const outAmount = formatTokenAmount(tokenOut.tokenAmount);

  return {
    signature: transaction.signature,
    timestamp: transaction.timestamp ?? 0,
    kind: 'swap',
    title: `${inSymbol} to ${outSymbol}`,
    detail: `Swapped ${inAmount} ${inSymbol} for ${outAmount} ${outSymbol}`,
    amountLabel: `${inAmount} ${inSymbol} -> ${outAmount} ${outSymbol}`,
  };
}

function extractTokenTransferItem(
  transaction: HeliusEnhancedTransaction,
  walletAddress: string,
): WalletHistoryItem | null {
  const transfer = transaction.tokenTransfers?.find(
    (item) => item.fromUserAccount === walletAddress || item.toUserAccount === walletAddress,
  );

  if (transfer) {
    const isReceive = transfer.toUserAccount === walletAddress;
    const symbol = getSymbol(transfer.tokenSymbol, transfer.mint);
    const amount = formatTokenAmount(transfer.tokenAmount);

    return {
      signature: transaction.signature,
      timestamp: transaction.timestamp ?? 0,
      kind: isReceive ? 'receive' : 'send',
      title: isReceive ? `Received ${symbol}` : `Sent ${symbol}`,
      detail: isReceive
        ? `From ${shortAddress(transfer.fromUserAccount)}`
        : `To ${shortAddress(transfer.toUserAccount)}`,
      amountLabel: `${isReceive ? '+' : '-'}${amount} ${symbol}`,
    };
  }

  const nativeTransfer = transaction.nativeTransfers?.find(
    (item) => item.fromUserAccount === walletAddress || item.toUserAccount === walletAddress,
  );

  if (!nativeTransfer) {
    return null;
  }

  const isReceive = nativeTransfer.toUserAccount === walletAddress;
  const solAmount = (nativeTransfer.amount ?? 0) / 1_000_000_000;

  return {
    signature: transaction.signature,
    timestamp: transaction.timestamp ?? 0,
    kind: isReceive ? 'receive' : 'send',
    title: isReceive ? 'Received SOL' : 'Sent SOL',
    detail: isReceive
      ? `From ${shortAddress(nativeTransfer.fromUserAccount)}`
      : `To ${shortAddress(nativeTransfer.toUserAccount)}`,
    amountLabel: `${isReceive ? '+' : '-'}${formatTokenAmount(solAmount)} SOL`,
  };
}

function shortAddress(value?: string) {
  if (!value) {
    return 'unknown';
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export async function fetchWalletHistory(address: string) {
  if (!config.heliusApiKey) {
    throw new Error('Add a Helius API key to load wallet history.');
  }

  const params = new URLSearchParams({
    'api-key': config.heliusApiKey,
    'token-accounts': 'balanceChanged',
    commitment: 'confirmed',
  });

  const response = await fetch(`https://api-mainnet.helius-rpc.com/v0/addresses/${address}/transactions?${params.toString()}`);
  const payload = (await response.json().catch(() => null)) as HeliusEnhancedTransaction[] | null;

  if (!response.ok || !Array.isArray(payload)) {
    throw new Error('Unable to fetch wallet history right now.');
  }

  return payload.slice(0, 30).map((transaction) => {
    const swapItem =
      transaction.type === 'SWAP' || transaction.events?.swap ? extractSwapItem(transaction) : null;

    if (swapItem) {
      return swapItem;
    }

    const transferItem = extractTokenTransferItem(transaction, address);

    if (transferItem) {
      return transferItem;
    }

    return {
      signature: transaction.signature,
      timestamp: transaction.timestamp ?? 0,
      kind: 'activity',
      title: transaction.type?.replace(/_/g, ' ') || 'Wallet activity',
      detail: transaction.description || 'Additional wallet activity detected.',
      amountLabel: shortAddress(transaction.signature),
    } satisfies WalletHistoryItem;
  });
}
