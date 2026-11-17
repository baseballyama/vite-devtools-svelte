// Module-level $state persisted to localStorage: shared by every component
// that imports it (Reactivity shows it under this module, not a component).
const KEY = 'kit-spa:prefs';

interface Prefs {
  theme: 'light' | 'dark';
  compact: boolean;
  favourites: number[];
}

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw)
      return {
        theme: 'light',
        compact: false,
        favourites: [],
        ...(JSON.parse(raw) as Partial<Prefs>),
      };
  } catch {
    // private window or corrupt value: start fresh
  }
  return { theme: 'light', compact: false, favourites: [] };
}

export const prefs = $state<Prefs>(read());

export const favouriteCount = () => prefs.favourites.length;

export function toggleFavourite(id: number) {
  const i = prefs.favourites.indexOf(id);
  if (i === -1) prefs.favourites.push(id);
  else prefs.favourites.splice(i, 1);
}

$effect.root(() => {
  $effect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      // storage unavailable: keep the in-memory value
    }
  });
});
