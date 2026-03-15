import type { PropsWithChildren } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { config, hasPrivyConfig } from '../config';

export function AppProviders({ children }: PropsWithChildren) {
  if (!hasPrivyConfig) {
    return children;
  }

  return (
    <PrivyProvider
      appId={config.privyAppId}
      config={{
        appearance: {
          theme: 'light',
          accentColor: '#6f1d1b',
          walletChainType: 'solana-only',
          logo: undefined,
        },
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
          requireUserPasswordOnCreate: false,
          showWalletUIs: true,
        },
        loginMethods: ['wallet', 'email'],
        defaultChain: undefined,
      }}
    >
      {children}
    </PrivyProvider>
  );
}
