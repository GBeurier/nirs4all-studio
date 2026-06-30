import { createContext } from 'react';
import type { PlaygroundSessionContextValue } from '@/lib/playground/sessionState';

export { DEFAULT_CHART_VISIBILITY } from '@/lib/playground/sessionState';
export type {
  ChartVisibility,
  PlaygroundSessionContextValue,
  PlaygroundSessionState,
} from '@/lib/playground/sessionState';

export const PlaygroundSessionContext = createContext<PlaygroundSessionContextValue | null>(null);
