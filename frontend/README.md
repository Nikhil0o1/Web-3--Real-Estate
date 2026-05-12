# EstateChain — Web (Next.js)

The new EstateChain front-end. Built with **Next.js (App Router) + TypeScript + Tailwind CSS + shadcn-style components + TanStack Query + Framer Motion + Recharts + ethers v6**.

## Tech stack

- **Framework:** Next.js 14 (App Router, React 18, TypeScript strict mode)
- **Styling:** Tailwind CSS 3.4 with shadcn-flavored design tokens, dark + light themes via `next-themes`
- **Data:** TanStack Query 5 (polling 12s on dashboard surfaces) hitting the FastAPI backend at `NEXT_PUBLIC_API_BASE_URL`
- **Web3:** `ethers` v6 + raw MetaMask `window.ethereum` for `eth_requestAccounts` / `personal_sign` / `wallet_switchEthereumChain`
- **Charts:** Recharts (`BarChart`, `PieChart`, `AreaChart`)
- **Animations:** Framer Motion
- **Notifications:** `sonner`

## Required env vars

Create `.env.local` (or set on Vercel):

```bash
NEXT_PUBLIC_API_BASE_URL=https://your-backend.onrender.com
NEXT_PUBLIC_CHAIN_ID=11155111
NEXT_PUBLIC_EXPLORER_TX_BASE=https://sepolia.etherscan.io/tx/
```

`NEXT_PUBLIC_API_BASE_URL` is the only one strictly required.

## Local development

```bash
cd frontend
npm install
cp .env.example .env.local   # then edit
npm run dev                   # http://localhost:3000
```

## Routes

| Path | Description |
| ---- | ----------- |
| `/` | Landing page + wallet sign-in (`/auth/nonce` → `personal_sign` → `/auth/verify`). New wallets get a role picker that calls `/auth/register`. |
| `/property_owner/dashboard` | Properties Overview table (paginated), Token Distribution bar chart, drill-in Investor Ownership pie chart. |
| `/property_owner/properties` | Property catalog with `Create Property` and `Mint Property NFT` header dialogs and icon-only card actions. |
| `/property_owner/transactions` | Paginated transactions table with click-row dialog showing the full receipt. |
| `/property_owner/investors` | Aggregated investors table with click-row dialog showing per-property positions. |
| `/property_owner/rent` | Rent management — set rent, sync chain, view payments and distributions. |
| `/property_owner/analytics` | Stripe-style analytics: KPIs, distribution timeline, transaction breakdown, property performance. |
| `/investor`, `/tenant` | Placeholders for the next phase. |
| `/admin/*` | Permanent redirect to `/property_owner/*`. |

All data displayed in these pages comes from the existing FastAPI backend — no mock data.

## Auth

The wallet sign-in flow is preserved bit-for-bit from the legacy frontend:

1. `POST /auth/nonce` with `{ wallet_address }`
2. MetaMask `personal_sign` of the returned message
3. `POST /auth/verify` with `{ wallet_address, signature, nonce }` → `{ token, user, expires_at, is_new_user }`
4. New wallets fall through to `/auth/register` after picking a role
5. JWT is stored in `localStorage` under `estatechain.session.v1`
6. `/auth/me` is called on entering the dashboard to refresh the user record
7. MetaMask `accountsChanged` / `chainChanged` / `disconnect` invalidate the session

## Deploying to Vercel

The new app lives at `/frontend` so Vercel must use it as the **Project Root**.

In the Vercel project settings:

- **Root Directory:** `frontend`
- **Framework preset:** Next.js (auto-detected)
- **Build Command:** _(leave default)_  → `next build`
- **Output Directory:** _(leave default)_
- **Environment variables:** add `NEXT_PUBLIC_API_BASE_URL` (production + preview) and optionally `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_EXPLORER_TX_BASE`

The previous repo-root `vercel.json` (which built the legacy static frontend) has been removed; the only `vercel.json` now lives inside this folder and just declares the framework.

## Scripts

```bash
npm run dev          # Next.js dev server
npm run build        # Production build
npm run start        # Run production build
npm run lint         # next lint
npm run type-check   # tsc --noEmit
```

## Backend untouched

This rewrite touches only the front-end. All FastAPI routes, smart contracts, and the indexer are unchanged. The legacy front-end is preserved at `frontend-legacy/` for reference and can be deleted once the new UI is verified in production.
