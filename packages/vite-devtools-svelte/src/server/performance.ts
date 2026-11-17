import type {
  PerfComponentTotal,
  PerfCost,
  PerfDerivedReruns,
  PerfTrigger,
  PerfUpdate,
  PerformanceRecording,
  SourceLocation,
} from '../types.js';
import { arrayOf, asPayload, nonNegInt } from './payload.js';
import type { Payload } from './payload.js';

/**
 * Caps on a recording the server keeps (= the runtime's own caps, so a
 * well-behaved runtime never hits them): updates per page load and, per
 * update, written states, cost rows and named deriveds.
 */
export const PERF_LIMITS = {
  updates: 2000,
  triggers: 16,
  costs: 30,
  unchanged: 10,
  components: 500,
  /** Page loads (app tabs, reloads) whose part of one recording is kept. */
  epochs: 4,
} as const;

/** A recording nobody stops ends by itself after this long. */
export const MAX_RECORDING_MS = 5 * 60_000;

const MAX_STRING = 4096;
const COST_KINDS = new Set<PerfCost['kind']>(['component', 'module', 'library', 'other']);

const str = (v: unknown): string => (typeof v === 'string' ? v.slice(0, MAX_STRING) : '');
const ms = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const intOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;

/** Objects of an untrusted array, at most `max`. */
function objects(value: unknown, max: number): Payload[] {
  const out: Payload[] = [];
  for (const v of arrayOf<unknown>(value)) {
    const p = asPayload(v);
    if (p) out.push(p);
    if (out.length === max) break;
  }
  return out;
}

function location(value: unknown): SourceLocation | null {
  const p = asPayload(value);
  const line = intOrNull(p?.line);
  const column = intOrNull(p?.column);
  if (!p || typeof p.file !== 'string' || p.file === '' || line === null || column === null) {
    return null;
  }
  return { file: str(p.file), line, column };
}

function trigger(p: Payload): PerfTrigger | null {
  const scopeId = intOrNull(p.scopeId);
  if (typeof p.nodeId !== 'string' || scopeId === null) return null;
  return {
    nodeId: str(p.nodeId),
    name: str(p.name),
    scopeId,
    scope: str(p.scope),
    file: str(p.file),
    loc: location(p.loc),
    during: p.during === true,
  };
}

function costFields(p: Payload): PerfCost {
  const kind = p.kind as PerfCost['kind'];
  return {
    file: str(p.file),
    name: str(p.name),
    kind: COST_KINDS.has(kind) ? kind : 'other',
    componentId: intOrNull(p.componentId),
    instances: nonNegInt(p.instances),
    rendered: nonNegInt(p.rendered),
    renderMs: ms(p.renderMs),
    effectMs: ms(p.effectMs),
    derivedMs: ms(p.derivedMs),
    renders: nonNegInt(p.renders),
    effects: nonNegInt(p.effects),
    deriveds: nonNegInt(p.deriveds),
  };
}

function reruns(p: Payload): PerfDerivedReruns {
  return {
    name: str(p.name),
    scope: str(p.scope),
    file: str(p.file),
    runs: nonNegInt(p.runs),
    unchanged: nonNegInt(p.unchanged),
  };
}

/** An update from the runtime, or null when it is not one. */
export function normalizeUpdate(value: unknown): PerfUpdate | null {
  const p = asPayload(value);
  const id = intOrNull(p?.id);
  if (!p || id === null || typeof p.start !== 'number' || !Number.isFinite(p.start)) return null;
  const ev = asPayload(p.event);
  return {
    id,
    start: p.start,
    duration: ms(p.duration),
    event:
      ev && typeof ev.type === 'string'
        ? {
            type: str(ev.type),
            target: str(ev.target),
            ...(typeof ev.key === 'string' && { key: str(ev.key) }),
          }
        : null,
    triggers: objects(p.triggers, PERF_LIMITS.triggers)
      .map(trigger)
      .filter(t => t !== null),
    triggersOmitted: nonNegInt(p.triggersOmitted),
    components: nonNegInt(p.components),
    renders: nonNegInt(p.renders),
    effects: nonNegInt(p.effects),
    deriveds: nonNegInt(p.deriveds),
    wastedDeriveds: nonNegInt(p.wastedDeriveds),
    unchangedDeriveds: objects(p.unchangedDeriveds, PERF_LIMITS.unchanged).map(reruns),
    costs: objects(p.costs, PERF_LIMITS.costs).map(costFields),
    costsOmitted: nonNegInt(p.costsOmitted),
    droppedFrames: intOrNull(p.droppedFrames),
  };
}

