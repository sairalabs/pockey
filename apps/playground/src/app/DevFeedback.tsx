'use client';

import { Agentation } from 'agentation';

/**
 * Visual feedback toolbar, development only: click an element, leave a note, and
 * the agent reads it from the local Agentation server. Never rendered in a build.
 */
export function DevFeedback({ appName }: { appName: string }) {
  if (process.env.NODE_ENV !== 'development') return null;
  return <Agentation appName={appName} endpoint="http://localhost:4747" />;
}
