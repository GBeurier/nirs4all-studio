/**
 * System Information Component
 *
 * Displays detailed system information including:
 * - Python version and environment
 * - Operating system details
 * - nirs4all version
 * - Key package versions
 * - Available capabilities (GPU, backends, etc.)
 *
 * Phase 5: System Information & Diagnostics
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Monitor,
  Cpu,
  Package,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Copy,
  Check,
  ChevronDown,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { getRuntimeSummary, getSystemInfo, getSystemCapabilities } from "@/api/system";
import type {
  SystemInfoResponse,
  SystemCapabilities,
  RuntimeSummaryResponse,
} from "@/types/settings";

interface SystemInfoProps {
  /** Whether to show in compact mode */
  compact?: boolean;
}

interface CapabilityItemProps {
  name: string;
  label: string;
  available: boolean;
}

function CapabilityItem({ label, available }: CapabilityItemProps) {
  return (
    <div className="flex items-center gap-2">
      {available ? (
        <CheckCircle2 className="h-4 w-4 text-green-500" />
      ) : (
        <XCircle className="h-4 w-4 text-muted-foreground" />
      )}
      <span className={available ? "" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}

export function SystemInfo({ compact = false }: SystemInfoProps) {
  const { t } = useTranslation();
  const [systemInfo, setSystemInfo] = useState<SystemInfoResponse | null>(null);
  const [capabilities, setCapabilities] = useState<SystemCapabilities | null>(null);
  const [runtimeSummary, setRuntimeSummary] = useState<RuntimeSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [packagesOpen, setPackagesOpen] = useState(false);

  const loadData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const [infoResponse, capabilitiesResponse, runtimeResponse] = await Promise.all([
        getSystemInfo(),
        getSystemCapabilities(),
        getRuntimeSummary(),
      ]);
      setSystemInfo(infoResponse);
      setCapabilities(capabilitiesResponse.capabilities);
      setRuntimeSummary(runtimeResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.systemInfo.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const handler = () => {
      void loadData();
    };
    window.addEventListener("backend-restarted", handler);
    return () => window.removeEventListener("backend-restarted", handler);
  }, []);

  const copyToClipboard = async () => {
    if (!systemInfo || !capabilities) return;

    const text = `
System Information
==================
Python Version: ${systemInfo.python.version}
Configured Python: ${runtimeSummary?.configured_python ?? "Not reported"}
Running Python: ${runtimeSummary?.running_python ?? systemInfo.python.executable}
Runtime Kind: ${runtimeSummary?.runtime_kind ?? "unknown"}
Configured Matches Running: ${runtimeSummary?.configured_matches_running ? "yes" : "no"}
OS: ${systemInfo.system.os} ${systemInfo.system.release}
Architecture: ${systemInfo.system.machine}
nirs4all Version: ${systemInfo.nirs4all_version}

Capabilities
============
nirs4all: ${capabilities.nirs4all ? "✓" : "✗"}
TensorFlow: ${capabilities.tensorflow ? "✓" : "✗"}
PyTorch: ${capabilities.pytorch ? "✓" : "✗"}
GPU (CUDA): ${capabilities.gpu_cuda ? "✓" : "✗"}
GPU (MPS): ${capabilities.gpu_mps ? "✓" : "✗"}
Visualization: ${capabilities.visualization ? "✓" : "✗"}
Excel Export: ${capabilities.export_excel ? "✓" : "✗"}

Packages
========
${Object.entries(systemInfo.packages)
  .map(([name, version]) => `${name}: ${version}`)
  .join("\n")}
`.trim();

    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            {t("settings.advanced.system.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-56" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-24" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Monitor className="h-5 w-5" />
            {t("settings.advanced.system.title")}
          </CardTitle>
          <CardDescription className="text-destructive">
            {error}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={loadData}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("common.retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!systemInfo || !capabilities) {
    return null;
  }

  // Extract Python version (first part only, e.g., "3.11.5" from full string)
  const pythonVersionMatch = (runtimeSummary?.runtime.version ?? systemInfo.python.version).match(/^(\d+\.\d+\.\d+)/);
  const pythonVersion = pythonVersionMatch
    ? pythonVersionMatch[1]
    : (runtimeSummary?.runtime.version ?? systemInfo.python.version);
  const configuredPython = runtimeSummary?.configured_python ?? systemInfo.python.executable;
  const runningPython = runtimeSummary?.running_python ?? systemInfo.python.executable;

  // Key packages to display prominently
  const keyPackages = ["numpy", "pandas", "scikit-learn", "scipy"];
  const deepLearningPackages = ["tensorflow", "torch"];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Monitor className="h-5 w-5" />
              {t("settings.advanced.system.title")}
            </CardTitle>
            <CardDescription>
              {t("settings.systemInfo.description")}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={copyToClipboard}
              title={t("settings.advanced.system.copyToClipboard")}
              aria-label={t("settings.advanced.system.copyToClipboard")}
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={loadData}
              title={t("common.refresh")}
              aria-label={t("common.refresh")}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Python & System Info */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Python */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              {t("settings.advanced.system.python")}
            </h4>
            <div className="text-sm space-y-1 pl-6">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("settings.systemInfo.version")}</span>
                <Badge variant="secondary">{pythonVersion}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("settings.systemInfo.platform")}</span>
                <span>{systemInfo.python.platform}</span>
              </div>
              {runtimeSummary?.runtime_kind && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("settings.systemInfo.runtimeKind")}</span>
                  <Badge variant="outline">{runtimeSummary.runtime_kind}</Badge>
                </div>
              )}
              {runtimeSummary && (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("settings.systemInfo.match")}</span>
                    <Badge variant={runtimeSummary.configured_matches_running ? "outline" : "destructive"}>
                      {runtimeSummary.configured_matches_running ? t("settings.systemInfo.matchOk") : t("settings.systemInfo.mismatch")}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("settings.systemInfo.coreReady")}</span>
                    <Badge variant={runtimeSummary.core_ready ? "default" : "destructive"}>
                      {runtimeSummary.core_ready ? t("common.yes") : t("common.no")}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("settings.systemInfo.optionalGaps")}</span>
                    <span>{runtimeSummary.missing_optional_packages.length}</span>
                  </div>
                </>
              )}
              {!compact && (
                <div className="space-y-2 text-xs text-muted-foreground break-all mt-2">
                  <div>
                    <p className="uppercase tracking-wide">{t("settings.systemInfo.configuredPython")}</p>
                    <p>{configuredPython}</p>
                  </div>
                  <div>
                    <p className="uppercase tracking-wide">{t("settings.systemInfo.runningPython")}</p>
                    <p>{runningPython}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* System */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Monitor className="h-4 w-4 text-muted-foreground" />
              {t("settings.systemInfo.system")}
            </h4>
            <div className="text-sm space-y-1 pl-6">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("settings.systemInfo.os")}</span>
                <span>
                  {systemInfo.system.os} {systemInfo.system.release}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("settings.systemInfo.architecture")}</span>
                <span>{systemInfo.system.machine}</span>
              </div>
            </div>
          </div>
        </div>

        {/* nirs4all Version */}
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            <span className="font-medium">nirs4all</span>
          </div>
          <Badge variant={capabilities.nirs4all ? "default" : "outline"}>
            {systemInfo.nirs4all_version}
          </Badge>
        </div>

        {/* Capabilities */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium">{t("settings.advanced.system.capabilities")}</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <CapabilityItem
              name="nirs4all"
              label="nirs4all"
              available={capabilities.nirs4all}
            />
            <CapabilityItem
              name="visualization"
              label={t("settings.systemInfo.visualization")}
              available={capabilities.visualization}
            />
            <CapabilityItem
              name="tensorflow"
              label="TensorFlow"
              available={capabilities.tensorflow}
            />
            <CapabilityItem
              name="pytorch"
              label="PyTorch"
              available={capabilities.pytorch}
            />
            <CapabilityItem
              name="gpu_cuda"
              label="GPU (CUDA)"
              available={capabilities.gpu_cuda}
            />
            <CapabilityItem
              name="gpu_mps"
              label="GPU (Apple MPS)"
              available={capabilities.gpu_mps}
            />
            <CapabilityItem
              name="export_excel"
              label={t("settings.systemInfo.excelExport")}
              available={capabilities.export_excel}
            />
          </div>
        </div>

        {/* Key Packages */}
        {!compact && (
          <Collapsible open={packagesOpen} onOpenChange={setPackagesOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between p-2 h-auto">
                <span className="text-sm font-medium">{t("settings.advanced.system.packages")}</span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${
                    packagesOpen ? "rotate-180" : ""
                  }`}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {/* Key packages first */}
                {keyPackages.map((pkg) =>
                  systemInfo.packages[pkg] ? (
                    <div key={pkg} className="flex justify-between">
                      <span className="text-muted-foreground">{pkg}:</span>
                      <span className="font-mono text-xs">
                        {systemInfo.packages[pkg]}
                      </span>
                    </div>
                  ) : null
                )}
                {/* Deep learning packages */}
                {deepLearningPackages.map((pkg) =>
                  systemInfo.packages[pkg] ? (
                    <div key={pkg} className="flex justify-between">
                      <span className="text-muted-foreground">{pkg}:</span>
                      <span className="font-mono text-xs">
                        {systemInfo.packages[pkg]}
                      </span>
                    </div>
                  ) : null
                )}
                {/* Other packages */}
                {Object.entries(systemInfo.packages)
                  .filter(
                    ([name]) =>
                      !keyPackages.includes(name) &&
                      !deepLearningPackages.includes(name)
                  )
                  .map(([name, version]) => (
                    <div key={name} className="flex justify-between">
                      <span className="text-muted-foreground">{name}:</span>
                      <span className="font-mono text-xs">{version}</span>
                    </div>
                  ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
