/**
 * World clock. Minutes since world epoch, day 0 = Monday 00:00.
 * Deliberately a plain serializable value object, not a Date: the simulation
 * must never read the host machine's clock.
 */

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 1440;
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type Clock = { minutes: number };

export function createClock(startMinutes = 0): Clock {
  return { minutes: startMinutes };
}

export function advanceClock(clock: Clock, minutes: number): void {
  clock.minutes += Math.max(0, Math.floor(minutes));
}

export function dayIndex(clock: Clock): number {
  return Math.floor(clock.minutes / MINUTES_PER_DAY);
}

export function minuteOfDay(clock: Clock): number {
  return clock.minutes % MINUTES_PER_DAY;
}

export function hourOf(clock: Clock): number {
  return Math.floor(minuteOfDay(clock) / MINUTES_PER_HOUR);
}

export function weekdayIndex(clock: Clock): number {
  return dayIndex(clock) % 7;
}

export function isWeekend(clock: Clock): boolean {
  return weekdayIndex(clock) >= 5;
}

export function formatClock(clock: Clock): string {
  const minutes = minuteOfDay(clock);
  const hour = Math.floor(minutes / MINUTES_PER_HOUR);
  const minute = minutes % MINUTES_PER_HOUR;
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return `Day ${dayIndex(clock)} ${WEEKDAYS[weekdayIndex(clock)]} ${hh}:${mm}`;
}
