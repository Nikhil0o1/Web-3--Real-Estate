from __future__ import annotations

import logging
import threading
import time
from datetime import datetime
from decimal import Decimal
from typing import Any

from backend.db.connection import get_connection
from backend.config.settings import INDEXER_ADVISORY_LOCK_KEY, INDEXER_START_BLOCK, TOKEN_DECIMALS
from backend.services.blockchain import (
    ZERO_ADDRESS,
    from_base_units,
    from_wei,
    get_contract,
    get_rent_distribution_address,
    get_web3,
    to_base_units,
)

LOGGER = logging.getLogger(__name__)
INDEXER_NAME = "sepolia_event_indexer"
BLOCK_CHUNK_SIZE = 500
REPLAY_DEPTH = 5
POLL_INTERVAL_SECONDS = 15
LOG_SCAN_RETRIES = 2

_INDEXER_THREAD: threading.Thread | None = None
_INDEXER_LOCK = threading.Lock()
_STOP_EVENT = threading.Event()


def _normalize_tx_hash(tx_hash: Any) -> str:
    if hasattr(tx_hash, "to_0x_hex"):
        value = tx_hash.to_0x_hex()
    elif hasattr(tx_hash, "hex"):
        value = tx_hash.hex()
    else:
        value = str(tx_hash)
    if not value.lower().startswith("0x"):
        value = f"0x{value}"
    return value.lower()


def _fetch_event_logs(event_callable, from_block: int, to_block: int, *, contract_address: str, event_name: str, domain: str) -> list:
    """Fetch logs defensively.

    Some providers reject large eth_getLogs ranges or transiently fail with 400/429/5xx.
    We retry briefly, and if still failing, split the block window recursively.
    """
    if from_block > to_block:
        return []

    last_exc: Exception | None = None
    for attempt in range(LOG_SCAN_RETRIES + 1):
        try:
            return event_callable().get_logs(from_block=from_block, to_block=to_block)
        except Exception as exc:
            last_exc = exc
            msg = str(exc).lower()
            retryable = any(token in msg for token in ("429", "rate limit", "timeout", "timed out", "temporarily unavailable", "503", "502", "connection reset"))
            splittable = any(token in msg for token in ("400 client error", "query returned more than", "response size", "payload too large", "block range"))

            if retryable and attempt < LOG_SCAN_RETRIES:
                time.sleep(0.75 * (attempt + 1))
                continue

            if splittable and from_block < to_block:
                mid = (from_block + to_block) // 2
                left = _fetch_event_logs(
                    event_callable,
                    from_block,
                    mid,
                    contract_address=contract_address,
                    event_name=event_name,
                    domain=domain,
                )
                right = _fetch_event_logs(
                    event_callable,
                    mid + 1,
                    to_block,
                    contract_address=contract_address,
                    event_name=event_name,
                    domain=domain,
                )
                return left + right

            break

    LOGGER.warning(
        "%s log scan failed for %s %s-%s: %s",
        domain,
        contract_address,
        from_block,
        to_block,
        last_exc,
    )
    return []


def get_indexer_status() -> dict[str, object]:
    db = get_connection()
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT last_block, updated_at FROM blockchain_sync_state WHERE index_name = %s",
            (INDEXER_NAME,)
        )
        row = cursor.fetchone()
        return {
            "running": bool(_INDEXER_THREAD and _INDEXER_THREAD.is_alive()),
            "last_block": int(row["last_block"]) if row else 0,
            "updated_at": row["updated_at"].isoformat() if row and row["updated_at"] else None,
            "poll_interval_seconds": POLL_INTERVAL_SECONDS,
        }
    except Exception:
        return {"running": bool(_INDEXER_THREAD and _INDEXER_THREAD.is_alive()), "last_block": 0, "updated_at": None}
    finally:
        cursor.close()
        db.close()


def _normalize_address(address: str | None) -> str | None:
    if not address:
        return None
    return get_web3().to_checksum_address(address)


def _block_timestamp(web3, block_number: int) -> datetime:
    block = web3.eth.get_block(block_number)
    return datetime.utcfromtimestamp(int(block["timestamp"]))


def _get_sync_state(cursor) -> int:
    cursor.execute(
        "SELECT last_block FROM blockchain_sync_state WHERE index_name = %s",
        (INDEXER_NAME,)
    )
    row = cursor.fetchone()
    if row:
        return int(row["last_block"] or 0)
    cursor.execute(
        "INSERT INTO blockchain_sync_state (index_name, last_block) VALUES (%s, %s)",
        (INDEXER_NAME, 0)
    )
    return 0


def _set_sync_state(cursor, last_block: int) -> None:
    cursor.execute(
        "INSERT INTO blockchain_sync_state (index_name, last_block, updated_at) VALUES (%s, %s, CURRENT_TIMESTAMP) "
        "ON CONFLICT (index_name) DO UPDATE SET last_block = EXCLUDED.last_block, updated_at = CURRENT_TIMESTAMP",
        (INDEXER_NAME, int(last_block))
    )


def _record_event(cursor, tx_hash: str, log_index: int, block_number: int, contract_address: str, event_name: str) -> bool:
    normalized_tx_hash = _normalize_tx_hash(tx_hash)
    cursor.execute(
        "SELECT 1 FROM blockchain_event_log WHERE LOWER(tx_hash) = LOWER(%s) AND log_index = %s LIMIT 1",
        (normalized_tx_hash, int(log_index)),
    )
    if cursor.fetchone():
        return False
    cursor.execute(
        "INSERT INTO blockchain_event_log (tx_hash, log_index, block_number, contract_address, event_name) "
        "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (tx_hash, log_index) DO NOTHING RETURNING id",
        (normalized_tx_hash, int(log_index), int(block_number), contract_address, event_name)
    )
    return cursor.fetchone() is not None


