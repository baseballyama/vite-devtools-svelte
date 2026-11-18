import { describe, expect, it } from 'vitest';

import { addonLogo } from './addon-logos.js';

describe('addonLogo', () => {
  it("finds an add-on's logo, else Svelte's", () => {
    const svelte = addonLogo('svelte');
    expect(svelte).toBeTruthy();
    expect(addonLogo('vitest')).not.toBe(svelte);
    expect(addonLogo('ai-tools')).toBe(svelte);
  });
});
