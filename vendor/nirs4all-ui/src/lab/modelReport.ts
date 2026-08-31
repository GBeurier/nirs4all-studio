// Model "report card" view-model — §3 Écran 4. PURE: no React, no IO. Turns raw
// evaluation metrics into a plain-language verdict ("good enough for screening /
// quantification?") with per-metric interpretation. The grade thresholds are
// CONFIGURABLE per validated method — never hardcoded, per §4bis.

import { loc, type Locale, type LocalizedText } from './locale.js';

/** What the model is fit to be used for, by its accuracy. */
export type ModelGrade = 'quantification' | 'screening' | 'insufficient';

export interface ModelGradeDisplay {
  grade: ModelGrade;
  label: LocalizedText;
  /** plain-language verdict (bilingual) */
  verdict: LocalizedText;
  colorClass: string;
  bgClass: string;
}

export const MODEL_GRADE_DISPLAY: Record<ModelGrade, ModelGradeDisplay> = {
  quantification: {
    grade: 'quantification',
    label: { fr: 'Quantification', en: 'Quantification' },
    verdict: { fr: 'Assez bon pour de la quantification', en: 'Good enough for quantification' },
    colorClass: 'text-success',
    bgClass: 'bg-success/10',
  },
  screening: {
    grade: 'screening',
    label: { fr: 'Criblage', en: 'Screening' },
    verdict: { fr: 'Utilisable pour du criblage / tri', en: 'Usable for screening / triage' },
    colorClass: 'text-warning',
    bgClass: 'bg-warning/10',
  },
  insufficient: {
    grade: 'insufficient',
    label: { fr: 'Insuffisant', en: 'Insufficient' },
    verdict: { fr: 'Précision insuffisante — enrichir la calibration', en: 'Insufficient accuracy — enrich the calibration' },
    colorClass: 'text-destructive',
    bgClass: 'bg-destructive/10',
  },
} as const;

export interface ModelMetricsInput {
  rmse?: number | null;
  r2?: number | null;
  rpd?: number | null;
  rpiq?: number | null;
  bias?: number | null;
  /** number of samples the metrics were computed on */
  n?: number | null;
}

/**
 * Grade thresholds. Defaults are the widely-used RPD/RPIQ chemometric bands, but
 * a validated method overrides them.
 */
export interface ModelReportThresholds {
  rpdScreening?: number;      // ≥ this → at least screening
  rpdQuantification?: number; // ≥ this → quantification
  rpiqScreening?: number;
  rpiqQuantification?: number;
  /** which metric leads the grade when BOTH are present (default 'rpd') */
  primaryMetric?: 'rpd' | 'rpiq';
  /**
   * How to combine RPD & RPIQ when both are present:
   * - 'primary'      → use `primaryMetric` (the other is informational)
   * - 'conservative' → take the WORSE of the two grades (safer for release)
   */
  gradingMode?: 'primary' | 'conservative';
}

export const DEFAULT_MODEL_REPORT_THRESHOLDS: Required<ModelReportThresholds> = {
  rpdScreening: 2,
  rpdQuantification: 2.5,
  rpiqScreening: 2.3,
  rpiqQuantification: 4.1,
  primaryMetric: 'rpd',
  gradingMode: 'primary',
} as const;

export type MetricInterpretationTone = 'good' | 'fair' | 'poor' | 'neutral';

export interface MetricInterpretation {
  key: 'rmse' | 'r2' | 'rpd' | 'rpiq' | 'bias';
  label: string;
  value: number | null;
  /** formatted value string */
  display: string;
  /** plain-language reading, e.g. "RPD 2.4 = bon pour du criblage" */
  reading: string;
  tone: MetricInterpretationTone;
}

export interface ModelReportView {
  grade: ModelGrade;
  gradeLabel: string;
  verdict: string;
  colorClass: string;
  bgClass: string;
  metrics: MetricInterpretation[];
}

function num(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

const VALUE_FORMATTER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });

