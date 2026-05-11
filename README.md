# EstateChain — Tokenized Real Estate on Ethereum Sepolia

A full-stack dApp that tokenizes real estate properties as ERC-20 security tokens, enables fractional investment, and automates rent distribution to investors proportional to their on-chain ownership.

## What It Does

- **Property Tokenization**: Each property is represented by a dedicated ERC-20 `SecurityToken` deployed on Ethereum Sepolia.
- **Fractional Investment**: Investors purchase property tokens using ETH. Ownership is recorded on-chain and reflected in the PostgreSQL backend.
- **Automated Rent Distribution**: Tenants pay rent directly to the `RentDistribution` smart contract, which automatically splits ETH to all token holders based on their proportional balance.
- **Event-Driven Indexing**: A dedicated blockchain indexer worker listens for `RentPaid`, `InvestorPaid`, `RentDistributed`, `InvestmentCompleted`, and `Transfer` events, reconciling on-chain state into the database deterministically.
- **Live Dashboards**: Separate vanilla-JS dashboards for Admin, Investor, and Tenant roles, reading exclusively from the backend API.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Smart Contracts | Solidity 0.8.20, OpenZeppelin, Hardhat |
| Blockchain | Ethereum Sepolia (Chain ID 11155111) |
| Backend API | FastAPI (Python), Uvicorn |
| Blockchain Integration | Web3.py |
| Database | PostgreSQL + SQLAlchemy + Alembic migrations |
| Event Indexer | Python background worker with PostgreSQL advisory locks |
| Frontend | Vanilla JavaScript, MetaMask wallet integration |
| Deployment | Render (web + worker), Vercel (frontend) |

## Architecture Overview

```
┌─────────────┐      ┌──────────────┐      ┌─────────────────┐
│  Frontend   │──────▶│ FastAPI      │──────▶│  PostgreSQL     │
│  (Vanilla   │      │ Backend      │      │  Database       │
│   JS)       │◀──────│              │◀──────│                 │
└─────────────┘      └──────────────┘      └─────────────────┘
       │                      │
       │ MetaMask             │ Web3.py
       ▼                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Ethereum Sepolia (Alchemy RPC)                │
│  ┌──────────────┐  ┌──────────────────┐  ┌─────────────┐  │
│  │ SecurityToken│  │ RentDistribution │  │ PropertyNFT │  │
│  │ (ERC-20)     │  │ (Singleton)      │  │ (ERC-721)   │  │
│  └──────────────┘  └──────────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ events
                              ▼
                    ┌──────────────────┐
                    │  Indexer Worker  │
                    │  (Advisory Lock) │
                    └──────────────────┘
```

## Smart Contracts

| Contract | Purpose |
|----------|---------|
| `SecurityToken.sol` | ERC-20 token per property with whitelist minting and investment tracking |
| `RentDistribution.sol` | Singleton contract that receives rent, computes investor shares via token balances, and distributes ETH automatically |
| `PropertyNFT.sol` | ERC-721 deed/NFT for each registered property |

### Key Events

- `RentPaid(propertyId, tenant, amount)` — emitted when a tenant pays rent
- `InvestorPaid(propertyId, investor, amount, ownershipBps)` — emitted for each investor payout
- `RentDistributed(propertyId, totalAmount, investorCount)` — emitted after all payouts complete
- `InvestmentCompleted(investor, tokenAmount, ethSpent)` — emitted on token purchase

## Project Structure

