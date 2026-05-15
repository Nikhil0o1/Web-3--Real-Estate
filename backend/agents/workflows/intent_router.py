"""Deterministic workflow intent detection — runs before any LLM / copilot path."""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Protocol


class _WorkflowLike(Protocol):
    roles: tuple[str, ...]
    intent_phrases: tuple[str, ...]
    aliases: tuple[str, ...]


# Words people insert between intent keywords; stripped for matching only.
_INTENT_FILLERS = frozenset(
    {
        "a",
        "an",
        "the",
        "to",
        "for",
        "me",
        "my",
        "please",
        "can",
        "you",
        "i",
        "we",
        "want",
        "wanna",
        "need",
        "would",
        "like",
        "help",
        "with",
        "new",
        "another",
        "some",
        "could",
        "just",
        "show",
        "tell",
        "let",
        "us",
        "go",
        "and",
        "or",
        "now",
        "quickly",
        "quick",
        "hey",
        "hi",
        "hello",
    }
)


def _normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").lower()).strip()


def collapse_intent_fillers(value: str) -> str:
    """Drop filler tokens so \"create a new property\" → \"create property\"."""
    tokens = [t for t in _normalize_whitespace(value).split() if t and t not in _INTENT_FILLERS]
    return " ".join(tokens)


def _ordered_token_subsequence(query_tokens: list[str], phrase_tokens: list[str]) -> bool:
    """True if phrase_tokens occur in order within query_tokens (not necessarily adjacent)."""
    if not phrase_tokens:
        return False
    qi = 0
    for pt in phrase_tokens:
        while qi < len(query_tokens):
            if query_tokens[qi] == pt:
                qi += 1
                break
            qi += 1
        else:
            return False
    return True


def phrase_matches_message(normalized_query: str, phrase: str) -> bool:
    """Whether user text expresses the template phrase."""
    q_norm = _normalize_whitespace(normalized_query)
    q_collapsed = collapse_intent_fillers(normalized_query)
    p_norm = _normalize_whitespace(phrase)
    p_collapsed = collapse_intent_fillers(phrase)

    if p_collapsed and p_collapsed in q_collapsed:
        return True
    if p_norm and p_norm in q_norm:
        return True

    q_tokens = q_collapsed.split()
    p_tokens = p_collapsed.split()
    if len(p_tokens) >= 2 and _ordered_token_subsequence(q_tokens, p_tokens):
        return True

    return False


def match_workflow_template(message: str, role: str, templates: Iterable[_WorkflowLike]) -> _WorkflowLike | None:
    """Highest-scoring template for role, or None."""
    role = str(role or "").strip().lower()
    if not role:
        return None

    normalized_msg = _normalize_whitespace(message)
    if not normalized_msg:
        return None

    matches: list[tuple[int, int, _WorkflowLike]] = []
    for template in templates:
        if role not in template.roles:
            continue
        phrases = tuple(template.intent_phrases) + tuple(template.aliases)
        for phrase in phrases:
            if not phrase_matches_message(message, phrase):
                continue
            p_collapsed = collapse_intent_fillers(phrase)
            score = len(p_collapsed.split()) * 100 + len(p_collapsed)
            matches.append((score, len(p_collapsed), template))

    if not matches:
        return None

    matches.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return matches[0][2]
