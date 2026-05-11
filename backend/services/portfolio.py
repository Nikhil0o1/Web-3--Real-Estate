from backend.db.connection import get_connection
from backend.services.blockchain import get_web3


def get_portfolio(wallet_address: str):
    web3 = get_web3()
    if not web3.is_address(wallet_address):
        return []
    checksum = web3.to_checksum_address(wallet_address)
    db = get_connection()
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT id FROM users WHERE LOWER(wallet_address) = LOWER(%s)",
            (checksum,),
        )
        user = cursor.fetchone()
        if not user:
            return []

        cursor.execute(
            "SELECT t.property_id, t.token_amount, p.name AS property_name "
            "FROM token_ownerships t "
            "JOIN properties p ON p.id = t.property_id "
            "WHERE t.user_id = %s AND t.token_amount > 0",
            (user["id"],)
        )
        return cursor.fetchall()
    finally:
        cursor.close()
        db.close()