def _upsert_transaction(
    cursor,
    *,
    tx_hash: str,
    tx_type: str,
    amount_base: int,
    timestamp: datetime,
    property_id: int | None,
    block_number: int,
    wallet_address: str | None,
    gas_fee: str | None,
    amount_spent: str | None,
    remaining_balance: str | None,
) -> int:
    tx_hash = _normalize_tx_hash(tx_hash)
    cursor.execute(
        "INSERT INTO transactions (tx_hash, type, amount, timestamp, property_id, block_number, wallet_address, gas_fee, amount_spent, remaining_balance) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
        "ON CONFLICT (tx_hash) DO UPDATE SET type = EXCLUDED.type, amount = EXCLUDED.amount, timestamp = EXCLUDED.timestamp, "
        "property_id = EXCLUDED.property_id, block_number = EXCLUDED.block_number, wallet_address = EXCLUDED.wallet_address, "
        "gas_fee = EXCLUDED.gas_fee, amount_spent = EXCLUDED.amount_spent, remaining_balance = EXCLUDED.remaining_balance",
        (
            tx_hash,
            tx_type,
            Decimal(amount_base),
            timestamp,
            property_id,
            int(block_number),
            wallet_address,
            gas_fee,
            amount_spent,
            remaining_balance,
        )
    )
    return int(cursor.rowcount or 0)


def _get_or_create_user_id(cursor, wallet_address: str) -> int:
    cursor.execute("SELECT id FROM users WHERE LOWER(wallet_address) = LOWER(%s)", (wallet_address,))
    row = cursor.fetchone()
    if row:
        return int(row["id"])
    cursor.execute("INSERT INTO users (wallet_address) VALUES (%s) RETURNING id", (wallet_address,))
    return int(cursor.fetchone()["id"])


def _get_or_create_tenant_id(cursor, wallet_address: str) -> int:
    cursor.execute("SELECT id FROM tenants WHERE LOWER(wallet_address) = LOWER(%s)", (wallet_address,))
    row = cursor.fetchone()
    if row:
        return int(row["id"])
    cursor.execute("INSERT INTO tenants (wallet_address) VALUES (%s) RETURNING id", (wallet_address,))
    return int(cursor.fetchone()["id"])


def _update_ownership(cursor, user_id: int, property_id: int, delta_base: int) -> int:
    cursor.execute(
        "INSERT INTO token_ownerships (user_id, property_id, token_amount) VALUES (%s, %s, GREATEST(%s, 0)) "
        "ON CONFLICT (user_id, property_id) DO UPDATE SET token_amount = GREATEST(token_ownerships.token_amount + %s, 0)",
        (user_id, property_id, int(delta_base), int(delta_base))
    )
    return int(cursor.rowcount or 0)


def _sync_ownership_to_chain(
    cursor,
    *,
    token_contract,
    property_id: int,
    wallet_address: str,
    user_id: int | None = None,
) -> int:
    try:
        balance_base = int(token_contract.functions.balanceOf(wallet_address).call())
    except Exception as exc:
        LOGGER.warning(
            "reconcile stage=ownership_balance_failed property_id=%s wallet=%s error=%s",
            int(property_id),
            wallet_address,
            exc,
        )
        return 0

    if user_id is None:
        user_id = _get_or_create_user_id(cursor, wallet_address)

    cursor.execute(
        "INSERT INTO token_ownerships (user_id, property_id, token_amount) VALUES (%s, %s, %s) "
        "ON CONFLICT (user_id, property_id) DO UPDATE SET token_amount = EXCLUDED.token_amount",
        (int(user_id), int(property_id), int(balance_base)),
    )
    return int(cursor.rowcount or 0)


def _upsert_investment_row(
    cursor,
    *,
    property_id: int,
    investor_wallet: str,
    token_amount_base: int,
    eth_amount_wei: int,
    tx_hash: str,
    timestamp: datetime,
) -> int:
    cursor.execute(
        "INSERT INTO investments (property_id, investor_wallet, token_amount_base, eth_amount_wei, deposit_tx_hash, status, created_at, updated_at) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) "
        "ON CONFLICT (deposit_tx_hash) WHERE deposit_tx_hash IS NOT NULL DO UPDATE SET property_id = EXCLUDED.property_id, investor_wallet = EXCLUDED.investor_wallet, "
        "token_amount_base = EXCLUDED.token_amount_base, eth_amount_wei = EXCLUDED.eth_amount_wei, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at",
        (
            int(property_id),
            investor_wallet,
            Decimal(token_amount_base),
            Decimal(eth_amount_wei),
            _normalize_tx_hash(tx_hash),
            "funded",
            timestamp,
            timestamp,
        ),
    )
    return int(cursor.rowcount or 0)


def _load_property_by_token(cursor, token_address: str) -> dict | None:
    cursor.execute(
        "SELECT * FROM properties WHERE token_address = %s LIMIT 1",
        (token_address,)
    )
    return cursor.fetchone()


def _load_property_by_distributor(cursor, distributor_address: str) -> dict | None:
    cursor.execute(
        "SELECT * FROM properties WHERE distributor_address = %s LIMIT 1",
        (distributor_address,)
    )
    return cursor.fetchone()


def _build_gas_fields(tx: dict[str, Any], receipt: dict[str, Any]) -> tuple[str | None, str | None, str | None]:
    gas_used = int(receipt.get("gasUsed") or 0)
    effective_gas_price = int(receipt.get("effectiveGasPrice") or tx.get("gasPrice") or 0)
    gas_fee_wei = gas_used * effective_gas_price
    amount_spent_wei = int(tx.get("value") or 0)
    remaining_balance_wei = None
    try:
        remaining_balance_wei = str(get_web3().eth.get_balance(tx.get("from")))
    except Exception:
        remaining_balance_wei = None
    return (str(gas_fee_wei) if gas_fee_wei else None, str(amount_spent_wei) if amount_spent_wei else None, remaining_balance_wei)


