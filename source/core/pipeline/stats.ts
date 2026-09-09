/**
 * عدّاد إحصائيات الوظيفة (البند 29). يحدّث المستمعين عند كل تغيير.
 */

import type { Stats } from "../types";
import { emptyStats } from "../types";

/** مستمع تغيير الإحصائيات. */
export type StatsListener = (stats: Stats) => void;

/** كائن تتبع إحصائيات الجلسة. */
export interface StatsTracker {
  snapshot: () => Stats;
  incProcessed: (amount?: number) => Stats;
  incMoved: (amount?: number) => Stats;
  incSkipped: (amount?: number) => Stats;
  incErrors: (amount?: number) => Stats;
}

/**
 * إنشاء عدّاد إحصائيات نشط.
 * @param listener مستمع اختياري يُستدعى عند كل تحديث.
 */
export function createStatsTracker(listener?: StatsListener): StatsTracker {
  let current = emptyStats();
  const update = (patch: Partial<Stats>): Stats => {
    current = { ...current, ...patch };
    listener?.(current);
    return current;
  };
  return {
    snapshot: () => ({ ...current }),
    incProcessed: (amount = 1) => update({ processed: current.processed + amount }),
    incMoved: (amount = 1) => update({ moved: current.moved + amount }),
    incSkipped: (amount = 1) => update({ skipped: current.skipped + amount }),
    incErrors: (amount = 1) => update({ errors: current.errors + amount }),
  };
}