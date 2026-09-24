import { EventEmitter } from "node:events";
import type { InstallLogSnapshot } from "../../src/types/installLog";
export type { InstallLogSnapshot } from "../../src/types/installLog";

export function redactInstallOutput(text: string): string {
  return text.replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/g, "$1[redacted]@")
    .replace(/([?&](?:token|key|password|secret|access_token)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+|basic\s+)?)[^\s]+/gi, "$1[redacted]");
}

const events = new EventEmitter();
let snapshot: InstallLogSnapshot = { status: "idle", package: "", started_at: null, updated_at: null, lines: [] };
let sequence = 0;
let scheduled: ReturnType<typeof setTimeout> | undefined;
export function getInstallLog(): InstallLogSnapshot { return { ...snapshot, lines: [...snapshot.lines] }; }
export function subscribeInstallLog(listener: (value: InstallLogSnapshot) => void): () => void {
  events.on("change", listener);
  return () => { events.off("change", listener); };
}
export function appendInstallLog(text: string): void {
  const time = Date.now();
  snapshot.updated_at = time;
  snapshot.lines.push({ id: ++sequence, time, text: redactInstallOutput(text).slice(0, 2000) });
  while (snapshot.lines.length > 250 || snapshot.lines.reduce((sum, line) => sum + line.text.length, 0) > 64000) snapshot.lines.shift();
  if (!scheduled) scheduled = setTimeout(() => {
    scheduled = undefined;
    events.emit("change", getInstallLog());
  }, 200);
}
export function startInstallLog(label: string): void {
  snapshot = { ...snapshot, status: "running", package: redactInstallOutput(label), started_at: Date.now() };
  appendInstallLog(label);
}
export function finishInstallLog(error?: string): void {
  snapshot.status = error ? "error" : "complete";
  appendInstallLog(error ?? "Command completed");
}