def _handle_investment_event(
    cursor,
    web3,
    tx: dict[str, Any],
    receipt: dict[str, Any],
    property_row: dict,
    event: dict[str, Any],
    *,
    token_contract,
    apply_delta: bool,
) -> None:
    args = event["args"]
    investor_wallet = web3.to_checksum_address(args["investor"])
    tx_from = web3.to_checksum_address(tx["from"])
    if investor_wallet != tx_from:
        raise ValueError("Investment sender mismatch")

    amount_base = to_base_units(Decimal(args["tokenAmount"]), TOKEN_DECIMALS)
    eth_amount_wei = int(args["ethSpent"])
    block_number = int(receipt["blockNumber"])
    timestamp = _block_timestamp(web3, block_number)
    gas_fee, amount_spent, remaining_balance = _build_gas_fields(tx, receipt)
    normalized_tx_hash = _normalize_tx_hash(tx["hash"])

    user_id = _get_or_create_user_id(cursor, investor_wallet)
    if apply_delta:
        ownership_rows = _update_ownership(cursor, user_id, int(property_row["id"]), int(amount_base))
        ownership_mode = "delta"
    else:
        ownership_rows = _sync_ownership_to_chain(
            cursor,
            token_contract=token_contract,
            property_id=int(property_row["id"]),
            wallet_address=investor_wallet,
            user_id=user_id,
        )
        ownership_mode = "chain_balance"
    investment_rows = _upsert_investment_row(
        cursor,
        property_id=int(property_row["id"]),
        investor_wallet=investor_wallet,
        token_amount_base=int(amount_base),
        eth_amount_wei=eth_amount_wei,
        tx_hash=normalized_tx_hash,
        timestamp=timestamp,
    )
    transaction_rows = _upsert_transaction(
        cursor,
        tx_hash=normalized_tx_hash,
        tx_type="INVESTMENT_COMPLETED",
        amount_base=amount_base,
        timestamp=timestamp,
        property_id=int(property_row["id"]),
        block_number=block_number,
        wallet_address=investor_wallet,
        gas_fee=gas_fee,
        amount_spent=amount_spent,
        remaining_balance=remaining_balance,
    )
    LOGGER.info(
        "reconcile stage=investment_event tx_hash=%s property_id=%s investor_wallet=%s ownership_rows=%s ownership_mode=%s investment_rows=%s transaction_rows=%s apply_delta=%s",
        normalized_tx_hash,
        int(property_row["id"]),
        investor_wallet,
        ownership_rows,
        ownership_mode,
        investment_rows,
        transaction_rows,
        apply_delta,
    )


def _handle_transfer_event(
    cursor,
    web3,
    tx: dict[str, Any],
    receipt: dict[str, Any],
    property_row: dict,
    event: dict[str, Any],
    *,
    token_contract,
    apply_delta: bool,
) -> None:
    args = event["args"]
    from_addr = web3.to_checksum_address(args["from"])
    to_addr = web3.to_checksum_address(args["to"])
    token_contract_address = web3.to_checksum_address(property_row["token_address"])

    if from_addr == ZERO_ADDRESS and to_addr == token_contract_address:
        return

    value_base = int(args["value"])
    if value_base <= 0:
        return

    block_number = int(receipt["blockNumber"])
    timestamp = _block_timestamp(web3, block_number)
    gas_fee, amount_spent, remaining_balance = _build_gas_fields(tx, receipt)
    normalized_tx_hash = _normalize_tx_hash(tx["hash"])
    tx_value_wei = int(tx.get("value") or 0)
    is_sale_transfer = (
        from_addr == token_contract_address
        and to_addr != ZERO_ADDRESS
        and to_addr != token_contract_address
    )
    ownership_debit_rows = 0
    ownership_credit_rows = 0

    # Contract-to-investor transfers are sales; don't track the contract as a user holder.
    if apply_delta:
        if from_addr != ZERO_ADDRESS and not is_sale_transfer:
            user_from_id = _get_or_create_user_id(cursor, from_addr)
            ownership_debit_rows = _update_ownership(cursor, user_from_id, int(property_row["id"]), -value_base)

        if to_addr != ZERO_ADDRESS and to_addr != token_contract_address:
            user_to_id = _get_or_create_user_id(cursor, to_addr)
            ownership_credit_rows = _update_ownership(cursor, user_to_id, int(property_row["id"]), value_base)
    else:
        if from_addr != ZERO_ADDRESS and not is_sale_transfer and from_addr != token_contract_address:
            ownership_debit_rows = _sync_ownership_to_chain(
                cursor,
                token_contract=token_contract,
                property_id=int(property_row["id"]),
                wallet_address=from_addr,
            )

        if to_addr != ZERO_ADDRESS and to_addr != token_contract_address:
            ownership_credit_rows = _sync_ownership_to_chain(
                cursor,
                token_contract=token_contract,
                property_id=int(property_row["id"]),
                wallet_address=to_addr,
            )

    tx_type = "ISSUE_TOKENS" if from_addr == ZERO_ADDRESS else "TRANSFER"
    investment_rows = 0
    if is_sale_transfer and tx_value_wei > 0:
        tx_type = "INVESTMENT_COMPLETED"
        investment_rows = _upsert_investment_row(
            cursor,
            property_id=int(property_row["id"]),
            investor_wallet=to_addr,
            token_amount_base=value_base,
            eth_amount_wei=tx_value_wei,
            tx_hash=normalized_tx_hash,
            timestamp=timestamp,
        )

    transaction_rows = _upsert_transaction(
        cursor,
        tx_hash=normalized_tx_hash,
        tx_type=tx_type,
        amount_base=value_base,
        timestamp=timestamp,
        property_id=int(property_row["id"]),
        block_number=block_number,
        wallet_address=to_addr,
        gas_fee=gas_fee,
        amount_spent=amount_spent,
        remaining_balance=remaining_balance,
    )
    LOGGER.info(
        "reconcile stage=transfer_event tx_hash=%s property_id=%s from=%s to=%s tx_type=%s debit_rows=%s credit_rows=%s investment_rows=%s transaction_rows=%s apply_delta=%s",
        normalized_tx_hash,
        int(property_row["id"]),
        from_addr,
        to_addr,
        tx_type,
        ownership_debit_rows,
        ownership_credit_rows,
        investment_rows,
        transaction_rows,
        apply_delta,
    )


