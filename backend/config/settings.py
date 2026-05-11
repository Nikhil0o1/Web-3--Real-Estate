import json
import os
from pathlib import Path
from urllib.parse import quote_plus, urlparse, urlunparse

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")

DATABASE_URL = os.getenv("DATABASE_URL", "")
ALCHEMY_API_KEY = os.getenv("ALCHEMY_API_KEY", "")
SEPOLIA_RPC_URL = os.getenv("SEPOLIA_RPC_URL", "")
if not SEPOLIA_RPC_URL and ALCHEMY_API_KEY:
    SEPOLIA_RPC_URL = f"https://eth-sepolia.g.alchemy.com/v2/{ALCHEMY_API_KEY}"
FRONTEND_URL = os.getenv("FRONTEND_URL", "")
BACKEND_URL = os.getenv("BACKEND_URL", "")
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "")
DEPLOY_ENV = os.getenv("DEPLOY_ENV", "development").lower()
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
PGUSER = os.getenv("PGUSER", "postgres")
PGPASSWORD = os.getenv("PGPASSWORD", "")
PGHOST = os.getenv("PGHOST", "localhost")
PGPORT = os.getenv("PGPORT", "5432")
PGDATABASE = os.getenv("PGDATABASE", "real_estate_web3")


def _build_database_url() -> str:
    if DATABASE_URL:
        return DATABASE_URL

    if not PGPASSWORD:
        raise RuntimeError("DATABASE_URL must be set in .env")

    return (
        f"postgresql://{quote_plus(PGUSER)}:{quote_plus(PGPASSWORD)}"
        f"@{PGHOST}:{PGPORT}/{PGDATABASE}"
    )


def get_database_url() -> str:
    return _build_database_url()


def get_database_name() -> str:
    parsed = urlparse(get_database_url())
    database_name = parsed.path.lstrip("/")
    if not database_name:
        raise RuntimeError("DATABASE_URL must include a database name")
    return database_name


def get_admin_database_url() -> str:
    parsed = urlparse(get_database_url())
    return urlunparse(parsed._replace(path="/postgres"))


def get_cors_origins() -> list[str]:
    origins = [origin.strip() for origin in CORS_ORIGINS.split(",") if origin.strip()]
    if FRONTEND_URL:
        origins.append(FRONTEND_URL.rstrip("/"))
    if BACKEND_URL:
        origins.append(BACKEND_URL.rstrip("/"))
    if not origins and DEPLOY_ENV != "production":
        origins.extend([
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:8000",
            "http://127.0.0.1:8000",
        ])
    if DEPLOY_ENV == "production" and not origins:
        raise RuntimeError("CORS_ORIGINS or FRONTEND_URL must be configured in production")
    return list(dict.fromkeys(origin.rstrip("/") for origin in origins))

WEB3_PROVIDER_URI = os.getenv("WEB3_PROVIDER_URI", SEPOLIA_RPC_URL)
DEPLOYER_PRIVATE_KEY = os.getenv("DEPLOYER_PRIVATE_KEY", "")
CHAIN_ID = int(os.getenv("CHAIN_ID", "11155111"))
EXPECTED_CHAIN_HEX = "0x" + hex(CHAIN_ID)[2:]

REQUIRED_CONTRACT_ADDRESSES = [
    "PropertyNFT",
    "RentDistribution",
    "Escrow",
]

# Indexer start block: 0 means backfill from genesis (extremely slow on Sepolia).
# Set INDEXER_START_BLOCK in .env to the deploy block of RentDistribution for fast startup.
INDEXER_START_BLOCK = int(os.getenv("INDEXER_START_BLOCK", "0"))


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


# Whether the FastAPI web process should also run the blockchain indexer.
# In development: convenient (single process). In production with >1 web replica
# this duplicates indexing — run the indexer as a dedicated worker process instead
# (see `python -m backend.worker`) and set RUN_INDEXER_IN_WEB=false.
RUN_INDEXER_IN_WEB = _env_bool("RUN_INDEXER_IN_WEB", default=(DEPLOY_ENV != "production"))

