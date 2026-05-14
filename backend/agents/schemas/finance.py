"""Typed financial / analytics summaries for tools and future LLM prompts."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class PortfolioSummary(BaseModel):
    wallet_address: str
    property_count: int
    aggregate_position_value_wei: str | None = None
    herfindahl_index: str | None = None


class PropertyYieldAnalysis(BaseModel):
    property_id: int
    monthly_rent_eth: str | None = None
    annual_rent_to_book_value: str | None = None
    sold_ratio: str | None = None
    disclaimer: str = "Heuristic only; not investment advice."


class PassiveIncomeProjection(BaseModel):
    total_claimable_wei: str
    total_claimed_wei: str
    notes: str = ""


class TransactionActivitySummary(BaseModel):
    wallet_address: str
    counts_by_type: dict[str, int] = Field(default_factory=dict)


class DiversificationAnalysis(BaseModel):
    property_count: int
    herfindahl_index: str
    largest_position_weight: str


class TxPreparationSummary(BaseModel):
    kind: str
    chain_id: int | None = None
    calldata: str | None = None
    value_wei: str | None = None
    to_address: str | None = None
    meta: dict[str, Any] = Field(default_factory=dict)
