/**
 * First-launch Python setup (desktop only). Outside Electron the deployment
 * manages the environment, so there is nothing to set up.
 */

import { Navigate } from "react-router-dom";
import { PythonEnvironmentPage } from "@/components/python-env/PythonEnvironmentPage";
import { usePythonEnv } from "@/context/usePythonEnv";

export default function SetupWizard() {
  const { api } = usePythonEnv();
  if (!api) return <Navigate to="/" replace />;
  return (
    <div className="max-w-4xl">
      <PythonEnvironmentPage context="setup" />
    </div>
  );
}
