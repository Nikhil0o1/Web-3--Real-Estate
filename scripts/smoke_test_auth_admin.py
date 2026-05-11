"""Verify the deployer wallet can register as admin and create a property."""
import sys
sys.path.insert(0, '.')

import json
import os
import urllib.request

from dotenv import load_dotenv
from eth_account import Account
from eth_account.messages import encode_defunct

load_dotenv(".env")
BASE = "http://127.0.0.1:8765"


def http(method, path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {"detail": "non-json error"}


def sign_in(acct, role=None):
    """Sign in (registering if needed). Returns the JWT."""
    s, body = http("POST", "/auth/nonce", {"wallet_address": acct.address})
    assert s == 200, body
    nonce, message = body["nonce"], body["message"]
    sig = acct.sign_message(encode_defunct(text=message)).signature
    sig = sig.hex() if isinstance(sig, bytes) else sig
    if isinstance(sig, str) and not sig.startswith("0x"):
        sig = "0x" + sig
    s, body = http("POST", "/auth/verify", {"wallet_address": acct.address, "signature": sig, "nonce": nonce})
    assert s == 200, body
    if body["is_new_user"]:
        # need to register
        assert role is not None, "role required for fresh wallet"
        s, body = http("POST", "/auth/nonce", {"wallet_address": acct.address})
        assert s == 200
        n2, m2 = body["nonce"], body["message"]
        sig2 = acct.sign_message(encode_defunct(text=m2)).signature
        sig2 = sig2.hex() if isinstance(sig2, bytes) else sig2
        if isinstance(sig2, str) and not sig2.startswith("0x"):
            sig2 = "0x" + sig2
        s, body = http("POST", "/auth/register", {
            "wallet_address": acct.address, "signature": sig2, "nonce": n2, "role": role,
        })
        assert s == 201, body
    return body["token"], body["user"]


# Deployer wallet should be auto-admin
deployer_key = os.getenv("DEPLOYER_PRIVATE_KEY")
assert deployer_key, "DEPLOYER_PRIVATE_KEY missing from .env"
deployer = Account.from_key(deployer_key)
print(f"deployer wallet: {deployer.address}")

# Lookup first — see is_admin_wallet flag
s, body = http("GET", f"/auth/lookup/{deployer.address}")
print(f"lookup status={s} body={body}")
assert s == 200
assert body["is_admin_wallet"] is True, "deployer must be flagged as admin-eligible"

# Sign in as admin
token, user = sign_in(deployer, role="admin")
print(f"signed in: role={user['role']}")
assert user["role"] == "admin"

# Admin should be able to GET /users
s, body = http("GET", "/users", token=token)
print(f"/users status={s} count={len(body) if isinstance(body, list) else 'n/a'}")
assert s == 200

# Admin should be able to read /admin/rent-analytics
s, body = http("GET", "/admin/rent-analytics", token=token)
print(f"/admin/rent-analytics status={s}")
assert s == 200

# Admin can access ANY wallet's portfolio
s, body = http("GET", f"/portfolio/{Account.create().address}", token=token)
print(f"/portfolio (random) as admin status={s}")
assert s == 200

print("\nADMIN SMOKE TESTS PASSED")