function componentTotal(p: Payload): PerfComponentTotal {
  const { rendered: _, ...rest } = costFields(p);
  return { ...rest, updates: nonNegInt(p.updates) };
}

interface EpochPart {
  updates: PerfUpdate[];
  dropped: number;
  components: PerfComponentTotal[];
  componentsOmitted: boolean;
  /** The runtime sent its last push for this recording. */
  final: boolean;
}

/**
 * The current (or last) performance recording. A recording is asked of every
 * app page load; each pushes its updates (appended) and its per-component
 * totals (replaced) under the recording id, and a final push once stopped.
 */
export class PerformanceStore {
  private id: string | null = null;
  private seq = 0;
  private startedAt: number | null = null;
  private stoppedAt: number | null = null;
  private parts = new Map<string, EpochPart>();

  get active(): boolean {
    return this.id !== null && this.stoppedAt === null;
  }

  get recordingId(): string | null {
    return this.id;
  }

  start(): { recordingId: string; startedAt: number } {
    this.id = `p${Date.now().toString(36)}-${++this.seq}`;
    this.startedAt = Date.now();
    this.stoppedAt = null;
    this.parts = new Map();
    return { recordingId: this.id, startedAt: this.startedAt };
  }

  stop(): void {
    if (this.active) this.stoppedAt = Date.now();
  }

  /** Every page load that sent part of the recording has sent its final push. */
  get settled(): boolean {
    if (this.parts.size === 0) return false;
    for (const part of this.parts.values()) if (!part.final) return false;
    return true;
  }

  /** A push from a runtime; false when it is not for the current recording. */
  ingest(data: Payload | undefined): boolean {
    if (this.id === null || data?.recordingId !== this.id) return false;
    if (typeof data.epoch !== 'string' || data.epoch === '') return false;
    let part = this.parts.get(data.epoch);
    if (!part) {
      part = { updates: [], dropped: 0, components: [], componentsOmitted: false, final: false };
      this.parts.set(data.epoch, part);
      while (this.parts.size > PERF_LIMITS.epochs) {
        this.parts.delete(this.parts.keys().next().value!);
      }
    }
    for (const raw of arrayOf<unknown>(data.updates)) {
      const update = normalizeUpdate(raw);
      if (!update) continue;
      if (part.updates.length < PERF_LIMITS.updates) part.updates.push(update);
      else part.dropped++;
    }
    part.dropped = Math.max(part.dropped, nonNegInt(data.dropped));
    if (Array.isArray(data.components)) {
      part.components = objects(data.components, PERF_LIMITS.components).map(componentTotal);
      part.componentsOmitted =
        data.componentsOmitted === true || data.components.length > PERF_LIMITS.components;
    }
    if (data.final === true) part.final = true;
    return true;
  }

  /**
   * The recording as served: the part of `servedEpoch` (the page load the
   * DevTools show) when it sent one, else the part with the most updates.
   */
  recording(servedEpoch: string | undefined): PerformanceRecording {
    let epoch: string | null = null;
    let part: EpochPart | undefined;
    if (servedEpoch !== undefined && this.parts.has(servedEpoch)) {
      epoch = servedEpoch;
      part = this.parts.get(servedEpoch);
    } else {
      for (const [e, p] of this.parts) {
        if (!part || p.updates.length >= part.updates.length) {
          epoch = e;
          part = p;
        }
      }
    }
    return {
      state: this.active ? 'recording' : 'idle',
      recordingId: this.id,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      epoch,
      updates: part ? part.updates.toSorted((a, b) => a.start - b.start) : [],
      droppedUpdates: part?.dropped ?? 0,
      components: part?.components ?? [],
      componentsOmitted: part?.componentsOmitted ?? false,
    };
  }
}
