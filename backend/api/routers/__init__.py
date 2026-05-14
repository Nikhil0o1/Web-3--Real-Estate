"""Aggregated API router.

Exports a single `router` that includes every sub-router. `backend.main`
imports this via `backend.api.routes.router` (a thin re-export shim).
"""
from fastapi import APIRouter

from backend.api.routers.auth import router as auth_router
from backend.api.routers.system import router as system_router
from backend.api.routers.properties import router as properties_router
from backend.api.routers.investments import router as investments_router
from backend.api.routers.rent import router as rent_router
from backend.api.routers.transactions_wallets import router as tx_wallets_router
from backend.api.routers.agents import router as agents_router

router = APIRouter()
router.include_router(auth_router)
router.include_router(system_router)
router.include_router(properties_router)
router.include_router(investments_router)
router.include_router(rent_router)
router.include_router(tx_wallets_router)
router.include_router(agents_router)

__all__ = ["router"]
