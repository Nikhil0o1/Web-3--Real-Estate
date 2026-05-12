# EstateChain

Production-ready Web3 real estate platform for tokenizing properties, selling fractional ownership on Ethereum Sepolia, and distributing rental yield to investors.

EstateChain combines Solidity smart contracts, a FastAPI backend, PostgreSQL persistence, a blockchain event indexer, and static vanilla JavaScript dashboards for property owners, investors, and tenants.

## Core Capabilities

- Tokenize real estate properties with per-property ERC-20 `SecurityToken` contracts.
- Mint property deed NFTs through the shared `PropertyNFT` ERC-721 contract.
- Let investors buy property tokens with ETH through MetaMask on Sepolia.
- Let tenants pay monthly rent on-chain through the shared `RentDistribution` contract.
- Accrue and claim investor rental rewards based on ERC-20 ownership.
- Index contract events into PostgreSQL for dashboards, portfolios, rent history, and transaction reporting.
- Authenticate users with wallet signatures, JWT sessions, and role-based access control.
- Deploy the backend to Render and the static frontend to Vercel.

## Architecture

```text
Browser dashboards
  - landing auth page
  - property_owner dashboard
  - investor dashboard
  - tenant dashboard
        |
        | HTTPS JSON API + Bearer JWT
        v
FastAPI backend
  - auth routers
  - property and token routers
  - investment routers
  - rent and rewards routers
  - transaction and wallet routers
        |
        | psycopg2 / SQL
        v
PostgreSQL
  - users and auth sessions
  - properties and token ownership
  - investments and transactions
  - rent payments, distributions, payouts
  - blockchain sync state and event log

FastAPI / worker process
        |
        | Web3.py
        v
Ethereum Sepolia
  - PropertyNFT singleton
  - Escrow singleton
  - RentDistribution singleton
  - SecurityToken per property
```

The backend is the system of record for application state, but on-chain transactions remain authoritative for token purchases, rent payments, token transfers, reward accrual, and reward claims. The indexer reconciles contract events into PostgreSQL and is designed to be idempotent.

## Tech Stack

- Smart contracts: Solidity `0.8.20`, OpenZeppelin `4.9`, Hardhat.
- Blockchain network: Ethereum Sepolia, chain ID `11155111`.
- Backend: FastAPI, Uvicorn, Web3.py, psycopg2, SQLAlchemy/Alembic.
- Database: PostgreSQL.
- Frontend: static HTML/CSS/vanilla JavaScript, ethers.js `5.7`, Chart.js.
- Authentication: MetaMask `personal_sign`, backend-issued JWT sessions.
- Deployment: Render for Python web service, Vercel/static hosting for frontend.

## Repository Layout

