// Lab sample-lifecycle status — the §1bis "paillasse" backbone. PURE view-model:
// no React, no IO, no app state. The status is the operational spine that
// precedes any ML: a sample moves received → measured → (re-measure) → sent to
// wet chemistry → integrated / excluded, and every transition is traceable.

/** The sample lifecycle, in operational order. */
export const SAMPLE_STATUSES = [
  'received',
  'nirs_measured',
  'to_remeasure',
  'sent_hplc',
  'integrated',
  'excluded',
] as const;

export type SampleStatus = typeof SAMPLE_STATUSES[number];

/** Semantic icon token; the host maps it to an actual ReactNode. */
export type SampleStatusIcon = 'inbox' | 'waveform' | 'refresh' | 'flask' | 'check' | 'x';

export interface SampleStatusDisplay {
  status: SampleStatus;
  label: string;
  /** one-line plain-language description of what this state means operationally */
  description: string;
  colorClass: string;
  bgClass: string;
  icon: SampleStatusIcon;
  /** terminal states no longer move through the workflow */
  isTerminal: boolean;
}

export const SAMPLE_STATUS_DISPLAY: Record<SampleStatus, SampleStatusDisplay> = {
  received: {
    status: 'received',
    label: 'Reçu',
    description: 'Échantillon enregistré, en attente de passage NIRS',
    colorClass: 'text-muted-foreground',
    bgClass: 'bg-muted/50',
    icon: 'inbox',
    isTerminal: false,
  },
  nirs_measured: {
    status: 'nirs_measured',
    label: 'Mesuré NIRS',
    description: 'Spectres acquis (avec répétitions)',
    colorClass: 'text-chart-2',
    bgClass: 'bg-chart-2/10',
    icon: 'waveform',
    isTerminal: false,
  },
  to_remeasure: {
    status: 'to_remeasure',
    label: 'À re-mesurer',
    description: 'Qualité insuffisante — repasser à la NIRS',
    colorClass: 'text-warning',
    bgClass: 'bg-warning/10',
    icon: 'refresh',
    isTerminal: false,
  },
  sent_hplc: {
    status: 'sent_hplc',
    label: 'Envoyé HPLC',
    description: 'En chimie humide, en attente de la valeur de référence',
    colorClass: 'text-chart-3',
    bgClass: 'bg-chart-3/10',
    icon: 'flask',
    isTerminal: false,
  },
  integrated: {
    status: 'integrated',
    label: 'Intégré',
    description: 'Couple spectre + référence intégré à la calibration',
    colorClass: 'text-success',
    bgClass: 'bg-success/10',
    icon: 'check',
    isTerminal: true,
  },
  excluded: {
    status: 'excluded',
    label: 'Écarté',
    description: 'Retiré du jeu (artefact / hors domaine / incohérent)',
    colorClass: 'text-destructive',
    bgClass: 'bg-destructive/10',
    icon: 'x',
    isTerminal: true,
  },
} as const;

export function isSampleStatus(value: unknown): value is SampleStatus {
  return typeof value === 'string'
    && Object.prototype.hasOwnProperty.call(SAMPLE_STATUS_DISPLAY, value);
}

export function resolveSampleStatus(
  value: string | null | undefined,
  fallback: SampleStatus = 'received',
): SampleStatus {
  return isSampleStatus(value) ? value : fallback;
}

export function getSampleStatusDisplay(value: string | null | undefined): SampleStatusDisplay {
  return SAMPLE_STATUS_DISPLAY[resolveSampleStatus(value)];
}

/** Aggregate a batch of sample statuses into per-state counts (for dashboards). */
export function countSampleStatuses(
  statuses: Iterable<string | null | undefined>,
): Record<SampleStatus, number> {
  const counts: Record<SampleStatus, number> = {
    received: 0,
    nirs_measured: 0,
    to_remeasure: 0,
    sent_hplc: 0,
    integrated: 0,
    excluded: 0,
  };
  for (const s of statuses) {
    counts[resolveSampleStatus(s)] += 1;
  }
  return counts;
}
