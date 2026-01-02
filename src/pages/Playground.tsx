import { PlaygroundSidebar, MainCanvas } from "@/components/playground";
import { useSpectralData } from "@/hooks/useSpectralData";
import { usePipeline } from "@/hooks/usePipeline";

export default function Playground() {
  const {
    rawData,
    isLoading,
    error,
    loadFile,
    loadDemoData,
    clearData,
  } = useSpectralData();

  const {
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
  } = usePipeline(rawData);

  return (
    <div className="h-full flex -m-6">
      <PlaygroundSidebar
        data={rawData}
        isLoading={isLoading}
        error={error}
        operators={operators}
        canUndo={canUndo}
        canRedo={canRedo}
        onLoadFile={loadFile}
        onLoadDemo={loadDemoData}
        onClearData={clearData}
        onAddOperator={addOperator}
        onUpdateOperator={updateOperator}
        onRemoveOperator={removeOperator}
        onToggleOperator={toggleOperator}
        onReorderOperators={reorderOperators}
        onClearPipeline={clearPipeline}
        onUndo={undo}
        onRedo={redo}
      />
      <MainCanvas data={processedData} />
    </div>
  );
}
