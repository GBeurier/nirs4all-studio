import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getOperatorAvailability,
  runPreflight,
  type OperatorAvailabilityEntry,
  type OperatorAvailabilityResponse,
} from "@/api/client";
import type { PipelineStep } from "../types";
import {
  OPERATOR_AVAILABILITY_INVALIDATED_EVENT,
  buildMissingOperatorLookups,
  clearCachedOperatorAvailability,
  filterMissingOperatorIssues,
  findMissingOperatorIssue,
  readCachedOperatorAvailability,
  writeCachedOperatorAvailability,
  type MissingOperatorIssue,
} from "@/lib/pipelineOperatorAvailability";

interface OperatorAvailability {
  available: boolean;
  entry?: OperatorAvailabilityEntry;
  issue?: MissingOperatorIssue | null;
}

interface OperatorAvailabilityContextValue {
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

export interface OperatorAvailabilityProviderProps {
  children: ReactNode;
  steps: PipelineStep[];
  pipelineName: string;
}

const OperatorAvailabilityContext = createContext<OperatorAvailabilityContextValue | undefined>(undefined);

function operatorTypeAndNameKey(type?: string, name?: string): string | null {
  const normalizedType = type?.trim().toLowerCase();
  const normalizedName = name?.trim().toLowerCase();
  if (!normalizedType || !normalizedName) {
    return null;
  }
  return `${normalizedType}:${normalizedName}`;
}

function makeSyntheticIssue(
  entry: OperatorAvailabilityEntry,
  pipelineName: string,
): MissingOperatorIssue {
  return {
    type: "missing_module",
    message: entry.error
      ? `Pipeline '${pipelineName}': ${entry.error}. Install it via Settings > Advanced > Dependencies.`
      : `Pipeline '${pipelineName}': ${entry.name} is unavailable.`,
    details: {
      pipeline_name: pipelineName,
      step_name: entry.name,
      step_type: entry.type,
      class_path: entry.class_path ?? undefined,
      function_path: entry.function_path ?? undefined,
      error: entry.error ?? undefined,
    },
  };
}

export function OperatorAvailabilityProvider({
  children,
  steps,
  pipelineName,
}: OperatorAvailabilityProviderProps) {
  const [operatorAvailability, setOperatorAvailability] = useState<OperatorAvailabilityResponse | null>(() =>
    readCachedOperatorAvailability(),
  );
  const [isLoadingOperators, setIsLoadingOperators] = useState(() => !readCachedOperatorAvailability());
  const [operatorsError, setOperatorsError] = useState<string | null>(null);
  const [missingIssues, setMissingIssues] = useState<MissingOperatorIssue[]>([]);
  const [isCheckingPipeline, setIsCheckingPipeline] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [pipelineRefreshToken, setPipelineRefreshToken] = useState(0);
  const latestPipelineRequest = useRef(0);

  const refreshOperatorAvailability = useCallback(async () => {
    setIsLoadingOperators(true);
    try {
      const response = await getOperatorAvailability();
      setOperatorAvailability(response);
      writeCachedOperatorAvailability(response);
      setOperatorsError(null);
    } catch (error) {
      setOperatorsError(error instanceof Error ? error.message : "Failed to load operator availability");
    } finally {
      setIsLoadingOperators(false);
    }
  }, []);

  useEffect(() => {
    if (operatorAvailability) {
      return;
    }
    void refreshOperatorAvailability();
  }, [operatorAvailability, refreshOperatorAvailability]);

  useEffect(() => {
    const handleInvalidated = () => {
      clearCachedOperatorAvailability();
      setOperatorAvailability(null);
      setPipelineRefreshToken((current) => current + 1);
      void refreshOperatorAvailability();
    };

    window.addEventListener(OPERATOR_AVAILABILITY_INVALIDATED_EVENT, handleInvalidated);
    return () => {
      window.removeEventListener(OPERATOR_AVAILABILITY_INVALIDATED_EVENT, handleInvalidated);
    };
  }, [refreshOperatorAvailability]);

  useEffect(() => {
    if (steps.length === 0) {
      setMissingIssues([]);
      setPipelineError(null);
      setIsCheckingPipeline(false);
      return;
    }

    const requestId = latestPipelineRequest.current + 1;
    latestPipelineRequest.current = requestId;
    setIsCheckingPipeline(true);

    const timeoutId = window.setTimeout(async () => {
      try {
        const preflight = await runPreflight([], { name: pipelineName, steps }, []);
        if (latestPipelineRequest.current !== requestId) {
          return;
        }
        setMissingIssues(filterMissingOperatorIssues(preflight.issues));
        setPipelineError(null);
      } catch (error) {
        if (latestPipelineRequest.current !== requestId) {
          return;
        }
        setMissingIssues([]);
        setPipelineError(error instanceof Error ? error.message : "Failed to check pipeline dependencies");
      } finally {
        if (latestPipelineRequest.current === requestId) {
          setIsCheckingPipeline(false);
        }
      }
    }, 350);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [pipelineName, pipelineRefreshToken, steps]);

  const unavailableById = useMemo(() => {
    const map = new Map<string, OperatorAvailabilityEntry>();
    for (const entry of operatorAvailability?.unavailable ?? []) {
      if (entry.id) {
        map.set(entry.id, entry);
      }
    }
    return map;
  }, [operatorAvailability]);

  const unavailableByClassPath = useMemo(() => {
    const map = new Map<string, OperatorAvailabilityEntry>();
    for (const entry of operatorAvailability?.unavailable ?? []) {
      if (entry.class_path) {
        map.set(entry.class_path, entry);
      }
      if (entry.function_path) {
        map.set(entry.function_path, entry);
      }
    }
    return map;
  }, [operatorAvailability]);

  const unavailableByTypeAndName = useMemo(() => {
    const map = new Map<string, OperatorAvailabilityEntry>();
    for (const entry of operatorAvailability?.unavailable ?? []) {
      const key = operatorTypeAndNameKey(entry.type, entry.name);
      if (key) {
        map.set(key, entry);
      }
    }
    return map;
  }, [operatorAvailability]);

  const missingLookups = useMemo(() => buildMissingOperatorLookups(missingIssues), [missingIssues]);

  const getUnavailableEntry = useCallback((node: {
    id?: string;
    type?: string;
    name?: string;
    classPath?: string;
    functionPath?: string;
  }): OperatorAvailabilityEntry | undefined => {
    if (node.id && unavailableById.has(node.id)) {
      return unavailableById.get(node.id);
    }
    if (node.functionPath && unavailableByClassPath.has(node.functionPath)) {
      return unavailableByClassPath.get(node.functionPath);
    }
    if (node.classPath && unavailableByClassPath.has(node.classPath)) {
      return unavailableByClassPath.get(node.classPath);
    }
    const key = operatorTypeAndNameKey(node.type, node.name);
    return key ? unavailableByTypeAndName.get(key) : undefined;
  }, [unavailableByClassPath, unavailableById, unavailableByTypeAndName]);

  const getNodeAvailability = useCallback((node: {
    id?: string;
    type?: string;
    name?: string;
    classPath?: string;
    functionPath?: string;
  }): OperatorAvailability => {
    const entry = getUnavailableEntry(node);
    if (!entry) {
      return { available: true };
    }
    return {
      available: false,
      entry,
      issue: makeSyntheticIssue(entry, pipelineName),
    };
  }, [getUnavailableEntry, pipelineName]);

  const getStepAvailability = useCallback((step: PipelineStep): OperatorAvailability => {
    const issue = findMissingOperatorIssue(step, missingLookups);
    if (issue) {
      return {
        available: false,
        issue,
      };
    }

    const entry = getUnavailableEntry({
      id: undefined,
      type: step.type,
      name: step.name,
      classPath: typeof step.classPath === "string" ? step.classPath : undefined,
      functionPath: typeof step.functionPath === "string" ? step.functionPath : undefined,
    });
    if (!entry) {
      return { available: true };
    }

    return {
      available: false,
      entry,
      issue: makeSyntheticIssue(entry, pipelineName),
    };
  }, [getUnavailableEntry, missingLookups, pipelineName]);

  const value = useMemo<OperatorAvailabilityContextValue>(() => ({
    isLoadingOperators,
    isCheckingPipeline,
    operatorsError,
    pipelineError,
    operatorAvailability,
    missingIssues,
    getNodeAvailability,
    getStepAvailability,
    refreshOperatorAvailability,
  }), [
    getNodeAvailability,
    getStepAvailability,
    isCheckingPipeline,
    isLoadingOperators,
    missingIssues,
    operatorAvailability,
    operatorsError,
    pipelineError,
    refreshOperatorAvailability,
  ]);

  return (
    <OperatorAvailabilityContext.Provider value={value}>
      {children}
    </OperatorAvailabilityContext.Provider>
  );
}

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
