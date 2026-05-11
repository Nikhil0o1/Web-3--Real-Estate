"""End-to-end smoke test of the wallet auth flow."""
import sys
sys.path.insert(0, '.')

import json
import urllib.request

from eth_account import Account
from eth_account.messages import encode_defunct

BASE = "http://127.0.0.1:8765"


def http(method, path, body=None, token=None):
    url = BASE + path
    data = None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def assert_eq(label, actual, expected):
    ok = actual == expected
    print(f"  {'OK ' if ok else 'BAD'}  {label}: actual={actual!r} expected={expected!r}")
    assert ok, label


# 1) Health
print("== health ==")
s, body = http("GET", "/health")
print(s, body)

# 2) Public routes still work
print("\n== /properties (public) ==")
s, body = http("GET", "/properties")
print(f"  status={s} count={len(body) if isinstance(body, list) else 'n/a'}")
assert s == 200

# 3) /users requires admin
print("\n== /users without token ==")
s, body = http("GET", "/users")
print(s, body)
assert s == 401

# 4) Full sign-in flow
print("\n== full investor sign-in ==")
acct = Account.create()
print(f"  test wallet: {acct.address}")

# 4a) nonce
s, body = http("POST", "/auth/nonce", {"wallet_address": acct.address})
print("  nonce status:", s)
assert s == 200, body
nonce = body["nonce"]
message = body["message"]
print(f"  nonce={nonce[:20]}... expires_at={body['expires_at']}")

# 4b) sign + verify
signed = acct.sign_message(encode_defunct(text=message))
signature = signed.signature.hex() if isinstance(signed.signature, bytes) else signed.signature
if isinstance(signature, str) and not signature.startswith("0x"):
    signature = "0x" + signature
s, body = http("POST", "/auth/verify", {"wallet_address": acct.address, "signature": signature, "nonce": nonce})
print("  verify status:", s)
print("  verify body:", {k: (v if k != 'token' else (v[:30] + '...' if v else '')) for k, v in body.items()})
assert s == 200, body
assert body["is_new_user"] is True, "expected new user"

# 4c) register (need a NEW nonce since /verify consumed the previous one)
s, body = http("POST", "/auth/nonce", {"wallet_address": acct.address})
nonce2 = body["nonce"]
message2 = body["message"]
sig2 = acct.sign_message(encode_defunct(text=message2)).signature
sig2 = sig2.hex() if isinstance(sig2, bytes) else sig2
if isinstance(sig2, str) and not sig2.startswith("0x"):
    sig2 = "0x" + sig2
s, body = http("POST", "/auth/register", {
    "wallet_address": acct.address,
    "signature": sig2,
    "nonce": nonce2,
    "role": "investor",
})
print("  register status:", s)
assert s == 201, body
token = body["token"]
print(f"  got token (len={len(token)})  user.role={body['user']['role']}")

# 4d) /auth/me
s, body = http("GET", "/auth/me", token=token)
print("  /auth/me status:", s)
assert s == 200, body
print("  me:", body)
assert_eq("role", body["role"], "investor")
assert_eq("wallet", body["wallet_address"].lower(), acct.address.lower())

# 5) Investor token can access /portfolio of own wallet
s, body = http("GET", f"/portfolio/{acct.address}", token=token)
print(f"\n== /portfolio (self) ==  status={s}")
assert s == 200, body

# 6) Investor token CANNOT access another wallet's portfolio
other = Account.create().address
s, body = http("GET", f"/portfolio/{other}", token=token)
print(f"\n== /portfolio (other) ==  status={s} (expected 403)")
assert s == 403, body

# 7) Investor token CANNOT do admin things
s, body = http("POST", "/properties", {
    "name": "X", "location": "X", "total_value": "100",
    "token_supply": "1000", "token_symbol": "X", "token_sale_price_eth": "0.01",
}, token=token)
print(f"\n== POST /properties as investor ==  status={s} (expected 403)")
assert s == 403, body

# 8) Admin gating: random wallet cannot register as admin
acct2 = Account.create()
s, body = http("POST", "/auth/nonce", {"wallet_address": acct2.address})
nonce3 = body["nonce"]; message3 = body["message"]
sig3 = acct2.sign_message(encode_defunct(text=message3)).signature
sig3 = sig3.hex() if isinstance(sig3, bytes) else sig3
if isinstance(sig3, str) and not sig3.startswith("0x"):
    sig3 = "0x" + sig3
s, body = http("POST", "/auth/register", {
    "wallet_address": acct2.address,
    "signature": sig3,
    "nonce": nonce3,
    "role": "admin",
})
print(f"\n== register as admin (random wallet) ==  status={s} (expected 403)")
assert s == 403, body

# 9) Replay protection: re-using the same nonce fails
s, body = http("POST", "/auth/verify", {"wallet_address": acct.address, "signature": signature, "nonce": nonce})
print(f"\n== nonce replay attack ==  status={s} (expected 401)")
assert s == 401, body

# 10) Logout revokes the session
s, body = http("POST", "/auth/logout", {}, token=token)
print(f"\n== /auth/logout ==  status={s}")
s, body = http("GET", "/auth/me", token=token)
print(f"== /auth/me after logout ==  status={s} (expected 401)")
assert s == 401, body

print("\nALL AUTH SMOKE TESTS PASSED")
