"""Properties + per-property property-owner endpoints (deploy-token, mint-nft, issue, transfer, verify)."""
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException

from backend.api._helpers import (
    add_transaction_row,
    deploy_property_token,
    enrich_property_with_supply,
    ensure_security_token_sale_inventory,
    fetch_property,
    find_existing_property,
    get_total_minted_base,
    lock_property,
    require_property_token,
)
from backend.api.deps import get_db, require_property_owner
from backend.api.schemas import (
    IssueTokensRequest,
    MintNFTRequest,
    PropertyCreate,
    PropertyRead,
    TransferTokensRequest,
)
from backend.config.settings import TOKEN_DECIMALS, load_contract_addresses
from backend.services.blockchain import (
    from_wei,
    get_contract,
    get_erc20_balance,
    mint_property_nft,
    mint_security_tokens,
    set_whitelist,
    to_base_units,
    to_wei,
    transfer_security_tokens,
)
from backend.services.blockchain_indexer import reconcile_transaction

router = APIRouter()


@router.post("/properties", response_model=PropertyRead, dependencies=[Depends(require_property_owner)])
def create_property(payload: PropertyCreate, db=Depends(get_db)):
    """Create a property record. DB-only — no on-chain side effects.

    Token deployment is done explicitly via POST /properties/{id}/deploy-token.
    Setting rent on-chain is done explicitly via POST /properties/{id}/set-rent.
    """
    if payload.token_sale_price_eth <= 0:
        raise HTTPException(status_code=400, detail="token_sale_price_eth must be > 0")
    if payload.token_supply <= 0:
        raise HTTPException(status_code=400, detail="token_supply must be > 0")

    token_price_wei = str(to_wei(payload.token_sale_price_eth))
    monthly_rent_wei = (
        str(to_wei(payload.monthly_rent_eth)) if payload.monthly_rent_eth is not None else None
    )

    cursor = db.cursor(dictionary=True)
    try:
        existing_property = find_existing_property(
            cursor, payload, token_price_wei, monthly_rent_wei
        )
        if existing_property:
            return enrich_property_with_supply(cursor, existing_property)

        cursor.execute(
            "INSERT INTO properties (name, location, total_value, token_supply, token_symbol, "
            "token_price_base, monthly_rent_wei) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (
                payload.name, payload.location, payload.total_value,
                payload.token_supply, payload.token_symbol,
                token_price_wei, monthly_rent_wei,
            ),
        )
        property_id = int(cursor.fetchone()["id"])
        db.commit()
        cursor.execute("SELECT * FROM properties WHERE id = %s", (property_id,))
        return enrich_property_with_supply(cursor, cursor.fetchone())
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()


@router.get("/properties", response_model=list[PropertyRead])
def list_properties(db=Depends(get_db)):
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute("SELECT * FROM properties ORDER BY id DESC")
        rows = cursor.fetchall()
        return [enrich_property_with_supply(cursor, row) for row in rows]
    finally:
        cursor.close()


@router.get("/properties/{property_id}", response_model=PropertyRead)
def get_property(property_id: int, db=Depends(get_db)):
    cursor = db.cursor(dictionary=True)
    try:
        property_item = fetch_property(cursor, property_id)
        if not property_item:
            raise HTTPException(status_code=404, detail="Property not found")
        return enrich_property_with_supply(cursor, property_item)
    finally:
        cursor.close()


