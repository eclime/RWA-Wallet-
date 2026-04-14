import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  ArrowLeftRight,
  BarChart3,
  ChevronDown,
  X,
  Copy,
  LogOut,
  Droplets,
  Landmark,
  ArrowUpRight,
  Search,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Undo2,
  Wallet,
  History,
} from 'lucide-react';
import { hasPrivyConfig } from './config';
import rwaWalletLogo from './assets/rwa_wallet_logo.svg';
import { assets as seedAssets } from './data/assets';
import { executeJupiterSwap, getJupiterTerminalState, type JupiterQuoteResponse } from './services/jupiter';
import { useEmbeddedSolanaWallet } from './services/privy';
import { fetchLiveXStockPrices, fetchXStockHistory } from './services/pricing';
import { fetchRaydiumPairYield } from './services/raydium';
import { fetchWalletHistory, type WalletHistoryItem } from './services/history';
import {
  createActiveMnemonicWallet,
  decryptMnemonicWallet,
  encryptMnemonicWallet,
  readStoredMnemonicWallet,
  writeStoredMnemonicWallet,
  type ActiveMnemonicWallet,
} from './services/localMnemonicWallet';
import { createSolanaMnemonicWallet, type SolanaMnemonicWallet } from './services/mnemonic';
import { applyStableWalletBalances } from './services/wallet';
import type { Asset, AssetCategory } from './types';
import type { HistoryPoint, HistoryRange } from './services/pricing';

const categories: Array<{
  id: AssetCategory;
  label: string;
  description: string;
  icon: typeof Landmark;
}> = [
  { id: 'stables', label: 'Stables', description: 'USDT, USDC and cash rails', icon: ShieldCheck },
  { id: 'xstocks', label: 'xStocks', description: 'Gold, silver and tokenized RWAs', icon: Landmark },
  { id: 'prestocks', label: 'Pre-Stocks', description: 'Private market access', icon: Sparkles },
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

function formatPercent(value: number) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatChartTimestamp(timestamp?: number) {
  if (!timestamp) {
    return 'No recent timestamp';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp * 1000));
}

function formatHistoryTimestamp(timestamp?: number) {
  if (!timestamp) {
    return 'Recent';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp * 1000));
}

function formatAxisPrice(value: number) {
  const decimals = value >= 100 ? 2 : value >= 1 ? 4 : 6;
  return value.toFixed(decimals);
}

function formatAxisDate(timestamp: number, range: HistoryRange) {
  const options: Intl.DateTimeFormatOptions =
    range === '24h'
      ? { hour: 'numeric' }
      : range === '1w' || range === '1m'
        ? { month: 'short', day: 'numeric' }
        : { month: 'short', year: '2-digit' };

  return new Intl.DateTimeFormat('en-US', options).format(new Date(timestamp * 1000));
}

