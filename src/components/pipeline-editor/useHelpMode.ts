import { useContext } from "react";

import { HelpModeContext, type HelpModeContextType } from "./helpModeContext";

export function useHelpMode(): HelpModeContextType {
  const context = useContext(HelpModeContext);
  if (!context) {
    throw new Error("useHelpMode must be used within a HelpModeProvider");
  }
  return context;
}
