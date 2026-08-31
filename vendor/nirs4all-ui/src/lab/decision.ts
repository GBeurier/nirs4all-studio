// Lab decision-semantics contract — the traffic-light model (§4bis of the
// quali-nirs4all design). PURE view-model: no React, no IO, no app state, no
// browser globals, no randomness. Given per-prediction / per-candidate
// applicability signals and a method's validated thresholds, it produces the
// display contract for a decision colour: meaning + authorized action +
// confidence + who-can-override + the reason to record.
//
// The four colours are a CONTRACT, never a bare pictogram. A host always shows:
// status + main reason + authorized action + confidence + a "see detail" hook.

/**
 * The four decision colours, named by MEANING (not by hue) so the vocabulary is
 * unambiguous:
 * - `reliable`    (🟢) usable in routine
 * - `caution`     (🟠) usable with control / second reading
 * - `out_of_domain` (🔴) do not release → wet chemistry / re-measure
 * - `informative` (🔵) measuring it would improve the model (≠ "good")
 */
import { loc, type Locale, type LocalizedText } from './locale.js';

export type DecisionColor = 'reliable' | 'caution' | 'out_of_domain' | 'informative';

/** Who is allowed to override a decision (overrides are always traced). */
export type DecisionOverride = 'none' | 'method_owner';

/** Confidence attached to the decision itself, shown alongside the colour. */
export type DecisionConfidence = 'high' | 'medium' | 'low';

/** Semantic icon token; the host maps it to an actual ReactNode. */
export type DecisionIcon = 'check' | 'alert' | 'ban' | 'sparkles';

/**
 * The confusable categories the design insists on separating in the UI. A
 * decision carries at most one primary category so the host never conflates
 * e.g. a measurement artefact with a rare-but-real sample.
 */
export type DecisionCategory =
  | 'in_domain'
  | 'near_border'
  | 'out_of_domain'
  | 'measurement_artifact'
  | 'rare_sample'
  | 'uncertain_prediction'
  | 'enrichment_candidate';

/**
 * Per-method, per-decision static display data. This is the ONLY place colour
 * token strings live (the host applies them; nothing is hardcoded in JSX). Token
 * classes follow the shared scientific theme (`--success`/`--warning`/
 * `--destructive` plus a sky tone for the informative/blue state).
 */
export interface DecisionDisplay {
  color: DecisionColor;
  /** short human label, e.g. "Reliable" (bilingual) */
  label: LocalizedText;
  /** the authorized action, in plain, non-pseudo-certain language (bilingual) */
  action: LocalizedText;
  overridableBy: DecisionOverride;
  icon: DecisionIcon;
  /** suggested foreground token class (host may override) */
  colorClass: string;
  /** suggested background/tint token class (host may override) */
  bgClass: string;
}

export const DECISION_DISPLAY: Record<DecisionColor, DecisionDisplay> = {
  reliable: {
    color: 'reliable',
    label: { fr: 'Fiable', en: 'Reliable' },
    action: { fr: 'Résultat utilisable en routine', en: 'Result usable in routine' },
    overridableBy: 'none',
    icon: 'check',
    colorClass: 'text-success',
    bgClass: 'bg-success/10',
  },
  caution: {
    color: 'caution',
    label: { fr: 'Prudence', en: 'Caution' },
    action: { fr: 'Utilisable avec contrôle ou 2ᵉ lecture', en: 'Usable with control or a second reading' },
    overridableBy: 'method_owner',
    icon: 'alert',
    colorClass: 'text-warning',
    bgClass: 'bg-warning/10',
  },
  out_of_domain: {
    color: 'out_of_domain',
    label: { fr: 'Hors domaine', en: 'Out of domain' },
    action: { fr: 'Ne pas rendre → chimie humide / re-mesure', en: 'Do not release → wet chemistry / re-measure' },
    overridableBy: 'method_owner',
    icon: 'ban',
    colorClass: 'text-destructive',
    bgClass: 'bg-destructive/10',
  },
  informative: {
    color: 'informative',
    label: { fr: 'Informatif pour amélioration', en: 'Informative for improvement' },
    action: { fr: "Proposer en file d'enrichissement", en: 'Add to the enrichment queue' },
    overridableBy: 'none',
    icon: 'sparkles',
    // theme token (indigo chart-3) rather than a raw palette class, so the
    // shared contract never freezes a colour outside the app theme.
    colorClass: 'text-chart-3',
    bgClass: 'bg-chart-3/10',
  },
} as const;

