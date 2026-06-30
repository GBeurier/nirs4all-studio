import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PipelineRun } from "@/types/runs";
import {
  buildResultPipelineJson,
  buildResultLogRows,
  getResultExecutionLogs,
  hasResultMetrics,
  type ResultDetailTab,
} from "./resultDetailData";

export function useResultDetailSheetState(pipeline: PipelineRun | null) {
  const [activeTab, setActiveTab] = useState<ResultDetailTab>("results");
  const [copied, setCopied] = useState(false);
  const copyResetTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current != null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  const logs = useMemo(
    () => pipeline ? getResultExecutionLogs(pipeline) : [],
    [pipeline],
  );

  const logRows = useMemo(
    () => buildResultLogRows(logs),
    [logs],
  );

  const pipelineJson = useMemo(
    () => pipeline ? buildResultPipelineJson(pipeline) : "",
    [pipeline],
  );

  const hasMetrics = useMemo(
    () => pipeline ? hasResultMetrics(pipeline) : false,
    [pipeline],
  );

  const handleCopyJson = useCallback(async () => {
    if (!pipelineJson) return;
    await navigator.clipboard.writeText(pipelineJson);
    setCopied(true);
    if (copyResetTimeoutRef.current != null) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }
    copyResetTimeoutRef.current = window.setTimeout(() => {
      setCopied(false);
      copyResetTimeoutRef.current = null;
    }, 2000);
  }, [pipelineJson]);

  return {
    activeTab,
    copied,
    handleCopyJson,
    hasMetrics,
    logRows,
    logs,
    pipelineJson,
    setActiveTab,
  };
}
