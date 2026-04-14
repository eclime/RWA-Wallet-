import { useMemo } from 'react';
import { useLogin, usePrivy, useSolanaWallets, useWallets } from '@privy-io/react-auth';

export function useEmbeddedSolanaWallet() {
  const { ready, authenticated, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { login } = useLogin();
  const {
    wallets: solanaWallets,
    ready: solanaReady,
  } = useSolanaWallets();

  const solanaWallet = useMemo(
    () => solanaWallets[0],
    [solanaWallets],
  );

  return {
    ready: ready && solanaReady,
    authenticated,
    login,
    logout,
    user,
    solanaWallet,
    evmWallet: wallets.find(
      (wallet) => wallet.walletClientType === 'privy' || wallet.walletClientType === 'privy-v2',
    ),
  };
}
