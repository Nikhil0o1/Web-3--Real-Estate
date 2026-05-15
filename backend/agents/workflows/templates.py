"""Endpoint-driven workflow template registry.

These templates are intentionally deterministic. They describe existing product
workflows, the fields needed to drive the existing UI/forms, and the endpoint or
prepare route that remains the source of business logic.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any

from backend.agents.workflows.intent_router import match_workflow_template


Action = dict[str, Any]


@dataclass(frozen=True)
class WorkflowField:
    key: str
    question: str
    field_type: str = "text"
    required: bool = True
    modal: str | None = None
    ui_field: str | None = None
    validation: str | None = None


@dataclass(frozen=True)
class WorkflowTemplate:
    workflow_id: str
    label: str
    endpoint: str
    method: str
    roles: tuple[str, ...]
    intent_phrases: tuple[str, ...]
    fields: tuple[WorkflowField, ...]
    start_actions: tuple[Action, ...]
    execution_actions: tuple[Action, ...]
    success_behavior: str
    metamask_required: bool = False
    aliases: tuple[str, ...] = field(default_factory=tuple)
    ready_requires_any: tuple[str, ...] = field(default_factory=tuple)

    def field(self, key: str) -> WorkflowField | None:
        for item in self.fields:
            if item.key == key:
                return item
        return None

    @property
    def required_keys(self) -> tuple[str, ...]:
        return tuple(item.key for item in self.fields if item.required)


CREATE_PROPERTY_WORKFLOW = WorkflowTemplate(
    workflow_id="CREATE_PROPERTY_WORKFLOW",
    label="Create property",
    endpoint="/properties",
    method="POST",
    roles=("property_owner",),
    intent_phrases=(
        "create property",
        "add property",
        "new property",
        "list property",
        "make a property",
        "create a property",
        "create a new property",
        "make property",
        "start creating property",
        "create proeprty",
        "new proeprty",
    ),
    aliases=("property create",),
    fields=(
        WorkflowField(
            key="name",
            question="What would you like the property name to be?",
            modal="CREATE_PROPERTY",
            ui_field="name",
            validation="text",
        ),
        WorkflowField(
            key="location",
            question="Where is the property located?",
            modal="CREATE_PROPERTY",
            ui_field="location",
            validation="text",
        ),
        WorkflowField(
            key="total_value",
            question="What is the total value in ETH?",
            field_type="number",
            modal="CREATE_PROPERTY",
            ui_field="total_value",
            validation="positive_decimal",
        ),
        WorkflowField(
            key="token_supply",
            question="How many ownership tokens should be issued?",
            field_type="integer",
            modal="CREATE_PROPERTY",
            ui_field="token_supply",
            validation="positive_integer",
        ),
        WorkflowField(
            key="token_symbol",
            question="What token symbol should I use?",
            modal="CREATE_PROPERTY",
            ui_field="token_symbol",
            validation="token_symbol",
        ),
        WorkflowField(
            key="monthly_rent_eth",
            question="What monthly rent should be set in ETH?",
            field_type="number",
            required=False,
            modal="CREATE_PROPERTY",
            ui_field="monthly_rent_eth",
            validation="non_negative_decimal",
        ),
    ),
    start_actions=(
        {"type": "NAVIGATE", "route": "/property_owner/properties"},
        {"type": "OPEN_MODAL", "modal": "CREATE_PROPERTY"},
    ),
    execution_actions=({"type": "SUBMIT_FORM", "modal": "CREATE_PROPERTY"},),
    success_behavior="Create through the existing property modal and refresh property lists.",
    metamask_required=False,
)


EDIT_PROPERTY_WORKFLOW = WorkflowTemplate(
    workflow_id="EDIT_PROPERTY_WORKFLOW",
    label="Edit property",
    endpoint="/properties/{property_id}",
    method="PUT",
    roles=("property_owner",),
    intent_phrases=("edit property", "update property", "change property"),
    fields=(
        WorkflowField(
            key="property_id",
            question="Which property ID should I edit?",
            field_type="integer",
            modal="EDIT_PROPERTY",
            ui_field="property_id",
            validation="positive_integer",
        ),
        WorkflowField(
            key="name",
            question="What should the updated property name be?",
            required=False,
            modal="EDIT_PROPERTY",
            ui_field="name",
            validation="text",
        ),
        WorkflowField(
            key="location",
            question="What should the updated location be?",
            required=False,
            modal="EDIT_PROPERTY",
            ui_field="location",
            validation="text",
        ),
        WorkflowField(
            key="total_value",
            question="What should the updated total value be in ETH?",
            field_type="number",
            required=False,
            modal="EDIT_PROPERTY",
            ui_field="total_value",
            validation="positive_decimal",
        ),
        WorkflowField(
            key="token_supply",
            question="What should the updated token supply be?",
            field_type="integer",
            required=False,
            modal="EDIT_PROPERTY",
            ui_field="token_supply",
            validation="positive_integer",
        ),
        WorkflowField(
            key="token_symbol",
            question="What should the updated token symbol be?",
            required=False,
            modal="EDIT_PROPERTY",
            ui_field="token_symbol",
            validation="token_symbol",
        ),
        WorkflowField(
            key="monthly_rent_eth",
            question="What should the updated monthly rent be in ETH?",
            field_type="number",
            required=False,
            modal="EDIT_PROPERTY",
            ui_field="monthly_rent_eth",
            validation="non_negative_decimal",
        ),
    ),
    start_actions=(
        {"type": "NAVIGATE", "route": "/property_owner/properties"},
        {"type": "OPEN_MODAL", "modal": "EDIT_PROPERTY", "requires": ("property_id",)},
    ),
    execution_actions=({"type": "SUBMIT_FORM", "modal": "EDIT_PROPERTY"},),
    success_behavior="Update through the existing property edit modal.",
    ready_requires_any=("name", "location", "total_value", "token_supply", "token_symbol", "monthly_rent_eth"),
)


INVEST_WORKFLOW = WorkflowTemplate(
    workflow_id="INVEST_WORKFLOW",
    label="Invest",
    endpoint="/investments/prepare",
    method="POST",
    roles=("investor",),
    intent_phrases=("invest", "buy tokens", "purchase tokens", "buy shares", "invest in property"),
    fields=(
        WorkflowField(
            key="property_id",
            question="Which property ID should I invest in?",
            field_type="integer",
            modal="INVEST_PROPERTY",
            ui_field="property_id",
            validation="positive_integer",
        ),
        WorkflowField(
            key="token_amount",
            question="How many tokens should I buy?",
            field_type="integer",
            modal="INVEST_PROPERTY",
            ui_field="token_amount",
            validation="positive_integer",
        ),
    ),
    start_actions=(
        {"type": "NAVIGATE", "route": "/investor/marketplace"},
        {"type": "OPEN_MODAL", "modal": "INVEST_PROPERTY", "requires": ("property_id",)},
    ),
    execution_actions=({"type": "SUBMIT_FORM", "modal": "INVEST_PROPERTY"},),
    success_behavior="Prepare the investment, open MetaMask, confirm, and refresh investor state.",
    metamask_required=True,
)


PAY_RENT_WORKFLOW = WorkflowTemplate(
    workflow_id="PAY_RENT_WORKFLOW",
    label="Pay rent",
    endpoint="/tenant/pay-rent/prepare/{property_id}",
    method="GET",
    roles=("tenant",),
    intent_phrases=("pay rent", "rent payment", "pay my rent", "make rent payment"),
    fields=(
        WorkflowField(
            key="property_id",
            question="Which property ID should I pay rent for?",
            field_type="integer",
            modal="PAY_RENT",
            ui_field="property_id",
            validation="positive_integer",
        ),
    ),
    start_actions=(
        {"type": "NAVIGATE", "route": "/tenant/rentals"},
        {"type": "OPEN_MODAL", "modal": "PAY_RENT", "requires": ("property_id",)},
    ),
    execution_actions=({"type": "SUBMIT_FORM", "modal": "PAY_RENT"},),
    success_behavior="Prepare the rent payment, open MetaMask, confirm, and refresh tenant state.",
    metamask_required=True,
)


CLAIM_REWARDS_WORKFLOW = WorkflowTemplate(
    workflow_id="CLAIM_REWARDS_WORKFLOW",
    label="Claim rewards",
    endpoint="/rewards/prepare-claim",
    method="POST",
    roles=("investor",),
    intent_phrases=("claim rewards", "claim yield", "withdraw yield", "claim rental yield"),
    fields=(
        WorkflowField(
            key="property_id",
            question="Which property ID should I claim rewards from?",
            field_type="integer",
            modal="CLAIM_REWARDS",
            ui_field="property_id",
            validation="positive_integer",
        ),
    ),
    start_actions=(
        {"type": "NAVIGATE", "route": "/investor/yield"},
        {"type": "OPEN_MODAL", "modal": "CLAIM_REWARDS", "requires": ("property_id",)},
    ),
    execution_actions=({"type": "SUBMIT_FORM", "modal": "CLAIM_REWARDS"},),
    success_behavior="Prepare the claim, open MetaMask, confirm, and refresh yield state.",
    metamask_required=True,
)


OPEN_GOVERNANCE_WORKFLOW = WorkflowTemplate(
    workflow_id="OPEN_GOVERNANCE_WORKFLOW",
    label="Open governance",
    endpoint="/property_owner/governance",
    method="NAVIGATE",
    roles=("property_owner",),
    intent_phrases=("open governance", "go to governance", "show governance", "ai governance"),
    fields=(),
    start_actions=({"type": "NAVIGATE", "route": "/property_owner/governance"},),
    execution_actions=(),
    success_behavior="Navigate to the existing AI governance page.",
)


WORKFLOW_REGISTRY: dict[str, WorkflowTemplate] = {
    item.workflow_id: item
    for item in (
        CREATE_PROPERTY_WORKFLOW,
        EDIT_PROPERTY_WORKFLOW,
        INVEST_WORKFLOW,
        PAY_RENT_WORKFLOW,
        CLAIM_REWARDS_WORKFLOW,
        OPEN_GOVERNANCE_WORKFLOW,
    )
}


def list_workflow_templates() -> list[WorkflowTemplate]:
    return list(WORKFLOW_REGISTRY.values())


def get_workflow_template(workflow_id: str | None) -> WorkflowTemplate | None:
    if not workflow_id:
        return None
    return WORKFLOW_REGISTRY.get(str(workflow_id).strip().upper())


def resolve_workflow_template(message: str, role: str) -> WorkflowTemplate | None:
    return match_workflow_template(message, role, WORKFLOW_REGISTRY.values())


def field_to_action(field: WorkflowField, value: Any) -> Action | None:
    if not field.modal or not field.ui_field:
        return None
    return {
        "type": "FILL_FIELD",
        "modal": field.modal,
        "field": field.ui_field,
        "value": str(value),
    }


def focus_action(field: WorkflowField) -> Action | None:
    if not field.modal or not field.ui_field or field.ui_field == "property_id":
        return None
    return {"type": "FOCUS_FIELD", "modal": field.modal, "field": field.ui_field}


def materialize_actions(actions: tuple[Action, ...] | list[Action], fields: dict[str, Any]) -> list[Action]:
    out: list[Action] = []
    for action in actions:
        req = action.get("requires")
        if req and any(str(k) not in fields or fields.get(str(k)) in (None, "") for k in req):
            continue
        item = {k: v for k, v in action.items() if k != "requires"}
        for key, value in fields.items():
            if key not in item:
                item[key] = value
        out.append(item)
    return out


def validate_field(field: WorkflowField, value: Any) -> tuple[bool, str | None, Any]:
    raw = "" if value is None else str(value).strip()
    if field.required and not raw:
        return False, "This field is required.", value
    if not raw:
        return True, None, ""

    validation = field.validation or field.field_type
    if validation == "text":
        return (True, None, raw) if raw else (False, "Please provide a value.", value)
    if validation in {"positive_decimal", "non_negative_decimal"}:
        raw_number = _number_fragment(raw) or raw
        try:
            amount = Decimal(raw_number.replace(",", ""))
        except (InvalidOperation, ValueError):
            return False, "Please give me a number.", value
        if validation == "positive_decimal" and amount <= 0:
            return False, "Please give me a number greater than zero.", value
        if validation == "non_negative_decimal" and amount < 0:
            return False, "Please give me zero or a positive number.", value
        return True, None, _decimal_to_plain(amount)
    if validation == "positive_integer":
        raw_number = _number_fragment(raw) or raw
        try:
            amount = Decimal(raw_number.replace(",", ""))
        except (InvalidOperation, ValueError):
            return False, "Please give me a whole number.", value
        if amount <= 0 or amount != amount.to_integral_value():
            return False, "Please give me a whole number greater than zero.", value
        return True, None, str(int(amount))
    if validation == "token_symbol":
        symbol = raw.upper().replace(" ", "")
        if not re.fullmatch(r"[A-Z0-9]{2,12}", symbol):
            return False, "Token symbols should be 2-12 letters or numbers.", value
        return True, None, symbol
    return True, None, raw


_TOKEN_WORD_AMOUNTS: dict[str, str] = {
    "zero": "0",
    "one": "1",
    "two": "2",
    "three": "3",
    "four": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8",
    "nine": "9",
    "ten": "10",
    "a": "1",
    "an": "1",
}


def _spoken_token_amount_fragment(text: str) -> str | None:
    """Word forms like ``one token`` / ``a share`` (digits are handled separately)."""
    m = re.search(
        r"\b(one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+(?:tokens?|shares?)\b",
        text,
        re.IGNORECASE,
    )
    if not m:
        return None
    return _TOKEN_WORD_AMOUNTS.get(m.group(1).lower())


def extract_field_values(
    template: WorkflowTemplate,
    message: str,
    *,
    active_field: str | None = None,
    allow_active_capture: bool = False,
) -> dict[str, Any]:
    text = (message or "").strip()
    q = _normalize(text)
    values: dict[str, Any] = {}

    property_id = _first_match(text, (r"\bproperty\s*(?:id|#)?\s*(\d+)\b", r"#\s*(\d+)\b"))
    if property_id and template.field("property_id"):
        values["property_id"] = property_id

    token_amount = _first_match(text, (r"\b(\d+(?:\.\d+)?)\s*(?:tokens?|shares?)\b",))
    if not token_amount:
        token_amount = _spoken_token_amount_fragment(text)
    if token_amount and template.field("token_amount"):
        values["token_amount"] = token_amount

    total_value = _first_match(
        text,
        (
            r"\b(?:total\s+value|valued\s+at|worth|value)\s*(?:is|of|at)?\s*(\d+(?:\.\d+)?)\s*(?:eth)?\b",
        ),
    )
    if total_value and template.field("total_value"):
        values["total_value"] = total_value

    token_supply = _first_match(text, (r"\b(?:token\s+supply|supply)\s*(?:is|of)?\s*(\d+)\b",))
    if token_supply and template.field("token_supply"):
        values["token_supply"] = token_supply

    token_symbol = _first_match(text, (r"\b(?:token\s+symbol|symbol|ticker)\s*(?:is|as)?\s*([A-Za-z0-9]{2,12})\b",))
    if token_symbol and template.field("token_symbol"):
        values["token_symbol"] = token_symbol

    monthly_rent = _first_match(
        text,
        (r"\b(?:monthly\s+rent|rent)\s*(?:is|of|at)?\s*(\d+(?:\.\d+)?)\s*(?:eth)?\b",),
    )
    if monthly_rent and template.field("monthly_rent_eth"):
        values["monthly_rent_eth"] = monthly_rent

    named = _first_match(
        text,
        (
            r"\b(?:the\s+)?(?:property\s+)?name\s+should\s+be\s*[\"\']?([^\"\'\n,]{1,120}?)[\"\']?(?:\s*[,.]|$)",
            r"\b(?:property\s+)?name\s+(?:is|should\s+be|=|:)\s*[\"\']?([^\"\'\n]{1,120}?)[\"\']?(?:\s*[,.]|$)",
            r"\b(?:named|called)\s+(?:is\s+)?[\"\']([^\"\']{1,120})[\"\']",
            r"\b(?:named|called)\s+([A-Za-z0-9][A-Za-z0-9 .'-]{1,80})",
            r"\bname\s+[\"\']([^\"\']{1,120})[\"\' ]",
        ),
    )
    if not named:
        quoted = _first_match(text, (r"[\"\']([A-Za-z0-9][A-Za-z0-9 .,&'-]{1,120})[\"\']",))
        if quoted and template.field("name") and active_field == "name":
            named = quoted
    if named and template.field("name"):
        values["name"] = _strip_trailing_field_noise(named)

    # Do not use a bare ``\bin\b`` — it fires on ``invest … in …`` and steals the property name as ``location``.
    located = _first_match(
        text,
        (
            r"\b(?:located\s+in|situated\s+in|found\s+in)\s*[\"\']?([^\"\'\n]{1,120}?)[\"\']?(?:\s*[,.]|$)",
            r"\b(?:location|address)\s+(?:is|should\s+be)\s*[\"\']?([^\"\'\n]{1,120}?)[\"\']?(?:\s*[,.]|$)",
        ),
    )
    if located and template.field("location") and not _looks_like_invest_utterance(q):
        values["location"] = _strip_trailing_field_noise(located)

    if allow_active_capture and active_field and active_field not in values:
        field = template.field(active_field)
        if field and text:
            values[active_field] = text

    return values


def _normalize(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").lower()).strip()


def _looks_like_invest_utterance(q: str) -> bool:
    return any(
        tok in q
        for tok in (
            "invest",
            "buy token",
            "purchase token",
            "buy share",
            "token in ",
            "invest in ",
        )
    )


def _first_match(text: str, patterns: tuple[str, ...]) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return str(match.group(1)).strip()
    return None


def _strip_trailing_field_noise(value: str) -> str:
    cleaned = re.split(
        r"\b(?:located in|location is|worth|value|total value|token supply|supply|symbol|ticker|monthly rent|rent)\b",
        value,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    return cleaned.strip(" ,.;")


def _number_fragment(value: str) -> str | None:
    match = re.search(r"\d+(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?", value)
    return match.group(0) if match else None


def _decimal_to_plain(value: Decimal) -> str:
    plain = format(value.normalize(), "f")
    if "." in plain:
        plain = plain.rstrip("0").rstrip(".")
    return plain or "0"