def _handle_rent_events(cursor, web3, tx: dict[str, Any], receipt: dict[str, Any], property_row: dict, rent_paid_event: dict[str, Any], investor_paid_events: list[dict[str, Any]], rent_distributed_events: list[dict[str, Any]]) -> dict[str, Any]:
    rent_args = rent_paid_event["args"]
    tenant_wallet = web3.to_checksum_address(rent_args["tenant"])
    tenant_id = _get_or_create_tenant_id(cursor, tenant_wallet)
    block_number = int(receipt["blockNumber"])
    timestamp = _block_timestamp(web3, block_number)
    amount_wei = int(rent_args["amount"])
    amount_eth = str(from_wei(amount_wei))
    gas_fee, amount_spent, remaining_balance = _build_gas_fields(tx, receipt)
    normalized_tx_hash = _normalize_tx_hash(tx["hash"])

    cursor.execute(
        "INSERT INTO rent_payments (tenant_id, property_id, amount_wei, amount_eth, tx_hash, block_number, payment_date, payment_status) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) "
        "ON CONFLICT (tx_hash) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, property_id = EXCLUDED.property_id, amount_wei = EXCLUDED.amount_wei, amount_eth = EXCLUDED.amount_eth, block_number = EXCLUDED.block_number, payment_date = EXCLUDED.payment_date, payment_status = EXCLUDED.payment_status",
        (tenant_id, int(property_row["id"]), str(amount_wei), amount_eth, normalized_tx_hash, block_number, timestamp, "confirmed")
    )
    rent_payment_rows = int(cursor.rowcount or 0)
    cursor.execute("SELECT id FROM rent_payments WHERE tx_hash = %s", (normalized_tx_hash,))
    rent_payment_id = int(cursor.fetchone()["id"])

    cursor.execute(
        "SELECT id FROM tenant_rentals WHERE tenant_id = %s AND property_id = %s AND status = 'active'",
        (tenant_id, int(property_row["id"]))
    )
    if not cursor.fetchone():
        monthly_rent_wei = property_row.get("monthly_rent_wei") or str(amount_wei)
        cursor.execute(
            "INSERT INTO tenant_rentals (tenant_id, property_id, rental_start_date, monthly_rent, status) VALUES (%s, %s, %s, %s, 'active')",
            (tenant_id, int(property_row["id"]), timestamp.date(), monthly_rent_wei)
        )

    total_distributed = 0
    investor_count = 0
    if rent_distributed_events:
        dist_args = rent_distributed_events[0]["args"]
        total_distributed = int(dist_args.get("totalAmount", 0))
        investor_count = int(dist_args.get("investorCount", 0))

    cursor.execute(
        "INSERT INTO rent_distributions (property_id, rent_payment_id, total_rent_collected, total_distributed, investor_count, distribution_tx_hash, distributed_at) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s) "
        "ON CONFLICT (distribution_tx_hash) DO UPDATE SET rent_payment_id = EXCLUDED.rent_payment_id, total_rent_collected = EXCLUDED.total_rent_collected, total_distributed = EXCLUDED.total_distributed, investor_count = EXCLUDED.investor_count, distributed_at = EXCLUDED.distributed_at",
        (int(property_row["id"]), rent_payment_id, str(amount_wei), str(total_distributed), investor_count, normalized_tx_hash, timestamp)
    )
    rent_distribution_rows = int(cursor.rowcount or 0)
    cursor.execute("SELECT id FROM rent_distributions WHERE distribution_tx_hash = %s", (normalized_tx_hash,))
    distribution_id = int(cursor.fetchone()["id"])

    investor_payout_rows = 0
    for ev in investor_paid_events:
        args = ev["args"]
        inv_addr = web3.to_checksum_address(args["investor"])
        payout_wei = int(args["amount"])
        ownership_bps = int(args["ownershipBps"])
        ownership_pct = round(ownership_bps / 100, 2)
        cursor.execute(
            "SELECT tx_hash, timestamp FROM transactions "
            "WHERE type = %s AND property_id = %s AND LOWER(wallet_address) = LOWER(%s) AND timestamp >= %s "
            "ORDER BY timestamp ASC LIMIT 1",
            ("REWARDS_CLAIMED", int(property_row["id"]), inv_addr, timestamp),
        )
        existing_claim = cursor.fetchone()
        claim_status = "claimed" if existing_claim else "claimable"
        claim_tx_hash = existing_claim["tx_hash"] if existing_claim else None
        claimed_at = existing_claim["timestamp"] if existing_claim else None
        # Idempotent insert: (distribution_id, investor_wallet) is unique.
        # Replays of the same tx must not create duplicate payout rows.
        cursor.execute(
            "INSERT INTO investor_rent_payouts (distribution_id, investor_wallet, property_id, ownership_percentage, payout_amount_wei, payout_amount_eth, tx_hash, distributed_at, claim_status, claim_tx_hash, claimed_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
            "ON CONFLICT (distribution_id, investor_wallet) DO NOTHING",
            (distribution_id, inv_addr, int(property_row["id"]), ownership_pct, str(payout_wei), str(from_wei(payout_wei)), normalized_tx_hash, timestamp, claim_status, claim_tx_hash, claimed_at)
        )
        investor_payout_rows += int(cursor.rowcount or 0)

    transaction_rows = _upsert_transaction(
        cursor,
        tx_hash=normalized_tx_hash,
        tx_type="RENT_PAID",
        amount_base=amount_wei,
        timestamp=timestamp,
        property_id=int(property_row["id"]),
        block_number=block_number,
        wallet_address=tenant_wallet,
        gas_fee=gas_fee,
        amount_spent=amount_spent,
        remaining_balance=remaining_balance,
    )
    LOGGER.info(
        "reconcile stage=rent_event tx_hash=%s property_id=%s tenant_wallet=%s rent_payment_rows=%s rent_distribution_rows=%s investor_payout_rows=%s transaction_rows=%s",
        normalized_tx_hash,
        int(property_row["id"]),
        tenant_wallet,
        rent_payment_rows,
        rent_distribution_rows,
        investor_payout_rows,
        transaction_rows,
    )

    return {
        "rent_payment_id": rent_payment_id,
        "distribution_id": distribution_id,
        "investors_paid": investor_count,
        "tx_hash": normalized_tx_hash,
    }