```text
.
|-- backend/
|   |-- api/
|   |   |-- routers/              # FastAPI routers by feature area
|   |   |-- deps.py               # DB and auth dependencies
|   |   |-- schemas.py            # Pydantic request/response models
|   |   `-- routes.py             # compatibility export for aggregated router
|   |-- config/
|   |   |-- settings.py           # environment loading and validation
|   |   `-- contract-addresses.json
|   |-- db/
|   |   |-- connection.py
|   |   `-- schema.py             # startup DDL and index creation
|   |-- services/
|   |   |-- auth.py
|   |   |-- blockchain.py
|   |   |-- blockchain_indexer.py
|   |   `-- contract_loader.py
|   |-- worker/
|   |   `-- __main__.py           # standalone indexer entrypoint
|   `-- main.py                   # FastAPI app entrypoint
|-- contracts/
|   |-- SecurityToken.sol
|   |-- RentDistribution.sol
|   |-- PropertyNFT.sol
|   |-- Escrow.sol
|   |-- RentalYieldDistributor.sol
|   `-- MockUSDC.sol
|-- frontend/
|   |-- index.html                # wallet sign-in and role registration
|   |-- property_owner/
|   |-- investor/
|   |-- tenant/
|   `-- shared/                   # API, auth, web3, utilities, styles
|-- scripts/
|   |-- deploy.js
|   |-- deploy-rent-distribution.js
|   `-- generate-runtime-config.js
|-- test/
|   `-- contracts.test.js
|-- alembic.ini
|-- hardhat.config.js
|-- package.json
|-- render.yaml
|-- requirements.txt
`-- vercel.json
```

## Application Roles

`property_owner`

- Creates property records.
- Deploys per-property `SecurityToken` contracts.
- Mints property NFTs.
- Issues or transfers property tokens.
- Sets monthly rent on-chain.
- Syncs rent state and investor lists to `RentDistribution`.
- Views platform transactions, investors, rent analytics, rent payments, and distributions.

`investor`

- Browses listed properties.
- Invests in property tokens through MetaMask.
- Views wallet portfolio and token balances.
- Tracks investment transactions.
- Views rental earnings.
- Prepares and confirms on-chain reward claims.

`tenant`

- Browses rentable properties.
- Pays rent through MetaMask.
- Views active rentals, rent payment history, and tenant-scoped transactions.

Roles are bound to a wallet at registration time. The frontend enforces dashboard routing, and the backend enforces role permissions on protected endpoints.

## Smart Contracts

`PropertyNFT.sol`

- ERC-721 deed contract.
- Owner-only `mintProperty(to, tokenURI)`.
- Pausable by contract owner.

`SecurityToken.sol`

- ERC-20 token deployed once per property.
- Stores immutable `propertyId` and `salePricePerTokenWei`.
- Supports owner minting, whitelisted transfers, and primary sale purchases through `invest(propertyId, tokenAmount)`.
- Emits `InvestmentCompleted`, `WhitelistUpdated`, `DistributorUpdated`, and `TokensMinted`.
- Calls the configured distributor after token transfers.

`RentDistribution.sol`

- Shared rent and rewards contract.
- Registers each property against its token contract.
- Stores monthly rent per property.
- Tracks known investors per property.
- Accepts tenant rent through `payRent(propertyId)`.
- Accrues rewards by token balance and emits rent distribution events.
- Lets investors withdraw rewards through `claimRewards(propertyId)`.
- Emits `PropertyRegistered`, `MonthlyRentSet`, `InvestorAdded`, `RentPaid`, `InvestorPaid`, `RentDistributed`, `RewardsAccrued`, and `RewardsClaimed`.

`Escrow.sol`

- Owner-managed ETH escrow.
- Supports deal creation, payer deposits, owner releases, owner refunds, and pause controls.

`RentalYieldDistributor.sol` and `MockUSDC.sol`

- Legacy/test-support contracts retained for historical flows and Hardhat tests.

## Backend Services

The FastAPI app is defined in `backend/main.py`. On startup it validates settings, initializes database tables and indexes, mounts the static frontend if present, registers CORS middleware, and optionally starts the blockchain indexer in the same process.

Main router groups:

- Auth: `/auth/nonce`, `/auth/verify`, `/auth/register`, `/auth/me`, `/auth/logout`, `/auth/lookup/{wallet_address}`.
- System: `/health`, `/status`, `/config`, `/dashboard/summary`, `/users`.
- Properties: `/properties`, `/properties/{property_id}`, `/properties/{property_id}/deploy-token`, `/properties/{property_id}/verify-contract`, `/properties/{property_id}/mint-nft`, `/properties/{property_id}/issue-tokens`, `/properties/{property_id}/transfer`.
- Investments: `/investments/prepare`, `/investments/{investment_id}/confirm`, `/investments/{investment_id}`, `/portfolio/{wallet_address}`.
- Rent and rewards: `/properties/{property_id}/set-rent`, `/properties/{property_id}/sync-rent-chain`, `/tenant/properties`, `/tenant/pay-rent/prepare/{property_id}`, `/tenant/pay-rent/confirm/{property_id}`, `/tenant/payment-history/{wallet_address}`, `/tenant/active-rentals/{wallet_address}`, `/tenant/preview-distribution/{property_id}`, `/rewards/prepare-claim`, `/rewards/confirm-claim`, `/rewards/claimable/{wallet_address}`, `/rewards/history/{wallet_address}`, `/investor/rental-earnings/{wallet_address}`, `/investor/distributions/{wallet_address}`, `/investor/yield-summary/{wallet_address}`.
- Transactions and wallets: `/transactions`, `/wallets/{wallet_address}/balances`.

## Database Model

Database objects are created and patched at startup by `backend/db/schema.py`, with Alembic migrations also present for managed schema changes.

Primary data areas:

- Users, KYC status, wallet roles, auth nonces, and auth sessions.
- Properties, NFT metadata, token contract addresses, token prices, and rent settings.
- Token ownership snapshots by user and property.
- Investments and on-chain transaction records.
- Tenants, tenant rentals, and rent payments.
- Rent distributions and investor payout rows.
- Blockchain sync state and processed event log.

Replay safety is built around unique transaction hashes, unique event `(tx_hash, log_index)` records, and `ON CONFLICT` upserts.

## Blockchain Indexer

The indexer lives in `backend/services/blockchain_indexer.py` and can run in two modes:

- In-process with the API when `RUN_INDEXER_IN_WEB=true`.
- As a standalone process with `python -m backend.worker`.

It scans Sepolia event logs in chunks, replays a small confirmation depth, records processed events, updates token ownership, stores transactions, records rent payments and distributions, and tracks claimable or claimed rewards.

Operational safeguards:

- PostgreSQL advisory lock via `INDEXER_ADVISORY_LOCK_KEY` prevents duplicate indexers from processing the same database at the same time.
- `INDEXER_START_BLOCK` should be set to the deployment block of `RentDistribution` to avoid slow Sepolia genesis scans.
- `/status` exposes indexer status, last indexed block, environment, chain ID, database status, and RPC health.

## Frontend

The frontend is static and intentionally framework-free.

- `frontend/index.html` handles wallet sign-in and first-time role registration.
- `frontend/property_owner/` contains the property owner dashboard.
- `frontend/investor/` contains marketplace, portfolio, investment, and reward-claim flows.
- `frontend/tenant/` contains rental browsing, rent payment, and payment history flows.
- `frontend/shared/api.js` centralizes API calls, retry handling, auth headers, and JSON errors.
- `frontend/shared/auth.js` manages nonce signing, JWT persistence, logout, dashboard guards, and MetaMask account/network invalidation.
- `frontend/shared/web3.js` centralizes MetaMask, ethers.js provider setup, Sepolia checks, and common contract calls.
- `frontend/runtime-config.js` is generated at build time by `scripts/generate-runtime-config.js`.

Do not manually commit secrets into frontend files. Production frontend configuration should come from `BACKEND_URL`, `API_BASE_URL`, `CHAIN_ID`, and the generated runtime config.

## Prerequisites

- Node.js `18+` and npm.
- Python `3.11+`.
- PostgreSQL `14+` or a hosted PostgreSQL database such as Neon.
- MetaMask browser extension.
- Alchemy Sepolia RPC URL or another Sepolia-compatible RPC provider.
- A funded Sepolia deployer wallet.

## Local Setup

Clone the repository and install dependencies:

```powershell
git clone <repo-url>
cd "Real Estate Web3"
npm install
python -m venv backend\.venv
backend\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