# Advisory lock key used by the indexer to ensure only one instance runs at a time,
# even if multiple worker processes are accidentally started against the same database.
# Any 64-bit integer; picked arbitrarily but must be stable across deploys.
INDEXER_ADVISORY_LOCK_KEY = int(os.getenv("INDEXER_ADVISORY_LOCK_KEY", "928374651234"))

def validate_required_settings() -> None:
    missing = []
    if not DATABASE_URL:
        missing.append("DATABASE_URL")
    if not SEPOLIA_RPC_URL:
        missing.append("SEPOLIA_RPC_URL")
    if DEPLOY_ENV == "production" and not (FRONTEND_URL or CORS_ORIGINS):
        missing.append("FRONTEND_URL or CORS_ORIGINS")
    if DEPLOY_ENV == "production" and not BACKEND_URL:
        missing.append("BACKEND_URL")

    if DEPLOY_ENV == "production" and not AUTH_JWT_SECRET:
        missing.append("AUTH_JWT_SECRET")

    if missing:
        raise RuntimeError("Missing required environment variables: " + ", ".join(missing))

    addresses = load_contract_addresses()
    if DEPLOY_ENV == "production" and not addresses:
        raise RuntimeError("Contract addresses file is required in production: " + CONTRACT_ADDRESSES_PATH)

    missing_contracts = [name for name in REQUIRED_CONTRACT_ADDRESSES if name not in addresses]
    if DEPLOY_ENV == "production" and missing_contracts:
        raise RuntimeError("Missing deployed contract addresses for production: " + ", ".join(missing_contracts))

CONTRACT_ADDRESSES_PATH = os.getenv(
    "CONTRACT_ADDRESSES_PATH",
    str(ROOT_DIR / "backend" / "config" / "contract-addresses.json")
)
ARTIFACTS_DIR = os.getenv("ARTIFACTS_DIR", str(ROOT_DIR / "artifacts" / "contracts"))

TOKEN_DECIMALS = int(os.getenv("TOKEN_DECIMALS", "18"))
RENT_TOKEN_DECIMALS = int(os.getenv("RENT_TOKEN_DECIMALS", "6"))

# ─────────────────────────────────────────────────────────────
# Web3 Authentication settings
# ─────────────────────────────────────────────────────────────
# JWT signing secret. In production this MUST be set to a long random value
# (e.g. `python -c "import secrets; print(secrets.token_hex(48))"`).
# In dev we derive a deterministic fallback so devs can boot the API without
# touching .env, but `validate_required_settings()` rejects this in prod.
AUTH_JWT_SECRET = os.getenv("AUTH_JWT_SECRET", "")
AUTH_JWT_ALGORITHM = os.getenv("AUTH_JWT_ALGORITHM", "HS256")
AUTH_JWT_ISSUER = os.getenv("AUTH_JWT_ISSUER", "estatechain")
AUTH_SESSION_TTL_HOURS = int(os.getenv("AUTH_SESSION_TTL_HOURS", "24"))
AUTH_NONCE_TTL_SECONDS = int(os.getenv("AUTH_NONCE_TTL_SECONDS", "300"))

# Comma-separated wallet addresses that may register / sign in as admin.
# DEPLOYER_PRIVATE_KEY's address is ALWAYS allowed as admin in addition to this list.
ADMIN_WALLETS = os.getenv("ADMIN_WALLETS", "")


def get_admin_wallets() -> set[str]:
    """Return the canonical set of admin wallets (lowercased)."""
    raw = [w.strip().lower() for w in ADMIN_WALLETS.split(",") if w.strip()]
    addrs = set(raw)
    # Always treat the deployer key's address as an admin so the platform owner
    # can bootstrap without extra env wiring.
    try:
        if DEPLOYER_PRIVATE_KEY:
            from eth_account import Account
            deployer_addr = Account.from_key(DEPLOYER_PRIVATE_KEY).address.lower()
            addrs.add(deployer_addr)
    except Exception:
        pass
    return addrs


def is_admin_wallet(wallet_address: str) -> bool:
    return (wallet_address or "").strip().lower() in get_admin_wallets()


def load_contract_addresses() -> dict:
    path = Path(CONTRACT_ADDRESSES_PATH)
    if not path.exists():
        return {}
    return json.loads(path.read_text())
