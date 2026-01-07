/**
 * DataLoadingDefaults Component
 *
 * Form for configuring default data loading settings that will be
 * applied in the dataset wizard.
 *
 * Phase 5 Implementation
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  FileSpreadsheet,
  Save,
  RotateCcw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Info,
} from "lucide-react";
import {
  getDataLoadingDefaults,
  updateDataLoadingDefaults,
} from "@/api/client";
import type { DataLoadingDefaults } from "@/types/settings";
import { DEFAULT_DATA_LOADING_DEFAULTS } from "@/types/settings";

interface FormFieldProps {
  label: string;
  description: string;
  children: React.ReactNode;
}

function FormField({ label, description, children }: FormFieldProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <Label className="text-sm font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

export interface DataLoadingDefaultsFormProps {
  /** Optional class name */
  className?: string;
  /** Callback when defaults are saved */
  onSave?: (defaults: DataLoadingDefaults) => void;
}

export function DataLoadingDefaultsForm({
  className,
  onSave,
}: DataLoadingDefaultsFormProps) {
  const { t } = useTranslation();
  const [defaults, setDefaults] = useState<DataLoadingDefaults>(
    DEFAULT_DATA_LOADING_DEFAULTS
  );
  const [originalDefaults, setOriginalDefaults] = useState<DataLoadingDefaults>(
    DEFAULT_DATA_LOADING_DEFAULTS
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadDefaults();
  }, []);

  const loadDefaults = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getDataLoadingDefaults();
      setDefaults(data);
      setOriginalDefaults(data);
    } catch (err) {
      // Use system defaults if loading fails (no workspace selected)
      setDefaults(DEFAULT_DATA_LOADING_DEFAULTS);
      setOriginalDefaults(DEFAULT_DATA_LOADING_DEFAULTS);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError(null);
      setSaved(false);
      await updateDataLoadingDefaults(defaults);
      setOriginalDefaults(defaults);
      setSaved(true);
      onSave?.(defaults);
      // Clear saved message after 3 seconds
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save defaults");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setDefaults(DEFAULT_DATA_LOADING_DEFAULTS);
  };

  const handleRevert = () => {
    setDefaults(originalDefaults);
  };

  const hasChanges =
    JSON.stringify(defaults) !== JSON.stringify(originalDefaults);

  const updateDefault = <K extends keyof DataLoadingDefaults>(
    key: K,
    value: DataLoadingDefaults[K]
  ) => {
    setDefaults((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          {t("settings.dataDefaults.title")}
        </CardTitle>
        <CardDescription>
          {t("settings.dataDefaults.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Auto-detect toggle */}
        <FormField
          label={t("settings.dataDefaults.autoDetect")}
          description={t("settings.dataDefaults.autoDetectDescription")}
        >
          <Switch
            checked={defaults.auto_detect}
            onCheckedChange={(checked) => updateDefault("auto_detect", checked)}
          />
        </FormField>

        <Separator />

        {/* CSV Parsing Options */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium flex items-center gap-2">
            {t("settings.dataDefaults.parsing.title")}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  {t("settings.dataDefaults.parsing.tooltip")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </h4>

          <FormField
            label={t("settings.dataDefaults.parsing.delimiter")}
            description={t("settings.dataDefaults.parsing.delimiterDescription")}
          >
            <Select
              value={defaults.delimiter}
              onValueChange={(value) => updateDefault("delimiter", value)}
            >
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value=";">{t("settings.dataDefaults.parsing.delimiters.semicolon")}</SelectItem>
                <SelectItem value=",">{t("settings.dataDefaults.parsing.delimiters.comma")}</SelectItem>
                <SelectItem value="\t">{t("settings.dataDefaults.parsing.delimiters.tab")}</SelectItem>
                <SelectItem value=" ">{t("settings.dataDefaults.parsing.delimiters.space")}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          <FormField
            label={t("settings.dataDefaults.parsing.decimal")}
            description={t("settings.dataDefaults.parsing.decimalDescription")}
          >
            <Select
              value={defaults.decimal_separator}
              onValueChange={(value) => updateDefault("decimal_separator", value)}
            >
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value=".">{t("settings.dataDefaults.parsing.decimals.dot")}</SelectItem>
                <SelectItem value=",">{t("settings.dataDefaults.parsing.decimals.comma")}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          <FormField
            label={t("settings.dataDefaults.parsing.hasHeader")}
            description={t("settings.dataDefaults.parsing.hasHeaderDescription")}
          >
            <Switch
              checked={defaults.has_header}
              onCheckedChange={(checked) => updateDefault("has_header", checked)}
            />
          </FormField>
        </div>

        <Separator />

        {/* Spectral Options */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium">{t("settings.dataDefaults.signal.title")}</h4>

          <FormField
            label={t("settings.dataDefaults.parsing.headerUnit")}
            description={t("settings.dataDefaults.parsing.headerUnitDescription")}
          >
            <Select
              value={defaults.header_unit}
              onValueChange={(value) =>
                updateDefault("header_unit", value as DataLoadingDefaults["header_unit"])
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nm">{t("settings.dataDefaults.parsing.headerUnits.nm")}</SelectItem>
                <SelectItem value="cm-1">{t("settings.dataDefaults.parsing.headerUnits.cm-1")}</SelectItem>
                <SelectItem value="text">{t("settings.dataDefaults.parsing.headerUnits.text")}</SelectItem>
                <SelectItem value="index">{t("settings.dataDefaults.parsing.headerUnits.index")}</SelectItem>
                <SelectItem value="none">{t("settings.dataDefaults.parsing.headerUnits.none")}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          <FormField
            label={t("settings.dataDefaults.signal.type")}
            description={t("settings.dataDefaults.signal.typeDescription")}
          >
            <Select
              value={defaults.signal_type}
              onValueChange={(value) =>
                updateDefault("signal_type", value as DataLoadingDefaults["signal_type"])
              }
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t("settings.dataDefaults.signal.types.auto")}</SelectItem>
                <SelectItem value="absorbance">{t("settings.dataDefaults.signal.types.absorbance")}</SelectItem>
                <SelectItem value="reflectance">{t("settings.dataDefaults.signal.types.reflectance")}</SelectItem>
                <SelectItem value="reflectance%">{t("settings.dataDefaults.signal.types.reflectance%")}</SelectItem>
                <SelectItem value="transmittance">{t("settings.dataDefaults.signal.types.transmittance")}</SelectItem>
                <SelectItem value="transmittance%">{t("settings.dataDefaults.signal.types.transmittance%")}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        </div>

        <Separator />

        {/* Missing Data Handling */}
        <FormField
          label={t("settings.dataDefaults.missing.title")}
          description={t("settings.dataDefaults.missing.description")}
        >
          <Select
            value={defaults.na_policy}
            onValueChange={(value) =>
              updateDefault("na_policy", value as DataLoadingDefaults["na_policy"])
            }
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="drop">{t("settings.dataDefaults.missing.policies.drop")}</SelectItem>
              <SelectItem value="fill_mean">{t("settings.dataDefaults.missing.policies.fill_mean")}</SelectItem>
              <SelectItem value="fill_median">{t("settings.dataDefaults.missing.policies.fill_median")}</SelectItem>
              <SelectItem value="fill_zero">{t("settings.dataDefaults.missing.policies.fill_zero")}</SelectItem>
              <SelectItem value="error">{t("settings.dataDefaults.missing.policies.error")}</SelectItem>
            </SelectContent>
          </Select>
        </FormField>

        {/* Feedback Messages */}
        {saved && (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            <span>{t("settings.dataDefaults.savedSuccess")}</span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            onClick={handleSave}
            disabled={isSaving || !hasChanges}
            size="sm"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("common.saving")}
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                {t("settings.dataDefaults.save")}
              </>
            )}
          </Button>
          {hasChanges && (
            <Button variant="outline" size="sm" onClick={handleRevert}>
              {t("common.revertChanges")}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={handleReset}>
            <RotateCcw className="mr-2 h-4 w-4" />
            {t("settings.dataDefaults.reset")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default DataLoadingDefaultsForm;
