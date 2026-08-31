import type { ReactNode } from "react";

import { cx } from "./_cx.js";
import { isSpectralHeader } from "./detect.js";
import { icon, type BuilderIconKey } from "./icons.js";
import { STRINGS } from "./locale.js";
import { ROLE_DESCRIPTORS, ROLE_ORDER, roleLabel, type Locale } from "./roles.js";
import { countRoles } from "./schema.js";
import type { DatasetColumn, DatasetRole } from "./types.js";

export type ColumnFilter = DatasetRole | "all" | "unassigned";

export interface ColumnMappingTableProps {
  columns: DatasetColumn[];
  onToggleColumn: (columnId: string, selected?: boolean) => void;
  onToggleAll?: (selected: boolean) => void;
  onAssignColumnRole: (columnId: string, role: DatasetRole) => void;
  onSelectSpectra?: () => void;
  filter?: ColumnFilter;
  onFilterChange?: (filter: ColumnFilter) => void;
  hideAssigned?: boolean;
  onToggleHideAssigned?: (hide: boolean) => void;
  locale?: Locale;
  icons?: Partial<Record<BuilderIconKey, ReactNode>> | undefined;
  /** show the compact side tip/progress panel (default true). */
  showTip?: boolean;
  className?: string;
}

const TYPE_LABELS: Record<DatasetColumn["detectedType"], Record<Locale, string>> = {
  text: { fr: "Texte", en: "Text" },
  integer: { fr: "Entier", en: "Integer" },
  float: { fr: "Numérique", en: "Numeric" },
  boolean: { fr: "Booléen", en: "Boolean" },
  date: { fr: "Date", en: "Date" },
  unknown: { fr: "Inconnu", en: "Unknown" },
};

const FILTERS: ColumnFilter[] = ["all", "unassigned", "x", "y", "metadata", "id", "partition", "replicate"];

