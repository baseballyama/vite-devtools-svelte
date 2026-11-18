import { render, screen, within } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as rpc from '../lib/rpc.js';
import type { AddonsResult, CommunityAddonsResult } from '../lib/types.js';
import { settle } from '../test/dom.js';
import { project } from '../test/fake-rpc.js';
import Addons from './Addons.svelte';

const official: AddonsResult = {
  available: true,
  addons: [
    { id: 'prettier', name: 'Prettier', description: 'Formatter', installed: true },
    { id: 'drizzle', name: 'Drizzle', description: 'Database ORM', kit: true, installed: false },
  ],
};

const community: CommunityAddonsResult = {
  addons: [
    {
      name: '@acme/sv-kysely',
      description: 'Kysely setup',
      version: '1.2.0',
      downloads: 1500,
      url: 'https://npmx.dev/package/@acme/sv-kysely',
      avatar: 'https://github.com/acme.png?size=64',
      installed: false,
    },
  ],
};

const cards = () =>
  screen.queryAllByRole('listitem').map(li => li.querySelector('.name')!.textContent);
const card = (name: string) =>
  screen.getAllByRole('listitem').find(li => li.textContent.includes(name))!;

async function setup() {
  const user = userEvent.setup();
  render(Addons);
  await settle();
  return user;
}

beforeEach(() => {
  vi.mocked(rpc.getAddons).mockResolvedValue(official);
  vi.mocked(rpc.getCommunityAddons).mockResolvedValue(community);
});

describe('Addons', () => {
  it('lists official and community add-ons', async () => {
    await setup();
    expect(cards()).toEqual(['Prettier', 'Drizzle', '@acme/sv-kysely']);
    expect(within(card('Prettier')).getByText('installed')).toBeTruthy();
    expect(within(card('Prettier')).getByRole('button', { name: 'Reinstall' })).toBeTruthy();
    expect(within(card('Drizzle')).getByText('SvelteKit')).toBeTruthy();
    expect(within(card('kysely')).getByText('1.5K/month · v1.2.0')).toBeTruthy();
    expect(within(card('kysely')).getByRole('link').getAttribute('href')).toBe(
      community.addons[0]!.url,
    );
  });

  it('filters both lists', async () => {
    const user = await setup();
    await user.type(screen.getByRole('searchbox'), 'kysely');
    expect(cards()).toEqual(['@acme/sv-kysely']);
  });

  it('disables SvelteKit add-ons without SvelteKit', async () => {
    vi.mocked(rpc.getProject).mockResolvedValue({ ...project, kit: false });
    await setup();
    const button = within(card('Drizzle')).getByRole('button', { name: 'Install' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('title')).toBe('Requires SvelteKit');
  });

  it('installs, and reports a failed install', async () => {
    const user = await setup();
    await user.click(within(card('kysely')).getByRole('button', { name: 'Install' }));
    expect(rpc.installAddon).toHaveBeenCalledWith('@acme/sv-kysely');

    vi.mocked(rpc.installAddon).mockRejectedValueOnce(new Error('no terminal'));
    await user.click(within(card('Drizzle')).getByRole('button', { name: 'Install' }));
    await settle();
    expect(screen.getByRole('alert').textContent).toContain('no terminal');
  });

  it('refreshes both lists', async () => {
    const user = await setup();
    await user.click(screen.getByRole('button', { name: 'Refresh add-ons' }));
    expect(rpc.getAddons).toHaveBeenCalledTimes(2);
    expect(rpc.getCommunityAddons).toHaveBeenCalledTimes(2);
  });

  it('explains when the dock has no terminal', async () => {
    vi.mocked(rpc.getAddons).mockResolvedValue({ available: false, addons: [] });
    await setup();
    expect(screen.getByText('No terminal in this dock')).toBeTruthy();
  });

  it('shows list failures', async () => {
    vi.mocked(rpc.getAddons).mockRejectedValue(new Error('down'));
    await setup();
    expect(screen.getByText('Could not list add-ons')).toBeTruthy();
  });

  it('shows npm failures', async () => {
    vi.mocked(rpc.getCommunityAddons).mockResolvedValue({ addons: [], error: 'offline' });
    await setup();
    expect(screen.getByText('Could not reach npm')).toBeTruthy();
  });

  it('says it is searching npm meanwhile', async () => {
    vi.mocked(rpc.getCommunityAddons).mockReturnValue(new Promise(() => {}));
    await setup();
    expect(screen.getByText('Searching npm…')).toBeTruthy();
  });
});
