"use client";

import { RUNTIME_CONFIG } from "@/lib/runtime-config";

export type SpeakWorkflowOptions = {
  /** Fires after audio finishes (or immediately if TTS off / empty text). */
  onComplete?: () => void;
};

/** Strip content that sounds bad when read aloud. */
export function stripTextForSpeech(text: string): string {
  let s = text.replace(/\s+/g, " ").trim();
  s = s.replace(/https?:\/\/\S+/g, "");
  s = s.replace(/[`*_#]/g, "");
  return s.slice(0, 2500);
}

function preferEnglishVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  return en.length ? en : voices;
}

function pickVoice(voices: SpeechSynthesisVoice[], gender: "male" | "female"): SpeechSynthesisVoice | null {
  const pool = preferEnglishVoices(voices);
  const g = gender === "male";
  const maleHints = /male|daniel|fred|david|alex|arthur|aaron|james|john|mark|microsoft david|google uk english male/i;
  const femaleHints = /female|samantha|karen|victoria|zira|susan|sarah|hazel|martha|google uk english female|microsoft zira/i;

  for (const v of pool) {
    const id = `${v.name} ${v.voiceURI}`.toLowerCase();
    if (g && maleHints.test(id)) return v;
    if (!g && femaleHints.test(id)) return v;
  }

  const fallback = pool[g ? Math.floor(pool.length / 2) : 0];
  return fallback ?? pool[0] ?? null;
}

export function cancelWorkflowSpeech(): void {
  if (typeof window === "undefined") return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}

function attachTerminalHandlers(utterance: SpeechSynthesisUtterance, onComplete?: () => void): void {
  const once = () => {
    onComplete?.();
  };
  utterance.onend = once;
  utterance.onerror = once;
}

/** Speak assistant reply using browser voices (no extra API key). Resolves when playback ends or is skipped. */
export function speakWorkflowAssistant(text: string, options?: SpeakWorkflowOptions): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      options?.onComplete?.();
      resolve();
      return;
    }

    const finish = () => {
      options?.onComplete?.();
      resolve();
    };

    if (!RUNTIME_CONFIG.workflowTtsEnabled) {
      finish();
      return;
    }

    const cleaned = stripTextForSpeech(text);
    if (!cleaned) {
      finish();
      return;
    }

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(cleaned);
      utterance.rate = RUNTIME_CONFIG.workflowTtsRate;
      utterance.pitch = 1;
      utterance.lang = "en-US";
      attachTerminalHandlers(utterance, finish);

      const applyVoice = () => {
        const voices = window.speechSynthesis.getVoices();
        const v = pickVoice(voices, RUNTIME_CONFIG.workflowTtsGender);
        if (v) utterance.voice = v;
      };

      applyVoice();
      const voicesNow = window.speechSynthesis.getVoices();
      if (voicesNow.length === 0) {
        const onVoices = () => {
          window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
          applyVoice();
          window.speechSynthesis.speak(utterance);
        };
        window.speechSynthesis.addEventListener("voiceschanged", onVoices);
        return;
      }

      window.speechSynthesis.speak(utterance);
    } catch {
      finish();
    }
  });
}

/** Speak multiple chunks in sequence (short status lines). */
export async function speakWorkflowAssistantSequential(parts: string[]): Promise<void> {
  const cleaned = parts.map(stripTextForSpeech).filter(Boolean);
  for (const line of cleaned) {
    await speakWorkflowAssistant(line);
  }
}
