import type { PageLoad } from './$types';

const greetings: Record<string, string> = { en: 'Hello', ja: 'こんにちは', fr: 'Bonjour' };

// Optional param: /lang and /lang/ja both match this route.
export const load: PageLoad = ({ params }) => {
  const lang = params.lang ?? 'en';
  return { lang, greeting: greetings[lang] ?? `(${lang}?)` };
};
