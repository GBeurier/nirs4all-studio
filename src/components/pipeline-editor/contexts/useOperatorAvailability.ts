import { createContext, useContext } from "react";
import type {
  OperatorAvailabilityEntry,
  OperatorAvailabilityResponse,
} from "@/api/system";
import type {
  CapabilityLevel,
  OperatorCapabilityResolution,
} from "@/lib/operatorCapability";
import type { MissingOperatorIssue } from "@/lib/pipelineOperatorAvailability";
import type { PipelineStep } from "../types";

export interface OperatorAvailability {
  available: boolean;
  capability?: OperatorCapabilityResolution;
  capabilityLevel?: CapabilityLevel;
  entry?: OperatorAvailabilityEntry | OperatorCapabilityResolution["entry"];
  issue?: MissingOperatorIssue | null;
}

export interface OperatorAvailabilityContextValue {
  isLoadingOperators: boolean;
  isCheckingPipeline: boolean;
  operatorsError: string | null;
  pipelineError: string | null;
  operatorAvailability: OperatorAvailabilityResponse | null;
  missingIssues: MissingOperatorIssue[];
  getNodeAvailability: (node: {
    id?: string;
    type?: string;
    name?: string;
    classPath?: string;
    functionPath?: string;
  }) => OperatorAvailability;
  getStepAvailability: (step: PipelineStep) => OperatorAvailability;
  refreshOperatorAvailability: () => Promise<void>;
}

export const OperatorAvailabilityContext = createContext<OperatorAvailabilityContextValue | undefined>(undefined);

export function useOperatorAvailability(): OperatorAvailabilityContextValue {
  const context = useContext(OperatorAvailabilityContext);
  if (!context) {
    throw new Error("useOperatorAvailability must be used within an OperatorAvailabilityProvider");
  }
  return context;
}

export function useOperatorAvailabilityOptional(): OperatorAvailabilityContextValue | null {
  return useContext(OperatorAvailabilityContext) ?? null;
}
