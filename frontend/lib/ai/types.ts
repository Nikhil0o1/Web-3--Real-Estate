export type AIAction = {
  type: "NAVIGATE" | "OPEN_MODAL" | "FOCUS_FIELD" | "FILL_FIELD" | "SUBMIT_FORM";
  route?: string | null;
  modal?: string | null;
  field?: string | null;
  value?: string | null;
  property_id?: number | string | null;
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

export type RealtimeVoiceTokenResponse = {
  token: string;
  model_id: string;
  language_code: string;
};

export type TTSRequest = {
  text: string;
  voice?: string | null;
};

export type TranscriptionResponse = {
  text: string;
};

export type AIState = "idle" | "listening" | "thinking" | "speaking" | "error";

/** Global ORT loaded from CDN for onnxruntime-web externals */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  var ORT: any;
}