@router.put("/properties/{property_id}", response_model=PropertyRead, dependencies=[Depends(require_property_owner)])
def update_property(property_id: int, payload: PropertyCreate, db=Depends(get_db)):
    """Update a property record. DB-only.

    token_sale_price_eth is rejected if the SecurityToken is already deployed
    (the on-chain sale price is immutable after deploy).
    """
    if payload.token_sale_price_eth <= 0:
        raise HTTPException(status_code=400, detail="token_sale_price_eth must be > 0")

    cursor = db.cursor(dictionary=True)
    try:
        prop = lock_property(cursor, property_id)
        if not prop:
            raise HTTPException(status_code=404, detail="Property not found")

        new_price_wei = str(to_wei(payload.token_sale_price_eth))
        if prop.get("token_address") and (prop.get("token_price_base") or "") != new_price_wei:
            raise HTTPException(
                status_code=400,
                detail="Cannot change token_sale_price_eth after the SecurityToken contract is deployed.",
            )

        monthly_rent_wei = (
            str(to_wei(payload.monthly_rent_eth)) if payload.monthly_rent_eth is not None else None
        )

        cursor.execute(
            "UPDATE properties SET name = %s, location = %s, total_value = %s, token_supply = %s, "
            "token_symbol = %s, token_price_base = %s, monthly_rent_wei = %s WHERE id = %s",
            (
                payload.name, payload.location, payload.total_value,
                payload.token_supply, payload.token_symbol,
                new_price_wei, monthly_rent_wei, property_id,
            ),
        )
        db.commit()
        cursor.execute("SELECT * FROM properties WHERE id = %s", (property_id,))
        return enrich_property_with_supply(cursor, cursor.fetchone())
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()


@router.post(
    "/properties/{property_id}/deploy-token",
    response_model=PropertyRead,
    dependencies=[Depends(require_property_owner)],
)
def deploy_property_token_endpoint(property_id: int, db=Depends(get_db)):
    """Explicit admin action: deploy the SecurityToken contract for this property.

    Idempotent — if an investable token already exists for the property, returns it.
    """
    cursor = db.cursor(dictionary=True)
    try:
        prop = lock_property(cursor, property_id)
        if not prop:
            raise HTTPException(status_code=404, detail="Property not found")

        prop = deploy_property_token(cursor, prop, property_id)
        db.commit()

        cursor.execute("SELECT * FROM properties WHERE id = %s", (property_id,))
        return enrich_property_with_supply(cursor, cursor.fetchone())
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Token deployment failed: {e}")
    finally:
        cursor.close()


@router.post(
    "/properties/{property_id}/repair-sale-inventory",
    response_model=PropertyRead,
    dependencies=[Depends(require_property_owner)],
)
def repair_sale_inventory(property_id: int, db=Depends(get_db)):
    """Mint the full token supply onto the SecurityToken contract when on-chain totalSupply is zero.

    Primary sale pulls from ``balanceOf(tokenContract)``. Use this if deployment succeeded but the
    initial mint to the sale pool never landed (RPC/gas issues). No-op when ``totalSupply() > 0``.
    """
    cursor = db.cursor(dictionary=True)
    try:
        prop = lock_property(cursor, property_id)
        if not prop:
            raise HTTPException(status_code=404, detail="Property not found")
        require_property_token(prop)
        ensure_security_token_sale_inventory(prop)
        db.commit()
        cursor.execute("SELECT * FROM properties WHERE id = %s", (property_id,))
        return enrich_property_with_supply(cursor, cursor.fetchone())
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close()


@router.get("/properties/{property_id}/verify-contract")
def verify_contract(property_id: int, db=Depends(get_db)):
    """Verify the token contract is properly deployed and responsive."""
    cursor = db.cursor(dictionary=True)
    try:
        property_item = fetch_property(cursor, property_id)
        if not property_item:
            raise HTTPException(status_code=404, detail="Property not found")

        token_address = property_item.get("token_address")
        if not token_address:
            raise HTTPException(status_code=400, detail="Token contract not deployed yet")

        try:
            contract = get_contract("SecurityToken", token_address)
            prop_id = contract.functions.propertyId().call()
            sale_price_wei = contract.functions.salePricePerTokenWei().call()
            contract_balance = get_erc20_balance(contract, token_address)
            owner = contract.functions.owner().call()
            return {
                "token_address": token_address,
                "property_id_on_chain": int(prop_id),
                "sale_price_wei": str(sale_price_wei),
                "sale_price_eth": str(from_wei(int(sale_price_wei))),
                "contract_token_balance": str(contract_balance),
                "contract_token_balance_formatted": (
                    str(contract_balance / (10 ** 18)) if contract_balance else "0"
                ),
                "owner": owner,
                "token_supply_base": str(
                    to_base_units(Decimal(property_item["token_supply"]), TOKEN_DECIMALS)
                ),
                "status": "ok",
            }
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Contract verification failed: {e}")
    finally:
        cursor.close()


