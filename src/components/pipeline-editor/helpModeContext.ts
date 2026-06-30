import { createContext } from "react";

export interface HelpModeContextType {
  helpModeActive: boolean;
  toggleHelpMode: () => void;
  showHelp: (operator: string) => void;
  activeOperator: string | null;
  clearActiveOperator: () => void;
}

export const HelpModeContext = createContext<HelpModeContextType | null>(null);
