"""Smart phrase buffer for TTS streaming.

Token-by-token text feeding into ElevenLabs WS produces fragmented prosody
because the engine doesn't see enough context per generation to inflect
correctly. This buffer accumulates LLM tokens and releases natural-sounding
phrase chunks (25..60 chars, broken at punctuation or word boundaries) so the
TTS hears intent rather than noise.

Boundary policy, in order of preference:
  1. Hard sentence terminator (. ! ?) after >= ``min_chars``.
  2. Soft phrase terminator (, ; :) after >= ``min_chars``.
  3. Whitespace boundary once we cross ``max_chars`` (hard flush).
"""
from __future__ import annotations

_HARD_TERMINATORS = ".!?"
_SOFT_TERMINATORS = ",;:"


class SmartChunkBuffer:
    """Stateful chunker. Single-threaded; one instance per turn."""

    def __init__(self, min_chars: int = 25, max_chars: int = 60) -> None:
        self.min_chars = min_chars
        self.max_chars = max_chars
        self._buf = ""

    def feed(self, token: str) -> list[str]:
        """Append a token; return any phrase chunks that are now ready to flush."""
        if not token:
            return []
        self._buf += token
        chunks: list[str] = []
        while True:
            extracted = self._extract_one()
            if extracted is None:
                break
            chunks.append(extracted)
        return chunks

    def flush(self) -> str | None:
        """Return whatever is left in the buffer (end of stream)."""
        tail = self._buf.strip()
        self._buf = ""
        return tail or None

    # ---- internals --------------------------------------------------------

    def _extract_one(self) -> str | None:
        buf = self._buf
        n = len(buf)
        if n < self.min_chars:
            return None

        # Hard sentence boundary — flush as soon as we see one after min_chars.
        idx = self._find_last_in(buf, _HARD_TERMINATORS, n)
        if idx >= self.min_chars - 1:
            return self._cut(idx + 1)

        if n >= self.max_chars:
            # Force flush at a whitespace boundary, falling back to a hard cut.
            ws = buf.rfind(" ", self.min_chars, self.max_chars + 1)
            return self._cut(ws if ws > 0 else self.max_chars)

        # Soft boundary — only after we've crossed min_chars.
        idx = self._find_last_in(buf, _SOFT_TERMINATORS, n)
        if idx >= self.min_chars - 1:
            return self._cut(idx + 1)

        return None

    @staticmethod
    def _find_last_in(buf: str, chars: str, end: int) -> int:
        for i in range(end - 1, -1, -1):
            if buf[i] in chars:
                return i
        return -1

    def _cut(self, at: int) -> str:
        chunk = self._buf[:at].rstrip()
        self._buf = self._buf[at:].lstrip()
        return chunk
