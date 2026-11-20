import { basename } from './format.js';

// Copied from svelte.dev's packages page, renamed to the sv add-on ids.
const files = import.meta.glob<string>('../assets/addon-logos/*.{svg,png}', {
  import: 'default',
  eager: true,
});

const logos = new Map(
  Object.entries(files).map(([file, url]) => {
    const name = basename(file);
    return [name.slice(0, name.lastIndexOf('.')), url];
  }),
);

/** Add-ons without a logo of their own get Svelte's. */
export function addonLogo(id: string): string | undefined {
  return logos.get(id) ?? logos.get('svelte');
}
