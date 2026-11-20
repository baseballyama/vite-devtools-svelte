// letters and digits by their physical key, so shortcuts survive keyboard layouts and shift
// (`shift-1` has `e.key` `!`); the recorder and the inspector must agree on these names
export function physicalKey(code: string): string | undefined {
  if (code.startsWith('Key')) return code.slice(3).toLowerCase();
  if (code.startsWith('Digit')) return code.slice(5);
  return undefined;
}
