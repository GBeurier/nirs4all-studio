import type {
  BinnedImportanceData,
  ExplainerType,
  Partition,
  ShapResultsResponse,
  ShapTab,
} from '@/types/shap';

const STORAGE_KEY = 'nirs4all_shap_session';
const STORAGE_VERSION = 1;
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface ShapSessionState {
  chainId: string | null;
  datasetName: string | null;
  partition: Partition;
  explainerType: ExplainerType;
  jobId: string | null;
  results: ShapResultsResponse | null;
  rebinnedData: BinnedImportanceData | null;
  isSubmitting: boolean;
  activeTab: ShapTab;
  selectedSamples: number[];
  savedAt: number;
  version: number;
}

export type PersistedShapSessionState = Omit<ShapSessionState, 'savedAt' | 'version'>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSessionState(value: unknown): value is ShapSessionState {
  if (!isObject(value)) return false;

  return (
    value.version === STORAGE_VERSION &&
    typeof value.savedAt === 'number' &&
    Array.isArray(value.selectedSamples)
  );
}

export function loadShapSessionState(): ShapSessionState | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const parsed = JSON.parse(stored) as unknown;
    if (!isSessionState(parsed)) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }

    if (Date.now() - parsed.savedAt > SESSION_MAX_AGE_MS) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function persistShapSessionState(state: PersistedShapSessionState): void {
  try {
    const payload: ShapSessionState = {
      ...state,
      savedAt: Date.now(),
      version: STORAGE_VERSION,
    };

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore session storage failures.
  }
}

export function clearShapSessionState(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore session storage failures.
  }
}
