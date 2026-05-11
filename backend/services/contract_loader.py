import json
from pathlib import Path

from backend.config.settings import ARTIFACTS_DIR, CONTRACT_ADDRESSES_PATH


def load_contract_addresses() -> dict:
    path = Path(CONTRACT_ADDRESSES_PATH)
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def get_contract_address(name: str) -> str | None:
    addresses = load_contract_addresses()
    return addresses.get(name)


def load_artifact(contract_name: str) -> tuple[list, str]:
    artifact_path = Path(ARTIFACTS_DIR) / f"{contract_name}.sol" / f"{contract_name}.json"
    if not artifact_path.exists():
        raise FileNotFoundError(f"Missing artifact: {artifact_path}")
    data = json.loads(artifact_path.read_text())
    return data["abi"], data["bytecode"]
