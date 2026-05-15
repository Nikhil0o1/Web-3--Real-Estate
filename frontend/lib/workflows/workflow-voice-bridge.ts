"use client";

/**
 * Lets Zustand trigger the next mic capture without importing React/MediaRecorder.
 * The bubble registers an implementation once mounted.
 */
type ContinuationFn = () => Promise<void>;

let continuationHandler: ContinuationFn | null = null;

export function registerWorkflowVoiceContinuation(handler: ContinuationFn | null): void {
  continuationHandler = handler;
}

export async function invokeWorkflowVoiceContinuation(): Promise<void> {
  await continuationHandler?.();
}