function fmt(value: number | undefined): string {
  return value === undefined ? '—' : VALUE_FORMATTER.format(value);
}

const GRADE_RANK: Record<ModelGrade, number> = { insufficient: 0, screening: 1, quantification: 2 };
const RANK_GRADE: readonly ModelGrade[] = ['insufficient', 'screening', 'quantification'];

/**
 * Grade the model from RPD/RPIQ with an EXPLICIT conflict policy (no silent
 * "RPD wins"): `gradingMode` decides how the two combine when both are present.
 */
export function gradeModel(
  metrics: ModelMetricsInput,
  thresholds?: ModelReportThresholds | null,
): ModelGrade {
  const t = mergeThresholds(thresholds);
  const rpdGrade = gradeFromValue(num(metrics.rpd), t.rpdScreening, t.rpdQuantification);
  const rpiqGrade = gradeFromValue(num(metrics.rpiq), t.rpiqScreening, t.rpiqQuantification);
  return combineGrades(rpdGrade, rpiqGrade, t);
}

function gradeFromValue(
  value: number | undefined,
  screening: number,
  quantification: number,
): ModelGrade | undefined {
  if (value === undefined) return undefined;
  if (value >= quantification) return 'quantification';
  if (value >= screening) return 'screening';
  return 'insufficient';
}

function combineGrades(
  rpd: ModelGrade | undefined,
  rpiq: ModelGrade | undefined,
  t: Required<ModelReportThresholds>,
): ModelGrade {
  if (rpd === undefined && rpiq === undefined) return 'insufficient';
  if (rpd !== undefined && rpiq !== undefined) {
    if (t.gradingMode === 'conservative') {
      const worst = Math.min(GRADE_RANK[rpd], GRADE_RANK[rpiq]);
      return RANK_GRADE[worst] ?? 'insufficient';
    }
    return (t.primaryMetric === 'rpiq' ? rpiq : rpd);
  }
  return (rpd ?? rpiq) as ModelGrade;
}

function mergeThresholds(t?: ModelReportThresholds | null): Required<ModelReportThresholds> {
  const out = { ...DEFAULT_MODEL_REPORT_THRESHOLDS };
  if (!t) return out;
  if (num(t.rpdScreening) !== undefined) out.rpdScreening = t.rpdScreening as number;
  if (num(t.rpdQuantification) !== undefined) out.rpdQuantification = t.rpdQuantification as number;
  if (num(t.rpiqScreening) !== undefined) out.rpiqScreening = t.rpiqScreening as number;
  if (num(t.rpiqQuantification) !== undefined) out.rpiqQuantification = t.rpiqQuantification as number;
  if (t.primaryMetric === 'rpd' || t.primaryMetric === 'rpiq') out.primaryMetric = t.primaryMetric;
  if (t.gradingMode === 'primary' || t.gradingMode === 'conservative') out.gradingMode = t.gradingMode;
  return out;
}

export function buildModelReportView(
  metrics: ModelMetricsInput,
  thresholds?: ModelReportThresholds | null,
  locale: Locale = 'fr',
): ModelReportView {
  const t = mergeThresholds(thresholds);
  const grade = gradeModel(metrics, t);
  const display = MODEL_GRADE_DISPLAY[grade];
  return {
    grade,
    gradeLabel: loc(display.label, locale),
    verdict: loc(display.verdict, locale),
    colorClass: display.colorClass,
    bgClass: display.bgClass,
    metrics: [
      interpretRpd(num(metrics.rpd), t, locale),
      interpretRpiq(num(metrics.rpiq), t, locale),
      interpretR2(num(metrics.r2), locale),
      interpretRmse(num(metrics.rmse), locale),
      interpretBias(num(metrics.bias), locale),
    ],
  };
}

