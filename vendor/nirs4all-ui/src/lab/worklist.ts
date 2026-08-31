// Worklist view-model — the physical bridge to the bench (§4 "listes de travail").
// PURE: no React, no IO. Shapes prioritized sample lists (send-to-HPLC, or
// re-measure) with a "why chosen" tag and a safety flag that ENFORCES the golden
// rule (§0): a strong outlier / out-of-domain candidate is flagged to VERIFY,
// never silently auto-selected. Safety is DERIVED from the sample's diagnostic
// signals so an app cannot forget to flag it.

import type { DecisionColor } from './decision.js';
import { loc, type Locale, type LocalizedText } from './locale.js';

export type WorklistKind = 'hplc' | 'remeasure';

/** Safety flag on a candidate: safe to action, or must be checked first. */
export type SafetyFlag = 'safe' | 'verify';

/** Why a candidate was chosen — a short, plain-language tag. */
export type EnrichmentReason =
  | 'extends_range'    // extends the range / covers an empty corner
  | 'fills_gap'        // fills a sparsely-covered region
  | 'rare_type'        // a rare sub-domain worth capturing
  | 'representative'   // a representative point of the current flow
  | 'boundary';        // near the domain boundary

export const ENRICHMENT_REASON_LABEL: Record<EnrichmentReason, LocalizedText> = {
  extends_range: { fr: 'Étend la gamme', en: 'Extends the range' },
  fills_gap: { fr: 'Comble un trou', en: 'Fills a gap' },
  rare_type: { fr: 'Type rare', en: 'Rare type' },
  representative: { fr: 'Représentatif', en: 'Representative' },
  boundary: { fr: 'En bordure', en: 'At the boundary' },
} as const;

export interface SafetyFlagDisplay {
  flag: SafetyFlag;
  label: LocalizedText;
  colorClass: string;
  bgClass: string;
  icon: 'check' | 'alert';
}

export const SAFETY_FLAG_DISPLAY: Record<SafetyFlag, SafetyFlagDisplay> = {
  safe: { flag: 'safe', label: { fr: 'Sûr à envoyer', en: 'Safe to send' }, colorClass: 'text-success', bgClass: 'bg-success/10', icon: 'check' },
  verify: { flag: 'verify', label: { fr: 'À vérifier', en: 'To check' }, colorClass: 'text-warning', bgClass: 'bg-warning/10', icon: 'alert' },
} as const;

export interface WorklistItemInput {
  sampleId: string;
  barcode?: string | null;
  /** why this sample was chosen (enrichment) */
  reason?: EnrichmentReason | null;
  /** free-text override for the reason label */
  reasonText?: string | null;
  /**
   * Explicit safety override. When omitted, safety is DERIVED from the diagnostic
   * signals below so an outlier is never silently marked safe.
   */
  safety?: SafetyFlag | null;
  /** the outlier audit flagged this as a strong spectral outlier */
  strongOutlier?: boolean | null;
  /** the sample's decision colour (from the reliability contract), if known */
  decisionColor?: DecisionColor | null;
  /** optional priority rank (1 = highest) */
  rank?: number | null;
}

export interface WorklistItemView {
  sampleId: string;
  barcode: string | null;
  reasonLabel: string | null;
  safety: SafetyFlag;
  safetyLabel: string;
  safetyColorClass: string;
  safetyBgClass: string;
  safetyIcon: 'check' | 'alert';
  rank: number | null;
}

/**
 * Derive the safety flag, enforcing the golden rule. Precedence:
 *   explicit override → strong outlier / out-of-domain ⇒ 'verify' → else 'safe'.
 * A caution-coloured candidate is also surfaced as 'verify' (needs a check).
 */
export function resolveSafety(input: WorklistItemInput): SafetyFlag {
  if (input.safety) return input.safety;
  if (input.strongOutlier === true) return 'verify';
  if (input.decisionColor === 'out_of_domain' || input.decisionColor === 'caution') return 'verify';
  return 'safe';
}

function finiteRank(rank: number | null | undefined): number | null {
  return typeof rank === 'number' && Number.isFinite(rank) ? rank : null;
}

export function buildWorklistItemView(input: WorklistItemInput, locale: Locale = 'fr'): WorklistItemView {
  const safety = resolveSafety(input);
  const s = SAFETY_FLAG_DISPLAY[safety];
  const reasonLabel = input.reasonText
    ?? (input.reason ? loc(ENRICHMENT_REASON_LABEL[input.reason], locale) : null);
  return {
    sampleId: input.sampleId,
    barcode: input.barcode ?? null,
    reasonLabel,
    safety,
    safetyLabel: loc(s.label, locale),
    safetyColorClass: s.colorClass,
    safetyBgClass: s.bgClass,
    safetyIcon: s.icon,
    rank: finiteRank(input.rank),
  };
}

export interface WorklistSummary {
  kind: WorklistKind;
  total: number;
  safe: number;
  verify: number;
  headline: string;
}

export function summarizeWorklist(
  items: readonly WorklistItemInput[],
  kind: WorklistKind,
  locale: Locale = 'fr',
): WorklistSummary {
  let safe = 0;
  let verify = 0;
  for (const it of items) {
    if (resolveSafety(it) === 'verify') verify += 1;
    else safe += 1;
  }
  const total = items.length;
  const en = locale === 'en';
  const noun = kind === 'hplc'
    ? (en ? 'to send to wet chemistry' : 'à envoyer en chimie humide')
    : (en ? 'to re-measure' : 'à re-mesurer');
  const headline = verify > 0
    ? (en ? `${total} sample(s) ${noun} — ${verify} to check first` : `${total} échantillon(s) ${noun} — dont ${verify} à vérifier d'abord`)
    : (en ? `${total} sample(s) ${noun}` : `${total} échantillon(s) ${noun}`);
  return { kind, total, safe, verify, headline };
}

/** Build a sorted view list (by rank when present, else input order). */
export function buildWorklistViews(items: readonly WorklistItemInput[], locale: Locale = 'fr'): WorklistItemView[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ra = finiteRank(a.item.rank) ?? a.index + 1;
      const rb = finiteRank(b.item.rank) ?? b.index + 1;
      return ra - rb;
    })
    .map(({ item }) => buildWorklistItemView(item, locale));
}
