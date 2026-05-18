"""EstateChain conversational AI runtime.

A production-grade agent module built on LangGraph that gives each role
(property owner, investor, tenant) a conversational agent that:

* answers questions about the user's own data by calling read-only tools that
  hit the real backend services (DB, blockchain indexer);
* automates workflows (create property, invest, pay rent, claim rewards) by
  returning typed UI actions that the frontend executes — same MetaMask /
  modal pipeline the dashboards already use;
* speaks back via browser-native TTS (default) with OpenAI / ElevenLabs as
  optional enhancement layers;
* persists conversation checkpoints in Postgres so multi-step workflows survive
  interruptions and can resume exactly where they left off.

Everything lives under one prefix: ``/api/ai``.
"""

__all__: list[str] = []