function interpretRpd(value: number | undefined, t: Required<ModelReportThresholds>, locale: Locale): MetricInterpretation {
  const en = locale === 'en';
  let reading = en ? 'SD / error ratio — not available' : 'Ratio écart-type / erreur — non disponible';
  let tone: MetricInterpretationTone = 'neutral';
  if (value !== undefined) {
    if (value >= t.rpdQuantification) { reading = `RPD ${fmt(value)} ${en ? '= good for quantification' : '= bon pour de la quantification'}`; tone = 'good'; }
    else if (value >= t.rpdScreening) { reading = `RPD ${fmt(value)} ${en ? '= ok for screening' : '= correct pour du criblage'}`; tone = 'fair'; }
    else { reading = `RPD ${fmt(value)} ${en ? '= insufficient' : '= insuffisant'}`; tone = 'poor'; }
  }
  return { key: 'rpd', label: 'RPD', value: value ?? null, display: fmt(value), reading, tone };
}

function interpretRpiq(value: number | undefined, t: Required<ModelReportThresholds>, locale: Locale): MetricInterpretation {
  const en = locale === 'en';
  let reading = en ? 'IQR / error ratio — not available' : 'Ratio IQR / erreur — non disponible';
  let tone: MetricInterpretationTone = 'neutral';
  if (value !== undefined) {
    if (value >= t.rpiqQuantification) { reading = `RPIQ ${fmt(value)} ${en ? '= good for quantification' : '= bon pour de la quantification'}`; tone = 'good'; }
    else if (value >= t.rpiqScreening) { reading = `RPIQ ${fmt(value)} ${en ? '= ok for screening' : '= correct pour du criblage'}`; tone = 'fair'; }
    else { reading = `RPIQ ${fmt(value)} ${en ? '= insufficient' : '= insuffisant'}`; tone = 'poor'; }
  }
  return { key: 'rpiq', label: 'RPIQ', value: value ?? null, display: fmt(value), reading, tone };
}

function interpretR2(value: number | undefined, locale: Locale): MetricInterpretation {
  const en = locale === 'en';
  let reading = en ? 'Explained variance — not available' : 'Variance expliquée — non disponible';
  let tone: MetricInterpretationTone = 'neutral';
  if (value !== undefined) {
    const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
    const tail = en ? `— ${pct}% of variance explained` : `— ${pct} % de la variance expliquée`;
    if (value >= 0.9) { reading = `R² ${fmt(value)} ${tail} ${en ? '(high)' : '(élevé)'}`; tone = 'good'; }
    else if (value >= 0.7) { reading = `R² ${fmt(value)} ${tail}`; tone = 'fair'; }
    else { reading = `R² ${fmt(value)} ${tail} ${en ? '(low)' : '(faible)'}`; tone = 'poor'; }
  }
  return { key: 'r2', label: 'R²', value: value ?? null, display: fmt(value), reading, tone };
}

function interpretRmse(value: number | undefined, locale: Locale): MetricInterpretation {
  const en = locale === 'en';
  const reading = value === undefined
    ? (en ? 'Prediction error — not available' : 'Erreur de prédiction — non disponible')
    : `RMSEP ${fmt(value)} ${en ? '— typical prediction error (target unit)' : '— erreur typique de prédiction (unité de la cible)'}`;
  return { key: 'rmse', label: 'RMSEP', value: value ?? null, display: fmt(value), reading, tone: 'neutral' };
}

function interpretBias(value: number | undefined, locale: Locale): MetricInterpretation {
  const en = locale === 'en';
  let reading = en ? 'Mean bias — not available' : 'Biais moyen — non disponible';
  let tone: MetricInterpretationTone = 'neutral';
  if (value !== undefined) {
    const abs = Math.abs(value);
    const dir = abs < 1e-6 ? (en ? 'near zero' : 'quasi nul') : value > 0 ? (en ? 'over-estimates on average' : 'sur-estime en moyenne') : (en ? 'under-estimates on average' : 'sous-estime en moyenne');
    reading = `${en ? 'Bias' : 'Biais'} ${fmt(value)} — ${dir}`;
    tone = abs < 1e-6 ? 'good' : 'fair';
  }
  return { key: 'bias', label: en ? 'Bias' : 'Biais', value: value ?? null, display: fmt(value), reading, tone };
}
