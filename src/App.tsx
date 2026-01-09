import { Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import Dashboard from "@/pages/Dashboard";
import Datasets from "@/pages/Datasets";
import DatasetDetail from "@/pages/DatasetDetail";
import Playground from "@/pages/Playground";
import Pipelines from "@/pages/Pipelines";
import PipelineEditor from "@/pages/PipelineEditor";
import Runs from "@/pages/Runs";
import RunProgress from "@/pages/RunProgress";
import NewExperiment from "@/pages/NewExperiment";
import Results from "@/pages/Results";
import Predictions from "@/pages/Predictions";
import Analysis from "@/pages/Analysis";
import Settings from "@/pages/Settings";
import NotFound from "@/pages/NotFound";

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="datasets" element={<Datasets />} />
        <Route path="datasets/:id" element={<DatasetDetail />} />
        <Route path="playground" element={<Playground />} />
        <Route path="pipelines" element={<Pipelines />} />
        <Route path="pipelines/:id" element={<PipelineEditor />} />
        <Route path="pipelines/new" element={<PipelineEditor />} />
        <Route path="runs" element={<Runs />} />
        <Route path="runs/new" element={<NewExperiment />} />
        <Route path="runs/:id" element={<RunProgress />} />
        <Route path="results" element={<Results />} />
        <Route path="predictions" element={<Predictions />} />
        <Route path="analysis" element={<Analysis />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default App;
