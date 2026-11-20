import { describe, expect, it } from 'vitest';

import { defaultInspectorOptions } from '../src/options.js';
import { same } from '../src/runtime/settings-shared.js';
import { mergeOptions, pickOptions, updateSaved, validateSettings } from '../src/settings.js';

const withDefaults = (patch: Record<string, unknown>) => ({
  ...structuredClone(defaultInspectorOptions),
  ...patch,
});

describe('settings', () => {
  it('accepts the default options', () => {
    expect(validateSettings(structuredClone(defaultInspectorOptions))).toEqual({
      options: defaultInspectorOptions,
    });
  });

  it.each([
    [withDefaults({ toggleKeyCombo: '' }), 'Shortcut needs a key'],
    [withDefaults({ toggleKeyCombo: 'alt--' }), 'Shortcut needs a key'],
    [withDefaults({ openKey: '  ' }), 'Open in editor needs a key'],
    [withDefaults({ escapeKeys: [] }), 'Stop picking needs at least one key'],
    [withDefaults({ navKeys: { parent: 'w' } }), 'First child needs a key'],
    [null, 'No settings to save'],
    [{}, 'Shortcut needs a key'],
  ] as const)('rejects %j', (input, error) => {
    expect(validateSettings(input)).toEqual({ error });
  });

  it('keeps a single space as a key, alone or in the shortcut', () => {
    const result = validateSettings(withDefaults({ openMenuKey: ' ', toggleKeyCombo: 'alt- ' }));
    expect(result).toHaveProperty('options.openMenuKey', ' ');
    expect(result).toHaveProperty('options.toggleKeyCombo', 'alt- ');
    expect(pickOptions({ toggleKeyCombo: 'alt- ' }).options).toEqual({ toggleKeyCombo: 'alt- ' });
  });

  it('saves only what changed, whatever the key order of navKeys', () => {
    const { parent, child, next, prev } = defaultInspectorOptions.navKeys;
    expect(
      updateSaved(
        {},
        { ...defaultInspectorOptions, holdMode: false, navKeys: { prev, next, child, parent } },
        defaultInspectorOptions,
      ),
    ).toEqual({ holdMode: false });
    expect(
      updateSaved(
        {},
        { ...defaultInspectorOptions, navKeys: { ...defaultInspectorOptions.navKeys, next: 'l' } },
        defaultInspectorOptions,
      ),
    ).toEqual({ navKeys: { ...defaultInspectorOptions.navKeys, next: 'l' } });
  });

  it('keeps saved options the form left alone, and removes the ones set back to the defaults', () => {
    const saved = { toggleKeyCombo: 'alt-x', openKey: 'o' };
    // a project whose default shortcut is control-i runs with the saved alt-x
    const base = { ...defaultInspectorOptions, toggleKeyCombo: 'control-i' };
    const running = mergeOptions(base, saved);
    expect(updateSaved(saved, { ...running, holdMode: false }, base)).toEqual({
      ...saved,
      holdMode: false,
    });
    expect(updateSaved(saved, { ...running, openKey: 'Enter' }, base)).toEqual({
      toggleKeyCombo: 'alt-x',
    });
  });

  it('picks the valid options and names the others', () => {
    expect(
      pickOptions({
        toggleKeyCombo: 'meta-k',
        openKey: '',
        holdMode: 'yes',
        escapeKeys: ['Escape', 1],
        navKeys: { parent: 'w', up: 'x' },
      }),
    ).toEqual({
      options: { toggleKeyCombo: 'meta-k', navKeys: { parent: 'w' } },
      invalid: ['openKey', 'holdMode', 'escapeKeys', 'navKeys.up'],
    });
    expect(pickOptions({ navKeys: 'w' })).toEqual({ options: {}, invalid: ['navKeys'] });
    expect(pickOptions(true)).toEqual({ options: {}, invalid: [] });
  });

  it('merges navKeys key by key', () => {
    expect(
      mergeOptions(defaultInspectorOptions, undefined, { navKeys: { parent: 'w' } }).navKeys,
    ).toEqual({
      ...defaultInspectorOptions.navKeys,
      parent: 'w',
    });
  });

  it('compares values whatever the key order of objects', () => {
    expect(same({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(same({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(same([1, 2], [2, 1])).toBe(false);
    expect(same([1], { 0: 1 })).toBe(false);
    expect(same(null, {})).toBe(false);
  });
});
