const [root, score, runtime, components] = await Promise.all([
  import("nirs4all-ui"),
  import("nirs4all-ui/score"),
  import("nirs4all-ui/runtime"),
  import("nirs4all-ui/components"),
]);

const checks = {
  "root.score": root.score,
  "root.runtime": root.runtime,
  "root.components": root.components,
  "score.canonicalMetricKey": score.canonicalMetricKey,
  "score.formatMetricValue": score.formatMetricValue,
  "runtime.getRuntimeResultStatusDisplay": runtime.getRuntimeResultStatusDisplay,
  "runtime.runtimeEngineLabel": runtime.runtimeEngineLabel,
  "components.RuntimeDiagnosticList": components.RuntimeDiagnosticList,
  "components.RuntimeEngineBadge": components.RuntimeEngineBadge,
  "components.RuntimeResultStatusBadge": components.RuntimeResultStatusBadge,
};

for (const [name, value] of Object.entries(checks)) {
  if (value == null) {
    throw new Error(`Missing nirs4all-ui export: ${name}`);
  }
}

if (score.canonicalMetricKey("RMSEP") !== "rmse") {
  throw new Error("nirs4all-ui/score canonicalMetricKey smoke failed");
}

if (runtime.runtimeEngineLabel({ executed: true }) !== "executed by dag-ml") {
  throw new Error("nirs4all-ui/runtime runtimeEngineLabel smoke failed");
}

console.log("nirs4all-ui package smoke passed");
