export type AssetCategory = 'stables' | 'xstocks' | 'prestocks';

export type Asset = {
  id: string;
  symbol: string;
  name: string;
  category: AssetCategory;
  logo: string;
  marketSymbol?: string;
  tokenAddress?: string;
  tokenDecimals?: number;
  price: number;
  change24h: number;
  apy: number;
  balance: number;
  value: number;
  yieldEarned: number;
  poolShare: number;
  liquidityLabel: string;
};

export type WalletOverview = {
  address: string;
  totalValue: number;
  totalYield: number;
  lpPositions: number;
};
