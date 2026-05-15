"use client";

import { RUNTIME_CONFIG } from "@/lib/runtime-config";

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

/** Speak assistant reply using browser voices (no extra API key). */
export function speakWorkflowAssistant(text: string): void {
  if (typeof window === "undefined") return;
  if (!RUNTIME_CONFIG.workflowTtsEnabled) return;

  const cleaned = stripTextForSpeech(text);
  if (!cleaned) return;

  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.rate = RUNTIME_CONFIG.workflowTtsRate;
    utterance.pitch = 1;
    utterance.lang = "en-US";

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
    /* ignore */
  }
}
