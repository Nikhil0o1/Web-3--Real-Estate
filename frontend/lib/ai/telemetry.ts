"use client";

/**
 * Latency telemetry for the voice pipeline.
 *
 * Each conversational turn opens a new "trace" identified by a turn id.
 * Marks are written with `mark(turnId, name)` and measurements derived via
 * `measure(turnId, from, to)`. The most recent N traces are kept in memory so
 * the UI can show a small latency badge / debug panel.
 */

export type MarkName =
  | "mic_open"
  | "first_partial"
  | "vad_speech_start"
  | "vad_speech_end"
  | "stt_commit"
  | "llm_request"
  | "llm_first_token"
  | "llm_done"
  | "tts_open"
  | "tts_first_text"
  | "tts_first_audio"
  | "tts_play_start"
  | "tts_play_end"
  | "barge_in";

export type Trace = {
  id: string;
  startedAt: number;
  marks: Partial<Record<MarkName, number>>;
};

const MAX_TRACES = 8;
const _traces: Trace[] = [];
const _listeners = new Set<(traces: Trace[]) => void>();

function emit() {
  const snapshot = _traces.slice();
  _listeners.forEach((l) => l(snapshot));
}

export function onTracesChange(cb: (traces: Trace[]) => void): () => void {
  _listeners.add(cb);
  cb(_traces.slice());
  return () => _listeners.delete(cb);
}

export function newTrace(id?: string): string {
  const trace: Trace = {
    id: id || `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    startedAt: performance.now(),
    marks: {},
  };
  _traces.unshift(trace);
  while (_traces.length > MAX_TRACES) _traces.pop();
  emit();
  return trace.id;
}

function findTrace(id: string | undefined | null): Trace | null {
  if (!id) return _traces[0] || null;
  return _traces.find((t) => t.id === id) || null;
}

export function mark(traceId: string | undefined | null, name: MarkName): void {
  const trace = findTrace(traceId);
  if (!trace) return;
  if (trace.marks[name] === undefined) {
    trace.marks[name] = performance.now();
    emit();
  }
}

export function measure(traceId: string, from: MarkName, to: MarkName): number | null {
  const trace = findTrace(traceId);
  if (!trace) return null;
  const a = trace.marks[from];
  const b = trace.marks[to];
  if (a === undefined || b === undefined) return null;
  return b - a;
}

export function getLatestTrace(): Trace | null {
  return _traces[0] || null;
}

/** Human-readable summary for the most recent trace. */
export function summarizeTrace(trace: Trace | null): {
  sttMs: number | null;
  llmFirstTokenMs: number | null;
  ttsFirstAudioMs: number | null;
  e2eMs: number | null;
} {
  if (!trace) return { sttMs: null, llmFirstTokenMs: null, ttsFirstAudioMs: null, e2eMs: null };
  const m = trace.marks;
  const sttMs = m.stt_commit !== undefined && m.vad_speech_end !== undefined ? m.stt_commit - m.vad_speech_end : null;
  const llmFirstTokenMs =
    m.llm_first_token !== undefined && m.llm_request !== undefined ? m.llm_first_token - m.llm_request : null;
  const ttsFirstAudioMs =
    m.tts_first_audio !== undefined && m.tts_first_text !== undefined ? m.tts_first_audio - m.tts_first_text : null;
  const e2eMs =
    m.tts_play_start !== undefined && m.vad_speech_end !== undefined ? m.tts_play_start - m.vad_speech_end : null;
  return { sttMs, llmFirstTokenMs, ttsFirstAudioMs, e2eMs };
}