@router.post(
    "/properties/{property_id}/mint-nft",
    response_model=PropertyRead,
    dependencies=[Depends(require_property_owner)],
)
def mint_nft(property_id: int, payload: MintNFTRequest, db=Depends(get_db)):
    cursor = db.cursor(dictionary=True)
    try:
        property_item = lock_property(cursor, property_id)
        if not property_item:
            raise HTTPException(status_code=404, detail="Property not found")

        addresses = load_contract_addresses()
        property_nft_address = addresses.get("PropertyNFT")
        if not property_nft_address:
            raise HTTPException(status_code=400, detail="PropertyNFT not deployed")

        token_id, receipt = mint_property_nft(payload.to_address, payload.token_uri)
        cursor.execute(
            "UPDATE properties SET nft_token_id = %s, nft_contract_address = %s WHERE id = %s",
            (token_id, property_nft_address, property_id),
        )
        add_transaction_row(
            cursor,
            receipt.transactionHash.to_0x_hex(),
            "MINT_NFT",
            0,
            property_id,
            receipt.blockNumber,
            payload.to_address,
        )
        db.commit()
        cursor.execute("SELECT * FROM properties WHERE id = %s", (property_id,))
        return enrich_property_with_supply(cursor, cursor.fetchone())
    except Exception:
        db.rollback()
        raise
    finally:
        cursor.close()


@router.post(
    "/properties/{property_id}/issue-tokens",
    response_model=PropertyRead,
    dependencies=[Depends(require_property_owner)],
)
def issue_tokens(property_id: int, payload: IssueTokensRequest, db=Depends(get_db)):
    cursor = db.cursor(dictionary=True)
    try:
        property_item = lock_property(cursor, property_id)
        if not property_item:
            raise HTTPException(status_code=404, detail="Property not found")

        require_property_token(property_item)

        amount_base = to_base_units(payload.amount, TOKEN_DECIMALS)
        max_supply_base = to_base_units(Decimal(property_item["token_supply"]), TOKEN_DECIMALS)
        total_minted_base = get_total_minted_base(cursor, property_id)
        if total_minted_base + Decimal(amount_base) > Decimal(max_supply_base):
            raise HTTPException(status_code=400, detail="Token supply exceeded")

        set_whitelist(property_item["token_address"], payload.to_address, True)
        mint_receipt = mint_security_tokens(
            property_item["token_address"], payload.to_address, payload.amount
        )
        reconcile_transaction(mint_receipt.transactionHash.to_0x_hex())

        db.commit()
        cursor.execute("SELECT * FROM properties WHERE id = %s", (property_id,))
        return enrich_property_with_supply(cursor, cursor.fetchone())
    except Exception:
        db.rollback()
        raise
    finally:
        cursor.close()


@router.post(
    "/properties/{property_id}/transfer",
    response_model=PropertyRead,
    dependencies=[Depends(require_property_owner)],
)
def transfer_tokens(property_id: int, payload: TransferTokensRequest, db=Depends(get_db)):
    cursor = db.cursor(dictionary=True)
    try:
        property_item = lock_property(cursor, property_id)
        if not property_item or not property_item.get("token_address"):
            raise HTTPException(status_code=404, detail="Property/token not found")

        set_whitelist(property_item["token_address"], payload.to_address, True)
        transfer_receipt = transfer_security_tokens(
            property_item["token_address"], payload.to_address, payload.amount
        )
        reconcile_transaction(transfer_receipt.transactionHash.to_0x_hex())

        db.commit()
        cursor.execute("SELECT * FROM properties WHERE id = %s", (property_id,))
        return enrich_property_with_supply(cursor, cursor.fetchone())
    except Exception:
        db.rollback()
        raise
    finally:
        cursor.close()
