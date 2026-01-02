import { useState, useCallback, useMemo } from 'react';
import { PipelineOperator, OperatorType, OperatorParams, SpectralData } from '@/types/spectral';
import { operatorDefinitions, processSpectrum } from '@/lib/preprocessing/operators';

const MAX_HISTORY = 50;

export function usePipeline(rawData: SpectralData | null) {
  const [operators, setOperators] = useState<PipelineOperator[]>([]);
  const [history, setHistory] = useState<PipelineOperator[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const saveToHistory = useCallback((newOperators: PipelineOperator[]) => {
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push([...newOperators]);
      if (newHistory.length > MAX_HISTORY) {
        newHistory.shift();
        return newHistory;
      }
      return newHistory;
    });
    setHistoryIndex(prev => Math.min(prev + 1, MAX_HISTORY - 1));
  }, [historyIndex]);

  const addOperator = useCallback((type: OperatorType) => {
    const definition = operatorDefinitions.find(d => d.type === type);
    if (!definition) return;

    const newOperator: PipelineOperator = {
      id: `${type}-${Date.now()}`,
      type,
      params: { ...definition.defaultParams } as OperatorParams[typeof type],
      enabled: true,
      name: definition.name,
      target: definition.allowedTargets[0],
    };

    const newOperators = [...operators, newOperator];
    setOperators(newOperators);
    saveToHistory(newOperators);
  }, [operators, saveToHistory]);

  const removeOperator = useCallback((id: string) => {
    const newOperators = operators.filter(op => op.id !== id);
    setOperators(newOperators);
    saveToHistory(newOperators);
  }, [operators, saveToHistory]);

  const updateOperator = useCallback((id: string, updates: Partial<PipelineOperator>) => {
    const newOperators = operators.map(op =>
      op.id === id ? { ...op, ...updates } : op
    );
    setOperators(newOperators);
    saveToHistory(newOperators);
  }, [operators, saveToHistory]);

  const toggleOperator = useCallback((id: string) => {
    const newOperators = operators.map(op =>
      op.id === id ? { ...op, enabled: !op.enabled } : op
    );
    setOperators(newOperators);
    saveToHistory(newOperators);
  }, [operators, saveToHistory]);

  const reorderOperators = useCallback((fromIndex: number, toIndex: number) => {
    const newOperators = [...operators];
    const [moved] = newOperators.splice(fromIndex, 1);
    newOperators.splice(toIndex, 0, moved);
    setOperators(newOperators);
    saveToHistory(newOperators);
  }, [operators, saveToHistory]);

  const clearPipeline = useCallback(() => {
    setOperators([]);
    saveToHistory([]);
  }, [saveToHistory]);

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setOperators([...history[newIndex]]);
    }
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setOperators([...history[newIndex]]);
    }
  }, [history, historyIndex]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  // Process data through the pipeline
  const processedData = useMemo(() => {
    if (!rawData) return null;

    let currentSpectra = rawData.spectra;
    let currentWavelengths = rawData.wavelengths;

    const enabledOperators = operators.filter(op => op.enabled);

    for (const operator of enabledOperators) {
      const result = processSpectrum(
        currentSpectra,
        currentWavelengths,
        operator.type,
        operator.params
      );
      currentSpectra = result.spectra;
      currentWavelengths = result.wavelengths;
    }

    return {
      wavelengths: currentWavelengths,
      spectra: currentSpectra,
      y: rawData.y,
      sampleIds: rawData.sampleIds,
      metadata: rawData.metadata,
      originalSpectra: rawData.spectra,
      originalY: rawData.y,
    };
  }, [rawData, operators]);

  return {
    operators,
    processedData,
    addOperator,
    removeOperator,
    updateOperator,
    toggleOperator,
    reorderOperators,
    clearPipeline,
    undo,
    redo,
    canUndo,
    canRedo,
  };
}
