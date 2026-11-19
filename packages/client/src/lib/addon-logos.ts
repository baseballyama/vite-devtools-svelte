// Copied from svelte.dev's packages page, renamed to the sv add-on ids.
const files = import.meta.glob<string>('../assets/addon-logos/*', {
  import: 'default',
  eager: true,
});

const REGEX_LOGO_NAME = /^.*\/([^/]+)\.(svg|png)$/;

const logos = new Map(
  Object.entries(files).map(([file, url]) => [file.replace(REGEX_LOGO_NAME, '$1'), url]),
);

/** Add-ons without a logo of their own get Svelte's. */
export function addonLogo(id: string): string | undefined {
  return logos.get(id) ?? logos.get('svelte');
}
