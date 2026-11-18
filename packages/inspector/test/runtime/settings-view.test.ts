import { flushSync, mount, unmount } from 'svelte';
import type { Component } from 'svelte';
import options from 'virtual:vite-devtools-svelte-inspector-options';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Inspector from '../../src/runtime/Inspector.svelte';
import KeyInput from '../../src/runtime/KeyInput.svelte';
import SettingsView from '../../src/runtime/SettingsView.svelte';

// a combo with a digit, whose `e.key` changes with shift, and letters to move by
vi.mock('virtual:vite-devtools-svelte-inspector-options', async importOriginal => {
  const { default: original } = await importOriginal<{ default: Record<string, unknown> }>();
  return {
    default: {
      ...original,
      toggleKeyCombo: 'shift-1',
      holdMode: false,
      navKeys: { parent: 'w', child: 's', next: 'd', prev: 'a' },
    },
  };
});

const defaults = {
  toggleKeyCombo: 'alt-x',
  holdMode: true,
  openKey: 'Enter',
  openMenuKey: ' ',
  escapeKeys: ['Backspace', 'Escape'],
  navKeys: { parent: 'ArrowUp', child: 'ArrowDown', next: 'ArrowRight', prev: 'ArrowLeft' },
  customStyles: true,
};

const mounted: Record<string, unknown>[] = [];

afterEach(() => {
  for (const component of mounted.splice(0)) void unmount(component);
  document.body.replaceChildren();
});

function show<Props extends Record<string, unknown>>(component: Component<Props>, props: Props) {
  mounted.push(mount(component, { target: document.body, props }));
  flushSync();
}

const button = (text: string) =>
  [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!;

const holdSwitch = () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;

function toggleHold() {
  holdSwitch().click();
  flushSync();
}

const key = (init: KeyboardEventInit) =>
  document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));

describe('SettingsView', () => {
  it('keeps tracking edits after resetting unsaved ones', () => {
    show(SettingsView, {
      current: defaults,
      defaults,
      save: vi.fn(),
      reset: vi.fn(),
    });
    toggleHold();
    expect(button('Save').disabled).toBe(false);

    button('Reset to defaults').click();
    flushSync();
    expect(holdSwitch().checked).toBe(true);
    expect(button('Save').disabled).toBe(true);

    toggleHold();
    expect(holdSwitch().checked).toBe(false);
    expect(button('Save').disabled).toBe(false);
  });
});

describe('SettingsView with saved settings', () => {
  const current = { ...defaults, holdMode: false };

  it('removes the saved settings on reset', async () => {
    const reset = vi.fn(() => Promise.resolve({ ok: true, status: 'Reset to defaults.' }));
    show(SettingsView, { current, defaults, save: vi.fn(), reset });
    button('Reset to defaults').click();
    await vi.waitFor(() => expect(holdSwitch().checked).toBe(true));
    expect(reset).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Reset to defaults.');
    // nothing is saved any more, though the page did not reload
    expect(button('Reset to defaults').disabled).toBe(true);
  });

  it('keeps the form when the reset fails', async () => {
    const reset = vi.fn(() => Promise.resolve({ ok: false, status: "Couldn't save: EACCES" }));
    show(SettingsView, { current, defaults, save: vi.fn(), reset });
    button('Reset to defaults').click();
    await vi.waitFor(() =>
      expect(document.querySelector('[role="status"]')?.textContent).toBe("Couldn't save: EACCES"),
    );
    expect(holdSwitch().checked).toBe(false);
  });

  it('counts a save without a reload as saved', async () => {
    const save = vi.fn(() => Promise.resolve({ ok: true, status: 'Saved.' }));
    show(SettingsView, { current: defaults, defaults, save, reset: vi.fn() });
    toggleHold();
    button('Save').click();
    await vi.waitFor(() => expect(button('Save').disabled).toBe(true));
    expect(save).toHaveBeenCalledWith({ ...defaults, holdMode: false });
    // the saved settings can be reset now
    expect(button('Reset to defaults').disabled).toBe(false);
  });
});

describe('KeyInput', () => {
  it('records the minus key by its code, as `-` separates the keys of a combo', () => {
    const onchange = vi.fn();
    show(KeyInput, { mode: 'combo' as const, value: 'alt-x', label: 'Shortcut', onchange });
    document.querySelector('button')!.click();
    flushSync();
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: '-', code: 'Minus', ctrlKey: true, bubbles: true }),
    );
    expect(onchange).toHaveBeenCalledWith('control-minus');
  });

  it('records a digit by its code, as the inspector matches it', () => {
    const onchange = vi.fn();
    show(KeyInput, { mode: 'combo' as const, value: 'alt-x', label: 'Shortcut', onchange });
    document.querySelector('button')!.click();
    flushSync();
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: '!', code: 'Digit1', shiftKey: true, bubbles: true }),
    );
    expect(onchange).toHaveBeenCalledWith('shift-1');
  });
});

describe('Inspector', () => {
  it('matches a digit in the combo by its code, though shift changes `e.key`', () => {
    const onenabledchange = vi.fn();
    show(Inspector, { openInEditor: vi.fn(), onenabledchange, ignore: () => false });
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: '!', code: 'Digit1', shiftKey: true, bubbles: true }),
    );
    flushSync();
    expect(onenabledchange).toHaveBeenLastCalledWith(true);
  });

  it('reads `minus` in the combo as the `-` key', () => {
    const combo = options.toggleKeyCombo;
    options.toggleKeyCombo = 'control-minus';
    try {
      const onenabledchange = vi.fn();
      show(Inspector, { openInEditor: vi.fn(), onenabledchange, ignore: () => false });
      key({ key: '-', code: 'Slash', ctrlKey: true });
      flushSync();
      expect(onenabledchange).toHaveBeenLastCalledWith(true);
    } finally {
      options.toggleKeyCombo = combo;
    }
  });

  it('moves by the physical key, as on an AZERTY keyboard where KeyW types z', () => {
    show(Inspector, { openInEditor: vi.fn(), onenabledchange: vi.fn(), ignore: () => false });
    const outer = document.createElement('div');
    const inner = document.createElement('span');
    for (const el of [outer, inner]) {
      Object.assign(el, { __svelte_meta: { loc: { file: 'src/A.svelte', line: 1, column: 1 } } });
    }
    outer.append(inner);
    document.body.append(outer);
    key({ key: '!', code: 'Digit1', shiftKey: true });
    inner.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    flushSync();
    expect(inner.classList.contains('svelte-inspector-active-target')).toBe(true);
    key({ key: 'z', code: 'KeyW' });
    flushSync();
    expect(outer.classList.contains('svelte-inspector-active-target')).toBe(true);
  });
});