def _handle_reward_claim_event(cursor, web3, tx: dict[str, Any], receipt: dict[str, Any], property_row: dict, claim_event: dict[str, Any]) -> dict[str, Any]:
    claim_args = claim_event["args"]
    investor_wallet = web3.to_checksum_address(claim_args["investor"])
    block_number = int(receipt["blockNumber"])
    timestamp = _block_timestamp(web3, block_number)
    claimed_amount_wei = int(claim_args["amount"])
    gas_fee, amount_spent, remaining_balance = _build_gas_fields(tx, receipt)
    normalized_tx_hash = _normalize_tx_hash(tx["hash"])

    cursor.execute(
        "UPDATE investor_rent_payouts SET claim_status = %s, claim_tx_hash = %s, claimed_at = %s "
        "WHERE property_id = %s AND LOWER(investor_wallet) = LOWER(%s) AND COALESCE(claim_status, 'claimable') = 'claimable' AND distributed_at <= %s",
        ("claimed", normalized_tx_hash, timestamp, int(property_row["id"]), investor_wallet, timestamp),
    )
    claimed_rows = int(cursor.rowcount or 0)

    transaction_rows = _upsert_transaction(
        cursor,
        tx_hash=normalized_tx_hash,
        tx_type="REWARDS_CLAIMED",
        amount_base=claimed_amount_wei,
        timestamp=timestamp,
        property_id=int(property_row["id"]),
        block_number=block_number,
        wallet_address=investor_wallet,
        gas_fee=gas_fee,
        amount_spent=amount_spent,
        remaining_balance=remaining_balance,
    )
    LOGGER.info(
        "reconcile stage=reward_claim tx_hash=%s property_id=%s investor_wallet=%s claimed_amount_wei=%s claimed_rows=%s transaction_rows=%s",
        normalized_tx_hash,
        int(property_row["id"]),
        investor_wallet,
        claimed_amount_wei,
        claimed_rows,
        transaction_rows,
    )

    return {
        "claimed_property_id": int(property_row["id"]),
        "claimed_amount_wei": str(claimed_amount_wei),
        "claimed_rows": claimed_rows,
        "claim_tx_hash": normalized_tx_hash,
    }