```
.
├── contracts/              # Solidity source files
├── artifacts/              # Compiled contract ABIs and bytecode
├── scripts/                # Hardhat deployment scripts
├── test/                   # Hardhat contract tests
├── backend/
│   ├── api/                # FastAPI routers (investment, rent, property, admin)
│   ├── services/           # Web3 integration, blockchain indexer
│   ├── db/                 # PostgreSQL connection and schema
│   ├── models/             # SQLAlchemy models
│   ├── alembic/            # Database migrations
│   ├── worker/             # Background blockchain indexer
│   └── main.py             # FastAPI application entry point
├── frontend/
│   ├── index.html          # Landing page
│   ├── tenant/             # Tenant dashboard
│   ├── investor/           # Investor dashboard
│   ├── admin/              # Admin dashboard
│   └── shared/             # Utils, API helpers, CSS
├── hardhat.config.js
├── requirements.txt
├── package.json
├── render.yaml             # Render deployment spec
├── vercel.json             # Vercel deployment spec
└── alembic.ini
```

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Python 3.11+
- PostgreSQL 14+
- An [Alchemy](https://alchemy.com) account with a Sepolia API key
- A funded Sepolia testnet wallet for the deployer

### 1. Clone and Install

```bash
git clone <repo-url>
cd estatechain

# Node dependencies (Hardhat, OpenZeppelin, etc.)
npm install

# Python dependencies
python -m venv backend/.venv
source backend/.venv/bin/activate  # Windows: backend\.venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SEPOLIA_RPC_URL` | Alchemy Sepolia RPC URL |
| `DEPLOYER_PRIVATE_KEY` | Sepolia wallet private key (with test ETH) |
| `CHAIN_ID` | `11155111` for Sepolia |
| `INDEXER_START_BLOCK` | Block number where `RentDistribution` was deployed |
| `RUN_INDEXER_IN_WEB` | `true` for dev (single process), `false` for production |

### 3. Compile Contracts

```bash
npx hardhat compile
```

### 4. Deploy to Sepolia

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

This generates `backend/config/contract-addresses.json` used by the backend at runtime.

### 5. Initialize Database

```bash
# Create database
createdb real_estate_web3

# Run baseline migration
alembic upgrade head
```

### 6. Run Backend

```bash
# Development (runs web server + indexer in one process)
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

# Production (web only)
uvicorn backend.main:app --host 0.0.0.0 --port 8000

# Production (dedicated indexer worker)
python -m backend.worker
```

### 7. Run Frontend

The frontend is static HTML/JS. Serve it with any static file server:

```bash
# Local dev
npx serve frontend/

# Or simply open frontend/index.html in a browser with a local server extension
```

For production, deploy the `frontend/` directory to Vercel or any CDN.

## API Endpoints

### Investment
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/investments/prepare/{property_id}` | Get on-chain investment calldata |
| `POST` | `/investments/confirm/{investment_id}` | Confirm investment tx and reconcile |

### Rent
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/tenant/pay-rent/prepare/{property_id}` | Get monthly rent amount + calldata |
| `POST` | `/tenant/pay-rent/confirm/{property_id}` | Confirm rent tx, distribute, and index |
| `GET`  | `/tenant/payment-history/{wallet}` | Tenant's payment history |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/properties/{id}/set-rent` | Set monthly rent on-chain |
| `POST` | `/properties/{id}/sync-rent-chain` | Sync DB investors/rent to contract |
| `POST` | `/properties/{id}/mint-nft` | Mint property deed NFT |
| `POST` | `/properties/{id}/mint-tokens` | Mint security tokens |

## Deployment

### Render (Backend + Indexer)

The `render.yaml` blueprint defines:
- `estatechain-backend` — FastAPI web service
- `estatechain-indexer` — Dedicated blockchain event worker

Push to GitHub and connect the repo to Render. Set all environment variables in the Render dashboard.

### Vercel (Frontend)

```bash
vercel --prod
```

Make sure `API_BASE_URL` in your environment points to the Render backend domain.

## Environment Modes

| Mode | `DEPLOY_ENV` | `RUN_INDEXER_IN_WEB` | Use Case |
|------|------------|----------------------|----------|
| Dev  | `development` | `true` | Single process, quick iteration |
| Prod | `production` | `false` | Separate web + worker processes |

## Idempotency & Safety

- All DB inserts use `ON CONFLICT DO UPDATE` so replaying the same transaction hash is safe.
- The indexer holds a PostgreSQL advisory lock to prevent duplicate event processing across multiple worker instances.
- Rent distribution and investor payouts are computed entirely on-chain; the backend only indexes and records.

## License

ISC