/**
 * A validated method's decision thresholds. Everything is CONFIGURABLE per
 * validated method — never hardcoded RPD/RPIQ. All fields optional so a method
 * can start with partial calibration; `DEFAULT_DECISION_THRESHOLDS` fills gaps.
 */
export interface DecisionThresholds {
  /** applicability-domain score above which a prediction is on the border (🟠) */
  adWarn?: number;
  /** applicability-domain score above which a prediction is out-of-domain (🔴) */
  adReject?: number;
  /** conformal interval width above which precision is only "caution" (🟠) */
  intervalWarn?: number;
  /** conformal interval width above which the result is unusable (🔴) */
  intervalMax?: number;
  /** local-density (0..1, higher = denser) below which a sample is enrichment-worthy (🔵) */
  lowDensity?: number;
}

export const DEFAULT_DECISION_THRESHOLDS: Required<DecisionThresholds> = {
  adWarn: 1,
  adReject: 2,
  intervalWarn: Number.POSITIVE_INFINITY,
  intervalMax: Number.POSITIVE_INFINITY,
  lowDensity: 0.15,
} as const;

/**
 * The applicability signals for one prediction / candidate. All optional and
 * permissive — the decision degrades gracefully when a signal is absent.
 */
export interface DecisionInput {
  /**
   * Normalized applicability-domain score, higher = further from the training
   * domain (e.g. a combined T²/Q/Mahalanobis/kNN score scaled so 1 ≈ the warn
   * boundary). This is the primary domain signal.
   */
  applicabilityScore?: number | null;
  /** width of the conformal prediction interval (same unit as the target) */
  intervalWidth?: number | null;
  /** ŷ falls outside (or at the edge of) the observed training Y range */
  extrapolation?: boolean | null;
  /** local density of the sample in the model space, 0..1 (lower = rarer) */
  localDensity?: number | null;
  /** the model flagged this as a strong spectral outlier (artefact vs rare) */
  strongOutlier?: boolean | null;
  /** OOD/SSI gate rejected the sample outright (domain not admissible) */
  gateRejected?: boolean | null;
}

/** The full display contract produced for one decision. */
export interface DecisionView {
  color: DecisionColor;
  label: string;
  /** main reason, plain language, non-pseudo-certain */
  reason: string;
  /** authorized action for this colour */
  action: string;
  confidence: DecisionConfidence;
  overridableBy: DecisionOverride;
  category: DecisionCategory;
  icon: DecisionIcon;
  colorClass: string;
  bgClass: string;
  /** a detail view is always available behind the badge */
  detailAvailable: true;
}

