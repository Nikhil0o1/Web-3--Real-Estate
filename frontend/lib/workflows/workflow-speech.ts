"use client";

import { getApiBase, getToken } from "@/lib/api";
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

let activeAudio: HTMLAudioElement | null = null;
let openAiTtsAvailable: boolean | null = null;

function killActiveAudio(): void {
  if (!activeAudio) return;
  try {
    activeAudio.pause();
    activeAudio.src = "";
    activeAudio.load();
  } catch {
    /* ignore */
  }
  activeAudio = null;
}

export function cancelWorkflowSpeech(): void {
  killActiveAudio();
  if (typeof window === "undefined") return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}

function preferEnglishVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  return en.length ? en : voices;
}

function pickBrowserVoice(voices: SpeechSynthesisVoice[], gender: "male" | "female"): SpeechSynthesisVoice | null {
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

function openAiVoice(gender: "male" | "female"): string {
  // OpenAI voices: alloy, echo, fable, onyx, nova, shimmer
  // alloy/echo/fable sound more neutral/male, nova/shimmer more female.
  return gender === "male" ? "onyx" : "nova";
}

function browserSpeak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      resolve();
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = RUNTIME_CONFIG.workflowTtsRate;
      utterance.pitch = 1;
      utterance.lang = "en-US";

      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      utterance.onend = settle;
      utterance.onerror = settle;

      // Hard ceiling: browser speechSynthesis sometimes never fires onend.
      // Estimate ~12 chars/sec and add buffer; never wait more than 25s.
      const estimateMs = Math.min(25_000, Math.max(2_500, text.length * 90));
      window.setTimeout(settle, estimateMs);

      const applyVoice = () => {
        const voices = window.speechSynthesis.getVoices();
        const v = pickBrowserVoice(voices, RUNTIME_CONFIG.workflowTtsGender);
        if (v) utterance.voice = v;
      };

      applyVoice();
      const voicesNow = window.speechSynthesis.getVoices();
      if (voicesNow.length === 0) {
        const onVoices = () => {
          window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
          applyVoice();
          try {
            window.speechSynthesis.speak(utterance);
          } catch {
            settle();
          }
        };
        window.speechSynthesis.addEventListener("voiceschanged", onVoices);
        // Some Chromium builds never fire voiceschanged — kick after 600ms.
        window.setTimeout(() => {
          window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
          applyVoice();
          try {
            window.speechSynthesis.speak(utterance);
          } catch {
            settle();
          }
        }, 600);
        return;
      }

      window.speechSynthesis.speak(utterance);
    } catch {
      resolve();
    }
  });
}

async function openAiSpeak(text: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (openAiTtsAvailable === false) return false;
  const base = getApiBase();
  if (!base) return false;
  const token = getToken();
  if (!token) return false;

  killActiveAudio();
  try {
    const res = await fetch(`${base}/api/agents/workflows/speak`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text, voice: openAiVoice(RUNTIME_CONFIG.workflowTtsGender) }),
    });
    if (res.status === 503) {
      openAiTtsAvailable = false;
      return false;
    }
    if (!res.ok) return false;
    openAiTtsAvailable = true;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.preload = "auto";
    activeAudio = audio;
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
        if (activeAudio === audio) activeAudio = null;
        resolve(ok);
      };
      audio.onended = () => settle(true);
      audio.onerror = () => settle(false);
      audio.onpause = () => {
        if (audio.ended || audio.currentTime >= (audio.duration || 0) - 0.05) settle(true);
      };
      // Hard ceiling — never block continuation more than 25s.
      window.setTimeout(() => settle(true), 25_000);
      void audio.play().catch(() => settle(false));
    });
  } catch {
    return false;
  }
}

/**
 * Speak assistant reply using OpenAI TTS when available, falling back to the
 * browser Web Speech API. Resolves when playback ends or the fallback path
 * finishes — `onComplete` always fires exactly once.
 */
export function speakWorkflowAssistant(text: string, options?: SpeakWorkflowOptions): Promise<void> {
  return new Promise<void>((resolve) => {
    const finish = () => {
      try {
        options?.onComplete?.();
      } finally {
        resolve();
      }
    };

    if (typeof window === "undefined" || !RUNTIME_CONFIG.workflowTtsEnabled) {
      finish();
      return;
    }
    const cleaned = stripTextForSpeech(text);
    if (!cleaned) {
      finish();
      return;
    }

    void (async () => {
      const playedRemotely = await openAiSpeak(cleaned);
      if (!playedRemotely) {
        await browserSpeak(cleaned);
      }
      finish();
    })();
  });
}

/** Speak multiple chunks in sequence (short status lines). */
export async function speakWorkflowAssistantSequential(parts: string[]): Promise<void> {
  const cleaned = parts.map(stripTextForSpeech).filter(Boolean);
  for (const line of cleaned) {
    await speakWorkflowAssistant(line);
  }
}
