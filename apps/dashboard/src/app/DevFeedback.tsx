'use client';

import { Agentation } from 'agentation';

/**
 * Visual feedback toolbar, development only: click an element, leave a note, and
 * the agent reads it from the local Agentation server. Never rendered in a build.
 *
 * Also off under a test run. The end to end suite boots this app with `next
 * dev`, so the development check alone leaves the toolbar reaching for a server
 * that is not there and printing a failure on every page load.
 */
export function DevFeedback({ appName }: { appName: string }) {
  if (process.env.NODE_ENV !== 'development') return null;
  if (process.env.NEXT_PUBLIC_E2E) return null;
  return <Agentation appName={appName} endpoint="http://localhost:4747" />;
}
