import { useCallback, useState, type ReactNode } from "react";

import { HelpModeContext } from "./helpModeContext";

export function HelpModeProvider({ children }: { children: ReactNode }) {
  const [helpModeActive, setHelpModeActive] = useState(false);
  const [activeOperator, setActiveOperator] = useState<string | null>(null);

  const toggleHelpMode = useCallback(() => {
    setHelpModeActive((prev) => !prev);
    if (!helpModeActive) {
      setActiveOperator(null);
    }
  }, [helpModeActive]);

  const showHelp = useCallback((operator: string) => {
    setActiveOperator(operator);
  }, []);

  const clearActiveOperator = useCallback(() => {
    setActiveOperator(null);
  }, []);

  return (
    <HelpModeContext.Provider
      value={{
        helpModeActive,
        toggleHelpMode,
        showHelp,
        activeOperator,
        clearActiveOperator,
      }}
    >
      {children}
    </HelpModeContext.Provider>
  );
}
