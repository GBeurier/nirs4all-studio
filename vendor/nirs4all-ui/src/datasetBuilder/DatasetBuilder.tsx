import { useCallback, useMemo, useState, type ReactNode } from "react";

import { cx } from "./_cx.js";
import { ColumnMappingTable, type ColumnFilter } from "./ColumnMappingTable.js";
import { DatasetSourceConfigPanel } from "./DatasetSourceConfigPanel.js";
import { DatasetWizardStepper } from "./DatasetWizardStepper.js";
import { LiveValidationCard } from "./LiveValidationCard.js";
import { PartitionPreview } from "./PartitionPreview.js";
import { RoleSelectionCards } from "./RoleSelectionCards.js";
import { SourceSummaryCard } from "./SourceSummaryCard.js";
import { autoDetectSource, isSpectralHeader } from "./detect.js";
import { buildExportConfig } from "./exportConfig.js";
import { icon, type BuilderIconKey } from "./icons.js";
import { STRINGS } from "./locale.js";
import { deriveSchema, derivePartitionPreview, assignRoleToColumns, toggleColumnSelection } from "./schema.js";
import { validateBuilder } from "./validate.js";
import { type Locale } from "./roles.js";
import {
  DEFAULT_ADVANCED_OPTIONS,
  type AdvancedOptions,
  type DatasetExportConfig,
  type DatasetRole,
  type DatasetSource,
  type PartitionMode,
  type SignalType,
  type SourceParsing,
  type SourceUseAs,
  type WizardStep,
} from "./types.js";

const STEP_ORDER: WizardStep[] = ["source", "role", "columns", "validation"];

export interface DatasetBuilderProps {
  /** Controlled sources. Omit to let the component own them internally. */
  sources?: DatasetSource[];
  /** Initial sources when uncontrolled. */
  defaultSources?: DatasetSource[];
  onChange?: (sources: DatasetSource[]) => void;
  /** Run auto-detection when a source first has no manual roles (default true). */
  autoDetectOnLoad?: boolean;

  datasetName?: string;
  defaultDatasetName?: string;
  onDatasetNameChange?: (name: string) => void;

  /** Host opens a file/folder picker and pushes parsed `DatasetSource`s back. */
  onRequestAddSource?: () => void;
  onExport?: (config: DatasetExportConfig, sources: DatasetSource[]) => void;

  locale?: Locale;
  icons?: Partial<Record<BuilderIconKey, ReactNode>> | undefined;
  className?: string;
  /** Render the right configuration rail (default true). */
  showConfigPanel?: boolean;
}

/**
 * The full multimodal Dataset Builder wizard. Presentational + self-contained:
 * it owns local UI state (active step/source, filters, toggles) but never reads
 * files, hits the network, or runs a runtime — the host parses files into
 * `DatasetSource` descriptors and receives the exported config.
 */