On macOS or Linux:

```bash
git clone <repo-url>
cd "Real Estate Web3"
npm install
python -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r requirements.txt
```

Create your environment file:

```powershell
Copy-Item .env.example .env
```

Then edit `.env` with your local database, Sepolia RPC, deployer wallet, URLs, and JWT secret. Never commit real `.env` values.

## Environment Variables

Required in production:

- `DATABASE_URL`: PostgreSQL connection string.
- `SEPOLIA_RPC_URL`: Sepolia RPC URL used by Hardhat and the backend.
- `DEPLOYER_PRIVATE_KEY`: funded Sepolia private key for deployments and owner-only contract actions.
- `DEPLOY_ENV`: set to `production` in hosted environments.
- `FRONTEND_URL`: public frontend origin.
- `BACKEND_URL`: public backend origin.
- `CORS_ORIGINS`: comma-separated allowed origins.
- `AUTH_JWT_SECRET`: long random secret for signing JWT sessions.
- `INDEXER_START_BLOCK`: block where the shared rent contract was deployed.

Common optional or derived variables:

- `ALCHEMY_API_KEY`: used to build `SEPOLIA_RPC_URL` when the full URL is not provided.
- `WEB3_PROVIDER_URI`: backend Web3 provider override; defaults to `SEPOLIA_RPC_URL`.
- `CHAIN_ID`: defaults to `11155111`.
- `API_BASE_URL`: frontend runtime API override; `BACKEND_URL` is also supported.
- `CONTRACT_ADDRESSES_PATH`: defaults to `backend/config/contract-addresses.json`.
- `ARTIFACTS_DIR`: defaults to `artifacts/contracts`.
- `TOKEN_DECIMALS`: defaults to `18`.
- `RENT_TOKEN_DECIMALS`: defaults to `6`.
- `RUN_INDEXER_IN_WEB`: defaults to `true` outside production and `false` in production.
- `INDEXER_ADVISORY_LOCK_KEY`: stable 64-bit integer used by the indexer lock.
- `AUTH_JWT_ALGORITHM`: defaults to `HS256`.
- `AUTH_JWT_ISSUER`: defaults to `estatechain`.
- `AUTH_SESSION_TTL_HOURS`: defaults to `24`.
- `AUTH_NONCE_TTL_SECONDS`: defaults to `300`.
- `LOG_LEVEL`: defaults to `INFO`.

