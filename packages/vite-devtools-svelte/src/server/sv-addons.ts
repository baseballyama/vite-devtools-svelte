import { officialAddons } from 'sv';

/** sv's official add-ons, in sv's order. The build inlines this list (see build/sv-addons.ts). */
export const svAddons: readonly { id: string; description: string }[] = Object.values(
  officialAddons,
)
  .filter(addon => !addon.hidden)
  .map(addon => ({ id: addon.id, description: addon.shortDescription ?? '' }));