function shortenAddress(address?: string) {
  if (!address) {
    return '';
  }

  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function formatDisplaySymbol(asset: Asset) {
  return asset.category === 'prestocks' ? asset.symbol.replace(/\.PRE$/i, '') : asset.symbol;
}

function AssetIcon({ asset }: { asset: Asset }) {
  const isImageLogo =
    asset.logo.startsWith('http') ||
    asset.logo.startsWith('data:image') ||
    asset.logo.endsWith('.svg');

  return (
    <div className={`asset-icon asset-icon--${asset.category}`}>
      {isImageLogo ? <img src={asset.logo} alt={`${asset.symbol} logo`} /> : asset.logo}
    </div>
  );
}

function buildChartPath(points: HistoryPoint[], width: number, height: number) {
  if (points.length === 0) {
    return '';
  }

  const prices = points.map((point) => point.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const range = maxPrice - minPrice || 1;

  return points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * width;
      const y = height - ((point.price - minPrice) / range) * height;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function getChartY(price: number, minPrice: number, maxPrice: number, height: number) {
  const range = maxPrice - minPrice || 1;
  return height - ((price - minPrice) / range) * height;
}

function buildOffsetChartPath(points: HistoryPoint[], width: number, height: number, offsetX: number, offsetY: number) {
  if (points.length === 0) {
    return '';
  }

  const prices = points.map((point) => point.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const range = maxPrice - minPrice || 1;

  return points
    .map((point, index) => {
      const x = offsetX + (index / Math.max(points.length - 1, 1)) * width;
      const y = offsetY + height - ((point.price - minPrice) / range) * height;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

const historyRanges: HistoryRange[] = ['24h', '1m', '6m', '1y', 'all'];
const HERO_DISMISSED_STORAGE_KEY = 'rwa-wallet-onboarding-dismissed';
const ACTIVE_NAV_STORAGE_KEY = 'rwa-wallet-active-nav';
const SELECTED_CATEGORY_STORAGE_KEY = 'rwa-wallet-selected-category';
const WALLET_VIEW_STORAGE_KEY = 'rwa-wallet-wallet-view';
const yieldPoolSeeds = [
  { id: 'usdt-gldx', base: 'USDT', pair: 'GLDx', label: 'Gold stability pool', apr: 8.2, tvl: 1240000 },
  { id: 'usdc-nvdax', base: 'USDC', pair: 'NVDAx', label: 'AI momentum pool', apr: 10.4, tvl: 980000 },
  { id: 'usdt-tslax', base: 'USDT', pair: 'TSLAx', label: 'EV rotation pool', apr: 9.1, tvl: 860000 },
  { id: 'usdc-openai-pre', base: 'USDC', pair: 'OPENAI.PRE', label: 'Pre-IPO access pool', apr: 13.6, tvl: 540000 },
];
const searchPlaceholders: Record<AssetCategory, string> = {
  stables: 'Search Stables',
  xstocks: 'Search xStocks',
  prestocks: 'Search Pre-Stocks',
};

export default function App() {
  const [activeNav, setActiveNav] = useState<'explore' | 'liquidity' | 'wallet'>('explore');
  const [selectedCategory, setSelectedCategory] = useState<AssetCategory>('xstocks');
  const [marketAssets, setMarketAssets] = useState(seedAssets);
  const [priceStatus, setPriceStatus] = useState('Loading live xStock prices...');
  const [selectedAssetId, setSelectedAssetId] = useState(
    seedAssets.find((asset) => asset.category === 'xstocks')?.id ?? seedAssets[0].id,
  );
  const [assetSearch, setAssetSearch] = useState('');
  const [historyRange, setHistoryRange] = useState<HistoryRange>('24h');
  const [historyPoints, setHistoryPoints] = useState<HistoryPoint[]>([]);
  const [historyStatus, setHistoryStatus] = useState('Loading chart...');
  const [isBuyMode, setIsBuyMode] = useState(false);
  const [isBuyDirectionFlipped, setIsBuyDirectionFlipped] = useState(false);
  const [mobileExploreView, setMobileExploreView] = useState<'list' | 'chart' | 'swap'>('list');
  const [copyStatus, setCopyStatus] = useState('Copy');
  const [isWalletSettingsOpen, setIsWalletSettingsOpen] = useState(false);
  const [isWalletBackupPromptOpen, setIsWalletBackupPromptOpen] = useState(false);
  const [walletBackupStatus, setWalletBackupStatus] = useState('');
  const [mnemonicWallet, setMnemonicWallet] = useState<ActiveMnemonicWallet | null>(null);
  const [pendingMnemonicWallet, setPendingMnemonicWallet] = useState<SolanaMnemonicWallet | null>(null);
  const [currentMnemonicPhrase, setCurrentMnemonicPhrase] = useState('');
  const [walletPassword, setWalletPassword] = useState('');
  const [walletPasswordConfirm, setWalletPasswordConfirm] = useState('');
  const [isWalletPasswordPromptOpen, setIsWalletPasswordPromptOpen] = useState(false);
  const [walletPasswordStatus, setWalletPasswordStatus] = useState('');
  const [walletRevealPhrase, setWalletRevealPhrase] = useState('');
  const [walletRevealPassword, setWalletRevealPassword] = useState('');
  const [walletRestoreMode, setWalletRestoreMode] = useState<'unlock' | 'reveal'>('unlock');
  const [swapAmount, setSwapAmount] = useState('100');
  const [swapStatus, setSwapStatus] = useState('Enter an amount to preview the Jupiter route.');
  const [estimatedOutput, setEstimatedOutput] = useState(0);
  const [minimumReceived, setMinimumReceived] = useState(0);
  const [priceImpact, setPriceImpact] = useState(0);
  const [isSwapLoading, setIsSwapLoading] = useState(false);
  const [isSwapSubmitting, setIsSwapSubmitting] = useState(false);
  const [swapQuote, setSwapQuote] = useState<JupiterQuoteResponse | null>(null);
  const [buyRouteLabel, setBuyRouteLabel] = useState('');
  const [swapRefreshTick, setSwapRefreshTick] = useState(0);
  const [isConnectingWallet, setIsConnectingWallet] = useState(false);
  const [connectError, setConnectError] = useState('');
  const [walletActionView, setWalletActionView] = useState<'send' | 'history' | null>(null);
  const [receiveQrCode, setReceiveQrCode] = useState('');
  const [sendAddress, setSendAddress] = useState('');
  const [sendAmountValue, setSendAmountValue] = useState('');
  const [sendAssetId, setSendAssetId] = useState('');
  const [sendStatus, setSendStatus] = useState('');
  const [isSendingAsset, setIsSendingAsset] = useState(false);
  const [walletHistoryItems, setWalletHistoryItems] = useState<WalletHistoryItem[]>([]);
  const [walletHistoryStatus, setWalletHistoryStatus] = useState('Open history to view transfers and swaps.');
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isHeroDismissed, setIsHeroDismissed] = useState(false);
  const [dailyGrowth, setDailyGrowth] = useState(0);
  const [weeklyGrowth, setWeeklyGrowth] = useState(0);
  const [pairYield, setPairYield] = useState(0);
  const [preferredStableSymbol, setPreferredStableSymbol] = useState<'USDT' | 'USDC'>('USDT');
  const wallet = useEmbeddedSolanaWallet();
  const marketAssetsRef = useRef(marketAssets);
  const walletSettingsRef = useRef<HTMLDivElement | null>(null);
  const activeSolanaWallet = mnemonicWallet ?? wallet.solanaWallet ?? null;
  const walletUserId = wallet.user?.id ?? '';
  const hasStoredMnemonicWallet = walletUserId ? Boolean(readStoredMnemonicWallet(walletUserId)) : false;

  useEffect(() => {
    marketAssetsRef.current = marketAssets;
  }, [marketAssets]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!walletSettingsRef.current?.contains(event.target as Node)) {
        setIsWalletSettingsOpen(false);
      }
    }

    if (!isWalletSettingsOpen) {
      return;
    }

    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isWalletSettingsOpen]);

  const selectedAsset =
    marketAssets.find((asset) => asset.id === selectedAssetId) ?? marketAssets[0];

  const setExploreMobileView = (view: 'list' | 'chart' | 'swap') => {
    setMobileExploreView(view);
    setIsBuyMode(view === 'swap');
  };

  const visibleAssets = useMemo(
    () =>
      marketAssets.filter((asset) => {
        if (asset.category !== selectedCategory) {
          return false;
        }

        const query = assetSearch.trim().toLowerCase();
        if (!query) {
          return true;
        }

        return (
          asset.symbol.toLowerCase().includes(query) ||
          asset.name.toLowerCase().includes(query)
        );
      }),
    [marketAssets, selectedCategory, assetSearch],
  );
  const topMovers = [...marketAssets].sort((a, b) => b.change24h - a.change24h).slice(0, 3);
  const stableAssets = useMemo(
    () => marketAssets.filter((asset) => asset.category === 'stables'),
    [marketAssets],
  );
  const swappableStableAssets = useMemo(
    () => stableAssets.filter((asset) => asset.symbol === 'USDT' || asset.symbol === 'USDC'),
    [stableAssets],
  );
  const chartPath = useMemo(() => buildOffsetChartPath(historyPoints, 710, 260, 110, 30), [historyPoints]);
  useEffect(() => {
    if (!swappableStableAssets.length) {
      return;
    }

    if (!swappableStableAssets.some((asset) => asset.symbol === preferredStableSymbol)) {
      const fallbackSymbol = swappableStableAssets[0].symbol;
      if (fallbackSymbol === 'USDT' || fallbackSymbol === 'USDC') {
        setPreferredStableSymbol(fallbackSymbol);
      }
    }
  }, [preferredStableSymbol, swappableStableAssets]);

  const historyHigh = historyPoints.length ? Math.max(...historyPoints.map((point) => point.price)) : selectedAsset.price;
  const historyLow = historyPoints.length ? Math.min(...historyPoints.map((point) => point.price)) : selectedAsset.price;
  const historyStart = historyPoints[0]?.price ?? selectedAsset.price;
  const historyEnd = historyPoints[historyPoints.length - 1]?.price ?? selectedAsset.price;
  const latestTimestamp = historyPoints[historyPoints.length - 1]?.timestamp;
  const displayPrice = selectedAsset.price;
  const historyChange = historyStart ? ((displayPrice - historyStart) / historyStart) * 100 : 0;
  const quoteStableAsset =
    swappableStableAssets.find((asset) => asset.symbol === preferredStableSymbol) ??
    stableAssets.find((asset) => asset.symbol === 'USDT') ??
    stableAssets[0];
  const fallbackStableAsset = stableAssets.find((asset) => asset.symbol === 'SOL') ?? stableAssets[0];
  const primarySwapPair = useMemo(() => {
    if (selectedAsset.category === 'stables') {
      if (selectedAsset.symbol === 'SOL') {
        return {
          sendAsset: selectedAsset,
          receiveAsset: quoteStableAsset,
        };
      }

      return {
        sendAsset: fallbackStableAsset,
        receiveAsset: selectedAsset,
      };
    }

    return {
      sendAsset: quoteStableAsset,
      receiveAsset: selectedAsset,
    };
  }, [fallbackStableAsset, quoteStableAsset, selectedAsset]);
  const buySendAsset = isBuyDirectionFlipped ? primarySwapPair.receiveAsset : primarySwapPair.sendAsset;
  const buyReceiveAsset = isBuyDirectionFlipped ? primarySwapPair.sendAsset : primarySwapPair.receiveAsset;
  const buySendAmount = Number(swapAmount) || 0;
  const buyReceiveAmount = estimatedOutput;
  const walletSolBalance = stableAssets.find((asset) => asset.symbol === 'SOL')?.balance ?? 0;
  const networkFeeReserveSol = 0.00001;
  const tokenAccountCreationReserveSol =
    buyReceiveAsset.symbol !== 'SOL' && buyReceiveAsset.balance <= 0 ? 0.0021 : 0;
  const totalSolReserve = networkFeeReserveSol + tokenAccountCreationReserveSol;
  const availableSwapBalance =
    buySendAsset.symbol === 'SOL'
      ? Math.max(buySendAsset.balance - totalSolReserve, 0)
      : Math.max(buySendAsset.balance, 0);
  const needsMoreSendAsset =
    wallet.authenticated &&
    buySendAmount > 0 &&
    buySendAmount > availableSwapBalance;
  const needsMoreSolForFees =
    wallet.authenticated &&
    buySendAsset.symbol !== 'SOL' &&
    buySendAmount > 0 &&
    walletSolBalance < totalSolReserve;
  const isSwapBalanceInsufficient = needsMoreSendAsset || needsMoreSolForFees;
  const insufficientBalanceMessage = needsMoreSendAsset
    ? `Insufficient ${buySendAsset.symbol} balance. Available ${availableSwapBalance.toFixed(
        buySendAsset.symbol === 'SOL' ? 6 : 4,
      )} ${buySendAsset.symbol}${
        buySendAsset.symbol === 'SOL'
          ? tokenAccountCreationReserveSol > 0
            ? ' after reserving Solana fees and first-time token account setup.'
            : ' after reserving Solana network fees.'
          : '.'
      }`
    : needsMoreSolForFees
      ? `Insufficient SOL for network costs. This swap needs about ${totalSolReserve.toFixed(
          6,
        )} SOL${tokenAccountCreationReserveSol > 0 ? ' including first-time token account setup' : ''}, but your wallet has ${walletSolBalance.toFixed(6)} SOL.`
      : '';
  const chartTicks = useMemo(() => {
    const tickCount = 4;
    return Array.from({ length: tickCount }, (_, index) => {
      const value = historyHigh - ((historyHigh - historyLow) / (tickCount - 1 || 1)) * index;
      return Number(value.toFixed(6));
    });
  }, [historyHigh, historyLow]);
  const chartDateTicks = useMemo(() => {
    if (historyPoints.length < 2) {
      return [];
    }

    const desired = 4;
    return Array.from({ length: desired }, (_, index) => {
      const pointIndex = Math.min(
        historyPoints.length - 1,
        Math.round((index / (desired - 1)) * (historyPoints.length - 1)),
      );
      return historyPoints[pointIndex];
    });
  }, [historyPoints]);
  const currentPriceY = getChartY(
    Math.min(Math.max(displayPrice, historyLow), historyHigh),
    historyLow,
    historyHigh,
    260,
  );
  const heldAssets = useMemo(
    () =>
      marketAssets
        .filter((asset) => asset.balance > 0)
        .sort((left, right) => right.value - left.value),
    [marketAssets],
  );
  const holdingsDailyChangeValue = useMemo(
    () =>
      heldAssets.reduce((total, asset) => total + asset.value * (asset.change24h / 100), 0),
    [heldAssets],
  );
  const sendableAssets = useMemo(() => heldAssets, [heldAssets]);
  const selectedSendAsset =
    sendableAssets.find((asset) => asset.id === sendAssetId) ??
    sendableAssets[0] ??
    stableAssets.find((asset) => asset.symbol === 'SOL') ??
    marketAssets[0];
  const publicKey = activeSolanaWallet?.address ?? 'Connect wallet to reveal public key';
  const shortPublicKey = shortenAddress(activeSolanaWallet?.address);
  const walletHistoryStats = useMemo(() => {
    const incoming = walletHistoryItems.filter((item) => item.kind === 'receive').length;
    const outgoing = walletHistoryItems.filter((item) => item.kind === 'send').length;
    const swaps = walletHistoryItems.filter((item) => item.kind === 'swap').length;

    return { incoming, outgoing, swaps };
  }, [walletHistoryItems]);
  const yieldPools = yieldPoolSeeds
    .map((pool) => {
      const baseAsset = marketAssets.find((asset) => asset.symbol === pool.base);
      const pairAsset = marketAssets.find((asset) => asset.symbol === pool.pair);

      if (!baseAsset || !pairAsset) {
        return null;
      }

      return {
        ...pool,
        baseAsset,
        pairAsset,
      };
    })
    .filter((pool): pool is NonNullable<typeof pool> => Boolean(pool));

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    setIsHeroDismissed(window.localStorage.getItem(HERO_DISMISSED_STORAGE_KEY) === 'true');

    const savedNav = window.localStorage.getItem(ACTIVE_NAV_STORAGE_KEY);
    if (savedNav === 'explore' || savedNav === 'liquidity' || savedNav === 'wallet') {
      setActiveNav(savedNav);
    }

    const savedCategory = window.localStorage.getItem(SELECTED_CATEGORY_STORAGE_KEY);
    if (savedCategory === 'stables' || savedCategory === 'xstocks' || savedCategory === 'prestocks') {
      setSelectedCategory(savedCategory);
    }

    const savedWalletView = window.localStorage.getItem(WALLET_VIEW_STORAGE_KEY);
    if (savedWalletView === 'send' || savedWalletView === 'history') {
      setWalletActionView(savedWalletView);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(ACTIVE_NAV_STORAGE_KEY, activeNav);
  }, [activeNav]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(SELECTED_CATEGORY_STORAGE_KEY, selectedCategory);
  }, [selectedCategory]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (walletActionView) {
      window.localStorage.setItem(WALLET_VIEW_STORAGE_KEY, walletActionView);
    } else {
      window.localStorage.removeItem(WALLET_VIEW_STORAGE_KEY);
    }
  }, [walletActionView]);

  useEffect(() => {
    if (!wallet.authenticated) {
      setMnemonicWallet(null);
      setPendingMnemonicWallet(null);
      setCurrentMnemonicPhrase('');
      setIsWalletPasswordPromptOpen(false);
      setWalletRevealPhrase('');
      setWalletRevealPassword('');
      return;
    }

    if (!walletUserId || mnemonicWallet || !hasStoredMnemonicWallet) {
      return;
    }

    setWalletRestoreMode('unlock');
    setWalletPassword('');
    setWalletPasswordStatus('');
    setIsWalletPasswordPromptOpen(true);
  }, [hasStoredMnemonicWallet, mnemonicWallet, wallet.authenticated, walletUserId]);

  async function handleCreateMnemonicWallet() {
    setWalletBackupStatus('');

    try {
      const nextWallet = createSolanaMnemonicWallet();
      setPendingMnemonicWallet(nextWallet);
      setCurrentMnemonicPhrase(nextWallet.mnemonic);
      setWalletPassword('');
      setWalletPasswordConfirm('');
      setIsWalletBackupPromptOpen(true);
    } catch (error) {
      setConnectError(
        error instanceof Error ? error.message : 'Unable to generate a recovery phrase right now.',
      );
    }
  }

  async function handleConnectWallet() {
    if (!hasPrivyConfig || isConnectingWallet) {
      return;
    }

    if (!wallet.ready) {
      setConnectError('Privy is still loading. Please try again.');
      return;
    }

    setIsConnectingWallet(true);
    setConnectError('');

    try {
      if (!wallet.authenticated) {
        wallet.login();
        return;
      }

      if (activeSolanaWallet?.address) {
        return;
      }

      if (pendingMnemonicWallet) {
        setIsWalletBackupPromptOpen(true);
        return;
      }

      if (hasStoredMnemonicWallet) {
        setWalletRestoreMode('unlock');
        setWalletPassword('');
        setWalletPasswordStatus('');
        setIsWalletPasswordPromptOpen(true);
        return;
      }

      await handleCreateMnemonicWallet();
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : 'Unable to connect your Solana wallet.');
    } finally {
      setIsConnectingWallet(false);
    }
  }

  async function handleRevealRecoveryPhrase() {
    if (currentMnemonicPhrase) {
      setWalletBackupStatus('');
      setIsWalletSettingsOpen(false);
      setWalletRestoreMode('reveal');
      setWalletRevealPhrase(currentMnemonicPhrase);
      setWalletPasswordStatus('');
      setIsWalletPasswordPromptOpen(true);
      return;
    }

    if (pendingMnemonicWallet) {
      setWalletBackupStatus('');
      setIsWalletSettingsOpen(false);
      setIsWalletBackupPromptOpen(true);
      return;
    }

    if (!walletUserId || !hasStoredMnemonicWallet) {
      setWalletBackupStatus('Save this wallet on the current device first, then you can reveal the recovery phrase.');
      setIsWalletSettingsOpen(false);
      setIsWalletBackupPromptOpen(true);
      return;
    }

    setWalletBackupStatus('');
    setIsWalletSettingsOpen(false);
    setWalletRevealPhrase('');
    setWalletRevealPassword('');
    setWalletRestoreMode('reveal');
    setWalletPasswordStatus('');
    setIsWalletPasswordPromptOpen(true);
  }

  async function handleSaveMnemonicWallet() {
    if (!pendingMnemonicWallet || !walletUserId) {
      setWalletBackupStatus('Sign in first so this device can encrypt your wallet.');
      return;
    }

    if (walletPassword.trim().length < 8) {
      setWalletBackupStatus('Choose a device password with at least 8 characters.');
      return;
    }

    if (walletPassword !== walletPasswordConfirm) {
      setWalletBackupStatus('The device passwords do not match yet.');
      return;
    }

    setWalletBackupStatus('');

    try {
      const encryptedWallet = await encryptMnemonicWallet(
        {
          mnemonic: pendingMnemonicWallet.mnemonic,
          privateKey: pendingMnemonicWallet.privateKey,
        },
        walletPassword,
      );

      writeStoredMnemonicWallet(walletUserId, encryptedWallet);
      setMnemonicWallet(createActiveMnemonicWallet(pendingMnemonicWallet.privateKey));
      setPendingMnemonicWallet(null);
      setWalletPassword('');
      setWalletPasswordConfirm('');
      setIsWalletBackupPromptOpen(false);
      setConnectError('');
    } catch (error) {
      setWalletBackupStatus(
        error instanceof Error ? error.message : 'Unable to secure your wallet on this device.',
      );
    }
  }

  async function handleUnlockMnemonicWallet() {
    if (!walletUserId) {
      setWalletPasswordStatus('Sign in first to unlock the wallet on this device.');
      return;
    }

    const storedWallet = readStoredMnemonicWallet(walletUserId);
    if (!storedWallet) {
      setWalletPasswordStatus('No encrypted wallet was found on this device.');
      return;
    }

    if (walletRestoreMode === 'reveal' && !walletRevealPassword.trim()) {
      setWalletPasswordStatus('Enter your device password to reveal the recovery phrase.');
      return;
    }

    if (walletRestoreMode === 'unlock' && !walletPassword.trim()) {
      setWalletPasswordStatus('Enter your device password to unlock the wallet.');
      return;
    }

    setWalletPasswordStatus('');

    try {
      const decryptedWallet = await decryptMnemonicWallet(
        storedWallet,
        walletRestoreMode === 'reveal' ? walletRevealPassword : walletPassword,
      );

      if (walletRestoreMode === 'reveal') {
        setWalletRevealPhrase(decryptedWallet.mnemonic);
        setCurrentMnemonicPhrase(decryptedWallet.mnemonic);
        return;
      }

      setMnemonicWallet(createActiveMnemonicWallet(decryptedWallet.privateKey));
      setCurrentMnemonicPhrase(decryptedWallet.mnemonic);
      setWalletPassword('');
      setIsWalletPasswordPromptOpen(false);
      setConnectError('');
    } catch (error) {
      setWalletPasswordStatus(
        error instanceof Error ? error.message : 'That password could not unlock this wallet.',
      );
    }
  }

  useEffect(() => {
    let ignore = false;

    async function loadReceiveQr() {
      if (!activeSolanaWallet?.address) {
        setReceiveQrCode('');
        return;
      }

      try {
        const qrCode = await QRCode.toDataURL(activeSolanaWallet.address, {
          margin: 1,
          width: 220,
          color: {
            dark: '#17233e',
            light: '#ffffff',
          },
        });

        if (!ignore) {
          setReceiveQrCode(qrCode);
        }
      } catch {
        if (!ignore) {
          setReceiveQrCode('');
        }
      }
    }

    void loadReceiveQr();

    return () => {
      ignore = true;
    };
  }, [activeSolanaWallet?.address]);

  useEffect(() => {
    if (selectedAsset.category !== 'stables') {
      setIsBuyDirectionFlipped(false);
    }
  }, [selectedAsset]);

  useEffect(() => {
    setMobileExploreView('list');
    setIsBuyMode(false);
  }, [selectedCategory]);

  useEffect(() => {
    let ignore = false;

    async function loadLivePrices() {
      try {
        const liveAssets = await fetchLiveXStockPrices(seedAssets);
        const mergedAssets = activeSolanaWallet?.address
          ? await applyStableWalletBalances(activeSolanaWallet.address, liveAssets)
          : liveAssets;

        if (ignore) {
          return;
        }

        setMarketAssets(mergedAssets);
        setPriceStatus('Live xStock prices');
      } catch (error) {
        if (ignore) {
          return;
        }

        const fallbackAssets = activeSolanaWallet?.address
          ? await applyStableWalletBalances(activeSolanaWallet.address, seedAssets).catch(() => seedAssets)
          : seedAssets;

        setMarketAssets(fallbackAssets);
        setPriceStatus(
          error instanceof Error ? `${error.message} Showing fallback prices.` : 'Showing fallback prices.',
        );
      }
    }

    void loadLivePrices();

    return () => {
      ignore = true;
    };
  }, [activeSolanaWallet?.address]);

  useEffect(() => {
    let ignore = false;

    async function loadWalletBalances() {
      if (!activeSolanaWallet?.address) {
        setMarketAssets((currentAssets) =>
          currentAssets.map((asset) =>
            ({ ...asset, balance: 0, value: 0 })
          ),
        );
        return;
      }

      try {
        const assetsWithBalances = await applyStableWalletBalances(
          activeSolanaWallet.address,
          marketAssetsRef.current,
        );

        if (!ignore) {
          setMarketAssets(assetsWithBalances);
        }
      } catch {
        if (!ignore) {
          setMarketAssets((currentAssets) =>
            currentAssets.map((asset) =>
              ({ ...asset, balance: 0, value: 0 })
            ),
          );
        }
      }
    }

    void loadWalletBalances();

    return () => {
      ignore = true;
    };
  }, [activeSolanaWallet?.address]);

  useEffect(() => {
    let ignore = false;

    async function loadHistory() {
      setHistoryStatus('Loading chart...');

      try {
        const points = await fetchXStockHistory(selectedAsset, historyRange);

        if (ignore) {
          return;
        }

        setHistoryPoints(points);
        setHistoryStatus(points.length ? 'Live market history' : 'No chart data for this asset.');
      } catch (error) {
        if (ignore) {
          return;
        }

        setHistoryPoints([]);
        setHistoryStatus(
          error instanceof Error ? error.message : 'Unable to load historical price data.',
        );
      }
    }

    void loadHistory();

    return () => {
      ignore = true;
    };
  }, [selectedAsset, historyRange]);

  useEffect(() => {
    if (activeNav !== 'wallet' || walletActionView !== 'history') {
      return;
    }

    const walletAddress = activeSolanaWallet?.address;

    if (!walletAddress) {
      setWalletHistoryItems([]);
      setWalletHistoryStatus('Connect your wallet to load transaction history.');
      return;
    }

    let cancelled = false;

    async function loadWalletHistory() {
      try {
        setIsHistoryLoading(true);
        setWalletHistoryStatus('Loading transaction history...');
        const items = await fetchWalletHistory(walletAddress);

        if (cancelled) {
          return;
        }

        setWalletHistoryItems(items);
        setWalletHistoryStatus(items.length ? 'Recent transfers and swaps' : 'No transfers or swaps found yet.');
      } catch (error) {
        if (cancelled) {
          return;
        }

        setWalletHistoryItems([]);
        setWalletHistoryStatus(
          error instanceof Error ? error.message : 'Unable to load wallet history right now.',
        );
      } finally {
        if (!cancelled) {
          setIsHistoryLoading(false);
        }
      }
    }

    void loadWalletHistory();

    return () => {
      cancelled = true;
    };
  }, [activeNav, activeSolanaWallet?.address, walletActionView]);

  useEffect(() => {
    let ignore = false;

    async function loadSupplementalMetrics() {
      try {
        const [dailyPoints, weeklyPoints, pairYieldValue] = await Promise.all([
          fetchXStockHistory(selectedAsset, '24h').catch(() => []),
          fetchXStockHistory(selectedAsset, '1w').catch(() => []),
          fetchRaydiumPairYield(buySendAsset, buyReceiveAsset).catch(() => 0),
        ]);

        if (ignore) {
          return;
        }

        const dailyStart = dailyPoints[0]?.price ?? selectedAsset.price;
        const dailyEnd = dailyPoints[dailyPoints.length - 1]?.price ?? selectedAsset.price;
        const weeklyStart = weeklyPoints[0]?.price ?? selectedAsset.price;
        const weeklyEnd = weeklyPoints[weeklyPoints.length - 1]?.price ?? selectedAsset.price;
        const dailyChange = dailyStart ? ((dailyEnd - dailyStart) / dailyStart) * 100 : selectedAsset.change24h;
        const weeklyChange = weeklyStart ? ((weeklyEnd - weeklyStart) / weeklyStart) * 100 : 0;

        setDailyGrowth(Number.isFinite(dailyChange) ? dailyChange : selectedAsset.change24h);
        setWeeklyGrowth(Number.isFinite(weeklyChange) ? weeklyChange : 0);
        setPairYield(pairYieldValue);
      } catch {
        if (!ignore) {
          setDailyGrowth(selectedAsset.change24h);
          setWeeklyGrowth(0);
          setPairYield(0);
        }
      }
    }

    void loadSupplementalMetrics();

    return () => {
      ignore = true;
    };
  }, [buyReceiveAsset, buySendAsset, selectedAsset]);

  useEffect(() => {
    if (!sendableAssets.length) {
      setSendAssetId('');
      return;
    }

    if (!sendableAssets.some((asset) => asset.id === sendAssetId)) {
      setSendAssetId(sendableAssets[0].id);
    }
  }, [sendAssetId, sendableAssets]);

  const sendAmountNumber = Number(sendAmountValue) || 0;
  const isSendAmountInvalid = sendAmountValue.trim().length > 0 && (!Number.isFinite(sendAmountNumber) || sendAmountNumber <= 0);
  const sendSolReserve =
    selectedSendAsset?.symbol === 'SOL'
      ? 0.00001
      : 0;
  const availableSendBalance = selectedSendAsset
    ? Math.max(selectedSendAsset.balance - sendSolReserve, 0)
    : 0;
  const isSendBalanceInsufficient = sendAmountNumber > 0 && selectedSendAsset ? sendAmountNumber > availableSendBalance : false;
  const sendPreviewAmount =
    sendAmountValue.trim().length > 0 && Number.isFinite(sendAmountNumber) && sendAmountNumber > 0
      ? sendAmountNumber.toFixed(selectedSendAsset.symbol === 'SOL' ? 6 : Math.min(selectedSendAsset.tokenDecimals ?? 6, 6))
      : null;
  const sendValidationMessage = !activeSolanaWallet?.address
    ? 'Connect your wallet to send assets.'
    : !sendableAssets.length
      ? 'No wallet assets are available to send yet.'
      : !sendAddress.trim()
        ? 'Enter a recipient Solana address.'
        : isSendAmountInvalid
          ? 'Enter a valid amount to send.'
          : isSendBalanceInsufficient
            ? `Insufficient ${selectedSendAsset.symbol} balance. Available ${availableSendBalance.toFixed(
                selectedSendAsset.symbol === 'SOL' ? 6 : 4,
              )} ${selectedSendAsset.symbol}${selectedSendAsset.symbol === 'SOL' ? ' after reserving network fees.' : '.'}`
            : '';

  async function handleSendAsset() {
    if (!activeSolanaWallet?.address || !selectedSendAsset) {
      setSendStatus('Connect your wallet to send assets.');
      return;
    }

    if (sendValidationMessage) {
      setSendStatus(sendValidationMessage);
      return;
    }

    setIsSendingAsset(true);
    setSendStatus('Waiting for Privy wallet approval...');

    try {
      const { sendWalletAsset } = await import('./services/send');
      const { signature } = await sendWalletAsset({
        walletAddress: activeSolanaWallet.address,
        wallet: activeSolanaWallet,
        asset: selectedSendAsset,
        recipient: sendAddress.trim(),
        amount: sendAmountValue,
      });

      const refreshedAssets = await applyStableWalletBalances(activeSolanaWallet.address, marketAssets).catch(
        () => marketAssets,
      );
      setMarketAssets(refreshedAssets);
      setSendAmountValue('');
      setSendAddress('');
      setSendStatus(`Transfer confirmed on Solana. ${signature.slice(0, 10)}...`);
    } catch (error) {
      setSendStatus(error instanceof Error ? error.message : 'Unable to send this asset right now.');
    } finally {
      setIsSendingAsset(false);
    }
  }

  useEffect(() => {
    let ignore = false;

    async function loadSwapState() {
      setIsSwapLoading(true);

      if (isSwapBalanceInsufficient) {
        setSwapStatus(insufficientBalanceMessage);
        setEstimatedOutput(0);
        setMinimumReceived(0);
        setPriceImpact(0);
        setBuyRouteLabel(`${buySendAsset.symbol} / ${buyReceiveAsset.symbol}`);
        setSwapQuote(null);
        setIsSwapLoading(false);
        return;
      }

      try {
        const quote = await getJupiterTerminalState({
          fromAsset: buySendAsset,
          toAsset: buyReceiveAsset,
          amount: swapAmount,
        });

        if (ignore) {
          return;
        }

        setSwapStatus(quote.status);
        setEstimatedOutput(quote.estimatedOutput);
        setMinimumReceived(quote.minimumReceived);
        setPriceImpact(quote.priceImpact);
        setBuyRouteLabel(quote.routeLabel);
        setSwapQuote(quote.quote);
      } catch (error) {
        if (ignore) {
          return;
        }

        setSwapStatus(
          error instanceof Error ? error.message : 'Unable to initialize the Jupiter swap terminal.',
        );
        setEstimatedOutput(0);
        setMinimumReceived(0);
        setPriceImpact(0);
        setBuyRouteLabel(`${buySendAsset.symbol} / ${buyReceiveAsset.symbol}`);
        setSwapQuote(null);
      } finally {
        if (!ignore) {
          setIsSwapLoading(false);
        }
      }
    }

    void loadSwapState();

    return () => {
      ignore = true;
    };
  }, [buyReceiveAsset, buySendAsset, insufficientBalanceMessage, isSwapBalanceInsufficient, swapAmount, swapRefreshTick]);

  useEffect(() => {
    if (selectedAsset.category !== 'stables') {
      return;
    }

    if (buySendAsset.symbol !== 'SOL') {
      return;
    }

    if (buySendAsset.balance <= 0) {
      return;
    }

    const currentAmount = Number(swapAmount);
    if (currentAmount > 0 && currentAmount <= buySendAsset.balance) {
      return;
    }

    const suggestedAmount = Math.max(Math.min(buySendAsset.balance * 0.5, buySendAsset.balance), 0.0001);
    setSwapAmount(suggestedAmount.toFixed(4));
  }, [buySendAsset.balance, buySendAsset.symbol, selectedAsset.category, swapAmount]);

  async function handleSwapSubmit() {
    if (!wallet.authenticated || !activeSolanaWallet?.address) {
      await handleConnectWallet();
      return;
    }

    if (isSwapBalanceInsufficient) {
      setSwapStatus(insufficientBalanceMessage);
      return;
    }

    if (!swapQuote) {
      setSwapStatus('No Jupiter route is ready for this amount yet.');
      return;
    }

    setIsSwapSubmitting(true);
    setSwapStatus('Waiting for Privy wallet approval...');

    try {
      const { signature } = await executeJupiterSwap({
        walletAddress: activeSolanaWallet.address,
        quote: swapQuote,
        wallet: activeSolanaWallet,
      });

      const refreshedAssets = await applyStableWalletBalances(activeSolanaWallet.address, marketAssets).catch(
        () => marketAssets,
      );
      setMarketAssets(refreshedAssets);
      setSwapStatus(`Jupiter swap confirmed on Solana. ${signature.slice(0, 8)}...`);
    } catch (error) {
      setSwapStatus(
        error instanceof Error ? error.message : 'Jupiter swap failed before confirmation.',
      );
    } finally {
      setIsSwapSubmitting(false);
    }
  }

  function navigateToSection(section: 'explore' | 'liquidity' | 'wallet') {
    setActiveNav(section);

    if (section === 'explore') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    if (section === 'wallet') {
      document.getElementById('wallet-section')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    document.getElementById('yield-section')?.scrollIntoView({ behavior: 'smooth' });
  }

  return (
    <div className="shell">
      <aside className="rail">
        <div className="rail-brand">
          <div className="rail-logo">
            <img src={rwaWalletLogo} alt="RWA Wallet logo" />
          </div>
          <div>
            <p className="eyebrow">RWA Wallet</p>
            <strong>Solana Treasury</strong>
          </div>
        </div>
        <div className="rail-menu">
          <button
            className={activeNav === 'explore' ? 'rail-link active' : 'rail-link'}
            onClick={() => navigateToSection('explore')}
          >
            <Wallet size={18} />
            <span>Explore</span>
          </button>
          <button
            className={activeNav === 'liquidity' ? 'rail-link active' : 'rail-link'}
            onClick={() => navigateToSection('liquidity')}
          >
            <Droplets size={18} />
            <span>Yield</span>
          </button>
          <button
            className={activeNav === 'wallet' ? 'rail-link active' : 'rail-link'}
            onClick={() => navigateToSection('wallet')}
          >
            <BarChart3 size={18} />
            <span>Wallet</span>
          </button>
        </div>
        <div className="rail-note">
          <p className="eyebrow">Focus</p>
          <strong>Onboard your stable coins</strong>
          <p>Store USDT, USDC or SOL and buy xStocks and pre-IPO stocks or earn yield on your holdings.</p>
        </div>
      </aside>

      <main className="layout">
        {activeNav !== 'explore' && !isHeroDismissed && (
          <header className="topbar">
            <div className="topbar-copy">
              <p className="eyebrow">Solana RWA Wallet</p>
              <h1>Trade tokenized gold, silver, xStocks, and private-market assets from one wallet.</h1>
              <p className="hero-text">
                Your all in one onchain broker for real world assets.
              </p>
              <div className="wallet-cta-row">
                <button
                  className="primary-button"
                  disabled={!wallet.ready || !hasPrivyConfig || isConnectingWallet}
                  onClick={() => {
                    if (!hasPrivyConfig) {
                      return;
                    }

                    if (wallet.authenticated) {
                      void wallet.logout();
                      return;
                    }

                    void handleConnectWallet();
                  }}
                >
                  {hasPrivyConfig
                    ? wallet.authenticated
                      ? 'Disconnect Wallet'
                      : 'Connect Wallet'
                    : 'Add Privy App ID'}
                </button>
                <button
                  className="icon-button"
                  aria-label="Reveal recovery phrase"
                  disabled={!wallet.authenticated || !hasStoredMnemonicWallet}
                  onClick={() => {
                    if (!hasStoredMnemonicWallet) {
                      return;
                    }

                    void handleRevealRecoveryPhrase();
                  }}
                >
                  <ShieldCheck size={16} />
                </button>
              </div>
            </div>
            <div className="header-card">
              {wallet.authenticated ? (
                <button
                  className="header-close-button"
                  aria-label="Dismiss onboarding"
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      window.localStorage.setItem(HERO_DISMISSED_STORAGE_KEY, 'true');
                    }
                    setIsHeroDismissed(true);
                  }}
                >
                  <X size={16} />
                </button>
              ) : null}
              <span className="header-pill">Mainnet Ready</span>
              <p>Privy email auth + self-custody Solana wallet + Jupiter routing + Helius wallet data.</p>
              <div className="ticker-row">
                {topMovers.map((asset) => (
                  <div key={asset.id} className="ticker-pill">
                    <span>{formatDisplaySymbol(asset)}</span>
                    <strong className={asset.change24h >= 0 ? 'positive' : 'negative'}>
                      {formatPercent(asset.change24h)}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          </header>
        )}

        {activeNav === 'explore' && (
        <section className="asset-section">
          <div className="panel-heading panel-heading--asset-explorer">
            <div>
              <p className="eyebrow">Asset explorer</p>
              <h3>Toggle between stables, xStocks, and pre-stocks</h3>
            </div>
            {wallet.authenticated && activeSolanaWallet?.address ? (
              <div className="connected-wallet-chip" ref={walletSettingsRef}>
                <span>{shortPublicKey}</span>
                <button
                  className="connected-wallet-chip__copy"
                  aria-label="Copy Solana wallet address"
                  onClick={async () => {
                    const address = activeSolanaWallet?.address;
                    if (!address) {
                      return;
                    }

                    await navigator.clipboard.writeText(address);
                    setCopyStatus('Copied');
                    window.setTimeout(() => setCopyStatus('Copy'), 1500);
                  }}
                >
                  <Copy size={15} />
                    {copyStatus === 'Copied' ? 'Copied' : 'Copy'}
                </button>
                <button
                  className="wallet-logout-button"
                  type="button"
                  aria-label="Sign out"
                  title="Sign out"
                  onClick={() => {
                    setIsWalletSettingsOpen(false);
                    void wallet.logout();
                  }}
                >
                  <LogOut size={14} />
                </button>
                <button
                  className="wallet-settings-button"
                  type="button"
                  aria-label="Wallet settings"
                  aria-expanded={isWalletSettingsOpen}
                  onClick={() => setIsWalletSettingsOpen((value) => !value)}
                >
                  <Settings2 size={14} />
                </button>
                {isWalletSettingsOpen ? (
                  <div className="wallet-settings-menu" onMouseDown={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      className="wallet-settings-menu__item"
                      onClick={() => {
                        setWalletBackupStatus('');
                        void handleRevealRecoveryPhrase();
                      }}
                    >
                      {hasStoredMnemonicWallet || pendingMnemonicWallet
                        ? 'Reveal recovery phrase'
                        : 'Save wallet to reveal phrase'}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <button
                className="primary-button"
                disabled={!wallet.ready || !hasPrivyConfig || isConnectingWallet}
                onClick={() => {
                  void handleConnectWallet();
                }}
              >
                {hasPrivyConfig
                  ? isConnectingWallet
                    ? 'Connecting...'
                    : 'Connect Wallet'
                  : 'Add Privy App ID'}
              </button>
            )}
          </div>
          {connectError ? <div className="asset-connect-error">{connectError}</div> : null}

          <div className="toggle-row">
            {categories.map(({ id, label, description, icon: Icon }) => (
              <button
                key={id}
                className={id === selectedCategory ? 'toggle-chip active' : 'toggle-chip'}
                onClick={() => {
                  setSelectedCategory(id);
                  setSelectedAssetId(
                    marketAssets.find((asset) => asset.category === id)?.id ?? marketAssets[0].id,
                  );
                }}
              >
                <Icon size={16} />
                <span>{label}</span>
                <small>{description}</small>
              </button>
            ))}
          </div>

          <div className="mobile-explore-actions" aria-label="Explore view controls">
            <button
              className={mobileExploreView === 'chart' ? 'mobile-explore-action active' : 'mobile-explore-action'}
              type="button"
              onClick={() => setExploreMobileView(mobileExploreView === 'chart' ? 'list' : 'chart')}
              aria-label={mobileExploreView === 'chart' ? 'Back to asset list' : 'Open chart'}
            >
              {mobileExploreView === 'chart' ? <Undo2 size={18} /> : <BarChart3 size={18} />}
            </button>
            <button
              className={mobileExploreView === 'swap' ? 'mobile-explore-action active' : 'mobile-explore-action'}
              type="button"
              onClick={() => setExploreMobileView(mobileExploreView === 'swap' ? 'list' : 'swap')}
              aria-label={mobileExploreView === 'swap' ? 'Back to asset list' : 'Open swap'}
            >
              {mobileExploreView === 'swap' ? <Undo2 size={18} /> : <ArrowLeftRight size={18} />}
            </button>
          </div>

          <div className="asset-grid">
            <div className={mobileExploreView === 'list' ? 'asset-list-panel' : 'asset-list-panel asset-list-panel--mobile-hidden'}>
              <label className="asset-search">
                <Search size={16} />
                <input
                  type="text"
                  value={assetSearch}
                  onChange={(event) => setAssetSearch(event.target.value)}
                  placeholder={searchPlaceholders[selectedCategory]}
                />
              </label>
              <div className="asset-search-status">{priceStatus}</div>

              <div className="asset-list">
              {visibleAssets.map((asset) => (
                <button
                  key={asset.id}
                  className={selectedAsset.id === asset.id ? 'asset-row asset-row--compact active' : 'asset-row asset-row--compact'}
                  onClick={() => setSelectedAssetId(asset.id)}
                >
                  <div className="asset-row__primary">
                    <AssetIcon asset={asset} />
                    <div>
                      <strong>{formatDisplaySymbol(asset)}</strong>
                      <span>
                        {asset.name}
                        {selectedCategory === 'stables' ? ` • ${asset.balance.toFixed(asset.symbol === 'SOL' ? 3 : 2)} ${asset.symbol}` : ''}
                      </span>
                    </div>
                  </div>
                  <div className="asset-row__stats">
                    {selectedCategory === 'stables' ? (
                      <>
                        <strong>{formatCurrency(asset.balance * asset.price)}</strong>
                        <span>Held in wallet</span>
                      </>
                    ) : (
                      <>
                        <strong>{formatCurrency(asset.price)}</strong>
                        <span className={asset.change24h >= 0 ? 'positive' : 'negative'}>
                          {formatPercent(asset.change24h)}
                        </span>
                      </>
                    )}
                  </div>
                </button>
              ))}
              </div>
            </div>

            <article className={mobileExploreView === 'list' ? 'asset-detail asset-detail--mobile-hidden' : 'asset-detail'}>
              <div className="asset-detail__header">
                <div className="asset-detail__title">
                  <AssetIcon asset={selectedAsset} />
                  <div>
                    <p className="eyebrow">Selected asset</p>
                    <h4>{selectedAsset.name}</h4>
                  </div>
                </div>
                <button
                  className="price-pill price-pill--button"
                  onClick={() => setIsBuyMode((value) => !value)}
                >
                  {isBuyMode ? 'Back' : 'Buy'}
                </button>
              </div>

              <div className="detail-metrics" key={`${selectedAsset.id}-${historyRange}`}>
                <div>
                  <span>24h</span>
                  <strong className={dailyGrowth >= 0 ? 'positive' : 'negative'}>
                    {formatPercent(dailyGrowth)}
                  </strong>
                </div>
                <div>
                  <span>1w</span>
                  <strong className={weeklyGrowth >= 0 ? 'positive' : 'negative'}>
                    {formatPercent(weeklyGrowth)}
                  </strong>
                </div>
                <div>
                  <span>Pair yield</span>
                  <strong>{formatPercent(pairYield)}</strong>
                </div>
              </div>

              <div className={isBuyMode ? 'asset-flip-card flipped' : 'asset-flip-card'}>
                <div className="asset-flip-card__inner">
                  <div className="asset-flip-face asset-flip-face--front">
                    <div className="history-card">
                      <div className="history-toolbar">
                        <div className="history-headline">
                          <span className="history-pair">{formatDisplaySymbol(selectedAsset)}/USD</span>
                          <strong>{formatCurrency(displayPrice)}</strong>
                          <p className="history-timestamp">{formatChartTimestamp(latestTimestamp)}</p>
                          <span className={historyChange >= 0 ? 'history-change positive' : 'history-change negative'}>
                            {formatPercent(historyChange)} for {historyRange}
                          </span>
                        </div>
                        <div className="history-toolbar__actions">
                          <div className="history-range-chips">
                            {historyRanges.map((range) => (
                              <button
                                key={range}
                                className={historyRange === range ? 'history-chip active' : 'history-chip'}
                                onClick={() => setHistoryRange(range)}
                              >
                                {range}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="history-chart-frame">
                        {historyPoints.length > 1 ? (
                          <svg viewBox="0 0 860 340" className="history-chart" preserveAspectRatio="none">
                            <defs>
                              <linearGradient id="historyFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="rgba(20, 41, 72, 0.18)" />
                                <stop offset="100%" stopColor="rgba(20, 41, 72, 0.03)" />
                              </linearGradient>
                            </defs>
                            {chartTicks.map((tick) => {
                              const y = getChartY(tick, historyLow, historyHigh, 260) + 30;
                              return (
                                <g key={tick}>
                                  <text x="18" y={y + 6} className="history-axis-label">
                                    {formatAxisPrice(tick)}
                                  </text>
                                  <line
                                    x1="110"
                                    y1={y}
                                    x2="820"
                                    y2={y}
                                    className="history-grid-line"
                                  />
                                </g>
                              );
                            })}
                            <line
                              x1="110"
                              y1={currentPriceY + 30}
                              x2="820"
                              y2={currentPriceY + 30}
                              className="history-current-line"
                            />
                            <rect
                              x="8"
                              y={currentPriceY + 14}
                              width="76"
                              height="32"
                              rx="8"
                              className="history-current-pill"
                            />
                            <text x="46" y={currentPriceY + 35} textAnchor="middle" className="history-current-pill-text">
                              {formatAxisPrice(displayPrice)}
                            </text>
                            <path
                              d={`${chartPath} L 820 290 L 110 290 Z`}
                              fill="url(#historyFill)"
                              stroke="none"
                            />
                            <path
                              d={chartPath}
                              fill="none"
                              stroke="#0b6bff"
                              strokeWidth="4"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            {chartDateTicks.map((point, index) => {
                              const x = 110 + (index / Math.max(chartDateTicks.length - 1, 1)) * 710;
                              return (
                                <text key={`${point.timestamp}-${index}`} x={x} y="326" textAnchor="middle" className="history-date-label">
                                  {formatAxisDate(point.timestamp, historyRange)}
                                </text>
                              );
                            })}
                          </svg>
                        ) : (
                          <div className="history-empty">Chart data unavailable for this range.</div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="asset-flip-face asset-flip-face--back">
                    <div className="buy-card">
                      <div className="buy-card__header">
                        <h5>Swap tokens</h5>
                        <div className="buy-card__actions">
                          <button
                            className="buy-icon-button"
                            aria-label="Refresh quote"
                            onClick={() => {
                              setSwapStatus('Refreshing Jupiter quote...');
                              setSwapRefreshTick((value) => value + 1);
                            }}
                          >
                            <RefreshCw size={18} />
                          </button>
                          <button className="buy-icon-button" aria-label="Flip back" onClick={() => setIsBuyMode(false)}>
                            <ArrowLeftRight size={18} />
                          </button>
                          <button className="buy-icon-button" aria-label="Settings">
                            <Settings2 size={18} />
                          </button>
                        </div>
                      </div>

                      <div className="buy-leg">
                        <span className="buy-leg__label">You send</span>
                        <div className="buy-leg__row">
                          <div className="buy-token">
                            <AssetIcon asset={buySendAsset} />
                            {buySendAsset.category === 'stables' &&
                            (buySendAsset.symbol === 'USDT' || buySendAsset.symbol === 'USDC') &&
                            swappableStableAssets.length > 1 ? (
                              <label className="buy-token-select">
                                <select
                                  value={preferredStableSymbol}
                                  onChange={(event) => {
                                    const nextSymbol = event.target.value;
                                    if (nextSymbol === 'USDT' || nextSymbol === 'USDC') {
                                      setPreferredStableSymbol(nextSymbol);
                                    }
                                  }}
                                >
                                  {swappableStableAssets.map((asset) => (
                                    <option key={asset.id} value={asset.symbol}>
                                      {asset.symbol}
                                    </option>
                                  ))}
                                </select>
                                <ChevronDown size={16} />
                              </label>
                            ) : (
                              <strong>{buySendAsset.symbol}</strong>
                            )}
                          </div>
                          <div className="buy-amount">
                            <input
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={swapAmount}
                              onChange={(event) => {
                                const nextValue = event.target.value.replace(/[^0-9.]/g, '');
                                const normalizedValue = nextValue.replace(/^(\d*\.\d*).*$/, '$1');
                                setSwapAmount(normalizedValue);
                              }}
                              placeholder="0.00"
                            />
                            <small>
                              {formatCurrency(buySendAmount * buySendAsset.price)}
                            </small>
                          </div>
                        </div>
                        <div className="buy-leg__meta">
                          <span>
                            Available {buySendAsset.balance.toFixed(buySendAsset.symbol === 'SOL' ? 6 : 4)} {buySendAsset.symbol}
                          </span>
                          {buySendAsset.balance > 0 ? (
                            <button
                              type="button"
                              className="buy-max-button"
                              onClick={() => {
                                const maxAmount =
                                  buySendAsset.symbol === 'SOL'
                                    ? availableSwapBalance
                                    : buySendAsset.balance;

                                setSwapAmount(
                                  Math.max(maxAmount, 0).toFixed(buySendAsset.symbol === 'SOL' ? 6 : 4),
                                );
                              }}
                            >
                              Max
                            </button>
                          ) : null}
                        </div>
                      </div>

                      <div className="buy-divider">
                        <button
                          className="buy-switch-button"
                          aria-label="Swap direction"
                          onClick={() => setIsBuyDirectionFlipped((value) => !value)}
                        >
                          <ArrowLeftRight size={18} />
                        </button>
                      </div>

                      <div className="buy-leg">
                        <span className="buy-leg__label">You receive</span>
                        <div className="buy-leg__row">
                          <div className="buy-token">
                            <AssetIcon asset={buyReceiveAsset} />
                            {buyReceiveAsset.category === 'stables' &&
                            (buyReceiveAsset.symbol === 'USDT' || buyReceiveAsset.symbol === 'USDC') &&
                            swappableStableAssets.length > 1 ? (
                              <label className="buy-token-select">
                                <select
                                  value={preferredStableSymbol}
                                  onChange={(event) => {
                                    const nextSymbol = event.target.value;
                                    if (nextSymbol === 'USDT' || nextSymbol === 'USDC') {
                                      setPreferredStableSymbol(nextSymbol);
                                    }
                                  }}
                                >
                                  {swappableStableAssets.map((asset) => (
                                    <option key={asset.id} value={asset.symbol}>
                                      {asset.symbol}
                                    </option>
                                  ))}
                                </select>
                                <ChevronDown size={16} />
                              </label>
                            ) : (
                              <strong>{buyReceiveAsset.symbol}</strong>
                            )}
                          </div>
                          <div className="buy-amount buy-amount--readonly">
                            <strong>{buyReceiveAmount.toFixed(4)}</strong>
                            <small>
                              {formatCurrency(buyReceiveAmount * buyReceiveAsset.price)}
                            </small>
                          </div>
                        </div>
                      </div>

                      <div className="buy-route">
                        <div className="buy-route__text">
                          <strong>Jupiter route</strong>
                          <span>{swapStatus}</span>
                          <span>{buySendAsset.symbol} / {buyReceiveAsset.symbol}</span>
                          {isSwapBalanceInsufficient ? (
                            <span className="buy-route-error">{insufficientBalanceMessage}</span>
                          ) : null}
                        </div>
                        <button
                          className="buy-route__badge"
                          disabled={
                            isSwapLoading ||
                            isSwapSubmitting ||
                            (wallet.authenticated && (!swapQuote || isSwapBalanceInsufficient))
                          }
                          onClick={() => {
                            void handleSwapSubmit();
                          }}
                        >
                          {isSwapSubmitting ? 'Signing...' : 'Swap'}
                        </button>
                      </div>

                      <div className="buy-route-meta">
                        <span>Min received {minimumReceived.toFixed(4)} {buyReceiveAsset.symbol}</span>
                        <span>Price impact {priceImpact.toFixed(2)}%</span>
                      </div>

                      <button
                        className="buy-submit-button"
                        disabled={
                          isSwapLoading ||
                          isSwapSubmitting ||
                          (wallet.authenticated && (!swapQuote || isSwapBalanceInsufficient))
                        }
                        onClick={() => {
                          void handleSwapSubmit();
                        }}
                      >
                        {isSwapSubmitting
                          ? 'Signing...'
                          : wallet.authenticated
                            ? `Swap ${buySendAsset.symbol} for ${buyReceiveAsset.symbol}`
                            : 'Connect Wallet'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </section>
        )}

        {activeNav === 'liquidity' && (
          <section className="bottom-grid">
            <article className="panel yield-panel" id="yield-section">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Yield investments</p>
                  <h3>Stablecoin pools paired with xStocks and pre-stocks</h3>
                </div>
              </div>

              <div className="yield-pools">
                {yieldPools.map((pool) => (
                  <div className="yield-pool-card" key={pool.id}>
                    <div className="yield-pool-card__head">
                      <div className="yield-pool-icons">
                        <AssetIcon asset={pool.baseAsset} />
                        <AssetIcon asset={pool.pairAsset} />
                      </div>
                      <button className="primary-button yield-add-button">Add</button>
                    </div>
                    <div className="yield-pool-card__body">
                      <strong>{pool.baseAsset.symbol} / {pool.pairAsset.symbol}</strong>
                      <span>{pool.label}</span>
                    </div>
                    <div className="yield-pool-stats">
                      <div>
                        <span>APR</span>
                        <strong>{formatPercent(pool.apr)}</strong>
                      </div>
                      <div>
                        <span>TVL</span>
                        <strong>{formatCurrency(pool.tvl)}</strong>
                      </div>
                      <div>
                        <span>Status</span>
                        <strong>Open</strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="yield-vaults">
                <div>
                  <p className="eyebrow">Vaults</p>
                  <h4>Coming soon</h4>
                </div>
                <p>Automated yield vaults for single-sided stables and curated RWA baskets will land here next.</p>
              </div>
            </article>
          </section>
        )}

        {activeNav === 'wallet' && (
        <section className="bottom-grid">
          <article className="panel wallet-panel" id="wallet-section">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Wallet</p>
                <h3>Holdings</h3>
              </div>
            </div>
            <div className="wallet-overview">
              <div className="wallet-actions-card">
                <div className="wallet-actions-head">
                  <div className="wallet-action-buttons">
                    <button
                      className="wallet-history-button"
                      type="button"
                      aria-label={walletActionView === 'history' ? 'Back to wallet holdings' : 'Transaction and swap history'}
                      title={walletActionView === 'history' ? 'Back to wallet holdings' : 'Transaction and swap history'}
                      onClick={() => setWalletActionView((view) => (view === 'history' ? null : 'history'))}
                    >
                      {walletActionView === 'history' ? <Undo2 size={16} /> : <History size={16} />}
                    </button>
                    <div className="wallet-public-key__pill" ref={walletSettingsRef}>
                      <strong>{activeSolanaWallet?.address ? shortenAddress(activeSolanaWallet.address) : publicKey}</strong>
                      <button
                        className="wallet-public-key__copy"
                        disabled={!activeSolanaWallet?.address}
                        onClick={async () => {
                          if (!activeSolanaWallet?.address) {
                            return;
                          }

                          await navigator.clipboard.writeText(activeSolanaWallet.address);
                          setCopyStatus('Copied');
                          window.setTimeout(() => setCopyStatus('Copy'), 1500);
                        }}
                      >
                        <Copy size={18} />
                        {copyStatus}
                      </button>
                      <button
                        className="wallet-logout-button"
                        type="button"
                        aria-label="Sign out"
                        title="Sign out"
                        onClick={() => {
                          setIsWalletSettingsOpen(false);
                          void wallet.logout();
                        }}
                      >
                        <LogOut size={14} />
                      </button>
                      <button
                        className="wallet-settings-button"
                        type="button"
                        aria-label="Wallet settings"
                        aria-expanded={isWalletSettingsOpen}
                        onClick={() => setIsWalletSettingsOpen((value) => !value)}
                      >
                        <Settings2 size={14} />
                      </button>
                      {isWalletSettingsOpen ? (
                        <div className="wallet-settings-menu wallet-settings-menu--wallet" onMouseDown={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            className="wallet-settings-menu__item"
                            onClick={() => {
                              setWalletBackupStatus('');
                              void handleRevealRecoveryPhrase();
                            }}
                          >
                            {hasStoredMnemonicWallet || pendingMnemonicWallet
                              ? 'Reveal recovery phrase'
                              : 'Save wallet to reveal phrase'}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <button
                      className={walletActionView === 'send' ? 'secondary-button active' : 'secondary-button'}
                      disabled={!activeSolanaWallet?.address}
                      onClick={() => setWalletActionView((view) => (view === 'send' ? null : 'send'))}
                    >
                      <ArrowUpRight size={16} />
                      Send
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {walletActionView === 'history' ? (
              <div className="wallet-history-screen">
                <div className="wallet-history-screen__header">
                  <div>
                    <strong>Transaction history</strong>
                    <span>Incoming transfers, outgoing transfers, and past swaps for {shortenAddress(activeSolanaWallet?.address)}.</span>
                  </div>
                  <span>{walletHistoryItems.length} entries</span>
                </div>
                <div className="wallet-history-summary">
                  <div className="wallet-history-summary__card">
                    <span>Incoming</span>
                    <strong>{walletHistoryStats.incoming}</strong>
                  </div>
                  <div className="wallet-history-summary__card">
                    <span>Outgoing</span>
                    <strong>{walletHistoryStats.outgoing}</strong>
                  </div>
                  <div className="wallet-history-summary__card">
                    <span>Swaps</span>
                    <strong>{walletHistoryStats.swaps}</strong>
                  </div>
                </div>
                <div className="wallet-history-status">
                  {isHistoryLoading ? 'Loading...' : walletHistoryStatus}
                </div>
                {walletHistoryItems.length ? (
                  <div className="wallet-history-list wallet-history-list--screen">
                    {walletHistoryItems.map((item) => (
                      <div className={`wallet-history-row wallet-history-row--${item.kind}`} key={item.signature}>
                        <div className="wallet-history-row__left">
                          <strong>{item.title}</strong>
                          <span>{item.detail}</span>
                        </div>
                        <div className="wallet-history-row__right">
                          <strong>{item.amountLabel}</strong>
                          <span>{formatHistoryTimestamp(item.timestamp)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="wallet-empty wallet-empty--history">
                    <strong>No history yet</strong>
                    <span>{walletHistoryStatus}</span>
                  </div>
                )}
              </div>
            ) : walletActionView === 'send' ? (
              <div className="wallet-history-screen wallet-send-screen">
                <div className="wallet-history-screen__header">
                  <div>
                    <strong>Send from your wallet</strong>
                    <span>Offline powered by Pollinet.</span>
                  </div>
                </div>
                <div className="wallet-send-card wallet-send-card--screen">
                  <div className="wallet-send-preview">
                    <div className="wallet-send-preview__row">
                      <span>You send</span>
                      <strong>{sendPreviewAmount ? `${sendPreviewAmount} ${selectedSendAsset.symbol}` : `0 ${selectedSendAsset.symbol}`}</strong>
                    </div>
                    <div className="wallet-send-preview__row">
                      <span>To</span>
                      <strong>{sendAddress.trim() ? shortenAddress(sendAddress.trim()) : 'Add recipient'}</strong>
                    </div>
                  </div>
                  <label className="wallet-send-field">
                    <span>Asset</span>
                    <select
                      value={selectedSendAsset?.id ?? ''}
                      onChange={(event) => {
                        setSendAssetId(event.target.value);
                        setSendStatus('');
                      }}
                      disabled={!sendableAssets.length || isSendingAsset}
                    >
                      {sendableAssets.length ? (
                        sendableAssets.map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {formatDisplaySymbol(asset)} · {asset.balance.toFixed(asset.symbol === 'SOL' ? 6 : 4)}
                          </option>
                        ))
                      ) : (
                        <option value="">No sendable assets</option>
                      )}
                    </select>
                  </label>
                  <label className="wallet-send-field">
                    <span>Recipient address</span>
                    <input
                      type="text"
                      value={sendAddress}
                      onChange={(event) => {
                        setSendAddress(event.target.value);
                        setSendStatus('');
                      }}
                      placeholder="Enter Solana address"
                      disabled={isSendingAsset}
                    />
                  </label>
                  <label className="wallet-send-field">
                    <span>Amount</span>
                    <input
                      type="number"
                      min="0"
                      step="0.0001"
                      value={sendAmountValue}
                      onChange={(event) => {
                        setSendAmountValue(event.target.value);
                        setSendStatus('');
                      }}
                      placeholder="0.00"
                      disabled={isSendingAsset}
                    />
                  </label>
                  <div className="wallet-send-card__meta">
                    <span>
                      Available {selectedSendAsset.balance.toFixed(selectedSendAsset.symbol === 'SOL' ? 6 : 4)} {selectedSendAsset.symbol}
                    </span>
                    {selectedSendAsset.balance > 0 ? (
                      <button
                        type="button"
                        className="wallet-send-max"
                        onClick={() => {
                          setSendAmountValue(
                            selectedSendAsset.balance.toFixed(selectedSendAsset.symbol === 'SOL' ? 6 : 4),
                          );
                          setSendStatus('');
                        }}
                        disabled={isSendingAsset}
                      >
                        Max
                      </button>
                    ) : null}
                  </div>
                  {sendStatus ? (
                    <div className={sendStatus.startsWith('Transfer confirmed') ? 'wallet-send-status success' : 'wallet-send-status'}>
                      {sendStatus}
                    </div>
                  ) : null}
                  <button
                    className="primary-button"
                    disabled={Boolean(sendValidationMessage) || isSendingAsset}
                    onClick={() => {
                      void handleSendAsset();
                    }}
                  >
                    {isSendingAsset
                      ? 'Sending...'
                      : sendPreviewAmount
                        ? `Send ${sendPreviewAmount} ${selectedSendAsset.symbol}`
                        : `Send ${selectedSendAsset.symbol}`}
                  </button>
                </div>
              </div>
            ) : (
              <div className="wallet-holdings">
                <div className="wallet-holdings__header">
                  <strong>Held assets</strong>
                  <div className="wallet-holdings__stats">
                    <span>{heldAssets.length} positions</span>
                    <span className={holdingsDailyChangeValue >= 0 ? 'positive' : 'negative'}>
                      24h growth {formatCurrency(holdingsDailyChangeValue)}
                    </span>
                  </div>
                </div>
                {wallet.authenticated ? (
                  heldAssets.length > 0 ? (
                    <div className="wallet-holdings__list">
                      {heldAssets.map((asset) => (
                        <div className="wallet-holding-row" key={asset.id}>
                          <div className="wallet-holding-row__left">
                            <AssetIcon asset={asset} />
                            <div>
                              <strong>{formatDisplaySymbol(asset)}</strong>
                              <span>{asset.balance}</span>
                            </div>
                          </div>
                          <strong>{formatCurrency(asset.value)}</strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="wallet-empty">
                      <strong>No assets held yet</strong>
                      <span>Your wallet is connected, but there are currently no positions to display.</span>
                    </div>
                  )
                ) : (
                  <div className="wallet-empty">
                    <strong>No assets held yet</strong>
                    <span>Connect your wallet to reveal your public key and future balances.</span>
                  </div>
                )}
              </div>
            )}
          </article>

        </section>
        )}

        {isWalletBackupPromptOpen ? (
          <div className="seed-phrase-modal" role="dialog" aria-modal="true" aria-labelledby="seed-phrase-title">
            <div className="seed-phrase-modal__backdrop" onClick={() => setIsWalletBackupPromptOpen(false)} />
            <div className="seed-phrase-modal__card">
              <button
                className="seed-phrase-modal__close"
                type="button"
                aria-label="Close wallet backup prompt"
                onClick={() => setIsWalletBackupPromptOpen(false)}
              >
                <X size={16} />
              </button>
              <p className="eyebrow">Wallet backup</p>
              <h3 id="seed-phrase-title">Write down your recovery phrase</h3>
              <p>
                This wallet is generated in your browser from a real Solana mnemonic. Write the phrase down offline first. Saving it on this device with a password is optional.
              </p>
              {pendingMnemonicWallet ? (
                <div className="seed-phrase-grid" aria-label="Recovery phrase">
                  {pendingMnemonicWallet.mnemonic.split(' ').map((word, index) => (
                    <div key={`${word}-${index}`} className="seed-phrase-grid__item">
                      <span>{index + 1}</span>
                      <strong>{word}</strong>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="seed-phrase-modal__optional">
                <strong>Optional: save on this device</strong>
                <span>Add a password only if you want this browser to remember the wallet and let you reveal the phrase again later.</span>
              </div>
              <div className="seed-phrase-modal__field-group">
                <label className="seed-phrase-modal__field">
                  <span>Device password</span>
                  <input
                    type="password"
                    value={walletPassword}
                    onChange={(event) => setWalletPassword(event.target.value)}
                    placeholder="At least 8 characters"
                  />
                </label>
                <label className="seed-phrase-modal__field">
                  <span>Confirm password</span>
                  <input
                    type="password"
                    value={walletPasswordConfirm}
                    onChange={(event) => setWalletPasswordConfirm(event.target.value)}
                    placeholder="Repeat password"
                  />
                </label>
              </div>
              <div className="seed-phrase-modal__note">
                <strong>Important</strong>
                <span>Never put this phrase in chat, screenshots, cloud notes, or analytics. Skipping the password only means this browser will not remember it after the session ends.</span>
              </div>
              {walletBackupStatus ? <div className="wallet-send-status">{walletBackupStatus}</div> : null}
              <div className="seed-phrase-modal__actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setIsWalletBackupPromptOpen(false)}
                >
                  Later
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    void handleSaveMnemonicWallet();
                  }}
                >
                  Save on this device
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {isWalletPasswordPromptOpen ? (
          <div className="seed-phrase-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-password-title">
            <div className="seed-phrase-modal__backdrop" onClick={() => setIsWalletPasswordPromptOpen(false)} />
            <div className="seed-phrase-modal__card">
              <button
                className="seed-phrase-modal__close"
                type="button"
                aria-label="Close wallet password prompt"
                onClick={() => {
                  setIsWalletPasswordPromptOpen(false);
                  setWalletRevealPhrase('');
                }}
              >
                <X size={16} />
              </button>
              <p className="eyebrow">{walletRestoreMode === 'unlock' ? 'Unlock wallet' : 'Reveal phrase'}</p>
              <h3 id="wallet-password-title">
                {walletRestoreMode === 'unlock' ? 'Unlock your Solana wallet' : 'Reveal your recovery phrase'}
              </h3>
              <p>
                {walletRestoreMode === 'unlock'
                  ? 'Enter the device password you chose when this wallet was saved on this browser.'
                  : 'Re-enter your device password before the recovery phrase is shown.'}
              </p>
              {walletRevealPhrase ? (
                <div className="seed-phrase-grid" aria-label="Stored recovery phrase">
                  {walletRevealPhrase.split(' ').map((word, index) => (
                    <div key={`${word}-${index}`} className="seed-phrase-grid__item">
                      <span>{index + 1}</span>
                      <strong>{word}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <label className="seed-phrase-modal__field">
                  <span>Device password</span>
                  <input
                    type="password"
                    value={walletRestoreMode === 'unlock' ? walletPassword : walletRevealPassword}
                    onChange={(event) => {
                      if (walletRestoreMode === 'unlock') {
                        setWalletPassword(event.target.value);
                      } else {
                        setWalletRevealPassword(event.target.value);
                      }
                    }}
                    placeholder="Enter your password"
                  />
                </label>
              )}
              <div className="seed-phrase-modal__note">
                <strong>Security</strong>
                <span>The recovery phrase is stored encrypted on this device only and is decrypted locally in your browser when you enter the right password.</span>
              </div>
              {walletPasswordStatus ? <div className="wallet-send-status">{walletPasswordStatus}</div> : null}
              <div className="seed-phrase-modal__actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setIsWalletPasswordPromptOpen(false);
                    setWalletRevealPhrase('');
                  }}
                >
                  Close
                </button>
                {!walletRevealPhrase ? (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      void handleUnlockMnemonicWallet();
                    }}
                  >
                    {walletRestoreMode === 'unlock' ? 'Unlock wallet' : 'Reveal phrase'}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </main>
      <nav className="mobile-tabbar" aria-label="Primary">
        <button
          className={activeNav === 'explore' ? 'mobile-tabbar__button active' : 'mobile-tabbar__button'}
          onClick={() => navigateToSection('explore')}
        >
          <Wallet size={20} />
          <span>Explore</span>
        </button>
        <button
          className={activeNav === 'liquidity' ? 'mobile-tabbar__button active' : 'mobile-tabbar__button'}
          onClick={() => navigateToSection('liquidity')}
        >
          <Droplets size={20} />
          <span>Yield</span>
        </button>
        <button
          className={activeNav === 'wallet' ? 'mobile-tabbar__button active' : 'mobile-tabbar__button'}
          onClick={() => navigateToSection('wallet')}
        >
          <BarChart3 size={20} />
          <span>Wallet</span>
        </button>
      </nav>
    </div>
  );
}
