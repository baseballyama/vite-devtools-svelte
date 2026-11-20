import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf-8');
const open = page.indexOf('<script>') + '<script>'.length;
const script = page.slice(open, page.indexOf('</script>', open));

/** Runs the inline script of index.html against fakes; returns the theme and OS listeners it left. */
function bootstrap(stored: string | null, osDark: boolean) {
  const dataset: Record<string, string> = {};
  let listeners = 0;
  vm.runInNewContext(script, {
    localStorage: { getItem: () => stored },
    window: {
      matchMedia: () => ({ matches: osDark, addEventListener: () => listeners++ }),
    },
    document: { documentElement: { dataset } },
  });
  return { theme: dataset['theme'], listeners };
}

describe('index.html theme bootstrap', () => {
  it.each([
    [null, true, 'dark'],
    [null, false, 'light'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
    ['blue', true, 'dark'],
  ] as const)('stored %j, OS dark %s → %s', (stored, dark, theme) => {
    expect(bootstrap(stored, dark).theme).toBe(theme);
  });

  // theme.svelte.ts follows the OS in 'system' mode; a second listener here
  // would override a theme picked later in the UI.
  it('leaves OS changes to the theme store', () => {
    expect(bootstrap(null, true).listeners).toBe(0);
  });
});