def reconcile_transaction(tx_hash: str) -> dict[str, Any]:
    web3 = get_web3()
    tx_hash = _normalize_tx_hash(tx_hash)
    tx = web3.eth.get_transaction(tx_hash)
    receipt = web3.eth.get_transaction_receipt(tx_hash)
    if not receipt or int(receipt.get("status") or 0) != 1:
        raise ValueError("Transaction reverted or not found")

    normalized_tx_hash = _normalize_tx_hash(tx.get("hash") or tx_hash)
    tx_to = _normalize_address(tx.get("to"))
    tx_from = _normalize_address(tx.get("from"))
    block_number = int(receipt["blockNumber"])
    LOGGER.info(
        "reconcile stage=receipt_fetched tx_hash=%s block_number=%s tx_from=%s tx_to=%s",
        normalized_tx_hash,
        block_number,
        tx_from,
        tx_to,
    )

    # Singleton RentDistribution address (canonical; not per-property).
    try:
        rent_contract_address = _normalize_address(get_rent_distribution_address())
    except Exception:
        rent_contract_address = None

    db = get_connection()
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute("SELECT * FROM properties WHERE token_address IS NOT NULL")
        properties = cursor.fetchall()
        property_by_token = {
            _normalize_address(row.get("token_address")): row
            for row in properties
            if row.get("token_address")
        }
        property_by_id = {int(row["id"]): row for row in properties}

        summary: dict[str, Any] = {
            "tx_hash": normalized_tx_hash,
            "block_number": block_number,
            "events_recorded": 0,
            "events_already_recorded": 0,
            "investment_events_decoded": 0,
            "transfer_events_decoded": 0,
            "rent_paid_events_decoded": 0,
            "investor_paid_events_decoded": 0,
            "rent_distributed_events_decoded": 0,
            "rewards_claimed_events_decoded": 0,
        }

        # ── SecurityToken events (invest / transfer) ──
        if tx_to and tx_to in property_by_token:
            property_row = property_by_token[tx_to]
            token_contract = get_contract("SecurityToken", property_row["token_address"])
            try:
                investment_events = token_contract.events.InvestmentCompleted().process_receipt(receipt)
            except Exception as exc:
                LOGGER.warning(
                    "reconcile stage=event_decode_failed tx_hash=%s property_id=%s event=InvestmentCompleted error=%s",
                    normalized_tx_hash,
                    int(property_row["id"]),
                    exc,
                )
                investment_events = []
            try:
                transfer_events = token_contract.events.Transfer().process_receipt(receipt)
            except Exception as exc:
                LOGGER.warning(
                    "reconcile stage=event_decode_failed tx_hash=%s property_id=%s event=Transfer error=%s",
                    normalized_tx_hash,
                    int(property_row["id"]),
                    exc,
                )
                transfer_events = []
            summary["investment_events_decoded"] = len(investment_events)
            summary["transfer_events_decoded"] = len(transfer_events)
            LOGGER.info(
                "reconcile stage=token_events_decoded tx_hash=%s property_id=%s investment_events=%s transfer_events=%s",
                normalized_tx_hash,
                int(property_row["id"]),
                len(investment_events),
                len(transfer_events),
            )

            if investment_events:
                for event in investment_events:
                    recorded = _record_event(
                        cursor,
                        normalized_tx_hash,
                        int(event["logIndex"]),
                        block_number,
                        event["address"],
                        event["event"],
                    )
                    if recorded:
                        summary["events_recorded"] += 1
                    else:
                        summary["events_already_recorded"] += 1
                    _handle_investment_event(
                        cursor,
                        web3,
                        tx,
                        receipt,
                        property_row,
                        event,
                        token_contract=token_contract,
                        apply_delta=recorded,
                    )
                for event in transfer_events:
                    recorded = _record_event(
                        cursor,
                        normalized_tx_hash,
                        int(event["logIndex"]),
                        block_number,
                        event["address"],
                        event["event"],
                    )
                    if recorded:
                        summary["events_recorded"] += 1
                    else:
                        summary["events_already_recorded"] += 1
                cursor.execute("SELECT id FROM investments WHERE LOWER(deposit_tx_hash) = LOWER(%s)", (normalized_tx_hash,))
                investment_row = cursor.fetchone()
                if investment_row:
                    summary["investment_id"] = int(investment_row["id"])
            else:
                for event in transfer_events:
                    recorded = _record_event(
                        cursor,
                        normalized_tx_hash,
                        int(event["logIndex"]),
                        block_number,
                        event["address"],
                        event["event"],
                    )
                    if recorded:
                        summary["events_recorded"] += 1
                    else:
                        summary["events_already_recorded"] += 1
                    _handle_transfer_event(
                        cursor,
                        web3,
                        tx,
                        receipt,
                        property_row,
                        event,
                        token_contract=token_contract,
                        apply_delta=recorded,
                    )
                if int(tx.get("value") or 0) > 0 and transfer_events:
                    LOGGER.warning(
                        "reconcile stage=investment_fallback tx_hash=%s property_id=%s detail=InvestmentCompleted_not_decoded_using_Transfer",
                        normalized_tx_hash,
                        int(property_row["id"]),
                    )

        # ── RentDistribution singleton events ──
        # Rent events are emitted from the singleton RentDistribution contract.
        # Resolve property_id from the indexed event arg, not from any address map.
        if rent_contract_address and tx_to == rent_contract_address:
            rent_contract = get_contract("RentDistribution", rent_contract_address)
            try:
                rent_paid_events = rent_contract.events.RentPaid().process_receipt(receipt)
            except Exception as exc:
                LOGGER.warning(
                    "reconcile stage=event_decode_failed tx_hash=%s event=RentPaid error=%s",
                    normalized_tx_hash,
                    exc,
                )
                rent_paid_events = []
            try:
                investor_paid_events = rent_contract.events.InvestorPaid().process_receipt(receipt)
            except Exception as exc:
                LOGGER.warning(
                    "reconcile stage=event_decode_failed tx_hash=%s event=InvestorPaid error=%s",
                    normalized_tx_hash,
                    exc,
                )
                investor_paid_events = []
            try:
                rent_distributed_events = rent_contract.events.RentDistributed().process_receipt(receipt)
            except Exception as exc:
                LOGGER.warning(
                    "reconcile stage=event_decode_failed tx_hash=%s event=RentDistributed error=%s",
                    normalized_tx_hash,
                    exc,
                )
                rent_distributed_events = []
            try:
                rewards_claimed_events = rent_contract.events.RewardsClaimed().process_receipt(receipt)
            except Exception as exc:
                LOGGER.warning(
                    "reconcile stage=event_decode_failed tx_hash=%s event=RewardsClaimed error=%s",
                    normalized_tx_hash,
                    exc,
                )
                rewards_claimed_events = []
            summary["rent_paid_events_decoded"] = len(rent_paid_events)
            summary["investor_paid_events_decoded"] = len(investor_paid_events)
            summary["rent_distributed_events_decoded"] = len(rent_distributed_events)
            summary["rewards_claimed_events_decoded"] = len(rewards_claimed_events)
            LOGGER.info(
                "reconcile stage=rent_events_decoded tx_hash=%s rent_paid=%s investor_paid=%s rent_distributed=%s rewards_claimed=%s",
                normalized_tx_hash,
                len(rent_paid_events),
                len(investor_paid_events),
                len(rent_distributed_events),
                len(rewards_claimed_events),
            )

            if rent_paid_events:
                rent_event = rent_paid_events[0]
                event_property_id = int(rent_event["args"]["propertyId"])
                property_row = property_by_id.get(event_property_id)
                if not property_row:
                    LOGGER.warning(
                        "RentPaid for unknown property_id=%s tx=%s — skipping",
                        event_property_id, normalized_tx_hash,
                    )
                else:
                    # Filter child events to the same property_id (defensive; a single tx
                    # currently only touches one property, but keep it robust).
                    matching_investor_paid = [
                        e for e in investor_paid_events
                        if int(e["args"].get("propertyId", event_property_id)) == event_property_id
                    ]
                    matching_rent_distributed = [
                        e for e in rent_distributed_events
                        if int(e["args"].get("propertyId", event_property_id)) == event_property_id
                    ]
                    recorded = _record_event(
                        cursor,
                        normalized_tx_hash,
                        int(rent_event["logIndex"]),
                        block_number,
                        rent_event["address"],
                        rent_event["event"],
                    )
                    if recorded:
                        summary["events_recorded"] += 1
                    else:
                        summary["events_already_recorded"] += 1
                    summary.update(_handle_rent_events(
                        cursor, web3, tx, receipt, property_row,
                        rent_event, matching_investor_paid, matching_rent_distributed,
                    ))

            for event in investor_paid_events:
                recorded = _record_event(
                    cursor,
                    normalized_tx_hash,
                    int(event["logIndex"]),
                    block_number,
                    event["address"],
                    event["event"],
                )
                if recorded:
                    summary["events_recorded"] += 1
                else:
                    summary["events_already_recorded"] += 1
            for event in rent_distributed_events:
                recorded = _record_event(
                    cursor,
                    normalized_tx_hash,
                    int(event["logIndex"]),
                    block_number,
                    event["address"],
                    event["event"],
                )
                if recorded:
                    summary["events_recorded"] += 1
                else:
                    summary["events_already_recorded"] += 1
            for event in rewards_claimed_events:
                event_property_id = int(event["args"]["propertyId"])
                property_row = property_by_id.get(event_property_id)
                if not property_row:
                    LOGGER.warning(
                        "RewardsClaimed for unknown property_id=%s tx=%s — skipping",
                        event_property_id,
                        normalized_tx_hash,
                    )
                    continue
                recorded = _record_event(
                    cursor,
                    normalized_tx_hash,
                    int(event["logIndex"]),
                    block_number,
                    event["address"],
                    event["event"],
                )
                if recorded:
                    summary["events_recorded"] += 1
                else:
                    summary["events_already_recorded"] += 1
                summary.update(_handle_reward_claim_event(
                    cursor,
                    web3,
                    tx,
                    receipt,
                    property_row,
                    event,
                ))

        db.commit()
        LOGGER.info(
            "reconcile stage=db_commit tx_hash=%s events_recorded=%s events_already_recorded=%s investment_events=%s transfer_events=%s rent_paid_events=%s investor_paid_events=%s rent_distributed_events=%s rewards_claimed_events=%s",
            normalized_tx_hash,
            summary.get("events_recorded", 0),
            summary.get("events_already_recorded", 0),
            summary.get("investment_events_decoded", 0),
            summary.get("transfer_events_decoded", 0),
            summary.get("rent_paid_events_decoded", 0),
            summary.get("investor_paid_events_decoded", 0),
            summary.get("rent_distributed_events_decoded", 0),
            summary.get("rewards_claimed_events_decoded", 0),
        )
        return summary
    except Exception:
        LOGGER.exception("reconcile stage=failed tx_hash=%s", normalized_tx_hash)
        db.rollback()
        raise
    finally:
        cursor.close()
        db.close()