export function ColumnMappingTable({
  columns,
  onToggleColumn,
  onToggleAll,
  onAssignColumnRole,
  onSelectSpectra,
  filter = "all",
  onFilterChange,
  hideAssigned = false,
  onToggleHideAssigned,
  locale = "fr",
  icons,
  showTip = true,
  className,
}: ColumnMappingTableProps) {
  const t = STRINGS[locale];
  const stats = countRoles(columns);
  const progress = stats.total > 0 ? Math.round((stats.assigned / stats.total) * 100) : 0;
  const spectralCount = columns.filter((c) => c.assignedRole === "x").length;

  const visible = columns.filter((col) => {
    if (hideAssigned && col.assignedRole !== "ignored") return false;
    if (filter === "all") return true;
    if (filter === "unassigned") return col.assignedRole === "ignored";
    return col.assignedRole === filter;
  });

  const allVisibleSelected = visible.length > 0 && visible.every((c) => c.selected);

  return (
    <div className={cx("dsb-mapping", className)}>
      <div className="dsb-mapping__toolbar">
        <div className="dsb-mapping__filters" role="tablist" aria-label={t.filterAll}>
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className="dsb-chip"
              data-active={filter === f || undefined}
              data-role={f !== "all" && f !== "unassigned" ? ROLE_DESCRIPTORS[f as DatasetRole]?.token : undefined}
              onClick={onFilterChange ? () => onFilterChange(f) : undefined}
              disabled={!onFilterChange}
            >
              {filterLabel(f, locale)}
            </button>
          ))}
        </div>
        <div className="dsb-mapping__actions">
          {onSelectSpectra ? (
            <button type="button" className="dsb-btn dsb-btn--ghost" onClick={onSelectSpectra}>
              {icon("x", icons)} {t.selectSpectra}
            </button>
          ) : null}
          {onToggleHideAssigned ? (
            <label className="dsb-mapping__toggle">
              <input
                type="checkbox"
                checked={hideAssigned}
                onChange={(e) => onToggleHideAssigned(e.target.checked)}
              />
              {t.hideAssigned}
            </label>
          ) : null}
        </div>
      </div>

      <div className="dsb-mapping__grid">
        <div className="dsb-mapping__table-wrap">
          <table className="dsb-mapping__table">
            <thead>
              <tr>
                <th className="dsb-mapping__col-check">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    aria-label="select all"
                    onChange={
                      onToggleAll
                        ? (e) => onToggleAll(e.target.checked)
                        : (e) => visible.forEach((c) => onToggleColumn(c.id, e.target.checked))
                    }
                  />
                </th>
                <th>{t.columnHeaderName}</th>
                <th>{t.columnHeaderPreview}</th>
                <th>{t.columnHeaderType}</th>
                <th>{t.columnHeaderRole}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((col) => (
                <tr key={col.id} data-selected={col.selected || undefined} data-role={ROLE_DESCRIPTORS[col.assignedRole].token}>
                  <td className="dsb-mapping__col-check">
                    <input
                      type="checkbox"
                      checked={Boolean(col.selected)}
                      aria-label={col.name}
                      onChange={(e) => onToggleColumn(col.id, e.target.checked)}
                    />
                  </td>
                  <td className="dsb-mapping__name">
                    {col.name}
                    {isSpectralHeader(col.name) ? <span className="dsb-mapping__wl" title="wavelength">nm</span> : null}
                  </td>
                  <td className="dsb-mapping__preview">{formatPreview(col.previewValue)}</td>
                  <td className="dsb-mapping__type">{TYPE_LABELS[col.detectedType][locale]}</td>
                  <td className="dsb-mapping__role">
                    <div className="dsb-role-select" data-role={ROLE_DESCRIPTORS[col.assignedRole].token}>
                      <select
                        value={col.assignedRole}
                        onChange={(e) => onAssignColumnRole(col.id, e.target.value as DatasetRole)}
                        aria-label={`${col.name} role`}
                      >
                        {[...ROLE_ORDER, "ignored" as DatasetRole].map((role) => (
                          <option key={role} value={role}>
                            {roleOptionLabel(col, role, locale)}
                          </option>
                        ))}
                      </select>
                      <span className="dsb-role-select__chevron" aria-hidden="true">
                        {icon("chevron", icons)}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={5} className="dsb-mapping__empty">
                    {locale === "en" ? "No columns match this filter." : "Aucune colonne pour ce filtre."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {showTip ? (
          <aside className="dsb-mapping__tip">
            <div className="dsb-mapping__tip-head">
              <span className="dsb-mapping__tip-icon">{icon("spark", icons)}</span>
              <strong>{t.tip}</strong>
            </div>
            <p>{t.tipBody}</p>
            <dl className="dsb-mapping__tip-stats">
              <div>
                <dt>{t.columnsDetected(stats.total)}</dt>
              </div>
              <div>
                <dt>{t.columnsAssigned(stats.assigned)}</dt>
              </div>
              {spectralCount > 0 ? (
                <div>
                  <dt>{spectralCount} {roleLabel("x", locale)}</dt>
                </div>
              ) : null}
            </dl>
            <div className="dsb-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <span className="dsb-progress__bar" style={{ width: `${progress}%` }} />
            </div>
            <span className="dsb-progress__label">{progress} %</span>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function formatPreview(value?: string | number | null): string {
  if (value == null || value === "") return "—";
  const text = String(value);
  return text.length > 16 ? `${text.slice(0, 15)}…` : text;
}

function roleOptionLabel(col: DatasetColumn, role: DatasetRole, locale: Locale): string {
  if (role === "y" && col.semanticType) {
    const task =
      col.semanticType === "classification" || col.semanticType === "categorical"
        ? locale === "en"
          ? "classification"
          : "classification"
        : locale === "en"
          ? "regression"
          : "régression";
    return `${roleLabel("y", locale)} · ${task}`;
  }
  return roleLabel(role, locale);
}

function filterLabel(filter: ColumnFilter, locale: Locale): string {
  if (filter === "all") return locale === "en" ? "All" : "Toutes";
  if (filter === "unassigned") return locale === "en" ? "Unassigned" : "Non assignées";
  return roleLabel(filter, locale);
}
