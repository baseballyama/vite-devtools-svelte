import { fail } from '@sveltejs/kit';

import { field } from '#lib/form.ts';

import type { Actions, PageServerLoad } from './$types';

const settings = { displayName: 'Ada', newsletter: false };

export const load: PageServerLoad = () => ({ settings: { ...settings } });

export const actions = {
  // Named actions: <form method="POST" action="?/profile"> (a page can't mix them
  // with a default action; see (marketing)/contact for that one).
  profile: async ({ request }) => {
    const displayName = field(await request.formData(), 'displayName');
    if (displayName.length < 2) {
      return fail(400, { displayName, error: 'Display name needs at least 2 characters' });
    }
    settings.displayName = displayName;
    return { saved: 'profile' };
  },
  newsletter: () => {
    settings.newsletter = !settings.newsletter;
    return { saved: 'newsletter' };
  },
} satisfies Actions;
