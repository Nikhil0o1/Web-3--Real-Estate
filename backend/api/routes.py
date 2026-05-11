"""Legacy compatibility shim - real handlers live in `backend.api.routers.*`.

Kept so `backend.main` (and any external imports) continue to work after the
Phase D split into per-concern router modules.

The original 1600+ line file has been decomposed into:
  - backend.api.routers.system                (/health, /status, /config, /dashboard, /users)
  - backend.api.routers.properties            (/properties CRUD + deploy-token + mint-nft + issue + transfer + verify)
  - backend.api.routers.investments           (/investments/*, /portfolio/{wallet})
  - backend.api.routers.rent                  (set-rent, sync-rent-chain, tenant/investor/admin rent endpoints)
  - backend.api.routers.transactions_wallets  (/transactions, /wallets/{addr}/balances)

Shared helpers live in `backend.api._helpers`.
"""
from backend.api.routers import router

__all__ = ["router"]
