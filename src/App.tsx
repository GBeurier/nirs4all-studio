import { useState, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import Datasets from "@/pages/Datasets";
import DatasetDetail from "@/pages/DatasetDetail";
import Pipelines from "@/pages/Pipelines";
import PipelineEditor from "@/pages/PipelineEditor";
import NewExperiment from "@/pages/NewExperiment";
import Playground from "@/pages/Playground";
import Inspector from "@/pages/Inspector";
import Runs from "@/pages/Runs";
import RunProgress from "@/pages/RunProgress";
import Results from "@/pages/Results";
import AggregatedResults from "@/pages/AggregatedResults";
import Predictions from "@/pages/Predictions";
import Lab from "@/pages/Lab";
import SpectraSynthesis from "@/pages/SpectraSynthesis";
import TransferAnalysis from "@/pages/TransferAnalysis";
import VariableImportance from "@/pages/VariableImportance";
import Settings from "@/pages/Settings";
import SetupWizard from "@/pages/SetupWizard";
import NotFound from "@/pages/NotFound";
import EnvSetup from "@/components/setup/EnvSetup";

const electronApi = (window as unknown as {
  electronApi?: {
    isElectron: boolean;
    isEnvReady: () => Promise<boolean>;
  };
}).electronApi;

function App() {
  // In Electron mode, check if the Python environment is ready.
  // If not, show the env setup screen before loading the app.
  const [envReady, setEnvReady] = useState<boolean | null>(null);
  const isElectron = !!electronApi?.isElectron;

  useEffect(() => {
    if (!isElectron || !electronApi) {
      // Web mode: no env check needed, backend managed externally
      setEnvReady(true);
      return;
    }
    electronApi.isEnvReady().then(setEnvReady);
  }, [isElectron]);

  // Loading state while checking env
  if (envReady === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Env not ready in Electron mode: show setup screen (no backend available yet)
  if (!envReady) {
    return <EnvSetup onComplete={() => setEnvReady(true)} />;
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/datasets" replace />} />
        <Route path="datasets" element={<Datasets />} />
        <Route path="datasets/:id" element={<DatasetDetail />} />
        <Route path="pipelines" element={<Pipelines />} />
        <Route path="pipelines/:id" element={<PipelineEditor />} />
        <Route path="pipelines/new" element={<PipelineEditor />} />
        <Route path="editor" element={<NewExperiment />} />
        <Route path="playground" element={<Playground />} />
        <Route path="inspector" element={<Inspector />} />
        <Route path="runs" element={<Runs />} />
        <Route path="runs/:id" element={<RunProgress />} />
        <Route path="results" element={<Results />} />
        <Route path="results/aggregated" element={<AggregatedResults />} />
        <Route path="predictions" element={<Predictions />} />
        <Route path="lab" element={<Lab />}>
          <Route index element={<Navigate to="/lab/synthesis" replace />} />
          <Route path="synthesis" element={<SpectraSynthesis />} />
          <Route path="transfer" element={<TransferAnalysis />} />
          <Route path="shapley" element={<VariableImportance />} />
        </Route>
        <Route path="settings" element={<Settings />} />
        <Route path="setup" element={<SetupWizard />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default App;
