const configuredHeliusRpcUrl =
  import.meta.env.VITE_HELIUS_RPC_URL ??
  'https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_API_KEY';

export const config = {
  privyAppId: import.meta.env.VITE_PRIVY_APP_ID ?? '',
  heliusApiKey: import.meta.env.VITE_HELIUS_API_KEY ?? '',
  birdeyeApiKey: import.meta.env.VITE_BIRDEYE_API_KEY ?? '',
  heliusRpcUrl: configuredHeliusRpcUrl.includes('YOUR_HELIUS_API_KEY') && import.meta.env.VITE_HELIUS_API_KEY
    ? configuredHeliusRpcUrl.replace('YOUR_HELIUS_API_KEY', import.meta.env.VITE_HELIUS_API_KEY)
    : configuredHeliusRpcUrl,
  jupiterApiBase: import.meta.env.VITE_JUPITER_API_BASE ?? 'https://lite-api.jup.ag/swap/v1',
  raydiumApiBase: import.meta.env.VITE_RAYDIUM_API_BASE ?? 'https://api-v3.raydium.io',
  raydiumCluster: import.meta.env.VITE_RAYDIUM_CLUSTER ?? 'mainnet',
};

export const hasPrivyConfig = Boolean(config.privyAppId);
