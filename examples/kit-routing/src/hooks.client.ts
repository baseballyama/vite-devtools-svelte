import type { HandleClientError } from '@sveltejs/kit/hooks';

export const handleError: HandleClientError = ({ kind, error }) => {
  if (kind === 'unknown') console.warn('[kit-routing] unexpected client error:', error);
  return { errorId: 'client' };
};
