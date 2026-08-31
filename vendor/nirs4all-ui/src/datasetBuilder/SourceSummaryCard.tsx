import type { ReactNode } from "react";

import { cx } from "./_cx.js";
import { icon, type BuilderIconKey } from "./icons.js";
import { STRINGS } from "./locale.js";
import { signalTypeLabel, type Locale } from "./roles.js";
import type { DatasetSource } from "./types.js";

export interface SourceSummaryCardProps {
  source: DatasetSource;
  sources?: DatasetSource[];
  onChangeSource?: (sourceId: string) => void;
  locale?: Locale;
  icons?: Partial<Record<BuilderIconKey, ReactNode>> | undefined;
  className?: string;
}

const STATUS_TONE: Record<DatasetSource["status"], BuilderIconKey> = {
  uploaded: "info",
  parsed: "check",
  warning: "warning",
  error: "error",
};

function formatBytes(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

function formatCount(n?: number): string {
  return typeof n === "number" ? n.toLocaleString("fr-FR") : "—";
}

/** The active-source card: icon, name, row/column counts, size and status. */
export function SourceSummaryCard({
  source,
  sources,
  onChangeSource,
  locale = "fr",
  icons,
  className,
}: SourceSummaryCardProps) {
  const t = STRINGS[locale];
  const glyph = source.kind === "folder" ? icon("folder", icons) : icon("file", icons);
  const size = formatBytes(source.sizeBytes);
  const statusIconKey = STATUS_TONE[source.status];

  return (
    <article className={cx("dsb-source-card", className)} data-status={source.status}>
      <span className={cx("dsb-source-card__icon", `dsb-ftype-${source.fileType.toLowerCase()}`)}>
        {glyph}
        <span className="dsb-source-card__ext">{source.fileType.toUpperCase()}</span>
      </span>
      <div className="dsb-source-card__body">
        <div className="dsb-source-card__title-row">
          <strong className="dsb-source-card__name">{source.name}</strong>
          <span className="dsb-source-card__badge" data-role={signalToken(source)}>
            {signalTypeLabel(source.signalType, locale)}
          </span>
        </div>
        <p className="dsb-source-card__meta">
          {formatCount(source.rowCount)} {t.rows} · {formatCount(source.columnCount ?? source.columns.length)}{" "}
          {t.columns}
          {size ? ` · ${size}` : ""}
        </p>
      </div>
      <span className="dsb-source-card__status" data-status={source.status}>
        <span className="dsb-source-card__status-icon">{icon(statusIconKey, icons)}</span>
        {statusLabel(source.status, locale)}
      </span>
      {sources && sources.length > 1 && onChangeSource ? (
        <select
          className="dsb-source-card__switch"
          value={source.id}
          onChange={(e) => onChangeSource(e.target.value)}
          aria-label={t.addSource}
        >
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      ) : null}
    </article>
  );
}

function signalToken(source: DatasetSource): string {
  return source.signalType === "spectra" || source.signalType === "hyperspectral"
    ? "x"
    : source.signalType === "target"
      ? "y"
      : "metadata";
}

function statusLabel(status: DatasetSource["status"], locale: Locale): string {
  const en = locale === "en";
  switch (status) {
    case "parsed":
      return en ? "Parsed" : "Fichier chargé";
    case "uploaded":
      return en ? "Uploaded" : "Importé";
    case "warning":
      return en ? "Warning" : "Avertissement";
    case "error":
      return en ? "Error" : "Erreur";
  }
}
