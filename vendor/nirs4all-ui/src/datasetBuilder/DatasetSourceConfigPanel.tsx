import { useState, type ReactNode } from "react";

import { cx } from "./_cx.js";
import { icon, type BuilderIconKey } from "./icons.js";
import { STRINGS } from "./locale.js";
import { ROLE_DESCRIPTORS, SIGNAL_TYPES, roleLabel, type Locale } from "./roles.js";
import type {
  AdvancedOptions,
  DatasetColumn,
  DatasetRole,
  DatasetSource,
  HeaderMode,
  SignalType,
  SourceParsing,
  SourceUseAs,
  ValidationResult,
} from "./types.js";
import { LiveValidationCard } from "./LiveValidationCard.js";

export interface DatasetSourceConfigPanelProps {
  source: DatasetSource;
  validation: ValidationResult;
  advanced: AdvancedOptions;
  autoDetect: boolean;
  manualColumns: boolean;
  onUpdateParsing: (parsing: Partial<SourceParsing>) => void;
  onUpdateSignalType: (signalType: SignalType) => void;
  onUpdateUseAs: (useAs: SourceUseAs) => void;
  onAssignColumnRole: (columnId: string, role: DatasetRole) => void;
  onSetSingletonRole: (role: DatasetRole, columnId: string | "") => void;
  onToggleAutoDetect: (enabled: boolean) => void;
  onToggleManualColumns: (enabled: boolean) => void;
  onUpdateAdvanced: (advanced: Partial<AdvancedOptions>) => void;
  onPreviewColumns?: (role: DatasetRole) => void;
  locale?: Locale;
  icons?: Partial<Record<BuilderIconKey, ReactNode>> | undefined;
  className?: string;
}

const SEPARATORS: Array<{ value: string; labels: Record<Locale, string> }> = [
  { value: "auto", labels: { fr: "Auto", en: "Auto" } },
  { value: ",", labels: { fr: ", (virgule)", en: ", (comma)" } },
  { value: ";", labels: { fr: "; (point-virgule)", en: "; (semicolon)" } },
  { value: "\t", labels: { fr: "Tabulation", en: "Tab" } },
  { value: " ", labels: { fr: "Espace", en: "Space" } },
];

const USE_AS: Array<{ value: SourceUseAs; labels: Record<Locale, string> }> = [
  { value: "x_train", labels: { fr: "X train", en: "X train" } },
  { value: "x_test", labels: { fr: "X test", en: "X test" } },
  { value: "x_train_test", labels: { fr: "X train + test", en: "X train + test" } },
  { value: "y_train", labels: { fr: "Y train", en: "Y train" } },
  { value: "y_test", labels: { fr: "Y test", en: "Y test" } },
  { value: "metadata", labels: { fr: "Metadata globale", en: "Global metadata" } },
  { value: "metadata_train_test", labels: { fr: "Metadata train/test", en: "Metadata train/test" } },
  { value: "join_table", labels: { fr: "Table de jointure", en: "Join table" } },
  { value: "partition", labels: { fr: "Fichier de partition", en: "Partition file" } },
  { value: "auxiliary", labels: { fr: "Source auxiliaire", en: "Auxiliary source" } },
];

