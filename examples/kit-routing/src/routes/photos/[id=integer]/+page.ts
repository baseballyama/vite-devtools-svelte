import { error } from '@sveltejs/kit';

import { photos } from '#lib/photos.ts';

import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
  const photo = photos.find(p => p.id === params.id);
  if (!photo) error(404, 'No such photo');
  return { photo };
};
