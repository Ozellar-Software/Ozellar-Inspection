/**
 * Fleet inspection status (same rule as the current app):
 * cycle 6 months from the last APPROVED inspection's completion date (or start date).
 * < 5 months: On track (green) · 5–6 months: Due soon (yellow) · ≥ 6 months or none: Overdue (red).
 */
export type DueColor = 'green' | 'yellow' | 'red';

export interface DueInfo {
  color: DueColor;
  label: 'On track' | 'Due soon' | 'Overdue' | 'No inspection on record' | 'Unknown';
  nextDue: Date | null;
}

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.4368;

export function inspectionDueInfo(
  last: { completionDate?: string | null; startDate?: string | null } | null,
  now: Date = new Date(),
  cycleMonths = 6,
  dueSoonMonths = 5,
): DueInfo {
  if (!last) return { color: 'red', label: 'No inspection on record', nextDue: null };
  const refStr = last.completionDate || last.startDate;
  const ref = refStr ? new Date(`${refStr}T00:00:00`) : new Date(NaN);
  if (isNaN(ref.getTime())) return { color: 'red', label: 'Unknown', nextDue: null };
  const monthsElapsed = (now.getTime() - ref.getTime()) / MS_PER_MONTH;
  const nextDue = new Date(ref.getTime());
  nextDue.setMonth(nextDue.getMonth() + cycleMonths);
  if (monthsElapsed >= cycleMonths) return { color: 'red', label: 'Overdue', nextDue };
  if (monthsElapsed >= dueSoonMonths) return { color: 'yellow', label: 'Due soon', nextDue };
  return { color: 'green', label: 'On track', nextDue };
}
