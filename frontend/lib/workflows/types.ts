"use client";

export type DashboardRole = "property_owner" | "investor" | "tenant";

export type WorkflowStatus = "idle" | "awaiting_fields" | "ready" | "forbidden" | "unknown";

export type WorkflowAction =
  | { type: "NAVIGATE"; route: string; [key: string]: unknown }
  | { type: "OPEN_MODAL"; modal: WorkflowModal; property_id?: string | number; [key: string]: unknown }
  | { type: "FOCUS_FIELD"; modal: WorkflowModal; field: string; [key: string]: unknown }
  | { type: "FILL_FIELD"; modal: WorkflowModal; field: string; value: string; [key: string]: unknown }
  | { type: "SUBMIT_FORM"; modal: WorkflowModal; [key: string]: unknown };

export type WorkflowModal =
  | "CREATE_PROPERTY"
  | "EDIT_PROPERTY"
  | "INVEST_PROPERTY"
  | "PAY_RENT"
  | "CLAIM_REWARDS";

export type WorkflowState = {
  workflow_id?: string | null;
  label?: string | null;
  endpoint?: string | null;
  method?: string | null;
  status?: WorkflowStatus;
  fields?: Record<string, unknown>;
  missing_fields?: string[];
  active_field?: string | null;
  metamask_required?: boolean;
  success_behavior?: string | null;
};

export type WorkflowTurnResponse = {
  trace_id: string;
  workflow_id: string | null;
  label: string | null;
  endpoint: string | null;
  method: string | null;
  status: WorkflowStatus;
  message: string;
  question: string | null;
  active_field: string | null;
  fields: Record<string, unknown>;
  missing_fields: string[];
  validation_errors: Record<string, string>;
  actions: WorkflowAction[];
  execution_actions: WorkflowAction[];
  metamask_required: boolean;
  success_behavior: string | null;
  graph_thread_id: string | null;
  workflow_state: WorkflowState;
};

export type WorkflowMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};