def _discover_transaction_hashes(cursor, from_block: int, to_block: int) -> tuple[set[str], dict[str, int]]:
    tx_hashes: set[str] = set()
    event_counts: dict[str, int] = {}

    # Per-property SecurityToken events
    cursor.execute("SELECT id, token_address FROM properties WHERE token_address IS NOT NULL")
    for property_row in cursor.fetchall():
        token_address = property_row.get("token_address")
        if not token_address:
            continue
        token_contract = get_contract("SecurityToken", token_address)
        for event_name in ("InvestmentCompleted", "Transfer"):
            logs = _fetch_event_logs(
                lambda en=event_name: getattr(token_contract.events, en)(),
                from_block,
                to_block,
                contract_address=token_address,
                event_name=event_name,
                domain="Token",
            )
            event_counts[event_name] = event_counts.get(event_name, 0) + len(logs)
            for log in logs:
                tx_hashes.add(_normalize_tx_hash(log["transactionHash"]))

    # Singleton RentDistribution events (not per-property)
    try:
        rent_contract_address = get_rent_distribution_address()
    except Exception:
        rent_contract_address = None

    if rent_contract_address:
        rent_contract = get_contract("RentDistribution", rent_contract_address)
        for event_name in ("RentPaid", "InvestorPaid", "RentDistributed", "RewardsClaimed"):
            logs = _fetch_event_logs(
                lambda en=event_name: getattr(rent_contract.events, en)(),
                from_block,
                to_block,
                contract_address=rent_contract_address,
                event_name=event_name,
                domain="Rent",
            )
            event_counts[event_name] = event_counts.get(event_name, 0) + len(logs)
            for log in logs:
                tx_hashes.add(_normalize_tx_hash(log["transactionHash"]))

    return tx_hashes, event_counts