function n(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Resolve + NORMALIZE thresholds so an inverted/out-of-range config can never
 * produce incoherent decisions: the warn boundary is clamped never to exceed the
 * reject boundary, and density is clamped to [0,1]. A pure view-model never
 * throws on bad config — it degrades to a coherent order.
 */
function resolveThresholds(t?: DecisionThresholds | null): Required<DecisionThresholds> {
  const adReject = n(t?.adReject) ?? DEFAULT_DECISION_THRESHOLDS.adReject;
  const adWarn = Math.min(n(t?.adWarn) ?? DEFAULT_DECISION_THRESHOLDS.adWarn, adReject);
  const intervalMax = n(t?.intervalMax) ?? DEFAULT_DECISION_THRESHOLDS.intervalMax;
  const intervalWarn = Math.min(n(t?.intervalWarn) ?? DEFAULT_DECISION_THRESHOLDS.intervalWarn, intervalMax);
  const lowDensity = Math.max(0, Math.min(1, n(t?.lowDensity) ?? DEFAULT_DECISION_THRESHOLDS.lowDensity));
  return { adWarn, adReject, intervalWarn, intervalMax, lowDensity };
}

/**
 * Decide the colour + full contract for one prediction/candidate.
 *
 * Ordering embodies the golden rule (§0): a strong outlier / rejected gate / hard
 * out-of-domain is 🔴 first (never auto-usable, never auto-selected). Then border
 * cases are 🟠. A clean, dense in-domain prediction is 🟢. A clean but rare/low-
 * density sample is 🔵 (informative), NOT "good" — it is worth measuring.
 */
export function buildDecisionView(
  input: DecisionInput,
  thresholds?: DecisionThresholds | null,
  locale: Locale = 'fr',
): DecisionView {
  const t = resolveThresholds(thresholds);
  const ad = n(input.applicabilityScore);
  const width = n(input.intervalWidth);
  const density = n(input.localDensity);

  // --- 🔴 out-of-domain: refuse to release ---------------------------------
  if (input.gateRejected === true) {
    return view('out_of_domain', 'measurement_artifact', 'low',
      { fr: 'Domaine non admissible (gate OOD/SSI négatif)', en: 'Domain not admissible (OOD/SSI gate rejected)' }, locale);
  }
  if (ad !== undefined && ad >= t.adReject) {
    return view('out_of_domain', 'out_of_domain', 'low',
      { fr: 'Spectre hors du domaine du modèle actuel', en: 'Spectrum outside the current model domain' }, locale);
  }
  if (width !== undefined && width >= t.intervalMax) {
    return view('out_of_domain', 'uncertain_prediction', 'low',
      { fr: 'Intervalle de prédiction trop large pour être utilisable', en: 'Prediction interval too wide to be usable' }, locale);
  }
  if (input.strongOutlier === true) {
    // Strong spectral outlier: an artefact OR a real extreme — never usable
    // without verification, per the golden rule. Held at 🔴 for review.
    return view('out_of_domain', 'measurement_artifact', 'low',
      { fr: 'Outlier spectral fort — à vérifier avant tout usage', en: 'Strong spectral outlier — verify before any use' }, locale);
  }

  // --- 🟠 caution: on the border / uncertain -------------------------------
  if (ad !== undefined && ad >= t.adWarn) {
    return view('caution', 'near_border', 'medium',
      { fr: 'En bordure du domaine connu du modèle', en: 'At the edge of the model’s known domain' }, locale);
  }
  if (width !== undefined && width >= t.intervalWarn) {
    return view('caution', 'uncertain_prediction', 'medium',
      { fr: 'Incertitude élevée (intervalle large)', en: 'High uncertainty (wide interval)' }, locale);
  }
  if (input.extrapolation === true) {
    return view('caution', 'uncertain_prediction', 'medium',
      { fr: "Valeur prédite proche ou hors de la gamme observée à l'apprentissage", en: 'Predicted value near or outside the training range' }, locale);
  }

  // --- 🔵 informative for improvement (clean but rare) ---------------------
  if (density !== undefined && density <= t.lowDensity) {
    return view('informative', 'enrichment_candidate', 'high',
      { fr: 'Échantillon rare/peu couvert — le mesurer enrichirait le modèle', en: 'Rare / sparsely-covered sample — measuring it would enrich the model' }, locale);
  }

  // --- 🟢 reliable ----------------------------------------------------------
  return view('reliable', 'in_domain', 'high',
    { fr: 'Dans le domaine connu, intervalle raisonnable, pas d’extrapolation', en: 'In the known domain, reasonable interval, no extrapolation' }, locale);
}

function view(
  color: DecisionColor,
  category: DecisionCategory,
  confidence: DecisionConfidence,
  reason: LocalizedText,
  locale: Locale,
): DecisionView {
  const d = DECISION_DISPLAY[color];
  return {
    color,
    label: loc(d.label, locale),
    reason: loc(reason, locale),
    action: loc(d.action, locale),
    confidence,
    overridableBy: d.overridableBy,
    category,
    icon: d.icon,
    colorClass: d.colorClass,
    bgClass: d.bgClass,
    detailAvailable: true,
  };
}

/** Type guard for a decision colour string. */
export function isDecisionColor(value: unknown): value is DecisionColor {
  return value === 'reliable' || value === 'caution'
    || value === 'out_of_domain' || value === 'informative';
}
