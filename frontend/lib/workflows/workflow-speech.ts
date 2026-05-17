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

/* ------------------------------------------------------------------ */
/* Speaking-state broadcaster — lets the UI render an "AI talking" cue */
/* ------------------------------------------------------------------ */
const speakingListeners = new Set<(speaking: boolean) => void>();
let speakingActive = false;

function setSpeakingActive(value: boolean): void {
  if (speakingActive === value) return;
  speakingActive = value;
  speakingListeners.forEach((cb) => cb(value));
}

export function subscribeSpeakingState(cb: (speaking: boolean) => void): () => void {
  speakingListeners.add(cb);
  cb(speakingActive);
  return () => {
    speakingListeners.delete(cb);
  };
}

export function isWorkflowSpeechActive(): boolean {
  return speakingActive;
}

/* ------------------------------------------------------------------ */
/* Audio unlock — browsers gate audio.play() to a recent user gesture  */
/* ------------------------------------------------------------------ */
let audioUnlocked = false;
let persistentAudio: HTMLAudioElement | null = null;
let activeAudio: HTMLAudioElement | null = null;
let openAiTtsAvailable: boolean | null = null;

// Tiny ~50ms silent MP3 used to "unlock" audio in autoplay-restricted browsers.
const SILENT_MP3_DATA_URL =
  "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQwAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAACAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA//////////////////////////8AAAA8TEFNRTMuMTAwAc0AAAAAAAAAABRgJAJAQgAAYAAAASAaW4D3LAAAAAAAAAAAAAAAAA";

function ensurePersistentAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (persistentAudio) return persistentAudio;
  try {
    const a = new Audio();
    a.preload = "auto";
    a.crossOrigin = "anonymous";
    persistentAudio = a;
    return a;
  } catch {
    return null;
  }
}

/** Call from any real user gesture (click, tap) to allow future audio.play(). */
export function unlockWorkflowAudio(): void {
  if (typeof window === "undefined" || audioUnlocked) return;
  const a = ensurePersistentAudio();
  if (!a) return;
  try {
    a.muted = true;
    a.src = SILENT_MP3_DATA_URL;
    const playPromise = a.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise
        .then(() => {
          audioUnlocked = true;
          a.pause();
          a.currentTime = 0;
          a.muted = false;
        })
        .catch(() => {
          /* still locked — try again on next gesture */
        });
    } else {
      audioUnlocked = true;
    }
  } catch {
    /* ignore */
  }
}

function killActiveAudio(): void {
  if (!activeAudio) return;
  try {
    activeAudio.pause();
  } catch {
    /* ignore */
  }
  activeAudio = null;
  setSpeakingActive(false);
}

export function cancelWorkflowSpeech(): void {
  killActiveAudio();
  if (typeof window === "undefined") return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
  setSpeakingActive(false);
}

/* ------------------------------------------------------------------ */
/* Browser fallback (Web Speech API)                                   */
/* ------------------------------------------------------------------ */
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
  return pool[g ? Math.floor(pool.length / 2) : 0] ?? pool[0] ?? null;
}

function browserSpeak(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      resolve(false);
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = RUNTIME_CONFIG.workflowTtsRate;
      utterance.pitch = 1;
      utterance.lang = "en-US";

      let settled = false;
      let started = false;
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        setSpeakingActive(false);
        resolve(ok);
      };
      utterance.onstart = () => {
        started = true;
        setSpeakingActive(true);
      };
      utterance.onend = () => settle(true);
      utterance.onerror = () => settle(false);

      // Hard ceiling: speechSynthesis often never fires onend on Chromium.
      const estimateMs = Math.min(25_000, Math.max(2_500, text.length * 90));
      window.setTimeout(() => settle(started), estimateMs);

      const applyVoice = () => {
        const voices = window.speechSynthesis.getVoices();
        const v = pickBrowserVoice(voices, RUNTIME_CONFIG.workflowTtsGender);
        if (v) utterance.voice = v;
      };

      applyVoice();
      const voicesNow = window.speechSynthesis.getVoices();
      const kick = () => {
        try {
          window.speechSynthesis.speak(utterance);
        } catch {
          settle(false);
        }
      };
      if (voicesNow.length === 0) {
        const onVoices = () => {
          window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
          applyVoice();
          kick();
        };
        window.speechSynthesis.addEventListener("voiceschanged", onVoices);
        window.setTimeout(() => {
          window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
          applyVoice();
          kick();
        }, 600);
        return;
      }
      kick();
    } catch {
      setSpeakingActive(false);
      resolve(false);
    }
  });
}

/* ------------------------------------------------------------------ */
/* OpenAI TTS (preferred path)                                         */
/* ------------------------------------------------------------------ */
function openAiVoice(gender: "male" | "female"): string {
  return gender === "male" ? "onyx" : "nova";
}

async function openAiSpeak(text: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (openAiTtsAvailable === false) return false;
  const base = getApiBase();
  const token = getToken();
  if (!base || !token) return false;

  let res: Response;
  try {
    res = await fetch(`${base}/api/agents/workflows/speak`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text, voice: openAiVoice(RUNTIME_CONFIG.workflowTtsGender) }),
    });
  } catch {
    return false;
  }
  if (res.status === 503 || res.status === 404) {
    openAiTtsAvailable = false;
    return false;
  }
  if (!res.ok) return false;
  openAiTtsAvailable = true;

  let blob: Blob;
  try {
    blob = await res.blob();
  } catch {
    return false;
  }
  const url = URL.createObjectURL(blob);
  const a = ensurePersistentAudio() ?? new Audio();
  killActiveAudio();
  try {
    a.muted = false;
    a.src = url;
    a.currentTime = 0;
    activeAudio = a;
  } catch {
    URL.revokeObjectURL(url);
    return false;
  }

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
      if (activeAudio === a) activeAudio = null;
      setSpeakingActive(false);
      a.onended = null;
      a.onerror = null;
      a.onpause = null;
      a.onplay = null;
      resolve(ok);
    };
    a.onplay = () => setSpeakingActive(true);
    a.onended = () => settle(true);
    a.onerror = () => settle(false);
    a.onpause = () => {
      if (a.ended || a.currentTime >= (a.duration || 0) - 0.05) settle(true);
    };
    window.setTimeout(() => settle(true), 30_000);

    const p = a.play();
    if (p && typeof p.then === "function") {
      p.catch(() => settle(false));
    }
  });
}

/* ------------------------------------------------------------------ */
/* Public speak API                                                    */
/* ------------------------------------------------------------------ */
export function speakWorkflowAssistant(text: string, options?: SpeakWorkflowOptions): Promise<void> {
  return new Promise<void>((resolve) => {
    const finish = () => {
      setSpeakingActive(false);
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

export async function speakWorkflowAssistantSequential(parts: string[]): Promise<void> {
  const cleaned = parts.map(stripTextForSpeech).filter(Boolean);
  for (const line of cleaned) {
    await speakWorkflowAssistant(line);
  }
}