def sync_once() -> int:
    web3 = get_web3()
    db = get_connection()
    cursor = db.cursor(dictionary=True)
    processed = 0
    failed: list[str] = []
    try:
        last_block = _get_sync_state(cursor)
        latest_block = int(web3.eth.block_number)
        # On first run (last_block == 0) jump forward to INDEXER_START_BLOCK
        # to avoid scanning millions of empty Sepolia blocks.
        if last_block == 0 and INDEXER_START_BLOCK > 0:
            last_block = INDEXER_START_BLOCK
            _set_sync_state(cursor, last_block)
            db.commit()
            LOGGER.info(
                "indexer stage=sync_state_seeded last_block=%s indexer_start_block=%s",
                last_block,
                INDEXER_START_BLOCK,
            )
        if latest_block <= last_block:
            LOGGER.info(
                "indexer stage=no_new_blocks last_block=%s latest_block=%s",
                last_block,
                latest_block,
            )
            return 0

        start_block = max(INDEXER_START_BLOCK, last_block - REPLAY_DEPTH)
        current = start_block
        while current <= latest_block:
            end_block = min(current + BLOCK_CHUNK_SIZE - 1, latest_block)
            tx_hashes, event_counts = _discover_transaction_hashes(cursor, current, end_block)
            LOGGER.info(
                "indexer stage=chunk_scanned from_block=%s to_block=%s latest_block=%s events_found=%s tx_hashes_found=%s",
                current,
                end_block,
                latest_block,
                event_counts,
                len(tx_hashes),
            )
            for tx_hash in sorted(tx_hashes):
                try:
                    reconcile_transaction(tx_hash)
                    processed += 1
                    LOGGER.info(
                        "indexer stage=tx_processed tx_hash=%s processed_total=%s chunk_from=%s chunk_to=%s",
                        tx_hash,
                        processed,
                        current,
                        end_block,
                    )
                except Exception as exc:
                    failed.append(tx_hash)
                    LOGGER.warning(
                        "indexer stage=tx_failed tx_hash=%s chunk_from=%s chunk_to=%s error=%s",
                        tx_hash,
                        current,
                        end_block,
                        exc,
                    )
            if failed:
                db.rollback()
                LOGGER.error(
                    "indexer stage=chunk_failed from_block=%s to_block=%s failed_count=%s processed_total=%s",
                    current,
                    end_block,
                    len(failed),
                    processed,
                )
                return processed
            _set_sync_state(cursor, end_block)
            db.commit()
            LOGGER.info(
                "indexer stage=chunk_committed indexed_block=%s commits_completed=true processed_total=%s",
                end_block,
                processed,
            )
            current = end_block + 1

        return processed
    finally:
        cursor.close()
        db.close()


def _acquire_advisory_lock() -> tuple[Any, Any] | None:
    """Try to acquire a session-scoped PostgreSQL advisory lock.

    Returns (connection, cursor) that must stay open for the indexer's lifetime.
    Returns None if another process already holds the lock.
    """
    conn = get_connection()
    # Autocommit so the advisory-lock statement commits immediately; the lock
    # is bound to the session, not the transaction.
    conn.autocommit = True
    cursor = conn.cursor()
    cursor.execute("SELECT pg_try_advisory_lock(%s)", (INDEXER_ADVISORY_LOCK_KEY,))
    acquired = cursor.fetchone()[0]
    if not acquired:
        cursor.close()
        conn.close()
        return None
    return conn, cursor


def _release_advisory_lock(handle: tuple[Any, Any] | None) -> None:
    if not handle:
        return
    conn, cursor = handle
    try:
        cursor.execute("SELECT pg_advisory_unlock(%s)", (INDEXER_ADVISORY_LOCK_KEY,))
    except Exception:
        pass
    try:
        cursor.close()
    except Exception:
        pass
    try:
        conn.close()
    except Exception:
        pass


def _background_loop() -> None:
    """Indexer main loop. Holds a PostgreSQL advisory lock for its lifetime
    so only one indexer instance runs against the DB, even if multiple worker
    processes are accidentally started.
    """
    lock_handle: tuple[Any, Any] | None = None
    # Retry advisory-lock acquisition until we either get it or are asked to stop.
    while not _STOP_EVENT.is_set():
        lock_handle = _acquire_advisory_lock()
        if lock_handle:
            LOGGER.info("Indexer acquired advisory lock key=%s", INDEXER_ADVISORY_LOCK_KEY)
            break
        LOGGER.info(
            "Indexer advisory lock key=%s held by another process; retrying in %ss",
            INDEXER_ADVISORY_LOCK_KEY, POLL_INTERVAL_SECONDS,
        )
        _STOP_EVENT.wait(POLL_INTERVAL_SECONDS)

    try:
        while not _STOP_EVENT.is_set():
            try:
                sync_once()
            except Exception as exc:
                LOGGER.exception("Blockchain indexer loop failed: %s", exc)
            _STOP_EVENT.wait(POLL_INTERVAL_SECONDS)
    finally:
        _release_advisory_lock(lock_handle)
        LOGGER.info("Indexer released advisory lock and exited cleanly.")


def start_background_indexer() -> None:
    global _INDEXER_THREAD
    with _INDEXER_LOCK:
        if _INDEXER_THREAD and _INDEXER_THREAD.is_alive():
            return
        _STOP_EVENT.clear()
        _INDEXER_THREAD = threading.Thread(target=_background_loop, name="blockchain-indexer", daemon=True)
        _INDEXER_THREAD.start()


def stop_background_indexer() -> None:
    _STOP_EVENT.set()
    thread = _INDEXER_THREAD
    if thread and thread.is_alive():
        thread.join(timeout=POLL_INTERVAL_SECONDS + 2)


def run_foreground_indexer() -> int:
    """Run the indexer loop synchronously in the current process.

    Used by the standalone worker entrypoint (`python -m backend.worker`).
    Blocks until SIGINT/SIGTERM (handled via _STOP_EVENT).
    Returns an exit code.
    """
    _STOP_EVENT.clear()
    try:
        _background_loop()
        return 0
    except KeyboardInterrupt:
        _STOP_EVENT.set()
        return 0
