"""Verify tenant flow: register as tenant, access own data, blocked from cross-wallet."""
import sys
sys.path.insert(0, '.')

import json
import urllib.request

from eth_account import Account
from eth_account.messages import encode_defunct

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
            return e.code, {"detail": "non-json"}


def register_as(acct, role):
    s, body = http("POST", "/auth/nonce", {"wallet_address": acct.address})
    assert s == 200
    sig = acct.sign_message(encode_defunct(text=body["message"])).signature
    sig = sig.hex() if isinstance(sig, bytes) else sig
    if isinstance(sig, str) and not sig.startswith("0x"):
        sig = "0x" + sig
    s, body = http("POST", "/auth/verify", {
        "wallet_address": acct.address, "signature": sig, "nonce": body["nonce"],
    })
    assert s == 200
    if body["is_new_user"]:
        s, body = http("POST", "/auth/nonce", {"wallet_address": acct.address})
        sig2 = acct.sign_message(encode_defunct(text=body["message"])).signature
        sig2 = sig2.hex() if isinstance(sig2, bytes) else sig2
        if isinstance(sig2, str) and not sig2.startswith("0x"):
            sig2 = "0x" + sig2
        s, body = http("POST", "/auth/register", {
            "wallet_address": acct.address, "signature": sig2, "nonce": body["nonce"], "role": role,
        })
        assert s == 201, body
    return body["token"], body["user"]


tenant = Account.create()
token, user = register_as(tenant, "tenant")
print(f"tenant signed in: {tenant.address} role={user['role']}")
assert user["role"] == "tenant"

# Tenant can view own payment history (empty for new wallet — but call succeeds)
s, body = http("GET", f"/tenant/payment-history/{tenant.address}", token=token)
print(f"/tenant/payment-history/own  status={s}  body={body if isinstance(body, list) else body}")
assert s == 200

# Tenant can view own active rentals
s, body = http("GET", f"/tenant/active-rentals/{tenant.address}", token=token)
print(f"/tenant/active-rentals/own  status={s}")
assert s == 200

# Tenant CANNOT view other wallet's history
other = Account.create().address
s, body = http("GET", f"/tenant/payment-history/{other}", token=token)
print(f"/tenant/payment-history/other  status={s} (expected 403)")
assert s == 403

# Tenant CANNOT call investor endpoints
s, body = http("GET", f"/investor/yield-summary/{tenant.address}", token=token)
print(f"/investor/yield-summary as tenant  status={s} (expected 403)")
assert s == 403

# Tenant CANNOT call admin endpoints
s, body = http("POST", "/properties/1/set-rent", {"monthly_rent_eth": "0.5"}, token=token)
print(f"POST /properties/1/set-rent as tenant  status={s} (expected 403)")
assert s == 403

# Public marketplace works for tenant
s, body = http("GET", "/tenant/properties")
print(f"/tenant/properties (public)  status={s}")
assert s == 200

print("\nTENANT SMOKE TESTS PASSED")