export function DatasetBuilder({
  sources: controlledSources,
  defaultSources = [],
  onChange,
  autoDetectOnLoad = true,
  datasetName,
  defaultDatasetName = "nouveau_dataset",
  onDatasetNameChange,
  onRequestAddSource,
  onExport,
  locale = "fr",
  icons,
  className,
  showConfigPanel = true,
}: DatasetBuilderProps) {
  const t = STRINGS[locale];

  const [internalSources, setInternalSources] = useState<DatasetSource[]>(() =>
    autoDetectOnLoad ? defaultSources.map(maybeDetect) : defaultSources,
  );
  const isControlled = controlledSources !== undefined;
  const sources = isControlled ? controlledSources! : internalSources;

  const [internalName, setInternalName] = useState(defaultDatasetName);
  const name = datasetName ?? internalName;

  const [activeStep, setActiveStep] = useState<WizardStep>("source");
  const [activeSourceId, setActiveSourceId] = useState<string | undefined>(defaultSources[0]?.id);
  const [activeRole, setActiveRole] = useState<DatasetRole | null>(null);
  const [filter, setFilter] = useState<ColumnFilter>("all");
  const [hideAssigned, setHideAssigned] = useState(false);
  const [autoDetect, setAutoDetect] = useState(true);
  const [manualColumns, setManualColumns] = useState(true);
  const [partitionMode, setPartitionMode] = useState<PartitionMode>("train_test");
  const [advanced, setAdvanced] = useState<AdvancedOptions>(DEFAULT_ADVANCED_OPTIONS);

  const activeSource = sources.find((s) => s.id === activeSourceId) ?? sources[0];

  const commitSources = useCallback(
    (next: DatasetSource[]) => {
      if (!isControlled) setInternalSources(next);
      onChange?.(next);
    },
    [isControlled, onChange],
  );

  const updateActiveSource = useCallback(
    (updater: (source: DatasetSource) => DatasetSource) => {
      if (!activeSource) return;
      commitSources(sources.map((s) => (s.id === activeSource.id ? updater(s) : s)));
    },
    [activeSource, sources, commitSources],
  );

  const schema = useMemo(() => deriveSchema(sources), [sources]);
  const validation = useMemo(() => validateBuilder(sources, locale), [sources, locale]);
  const partition = useMemo(
    () => derivePartitionPreview(sources, partitionMode),
    [sources, partitionMode],
  );
  const selectedCount = activeSource?.columns.filter((c) => c.selected).length ?? 0;

  // --- column / role handlers -------------------------------------------------

  const handleAssignColumnRole = useCallback(
    (columnId: string, role: DatasetRole) => {
      updateActiveSource((s) => assignRoleToColumns(s, new Set([columnId]), role));
    },
    [updateActiveSource],
  );

  const handleAssignRoleToSelection = useCallback(
    (role: DatasetRole) => {
      setActiveRole(role);
      updateActiveSource((s) => {
        const selectedIds = new Set(s.columns.filter((c) => c.selected).map((c) => c.id));
        if (selectedIds.size === 0) return s; // nothing selected → role just becomes active
        const next = assignRoleToColumns(s, selectedIds, role);
        return { ...next, columns: next.columns.map((c) => ({ ...c, selected: false })) };
      });
    },
    [updateActiveSource],
  );

  const handleToggleColumn = useCallback(
    (columnId: string, selected?: boolean) => {
      updateActiveSource((s) => toggleColumnSelection(s, columnId, selected));
    },
    [updateActiveSource],
  );

  const handleToggleAll = useCallback(
    (selected: boolean) => {
      updateActiveSource((s) => ({ ...s, columns: s.columns.map((c) => ({ ...c, selected })) }));
    },
    [updateActiveSource],
  );

  const handleSelectSpectra = useCallback(() => {
    updateActiveSource((s) => ({
      ...s,
      columns: s.columns.map((c) => ({
        ...c,
        selected: isSpectralHeader(c.name) || c.assignedRole === "x" || Boolean(c.selected),
      })),
    }));
  }, [updateActiveSource]);

  const handleSetSingletonRole = useCallback(
    (role: DatasetRole, columnId: string | "") => {
      updateActiveSource((s) => {
        const cleared = s.columns.map((c) =>
          c.assignedRole === role ? { ...c, assignedRole: "ignored" as DatasetRole, manual: true } : c,
        );
        const columns = cleared.map((c) =>
          c.id === columnId ? { ...c, assignedRole: role, manual: true } : c,
        );
        return { ...s, columns };
      });
    },
    [updateActiveSource],
  );

  const handleUpdateParsing = useCallback(
    (parsing: Partial<SourceParsing>) => {
      updateActiveSource((s) => ({ ...s, parsing: { ...s.parsing, ...parsing } }));
    },
    [updateActiveSource],
  );

  const handleUpdateSignalType = useCallback(
    (signalType: SignalType) => updateActiveSource((s) => ({ ...s, signalType })),
    [updateActiveSource],
  );

  const handleUpdateUseAs = useCallback(
    (useAs: SourceUseAs) => updateActiveSource((s) => ({ ...s, usage: { ...s.usage, useAs } })),
    [updateActiveSource],
  );

  const handleToggleAutoDetect = useCallback(
    (enabled: boolean) => {
      setAutoDetect(enabled);
      if (enabled) updateActiveSource((s) => autoDetectSource({ ...s, columns: s.columns.map((c) => ({ ...c, manual: false })) }));
    },
    [updateActiveSource],
  );

  const handleNameChange = useCallback(
    (value: string) => {
      if (datasetName === undefined) setInternalName(value);
      onDatasetNameChange?.(value);
    },
    [datasetName, onDatasetNameChange],
  );

  const handleExport = useCallback(() => {
    onExport?.(buildExportConfig(name, sources), sources);
  }, [onExport, name, sources]);

  const goToStep = useCallback((step: WizardStep) => setActiveStep(step), []);
  const activeIndex = STEP_ORDER.indexOf(activeStep);
  const nextStep = STEP_ORDER[activeIndex + 1];

  const hasSources = sources.length > 0;

  return (
    <div className={cx("dsb", className)} data-locale={locale}>
      <TopBar
        name={name}
        onNameChange={handleNameChange}
        schema={schema}
        sourceCount={sources.length}
        sampleCount={partition.total}
        validationStatus={validation.status}
        onCreate={handleExport}
        locale={locale}
        icons={icons}
      />

      <div className="dsb__body">
        <main className="dsb__main">
          <header className="dsb__header">
            <h2 className="dsb__title">{t.title}</h2>
            <DatasetWizardStepper
              activeStep={activeStep}
              onStepClick={goToStep}
              locale={locale}
              icons={icons}
            />
            <p className="dsb__subtitle">
              <span className="dsb__subtitle-icon">{icon("info", icons)}</span>
              {t.stepSubtitles[activeStep]}
            </p>
          </header>

          {!hasSources ? (
            <DropZone onClick={onRequestAddSource} locale={locale} icons={icons} />
          ) : (
            <>
              {sources.length > 1 ? (
                <div className="dsb__source-tabs" role="tablist">
                  {sources.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="dsb__source-tab"
                      data-active={s.id === activeSource?.id || undefined}
                      onClick={() => setActiveSourceId(s.id)}
                    >
                      {icon(s.kind === "folder" ? "folder" : "file", icons)} {s.name}
                    </button>
                  ))}
                  {onRequestAddSource ? (
                    <button type="button" className="dsb__source-tab dsb__source-tab--add" onClick={onRequestAddSource}>
                      + {t.addSource}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {activeSource ? (
                <SourceSummaryCard
                  source={activeSource}
                  sources={sources}
                  onChangeSource={setActiveSourceId}
                  locale={locale}
                  icons={icons}
                />
              ) : null}

              {activeStep !== "validation" ? (
                <>
                  <section className="dsb__section">
                    <h3 className="dsb__section-title">{t.rolePrompt}</h3>
                    <RoleSelectionCards
                      selectedCount={selectedCount}
                      activeRole={activeRole}
                      onAssignRole={handleAssignRoleToSelection}
                      locale={locale}
                      icons={icons}
                    />
                  </section>

                  {activeSource ? (
                    <section className="dsb__section">
                      <h3 className="dsb__section-title">
                        {locale === "en" ? "Column preview & mapping" : "Aperçu et mapping des colonnes"}
                      </h3>
                      <ColumnMappingTable
                        columns={activeSource.columns}
                        onToggleColumn={handleToggleColumn}
                        onToggleAll={handleToggleAll}
                        onAssignColumnRole={handleAssignColumnRole}
                        onSelectSpectra={handleSelectSpectra}
                        filter={filter}
                        onFilterChange={setFilter}
                        hideAssigned={hideAssigned}
                        onToggleHideAssigned={setHideAssigned}
                        locale={locale}
                        icons={icons}
                      />
                    </section>
                  ) : null}
                </>
              ) : (
                <ValidationStep
                  config={buildExportConfig(name, sources)}
                  validation={validation}
                  locale={locale}
                  icons={icons}
                />
              )}

              <PartitionPreview preview={partition} onModeChange={setPartitionMode} locale={locale} />
            </>
          )}

          <footer className="dsb__footer">
            <div className="dsb__footer-spacer" />
            {nextStep ? (
              <button type="button" className="dsb-btn dsb-btn--primary" onClick={() => goToStep(nextStep)} disabled={!hasSources}>
                {t.continueLabel(t.steps[nextStep])} {icon("arrow", icons)}
              </button>
            ) : (
              <button type="button" className="dsb-btn dsb-btn--primary" onClick={handleExport} disabled={validation.status === "error"}>
                {icon("check", icons)} {t.createDataset}
              </button>
            )}
          </footer>
        </main>

        {showConfigPanel && activeSource ? (
          <DatasetSourceConfigPanel
            source={activeSource}
            validation={validation}
            advanced={advanced}
            autoDetect={autoDetect}
            manualColumns={manualColumns}
            onUpdateParsing={handleUpdateParsing}
            onUpdateSignalType={handleUpdateSignalType}
            onUpdateUseAs={handleUpdateUseAs}
            onAssignColumnRole={handleAssignColumnRole}
            onSetSingletonRole={handleSetSingletonRole}
            onToggleAutoDetect={handleToggleAutoDetect}
            onToggleManualColumns={setManualColumns}
            onUpdateAdvanced={(patch) => setAdvanced((prev) => ({ ...prev, ...patch }))}
            locale={locale}
            icons={icons}
          />
        ) : null}
      </div>
    </div>
  );
}

function maybeDetect(source: DatasetSource): DatasetSource {
  const hasManual = source.columns.some((c) => c.manual);
  return hasManual ? source : autoDetectSource(source);
}

function TopBar({
  name,
  onNameChange,
  schema,
  sourceCount,
  sampleCount,
  validationStatus,
  onCreate,
  locale,
  icons,
}: {
  name: string;
  onNameChange: (value: string) => void;
  schema: ReturnType<typeof deriveSchema>;
  sourceCount: number;
  sampleCount: number;
  validationStatus: "ok" | "warning" | "error";
  onCreate: () => void;
  locale: Locale;
  icons?: Partial<Record<BuilderIconKey, ReactNode>> | undefined;
}) {
  const t = STRINGS[locale];
  const en = locale === "en";
  return (
    <div className="dsb__topbar">
      <div className="dsb__brand">
        <span className="dsb__brand-mark" aria-hidden="true">{icon("spark", icons)}</span>
        <span className="dsb__brand-name">nirs4all</span>
        <span className="dsb__brand-sub">Dataset Builder</span>
      </div>
      <input
        className="dsb__name-input"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        aria-label={en ? "Dataset name" : "Nom du dataset"}
        spellCheck={false}
      />
      <div className="dsb__chips">
        <span className="dsb__chip" data-role="x">{icon("x", icons)} {schema.xSources.length || sourceCount} {en ? "modalities" : "modalités"}</span>
        <span className="dsb__chip" data-role="y">{icon("y", icons)} {schema.yColumns.length} targets</span>
        <span className="dsb__chip" data-role="id">{icon("group", icons)} {sampleCount.toLocaleString("fr-FR")} samples</span>
        <span className="dsb__chip" data-status={validationStatus}>
          {icon(validationStatus === "ok" ? "check" : validationStatus === "warning" ? "warning" : "error", icons)}
          {validationStatus === "ok" ? "Train/Test OK" : validationStatus === "warning" ? (en ? "Warnings" : "Avertissements") : (en ? "Incomplete" : "Incomplet")}
        </span>
      </div>
      <button type="button" className="dsb-btn dsb-btn--primary dsb__create" onClick={onCreate} disabled={validationStatus === "error"}>
        {icon("check", icons)} {t.createDataset}
      </button>
    </div>
  );
}

function DropZone({
  onClick,
  locale,
  icons,
}: {
  onClick?: (() => void) | undefined;
  locale: Locale;
  icons?: Partial<Record<BuilderIconKey, ReactNode>> | undefined;
}) {
  const t = STRINGS[locale];
  const en = locale === "en";
  return (
    <button type="button" className="dsb__dropzone" onClick={onClick}>
      <span className="dsb__dropzone-icon">{icon("upload", icons)}</span>
      <strong>{en ? "Drop your files or folders" : "Glissez-déposez vos fichiers ou dossiers"}</strong>
      <span className="dsb__dropzone-hint">{t.noSourceHint}</span>
      <span className="dsb__dropzone-types">
        <span className="dsb-chip" data-role="x">CSV</span>
        <span className="dsb-chip" data-role="metadata">Excel</span>
        <span className="dsb-chip" data-role="x">Parquet</span>
        <span className="dsb-chip" data-role="id">Images</span>
      </span>
    </button>
  );
}

function ValidationStep({
  config,
  validation,
  locale,
  icons,
}: {
  config: DatasetExportConfig;
  validation: ReturnType<typeof validateBuilder>;
  locale: Locale;
  icons?: Partial<Record<BuilderIconKey, ReactNode>> | undefined;
}) {
  const en = locale === "en";
  return (
    <div className="dsb__validation-step">
      <LiveValidationCard
        validation={validation}
        locale={locale}
        icons={icons}
        title={en ? "Consistency summary" : "Résumé de cohérence"}
      />
      <section className="dsb__export-preview">
        <header className="dsb__export-head">
          <strong>{en ? "Generated config" : "Configuration générée"}</strong>
          <code>dataset.json</code>
        </header>
        <pre className="dsb__export-json">{JSON.stringify(config, null, 2)}</pre>
      </section>
    </div>
  );
}
