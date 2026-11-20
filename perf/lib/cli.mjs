import { parseArgs } from 'node:util';

function kebab(key) {
  let out = '';
  for (const ch of key) out += ch >= 'A' && ch <= 'Z' ? `-${ch.toLowerCase()}` : ch;
  return out;
}

/**
 * `--some-key=value` flags for the camelCase keys of `defaults`; a value is
 * converted to a number when its default is one. Unknown flags throw.
 */
export function parseOptions(argv, defaults) {
  const keys = Object.keys(defaults);
  const { values } = parseArgs({
    // `pnpm <script> -- --x=1` forwards the `--`, which parseArgs reads as the
    // end of options.
    args: argv[0] === '--' ? argv.slice(1) : argv,
    options: Object.fromEntries(keys.map(k => [kebab(k), { type: 'string' }])),
    strict: true,
    allowPositionals: false,
  });
  const opts = { ...defaults };
  for (const k of keys) {
    const v = values[kebab(k)];
    if (v !== undefined) opts[k] = typeof defaults[k] === 'number' ? Number(v) : v;
  }
  return opts;
}
