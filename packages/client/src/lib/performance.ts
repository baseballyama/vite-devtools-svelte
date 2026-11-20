import type { PerfCost, PerfUpdate } from './types.js';

/** One frame at 60 Hz: an update longer than this delays the next frame. */
export const FRAME_BUDGET_MS = 16;
/** An update at least this long is slow (also the MCP `slow-update` default). */
export const SLOW_UPDATE_MS = 50;
/** Instances of one component re-rendered in one update from which a hint is shown. */
const MANY_INSTANCES = 10;
/** Named deriveds listed in the hints of one update. */
const MAX_DERIVED_HINTS = 3;

export type Severity = 'ok' | 'slow' | 'bad';

export function severity(ms: number): Severity {
  if (ms >= SLOW_UPDATE_MS) return 'bad';
  return ms > FRAME_BUDGET_MS ? 'slow' : 'ok';
}

/** Time since the recording started: `+4.21 s`, `+10.7 s`, `+125 s`. */
export function formatOffset(ms: number): string {
  const s = ms / 1000;
  return `+${s.toFixed(s < 10 ? 2 : s < 100 ? 1 : 0)} s`;
}

/** Elapsed recording time `mm:ss`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  return `${String(m).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** `click on button.send`, `keydown Enter on input#q`. */
export function eventText(event: PerfUpdate['event']): string {
  if (!event) return '';
  const what = event.key ? `${event.type} ${event.key}` : event.type;
  return event.target ? `${what} on ${event.target}` : what;
}

export const selfMs = (c: Pick<PerfCost, 'renderMs' | 'effectMs' | 'derivedMs'>): number =>
  c.renderMs + c.effectMs + c.derivedMs;

/** The written states that started the update (not those an `$effect` wrote while it ran). */
export function causes(u: PerfUpdate) {
  return u.triggers.filter(t => !t.during);
}

export type HintPart = { text: string } | { code: string };

/**
 * Statements about one update that follow from what was measured, without
 * guessing at causes: named deriveds that recomputed to the same value,
 * many instances of one component re-rendering, states written by an
 * `$effect` while the update ran.
 */
export function updateHints(u: PerfUpdate): HintPart[][] {
  const hints: HintPart[][] = [];
  for (const d of u.unchangedDeriveds.slice(0, MAX_DERIVED_HINTS)) {
    hints.push([
      { code: d.name },
      {
        text: ` ($derived in ${d.scope}) recomputed ${d.runs}× and returned the same value ${d.unchanged}×.`,
      },
    ]);
  }
  for (const c of u.costs) {
    if (c.kind === 'component' && c.rendered >= MANY_INSTANCES) {
      hints.push([
        { text: `${c.rendered} instances of ` },
        { code: `<${c.name}>` },
        { text: ' re-rendered.' },
      ]);
    }
  }
  const during = u.triggers.filter(t => t.during);
  if (during.length > 0) {
    hints.push([
      ...during.flatMap((t, i): HintPart[] => [
        ...(i > 0 ? [{ text: ', ' }] : []),
        { code: `${t.scope}.${t.name}` },
      ]),
      {
        text: ` ${during.length === 1 ? 'was' : 'were'} written while this update was running (from an $effect).`,
      },
    ]);
  }
  return hints;
}