/** Right-hand guided configuration for the active source. */
export function DatasetSourceConfigPanel(props: DatasetSourceConfigPanelProps) {
  const {
    source,
    validation,
    advanced,
    autoDetect,
    manualColumns,
    onUpdateParsing,
    onUpdateSignalType,
    onUpdateUseAs,
    onSetSingletonRole,
    onToggleAutoDetect,
    onToggleManualColumns,
    onUpdateAdvanced,
    onPreviewColumns,
    locale = "fr",
    icons,
    className,
  } = props;
  const t = STRINGS[locale];
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const isCsv = ["csv", "tsv", "txt"].includes(source.fileType.toLowerCase());

  const columnsByRole = (role: DatasetRole): DatasetColumn[] =>
    source.columns.filter((c) => c.assignedRole === role);
  const firstOf = (role: DatasetRole): string => columnsByRole(role)[0]?.id ?? "";

  return (
    <aside className={cx("dsb-config", className)}>
      <header className="dsb-config__head">
        <span className="dsb-config__head-icon">{icon("spark", icons)}</span>
        <div>
          <strong className="dsb-config__title">{t.assistantTitle}</strong>
          <p className="dsb-config__subtitle">{t.assistantSubtitle}</p>
        </div>
      </header>

      <Field label={t.signalType}>
        <Select
          value={source.signalType}
          onChange={(v) => onUpdateSignalType(v as SignalType)}
          options={SIGNAL_TYPES.map((s) => ({ value: s.value, label: s.labels[locale] }))}
          icons={icons}
        />
      </Field>

      {isCsv ? (
        <fieldset className="dsb-config__group">
          <legend>{t.fileFormat}</legend>
          <div className="dsb-config__row">
            <Field label={t.separator} compact>
              <Select
                value={source.parsing.separator ?? "auto"}
                onChange={(v) => onUpdateParsing({ separator: v === "auto" ? undefined : v })}
                options={SEPARATORS.map((s) => ({ value: s.value, label: s.labels[locale] }))}
                icons={icons}
              />
            </Field>
            <Field label={t.decimal} compact>
              <Select
                value={source.parsing.decimal ?? "."}
                onChange={(v) => onUpdateParsing({ decimal: v as "." | "," })}
                options={[
                  { value: ".", label: locale === "en" ? ". (dot)" : ". (point)" },
                  { value: ",", label: locale === "en" ? ", (comma)" : ", (virgule)" },
                ]}
                icons={icons}
              />
            </Field>
          </div>
          <Field label={t.headers}>
            <div className="dsb-toggle-group" role="group">
              {(["horizontal", "vertical"] as HeaderMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className="dsb-toggle"
                  data-active={(source.parsing.headerMode ?? "horizontal") === mode || undefined}
                  onClick={() => onUpdateParsing({ headerMode: mode })}
                >
                  {mode === "horizontal" ? t.headersHorizontal : t.headersVertical}
                </button>
              ))}
            </div>
          </Field>
        </fieldset>
      ) : null}

      <fieldset className="dsb-config__group">
        <legend>{t.columnChoice}</legend>
        {(["id", "replicate", "partition"] as DatasetRole[]).map((role) => (
          <Field key={role} label={roleLabel(role, locale)} role={role} compact>
            <Select
              value={firstOf(role)}
              onChange={(v) => onSetSingletonRole(role, v)}
              options={[
                { value: "", label: locale === "en" ? "— none —" : "— aucune —" },
                ...source.columns.map((c) => ({ value: c.id, label: c.name })),
              ]}
              icons={icons}
            />
          </Field>
        ))}
        <RoleSummaryField
          label={roleLabel("x", locale)}
          role="x"
          columns={columnsByRole("x")}
          onPreview={onPreviewColumns}
          locale={locale}
          icons={icons}
        />
        <RoleSummaryField
          label={roleLabel("y", locale)}
          role="y"
          columns={columnsByRole("y")}
          onPreview={onPreviewColumns}
          locale={locale}
          icons={icons}
        />
      </fieldset>

      <Field label={t.useAs}>
        <Select
          value={source.usage.useAs ?? "x_train"}
          onChange={(v) => onUpdateUseAs(v as SourceUseAs)}
          options={USE_AS.map((u) => ({ value: u.value, label: u.labels[locale] }))}
          icons={icons}
        />
      </Field>

      <div className="dsb-config__switches">
        <Switch label={t.autoDetect} checked={autoDetect} onChange={onToggleAutoDetect} />
        <Switch label={t.manualColumns} checked={manualColumns} onChange={onToggleManualColumns} />
      </div>

      <details className="dsb-config__advanced" open={advancedOpen} onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}>
        <summary>{t.advanced}</summary>
        <div className="dsb-config__advanced-body">
          <Field label={locale === "en" ? "Join strategy" : "Stratégie de jointure"} compact>
            <Select
              value={advanced.joinStrategy}
              onChange={(v) => onUpdateAdvanced({ joinStrategy: v as AdvancedOptions["joinStrategy"] })}
              options={[
                { value: "inner", label: "inner join" },
                { value: "left", label: "left join" },
                { value: "strict", label: locale === "en" ? "strict match" : "strict match" },
                { value: "allow_missing", label: locale === "en" ? "allow missing" : "autoriser manquants" },
              ]}
              icons={icons}
            />
          </Field>
          <Field label={locale === "en" ? "Replicates" : "Répétitions"} compact>
            <Select
              value={advanced.replicateStrategy}
              onChange={(v) => onUpdateAdvanced({ replicateStrategy: v as AdvancedOptions["replicateStrategy"] })}
              options={[
                { value: "keep", label: locale === "en" ? "keep" : "garder" },
                { value: "average", label: locale === "en" ? "average" : "moyenner" },
                { value: "stack", label: locale === "en" ? "stack" : "empiler" },
                { value: "augment", label: locale === "en" ? "augmentation" : "augmentation" },
                { value: "hierarchy", label: locale === "en" ? "hierarchy level" : "niveau hiérarchique" },
              ]}
              icons={icons}
            />
          </Field>
          <Field label={locale === "en" ? "Multi-source alignment" : "Alignement multi-source"} compact>
            <Select
              value={advanced.multiSourceAlign}
              onChange={(v) => onUpdateAdvanced({ multiSourceAlign: v as AdvancedOptions["multiSourceAlign"] })}
              options={[
                { value: "sample_id", label: "sample_id" },
                { value: "plot_id", label: "plot_id" },
                { value: "row_index", label: locale === "en" ? "row index" : "index de ligne" },
                { value: "temporal", label: locale === "en" ? "temporal" : "temporel" },
              ]}
              icons={icons}
            />
          </Field>
          <Field label={locale === "en" ? "Missing values" : "Valeurs manquantes"} compact>
            <Select
              value={advanced.missingPolicy}
              onChange={(v) => onUpdateAdvanced({ missingPolicy: v as AdvancedOptions["missingPolicy"] })}
              options={[
                { value: "forbid", label: locale === "en" ? "forbid" : "interdire" },
                { value: "allow", label: locale === "en" ? "allow" : "autoriser" },
                { value: "impute", label: locale === "en" ? "impute" : "imputer" },
                { value: "drop_rows", label: locale === "en" ? "drop rows" : "exclure les lignes" },
              ]}
              icons={icons}
            />
          </Field>
          <Field label={locale === "en" ? "Y typing" : "Typage Y"} compact>
            <Select
              value={advanced.yTask}
              onChange={(v) => onUpdateAdvanced({ yTask: v as AdvancedOptions["yTask"] })}
              options={[
                { value: "auto", label: "auto" },
                { value: "regression", label: locale === "en" ? "regression" : "régression" },
                { value: "classification", label: "classification" },
                { value: "multilabel", label: "multilabel" },
                { value: "multiclass", label: "multiclass" },
                { value: "ordinal", label: "ordinal" },
              ]}
              icons={icons}
            />
          </Field>
        </div>
      </details>

      <LiveValidationCard validation={validation} locale={locale} icons={icons} />
    </aside>
  );
}

