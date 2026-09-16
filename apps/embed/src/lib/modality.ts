/**
 * Tracks whether the last interaction came from the keyboard. Keyboard initiated
 * navigation (Enter to submit, Escape to close) only animates opacity.
 */
let lastModality: 'keyboard' | 'pointer' = 'pointer';

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

export function installModalityTracking(target: Window): () => void {
  const onKey = (event: KeyboardEvent) => {
    if (!MODIFIERS.has(event.key)) lastModality = 'keyboard';
  };
  const onPointer = () => {
    lastModality = 'pointer';
  };
  target.addEventListener('keydown', onKey, true);
  target.addEventListener('pointerdown', onPointer, true);
  return () => {
    target.removeEventListener('keydown', onKey, true);
    target.removeEventListener('pointerdown', onPointer, true);
  };
}

export function isKeyboardModality(): boolean {
  return lastModality === 'keyboard';
}
