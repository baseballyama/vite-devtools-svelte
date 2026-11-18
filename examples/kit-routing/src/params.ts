import { defineParams } from '@sveltejs/kit/params';

// SvelteKit 3 param matchers. `[id=integer]` only matches digits (so /items/abc
// falls through to a 404) and the param arrives as a number.
export const params = defineParams({
  integer: param => (isDigits(param) ? Number(param) : undefined),
});

function isDigits(value: string): boolean {
  if (value.length === 0) return false;
  for (const char of value) if (char < '0' || char > '9') return false;
  return true;
}
