import type { PerfUpdate, PerformanceRecording } from '../types.js';
import { round } from './stats.js';

/** One frame at 60 Hz: an update longer than this delays the next frame. */
const FRAME_BUDGET_MS = 16;
/** An update at least this long is reported as slow (list_performance_issues). */
export const SLOW_UPDATE_MS = 50;
/** Cost rows (components) listed per update in a summary. */
const COSTS_PER_UPDATE = 5;

/** `click on button#save` (`keydown Enter on input`). */
export function describeEvent(event: PerfUpdate['event']): string | null {
  if (!event) return null;
  const what = event.key ? `${event.type} ${event.key}` : event.type;
  return event.target ? `${what} on ${event.target}` : what;
}

/** The update as an agent reads it: what triggered it and where its time went. */
function updateSummary(u: PerfUpdate) {
  return {
    id: u.id,
    atMs: round(u.start),
    durationMs: round(u.duration),
    event: describeEvent(u.event),
    triggers: u.triggers.map(t => ({
      state: `${t.scope}.${t.name}`,
      nodeId: t.nodeId,
      scopeId: t.scopeId,
      file: t.loc?.file ?? t.file,
      ...(t.loc && { line: t.loc.line }),
      writtenDuringUpdate: t.during,
    })),
    triggersOmitted: u.triggersOmitted,
    componentsRendered: u.components,
    runs: { render: u.renders, effect: u.effects, derived: u.deriveds },
    unchangedDerivedReruns: u.wastedDeriveds,
    namedUnchangedDeriveds: u.unchangedDeriveds,
    selfTime: u.costs.slice(0, COSTS_PER_UPDATE).map(c => ({
      name: c.name,
      file: c.file,
      kind: c.kind,
      instances: c.instances,
      instancesRendered: c.rendered,
      renderMs: round(c.renderMs),
      effectMs: round(c.effectMs),
      derivedMs: round(c.derivedMs),
    })),
    droppedFrames: u.droppedFrames,
  };
}

/** A recording, its slowest updates first (at most `topN`, at least `minDurationMs`). */
export function recordingSummary(
  rec: PerformanceRecording,
  opts: { topN: number; minDurationMs: number },
) {
  const { updates } = rec;
  const end = rec.stoppedAt ?? Date.now();
  return {
    state: rec.state,
    recordingId: rec.recordingId,
    epoch: rec.epoch,
    durationMs: rec.startedAt === null ? null : end - rec.startedAt,
    updates: {
      recorded: updates.length,
      droppedOverCap: rec.droppedUpdates,
      overFrameBudget: updates.filter(u => u.duration > FRAME_BUDGET_MS).length,
      slow: updates.filter(u => u.duration >= SLOW_UPDATE_MS).length,
      totalMs: round(updates.reduce((s, u) => s + u.duration, 0)),
    },
    slowest: updates
      .filter(u => u.duration >= opts.minDurationMs)
      .toSorted((a, b) => b.duration - a.duration)
      .slice(0, opts.topN)
      .map(updateSummary),
    components: rec.components.slice(0, opts.topN).map(c => ({
      name: c.name,
      file: c.file,
      kind: c.kind,
      instances: c.instances,
      updates: c.updates,
      runs: { render: c.renders, effect: c.effects, derived: c.deriveds },
      selfMs: round(c.renderMs + c.effectMs + c.derivedMs),
      renderMs: round(c.renderMs),
      effectMs: round(c.effectMs),
      derivedMs: round(c.derivedMs),
    })),
    componentsOmitted: rec.componentsOmitted,
  };
}
