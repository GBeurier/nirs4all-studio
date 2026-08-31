// Dataset "health" (Quality Passport) view-model — §3 Écran 2. PURE: no React,
// no IO. Turns a list of raw quality findings into an actionable, traffic-light
// check-list and a single overall score, in plain language (never "bad"/"error").

export type HealthSeverity = 'ok' | 'warning' | 'critical';

/** Semantic icon token; the host maps it to an actual ReactNode. */
export type HealthIcon = 'check' | 'alert' | 'ban';

/**
 * A confusable-category tag so the UI never conflates e.g. a saturated spectrum
 * (a measurement problem) with a genuinely rare sample. Mirrors the design's
 * insistence on separating categories.
 */
export type HealthCategory =
  | 'integrity'      // NaN / missing wavelengths / units
  | 'signal'         // saturation / clipping / breaks
  | 'noise'          // S/N, high-frequency noise
  | 'baseline'       // offset / scatter
  | 'repetition'     // replicate inconsistency
  | 'reference'      // y inconsistent with spectrum / history
  | 'structure';     // metadata structure / split recommendation

export interface HealthSeverityDisplay {
  severity: HealthSeverity;
  colorClass: string;
  bgClass: string;
  icon: HealthIcon;
}

export const HEALTH_SEVERITY_DISPLAY: Record<HealthSeverity, HealthSeverityDisplay> = {
  ok: { severity: 'ok', colorClass: 'text-success', bgClass: 'bg-success/10', icon: 'check' },
  warning: { severity: 'warning', colorClass: 'text-warning', bgClass: 'bg-warning/10', icon: 'alert' },
  critical: { severity: 'critical', colorClass: 'text-destructive', bgClass: 'bg-destructive/10', icon: 'ban' },
} as const;

/** The suggested operational action for a finding. */
export type HealthAction = 'accept' | 'remeasure' | 'exclude' | 'verify' | 'auto_handled';

export const HEALTH_ACTION_LABEL: Record<HealthAction, string> = {
  accept: 'Accepter',
  remeasure: 'Re-mesurer',
  exclude: 'Exclure',
  verify: 'À vérifier',
  auto_handled: 'Traité automatiquement',
} as const;

export interface HealthFindingInput {
  id: string;
  title: string;
  detail?: string | null;
  severity: HealthSeverity;
  category?: HealthCategory | null;
  action?: HealthAction | null;
  /** number of samples/repetitions this finding concerns */
  affectedCount?: number | null;
  /** the sample ids concerned (optional; drives a worklist) */
  affectedSampleIds?: string[] | null;
}

export interface HealthFindingView {
  id: string;
  title: string;
  detail: string | null;
  severity: HealthSeverity;
  category: HealthCategory | null;
  action: HealthAction;
  actionLabel: string;
  affectedCount: number | null;
  colorClass: string;
  bgClass: string;
  icon: HealthIcon;
}

const COUNT_FORMATTER = new Intl.NumberFormat('fr-FR');

export function formatAffected(count: number | null | undefined): string | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return null;
  const noun = count > 1 ? 'échantillons' : 'échantillon';
  return `${COUNT_FORMATTER.format(count)} ${noun}`;
}

export function buildHealthFindingView(input: HealthFindingInput): HealthFindingView {
  const display = HEALTH_SEVERITY_DISPLAY[input.severity];
  const action: HealthAction = input.action ?? defaultActionFor(input.severity);
  const rawCount = typeof input.affectedCount === 'number' && Number.isFinite(input.affectedCount)
    ? Math.max(0, Math.trunc(input.affectedCount))
    : input.affectedSampleIds?.length;
  const affectedCount = typeof rawCount === 'number' && rawCount > 0 ? rawCount : null;
  return {
    id: input.id,
    title: input.title,
    detail: input.detail ?? null,
    severity: input.severity,
    category: input.category ?? null,
    action,
    actionLabel: HEALTH_ACTION_LABEL[action],
    affectedCount,
    colorClass: display.colorClass,
    bgClass: display.bgClass,
    icon: display.icon,
  };
}

function defaultActionFor(severity: HealthSeverity): HealthAction {
  if (severity === 'critical') return 'remeasure';
  if (severity === 'warning') return 'verify';
  return 'accept';
}

export interface HealthSummary {
  /** 0..100 overall data-health score (100 = clean) */
  score: number;
  /** worst severity present */
  level: HealthSeverity;
  counts: Record<HealthSeverity, number>;
  total: number;
  /** short plain-language headline */
  headline: string;
}

/**
 * Summarize a set of findings into a single score + headline. The score starts
 * at 100 and is docked per finding (a critical costs more than a warning),
 * floored at 0 — a deliberately simple, explainable rule (no black box).
 */
export function summarizeHealth(findings: readonly HealthFindingInput[]): HealthSummary {
  const counts: Record<HealthSeverity, number> = { ok: 0, warning: 0, critical: 0 };
  for (const f of findings) counts[f.severity] += 1;
  const total = findings.length;
  const penalty = counts.critical * 20 + counts.warning * 6;
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const level: HealthSeverity = counts.critical > 0 ? 'critical' : counts.warning > 0 ? 'warning' : 'ok';
  return { score, level, counts, total, headline: headlineFor(level, counts) };
}

function headlineFor(level: HealthSeverity, counts: Record<HealthSeverity, number>): string {
  if (level === 'critical') {
    return `${counts.critical} point(s) bloquant(s) à traiter avant de continuer`;
  }
  if (level === 'warning') {
    return `${counts.warning} point(s) à vérifier — utilisable avec contrôle`;
  }
  return 'Données saines — prêtes pour la calibration';
}
