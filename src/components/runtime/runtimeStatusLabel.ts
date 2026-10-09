import type { TFunction } from "i18next";

import { getRuntimeResultStatusDisplay } from "@/ui/runtime";

/** Localised label of a run/pipeline result status (the shared UI package only ships English labels). */
export function runtimeStatusLabel(status: string | null | undefined, t: TFunction): string {
  return t(`runs.status.${getRuntimeResultStatusDisplay(status).status}`);
}