If `DATABASE_URL` is not set, the backend can build a connection from `PGUSER`, `PGPASSWORD`, `PGHOST`, `PGPORT`, and `PGDATABASE`.

## Contract Workflow

Compile contracts:

```powershell
npm run compile
```

Run Hardhat tests:

```powershell
npm test
```

Deploy shared contracts to Sepolia:

```powershell
npm run deploy:sepolia
```

The deploy script writes `backend/config/contract-addresses.json` with:

- `PropertyNFT`
- `Escrow`
- `RentDistribution`
- `Deployer`
- `DeployBlock`

Use the `DeployBlock` value as `INDEXER_START_BLOCK` for fast indexing.

Per-property `SecurityToken` contracts are not deployed by `scripts/deploy.js`. They are deployed from the property owner dashboard or `POST /properties/{property_id}/deploy-token`.

## Database Setup

Create a local PostgreSQL database if needed:

```powershell
createdb real_estate_web3
```

Apply migrations:

```powershell
alembic upgrade head
```

The API also runs startup DDL in `backend/db/schema.py` to ensure required tables, columns, indexes, and triggers exist. Alembic should still be used for controlled migration history.

## Running Locally

Generate frontend runtime config:

```powershell
npm run generate-runtime-config
```

Start the backend:

```powershell
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

In development, `RUN_INDEXER_IN_WEB=true` lets the API process start the indexer automatically.

Serve the static frontend with any static server:

```powershell
npx serve frontend
```

Then open the served frontend URL, connect MetaMask, switch to Sepolia, sign in, and choose a role for the wallet.

## End-to-End Product Flow

Property owner flow:

1. Sign in with MetaMask and register as `property_owner`.
2. Create a property record with value, token supply, symbol, token sale price, and optional rent.
3. Deploy the property `SecurityToken`.
4. Mint token inventory to the token contract or issue tokens to wallets from the dashboard.
5. Mint the property deed NFT if desired.
6. Set monthly rent.
7. Run "Sync Rent Chain" after setting rent or adding investors.

Investor flow:

1. Sign in as `investor`.
2. Browse marketplace properties.
3. Prepare an investment through the backend.
4. Confirm the MetaMask transaction calling `SecurityToken.invest`.
5. Let the backend/indexer reconcile ownership from emitted events.
6. View portfolio and rental earnings.
7. Claim available rewards through `RentDistribution.claimRewards`.

Tenant flow:

1. Sign in as `tenant`.
2. Browse rentable properties.
3. Prepare rent payment details through the backend.
4. Pay rent through MetaMask by calling `RentDistribution.payRent`.
5. Confirm the transaction with the backend.
6. View rent history and active rentals.

## Deployment

### Render Backend

`render.yaml` defines a free-tier web service named `estatechain-backend`.

The current free-tier profile runs the indexer inside the web service with `RUN_INDEXER_IN_WEB=true`. This avoids requiring a paid Render background worker, but the service can sleep when idle. On wake, indexing resumes.

Required Render environment values:

- `DATABASE_URL`
- `SEPOLIA_RPC_URL`
- `DEPLOYER_PRIVATE_KEY`
- `FRONTEND_URL`
- `BACKEND_URL`
- `CORS_ORIGINS`
- `AUTH_JWT_SECRET`
- `INDEXER_START_BLOCK`

Recommended production values:

- `DEPLOY_ENV=production`
- `RUN_INDEXER_IN_WEB=true` for Render free tier, or `false` when using a dedicated worker.
- `CHAIN_ID=11155111`
- `CONTRACT_ADDRESSES_PATH=backend/config/contract-addresses.json`
- `ARTIFACTS_DIR=artifacts/contracts`

Run migrations once after provisioning:

```powershell
alembic upgrade head
```

### Dedicated Worker Mode

For production deployments with separate processes, set:

```text
RUN_INDEXER_IN_WEB=false
```

Run the API:

```powershell
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Run the worker:

```powershell
python -m backend.worker
```

Multiple workers are safe from duplicate processing because the indexer uses a PostgreSQL advisory lock, but only one should be actively processing.

