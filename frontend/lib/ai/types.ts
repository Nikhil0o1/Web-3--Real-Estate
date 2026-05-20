export type AIAction = {
  type:
    | "NAVIGATE"
    | "OPEN_MODAL"
    | "CLOSE_MODAL"
    | "FOCUS_FIELD"
    | "FILL_FIELD"
    | "SUBMIT_FORM";
  route?: string | null;
  modal?: string | null;
  field?: string | null;
  value?: string | null;
  property_id?: number | string | null;
  /** Optional human-readable note (e.g. toast text on CLOSE_MODAL). */
  message?: string | null;
};

export type AIMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_call_id?: string | null;
  name?: string | null;
};

export type AIChatRequest = {
  messages: AIMessage[];
  client_session_id?: string | null;
};

export type AIChatResponse = {
  reply: string;
  actions: AIAction[];
  messages: AIMessage[];
  role: string;
  model: string;
};

export type AIVoiceStatus = {
  stt_enabled: boolean;
  tts_enabled: boolean;
  tts_provider: string;
};

export type AIState =
  | "idle"
  | "listening"
  | "recording"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error";
