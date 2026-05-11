"""Cross-cutting read endpoints: /transactions list and /wallets/{addr}/balances."""
from fastapi import APIRouter, Depends, HTTPException

from backend.api._helpers import format_transaction_row
from backend.api.deps import get_current_user, get_db
from backend.api.schemas import TransactionRead
from backend.config.settings import TOKEN_DECIMALS
from backend.services.auth import AuthUser, normalize_address
from backend.services.blockchain import (
    from_base_units,
    get_contract,
    get_erc20_balance,
    get_native_balance,
    get_web3,
)

router = APIRouter()


@router.get("/transactions", response_model=list[TransactionRead])
def list_transactions(
    tx_type: str | None = None,
    wallet_address: str | None = None,
    db=Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    # Non-admin callers can only ever see their own transactions.
    if user.role != "admin":
        if wallet_address and normalize_address(wallet_address) != normalize_address(user.wallet_address):
            raise HTTPException(status_code=403, detail="You can only list your own transactions")
        wallet_address = user.wallet_address
    web3 = get_web3()
    cursor = db.cursor(dictionary=True)
    try:
        conditions: list[str] = []
        params: list = []
        if tx_type:
            conditions.append("t.type = %s")
            params.append(tx_type)
        if wallet_address:
            if not web3.is_address(wallet_address):
                raise HTTPException(status_code=400, detail="Invalid wallet address")
            checksum = web3.to_checksum_address(wallet_address)
            conditions.append("LOWER(COALESCE(t.wallet_address, i.investor_wallet)) = LOWER(%s)")
            params.append(checksum)

        query = (
            "SELECT t.id, t.tx_hash, t.type, t.amount, t.timestamp, t.property_id, "
            "t.block_number, COALESCE(t.wallet_address, i.investor_wallet) AS wallet_address, "
            "t.gas_fee, t.amount_spent, t.remaining_balance, "
            "p.name AS property_name "
            "FROM transactions t "
            "LEFT JOIN properties p ON p.id = t.property_id "
            "LEFT JOIN investments i ON LOWER(i.deposit_tx_hash) = LOWER(t.tx_hash) "
        )
        if conditions:
            query += "WHERE " + " AND ".join(conditions) + " "
        query += "ORDER BY t.timestamp DESC, t.id DESC"

        cursor.execute(query, tuple(params))
        rows = cursor.fetchall()
        for row in rows:
            ts = row.get("timestamp")
            if ts:
                row["timestamp"] = ts.isoformat()
            format_transaction_row(row)
        return rows
    finally:
        cursor.close()


@router.get("/wallets/{wallet_address}/balances")
def get_wallet_balances(
    wallet_address: str,
    db=Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    web3 = get_web3()
    if not web3.is_address(wallet_address):
        raise HTTPException(status_code=400, detail="Invalid wallet address")
    if user.role != "admin" and normalize_address(wallet_address) != normalize_address(user.wallet_address):
        raise HTTPException(status_code=403, detail="You can only view your own wallet balances")

    checksum = web3.to_checksum_address(wallet_address)
    native_wei = get_native_balance(checksum)
    native = {
        "symbol": "ETH",
        "balance_wei": str(native_wei),
        "balance": str(web3.from_wei(native_wei, "ether")),
    }

    tokens: list[dict] = []
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT id, name, token_address, token_symbol "
            "FROM properties WHERE token_address IS NOT NULL"
        )
        for row in cursor.fetchall():
            token_address = row.get("token_address")
            if not token_address:
                continue
            contract = get_contract("SecurityToken", token_address)
            try:
                balance_base = get_erc20_balance(contract, checksum)
            except Exception:
                balance_base = 0
            tokens.append(
                {
                    "category": "property",
                    "property_id": row.get("id"),
                    "property_name": row.get("name"),
                    "symbol": row.get("token_symbol"),
                    "token_address": token_address,
                    "decimals": TOKEN_DECIMALS,
                    "balance_base": str(balance_base),
                    "balance": str(from_base_units(balance_base, TOKEN_DECIMALS)),
                }
            )
    finally:
        cursor.close()

    # MockUSDC rent-token balance removed in Phase A — rent is pure ETH.
    return {"wallet_address": checksum, "native": native, "tokens": tokens}
