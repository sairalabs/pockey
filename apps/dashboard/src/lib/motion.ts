/**
 * emil-design-eng: never animate keyboard-initiated actions. Base UI hands us
 * the native event that opened a popup; when it is a KeyboardEvent the popup
 * gets `data-no-motion` and its transition duration drops to 0ms (globals.css).
 */
export function isKeyboardEvent(event: Event | undefined): boolean {
  return typeof KeyboardEvent !== 'undefined' && event instanceof KeyboardEvent;
}
