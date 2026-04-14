import { config } from '../config';
import type { Asset } from '../types';

const TOKEN_PROGRAM_IDS = [
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
];

type TokenAccount = {
  account?: {
    data?: {
      parsed?: {
        info?: {
          mint?: string;
          tokenAmount?: {
            uiAmount?: number | null;
          };
        };
      };
    };
  };
};

export async function applyStableWalletBalances(address: string, baseAssets: Asset[]) {
  const [solBalance, tokenAccounts] = await Promise.all([
    fetchSolBalance(address),
    fetchSplTokenAccounts(address),
  ]);

  const tokenBalances = new Map<string, number>();

  for (const account of tokenAccounts) {
    const mint = account.account?.data?.parsed?.info?.mint;
    const uiAmount = account.account?.data?.parsed?.info?.tokenAmount?.uiAmount;

    if (mint && typeof uiAmount === 'number') {
      tokenBalances.set(mint, (tokenBalances.get(mint) ?? 0) + uiAmount);
    }
  }

  return baseAssets.map((asset) => {
    const balance =
      asset.symbol === 'SOL'
        ? solBalance
        : asset.tokenAddress
          ? tokenBalances.get(asset.tokenAddress) ?? 0
          : 0;

    return {
      ...asset,
      balance,
      value: Number((balance * asset.price).toFixed(2)),
    };
  });
}

async function fetchSolBalance(address: string) {
  const payload = await heliusRpc('getBalance', [address]);
  return (payload?.value ?? 0) / 1_000_000_000;
}

async function fetchSplTokenAccounts(address: string) {
  const payloads = await Promise.all(
    TOKEN_PROGRAM_IDS.map((programId) =>
      heliusRpc('getTokenAccountsByOwner', [
        address,
        { programId },
        { encoding: 'jsonParsed' },
      ]),
    ),
  );

  return payloads.flatMap((payload) => (payload?.value ?? []) as TokenAccount[]);
}

async function heliusRpc(method: string, params: unknown[]) {
  const response = await fetch(config.heliusRpcUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'wallet-balance',
      method,
      params,
    }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok || payload?.error) {
    throw new Error('Unable to fetch wallet balances right now.');
  }

  return payload.result;
}
