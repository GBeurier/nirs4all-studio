import { cx } from "./_cx.js";
import { STRINGS } from "./locale.js";
import type { Locale } from "./roles.js";
import type { PartitionMode, PartitionPreviewModel } from "./types.js";

export interface PartitionPreviewProps {
  preview: PartitionPreviewModel;
  onModeChange?: (mode: PartitionMode) => void;
  locale?: Locale;
  className?: string;
}

const MODES: PartitionMode[] = ["train_test", "train_only", "train_val_test", "folds"];

const BUCKET_TONE: Record<string, string> = {
  train: "x",
  test: "partition",
  validation: "y",
};

/** Train/test/validation/folds counters shown under the central panel. */
export function PartitionPreview({ preview, onModeChange, locale = "fr", className }: PartitionPreviewProps) {
  const t = STRINGS[locale];

  return (
    <section className={cx("dsb-partition", className)} aria-label={t.partitionTitle}>
      <div className="dsb-partition__head">
        <h3 className="dsb-partition__title">{t.partitionTitle}</h3>
        <div className="dsb-partition__modes" role="group">
          {MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className="dsb-chip"
              data-active={preview.mode === mode || undefined}
              onClick={onModeChange ? () => onModeChange(mode) : undefined}
              disabled={!onModeChange}
            >
              {t.partitionModes[mode]}
            </button>
          ))}
        </div>
      </div>

      {!preview.detected && preview.mode !== "train_only" ? (
        <p className="dsb-partition__note">
          {locale === "en"
            ? "No partition column detected — an 80/20 split is estimated."
            : "Aucune partition détectée — un split 80/20 est estimé."}
        </p>
      ) : preview.columnName ? (
        <p className="dsb-partition__note">
          {locale === "en" ? "From column " : "D'après la colonne "}
          <code>{preview.columnName}</code>
        </p>
      ) : null}

      <div className="dsb-partition__buckets">
        {preview.buckets.map((bucket) => (
          <div key={bucket.id} className="dsb-partition__bucket" data-role={BUCKET_TONE[bucket.id] ?? "group"}>
            <span className="dsb-partition__bucket-label">{bucket.label}</span>
            <strong className="dsb-partition__bucket-count">{bucket.count.toLocaleString("fr-FR")}</strong>
            <span className="dsb-partition__bucket-ratio">
              {bucket.count.toLocaleString("fr-FR")} {t.rows} · {Math.round(bucket.ratio * 100)} %
            </span>
            <span className="dsb-partition__bucket-bar" style={{ width: `${Math.round(bucket.ratio * 100)}%` }} />
          </div>
        ))}
      </div>
    </section>
  );
}
