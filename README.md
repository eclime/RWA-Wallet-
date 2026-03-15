# RWA Wallet

Solana-based frontend scaffold for a real-world asset wallet focused on stablecoins, tokenized commodities, xStocks, and pre-IPO assets.

## Stack

- React + TypeScript + Vite
- Privy embedded wallets for Solana onboarding
- Raydium SDK v2 integration hooks for swaps and liquidity
- Helius-ready service layer for wallet and portfolio data

## Run

1. Copy `.env.example` to `.env`
2. Add your Privy app ID and Helius API key
3. Install dependencies with `npm install`
4. Start with `npm run dev`

## Deploy

This app is ready to deploy on Vercel as a public URL.

1. Import the project into Vercel or run `npx vercel`
2. Add these environment variables in Vercel:
   - `VITE_PRIVY_APP_ID`
   - `VITE_HELIUS_API_KEY`
   - `VITE_BIRDEYE_API_KEY`
3. Deploy to production

The included `vercel.json` handles the Vite build output and SPA rewrites.

## Current state

- Wallet onboarding dashboard and asset-category toggles
- Default stablecoin-first landing view
- Portfolio pricing, 24h stats, swap preview, and yield/LP surfaces
- Service stubs ready for real Privy, Raydium, and Helius logic
