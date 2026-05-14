"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Narrow Web Speech API types (Chromium / Safari); not all TS lib targets declare them. */
interface WebSpeechRecognitionAlternative {
  readonly transcript: string;
}

interface WebSpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  item(index: number): WebSpeechRecognitionAlternative;
  [index: number]: WebSpeechRecognitionAlternative;
}

interface WebSpeechRecognitionResultList {
  readonly length: number;
  item(index: number): WebSpeechRecognitionResult;
  [index: number]: WebSpeechRecognitionResult;
}

interface WebSpeechRecognitionEvent extends Event {
  readonly results: WebSpeechRecognitionResultList;
}

interface WebSpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface WebSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((this: WebSpeechRecognition, ev: WebSpeechRecognitionEvent) => void) | null;
  onerror: ((this: WebSpeechRecognition, ev: WebSpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: WebSpeechRecognition, ev: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type WebSpeechRecognitionCtor = new () => WebSpeechRecognition;

function getSpeechRecognitionCtor(): WebSpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    webkitSpeechRecognition?: WebSpeechRecognitionCtor;
    SpeechRecognition?: WebSpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type CopilotVoiceInputProps = {
  disabled?: boolean;
  /** Live partial transcript while speaking (optional). */
  onInterimTranscript?: (text: string) => void;
  /** Called with a finalized utterance (same pipeline as typed messages). */
  onFinalTranscript: (text: string) => void;
};

export function CopilotVoiceInput({ disabled, onInterimTranscript, onFinalTranscript }: CopilotVoiceInputProps) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recRef = useRef<WebSpeechRecognition | null>(null);

  useEffect(() => {
    setSupported(Boolean(getSpeechRecognitionCtor()));
  }, []);

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    recRef.current = null;
    setListening(false);
  }, []);

  useEffect(() => {
    return () => {
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
      recRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      toast.error("Voice input is not supported in this browser.");
      return;
    }
    if (disabled) return;

    try {
      const rec = new Ctor();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US";

      rec.onresult = (ev: WebSpeechRecognitionEvent) => {
        let text = "";
        for (let i = 0; i < ev.results.length; i += 1) {
          text += ev.results[i]?.[0]?.transcript ?? "";
        }
        const trimmed = text.trim();
        const last = ev.results[ev.results.length - 1];
        if (trimmed && onInterimTranscript && !last?.isFinal) {
          onInterimTranscript(trimmed);
        }
        if (last?.isFinal && trimmed) {
          onFinalTranscript(trimmed);
        }
      };

      rec.onerror = (ev: WebSpeechRecognitionErrorEvent) => {
        if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
          toast.error("Microphone permission denied — enable it to use voice commands.");
        } else if (ev.error !== "aborted" && ev.error !== "no-speech") {
          toast.error(`Voice capture error: ${ev.error}`);
        }
        setListening(false);
        recRef.current = null;
      };

      rec.onend = () => {
        setListening(false);
        recRef.current = null;
      };

      recRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      toast.error("Could not start voice recognition.");
      setListening(false);
      recRef.current = null;
    }
  }, [disabled, onFinalTranscript, onInterimTranscript]);

  return (
    <Button
      type="button"
      variant={listening ? "default" : "outline"}
      size="default"
      className={cn("h-10 shrink-0 px-3", listening && "animate-pulse")}
      disabled={disabled || !supported}
      title={supported ? (listening ? "Stop listening" : "Voice command") : "Voice not supported"}
      aria-pressed={listening}
      onClick={() => {
        if (listening) stop();
        else void start();
      }}
    >
      {listening ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-4 w-4" />}
    </Button>
  );
}
