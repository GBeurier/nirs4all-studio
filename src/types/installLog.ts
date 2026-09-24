export interface InstallLogSnapshot {
  status: "idle" | "running" | "complete" | "error";
  package: string;
  started_at: number | null;
  updated_at: number | null;
  lines: { id: number; time: number; text: string }[];
}
