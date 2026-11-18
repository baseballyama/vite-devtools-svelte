import { fail } from '@sveltejs/kit';

import { field } from '#lib/form.ts';

import type { Actions } from './$types';

const messages: string[] = [];

// A default action (<form method="POST"> with no ?/name), no load: the page has
// a server file with actions only.
export const actions = {
  default: async ({ request }) => {
    const form = await request.formData();
    const email = field(form, 'email');
    const message = field(form, 'message');
    if (!email.includes('@')) return fail(400, { email, message, error: 'Enter a valid email' });
    if (message.length === 0) return fail(400, { email, message, error: 'Write a message' });
    messages.push(message);
    return { sent: messages.length };
  },
} satisfies Actions;
