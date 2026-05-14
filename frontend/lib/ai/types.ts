"use client";

export type CopilotCitation = {
  source: string;
  detail: string;
};

export type RecommendedAction = {
  action_id: string;
  title: string;
  rationale: string;
  requires_wallet: boolean;
};

export type PreparedTransactionData = {
  property_id?: number;
  investment_id?: number;
  token_amount?: string | number;
  eth_amount_wei?: string;
  recipient_address?: string;
  rent_contract_address?: string;
  claimable_amount_wei?: string;
  claimable_amount_eth?: string;
  [key: string]: unknown;
};

export type PreparedTransaction = {
  tool: string;
  ok: boolean;
  error?: string | null;
  data: PreparedTransactionData;
};

export type CopilotInteractionMode = "advisory" | "execution";

export type InvestorCopilotStructuredResponse = {
  message: string;
  reasoning_summary: string;
  recommended_actions: RecommendedAction[];
  tool_results: Array<Record<string, unknown>>;
  analytics_summary: Record<string, unknown>;
  prepared_transactions: PreparedTransaction[];
  warnings: string[];
  citations: CopilotCitation[];
  intent: string;
  stream_progress: string[];
  /** Advisory = explain/analyze; execution = act-first when a prepared tx exists. */
  interaction_mode?: CopilotInteractionMode;
  /** When true, the client may auto-invoke MetaMask after a successful tx.prepare_* (user still signs). */
  prompt_metamask?: boolean;
};

export type InvestorCopilotChatRequest = {
  message: string;
  thread_id?: number;
  title?: string;
};

export type CopilotStreamEventName = "lifecycle" | "orchestration" | "progress" | "final" | "error" | "message";

export type CopilotStreamEvent<T = unknown> = {
  event: CopilotStreamEventName;
  data: T;
};

export type CopilotMessageRole = "user" | "assistant";

export type CopilotConversationMessage = {
  id: string;
  role: CopilotMessageRole;
  content: string;
  createdAt: string;
  status: "done" | "streaming" | "error";
  structured?: InvestorCopilotStructuredResponse;
  progress?: string[];
};

export type AiActivityKind = "lifecycle" | "progress" | "recommendation" | "execution" | "error" | "system";

export type AiActivityItem = {
  id: string;
  kind: AiActivityKind;
  message: string;
  createdAt: string;
};
