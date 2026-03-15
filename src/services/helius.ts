import type { WalletOverview } from '../types';
import { config } from '../config';

export async function getWalletOverview(address?: string): Promise<WalletOverview> {
  if (!address || !config.heliusApiKey) {
    return {
      address: address ?? 'Not connected',
      totalValue: 0,
      totalYield: 0,
      lpPositions: 0,
    };
  }

  return {
    address,
    totalValue: 0,
    totalYield: 0,
    lpPositions: 0,
  };
}
