// shared by the plugin and the browser, so no node imports

/** vite loads it and `*.local` files are not committed */
export const SETTINGS_FILE = '.env.local';

export const SAVE_SETTINGS = 'svelte:inspector:save-settings';
export const RESET_SETTINGS = 'svelte:inspector:reset-settings';