### Vercel Frontend

The frontend is served from `frontend/` through `vercel.json`. Route behavior:

- `/` serves the wallet sign-in page.
- `/property_owner` serves the property owner dashboard.
- `/investor` serves the investor dashboard.
- `/tenant` serves the tenant dashboard.
- `/admin` redirects to `/property_owner`.
- `/static/*` maps to static frontend assets.

Set Vercel environment variables:

- `BACKEND_URL` or `API_BASE_URL`: public Render backend origin, no trailing slash.
- `CHAIN_ID=11155111`
- `DEPLOY_ENV=production`

Build command:

```powershell
npm run build
```

The build runs `scripts/generate-runtime-config.js`, which writes `frontend/runtime-config.js`. On Vercel or Netlify, the build intentionally fails if no backend URL is configured.

## Operational Checklist

Before production deploy:

- Use a real hosted PostgreSQL database.
- Set a long random `AUTH_JWT_SECRET`.
- Confirm `FRONTEND_URL`, `BACKEND_URL`, and `CORS_ORIGINS` match deployed domains.
- Confirm `contract-addresses.json` contains the Sepolia contracts for this environment.
- Set `INDEXER_START_BLOCK` to the deployment block, not `0`.
- Confirm the deployer wallet owns the shared contracts or has the expected owner permissions.
- Confirm the deployer wallet has Sepolia ETH for owner-only transactions.
- Run `npm test` and `alembic upgrade head`.
- Check `/health` and `/status` after deployment.

After property creation:

- Deploy the property's `SecurityToken`.
- Mint sale inventory to the token contract itself when using primary sale investment.
- Set monthly rent before tenant payments.
- Run rent-chain sync after investors are added or rent is changed.
- Verify `/properties/{property_id}/verify-contract` before opening a property to users.

## Security Notes

- Never commit `.env` or private keys.
- `AUTH_JWT_SECRET` is required in production and must be long and random.
- Privileged backend endpoints require a valid JWT and `property_owner` role.
- Investor and tenant wallet-scoped endpoints enforce self-access unless the caller is a property owner.
- The frontend stores the JWT in localStorage and clears it when MetaMask account, chain, or connection state no longer matches.
- `SecurityToken` restricts regular transfers to whitelisted wallets.
- Contracts include `Ownable`, `Pausable`, and `ReentrancyGuard` where appropriate.
- Keep `DEPLOYER_PRIVATE_KEY` limited to the deployment/owner wallet and rotate it if exposed.

## Testing and Quality

Smart contract tests:

```powershell
npm test
```

Compile contracts:

```powershell
npm run compile
```

Backend smoke checks:

```powershell
uvicorn backend.main:app --reload --port 8000
```

Then visit:

- `http://127.0.0.1:8000/health`
- `http://127.0.0.1:8000/status`
- `http://127.0.0.1:8000/config`

There is no dedicated frontend build step beyond generating runtime config because the frontend is static.

## Troubleshooting

`Missing required environment variables`

- Check `.env`.
- In production, make sure `DATABASE_URL`, `SEPOLIA_RPC_URL`, `BACKEND_URL`, `FRONTEND_URL` or `CORS_ORIGINS`, and `AUTH_JWT_SECRET` are configured.

Frontend says backend URL is not configured

- Set `BACKEND_URL` or `API_BASE_URL` in Vercel.
- Redeploy so `frontend/runtime-config.js` is regenerated.
- Confirm the value has no trailing slash.

Browser CORS errors

- Add the frontend origin to `CORS_ORIGINS`.
- Set `FRONTEND_URL` to the exact deployed frontend origin.
- Redeploy the backend.

Indexer starts from block `0` or runs slowly

- Set `INDEXER_START_BLOCK` to the `DeployBlock` in `backend/config/contract-addresses.json`.
- Restart the API or worker.

Tenant rent prepare returns a sync error

- The property owner must call `/properties/{property_id}/sync-rent-chain`.
- Confirm the property has a token contract, monthly rent, and investors.

Investment fails with insufficient sale inventory

- Mint the property's token inventory to the `SecurityToken` contract address itself.
- Use the property owner dashboard repair/sale inventory action if available.
- Re-run `/properties/{property_id}/verify-contract`.

Wrong network warning

- Switch MetaMask to Sepolia.
- Confirm `CHAIN_ID=11155111` and runtime config has expected chain hex `0xaa36a7`.

## License

ISC