function Field({
  label,
  children,
  role,
  compact,
}: {
  label: string;
  children: ReactNode;
  role?: DatasetRole;
  compact?: boolean;
}) {
  return (
    <label className="dsb-field" data-role={role ? ROLE_DESCRIPTORS[role].token : undefined} data-compact={compact || undefined}>
      <span className="dsb-field__label">{label}</span>
      {children}
    </label>
  );
}

function RoleSummaryField({
  label,
  role,
  columns,
  onPreview,
  locale,
  icons,
}: {
  label: string;
  role: DatasetRole;
  columns: DatasetColumn[];
  onPreview?: ((role: DatasetRole) => void) | undefined;
  locale: Locale;
  icons?: Partial<Record<BuilderIconKey, ReactNode>> | undefined;
}) {
  const summary =
    columns.length === 0
      ? locale === "en"
        ? "— none —"
        : "— aucune —"
      : columns.length > 3
        ? `${columns[0]?.name} → ${columns[columns.length - 1]?.name}`
        : columns.map((c) => c.name).join(", ");
  return (
    <div className="dsb-field dsb-field--summary" data-role={ROLE_DESCRIPTORS[role].token}>
      <span className="dsb-field__label">{label}</span>
      <div className="dsb-field__summary-box" data-role={ROLE_DESCRIPTORS[role].token}>
        <span className="dsb-field__summary-text">{summary}</span>
        {columns.length > 0 && onPreview ? (
          <button type="button" className="dsb-field__preview" onClick={() => onPreview(role)}>
            {icon("eye", icons)} {columns.length}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  icons,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  icons?: Partial<Record<BuilderIconKey, ReactNode>> | undefined;
}) {
  return (
    <div className="dsb-select">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <span className="dsb-select__chevron" aria-hidden="true">
        {icon("chevron", icons)}
      </span>
    </div>
  );
}

function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="dsb-switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="dsb-switch__track" aria-hidden="true">
        <span className="dsb-switch__thumb" />
      </span>
      <span className="dsb-switch__label">{label}</span>
    </label>
  );
}
