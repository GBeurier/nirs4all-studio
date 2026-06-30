import { useContext } from 'react';

import {
  PlaygroundSessionContext,
  type PlaygroundSessionContextValue,
} from './PlaygroundSessionContextCore';

/**
 * Hook to access playground session context.
 */
export function usePlaygroundSession(): PlaygroundSessionContextValue {
  const context = useContext(PlaygroundSessionContext);
  if (!context) {
    throw new Error('usePlaygroundSession must be used within a PlaygroundSessionProvider');
  }
  return context;
}

/**
 * Optional hook that returns null if not within provider.
 */
export function usePlaygroundSessionOptional(): PlaygroundSessionContextValue | null {
  return useContext(PlaygroundSessionContext);
}
