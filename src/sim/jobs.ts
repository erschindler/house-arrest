/**
 * Work (brief §13 economy, §19 world expansion).
 *
 * The premise is house arrest, which rules out the obvious design: you cannot go
 * to a job. So every position on the market is remote or on the property, and the
 * mechanic is attendance rather than travel. The player clocks in during a shift
 * window, minutes accrue at an hourly rate, and the shift settles when it ends.
 *
 * Three things make it a system rather than a money faucet:
 *
 *   - **Shifts are windows, not a button.** Pay accrues per simulated minute, so
 *     the temptation to sit on a shift is the intended loop, and the cost is the
 *     day you did not spend on anything else.
 *   - **Absence is counted daily.** Three missed shifts is a firing, which turns
 *     a small neglect into a structural problem.
 *   - **Performance is a slow axis.** It drifts up while you work and down when
 *     you do not, so a job held badly is worse than a job held well but neither is
 *     instantly fatal.
 *
 * Nothing here reads the wall clock: the shift check takes the world's minute of
 * day, because a save restored at 08:59 must behave identically to one that was
 * never closed.
 */

import { dayIndex, minuteOfDay } from "../core/clock.ts";
import type { Clock } from "../core/clock.ts";
import type { Economy } from "./economy.ts";
import { fillGaps } from "./schedule.ts";
import type { LocationId, LogInput, ScheduleBlock } from "./types.ts";

export type JobOffer = {
  id: string;
  title: string;
  employer: string;
  hourlyRate: number;
  /** Shift window in hours, same day (no midnight wrap). */
  shiftStart: number;
  shiftEnd: number;
  /** Weekday indices this job is scheduled: 0 = Monday. */
  days: number[];
  remote: boolean;
  description: string;
};

export const JOB_MARKET: JobOffer[] = [
  {
    id: "bookkeeping",
    title: "Freelance bookkeeping",
    employer: "Ledger & Co",
    hourlyRate: 28,
    shiftStart: 9,
    shiftEnd: 13,
    days: [0, 1, 2, 3, 4],
    remote: true,
    description: "Four hours of other people's receipts. Quiet, legal, reliable.",
  },
  {
    id: "supportDesk",
    title: "Remote support desk",
    employer: "Northline Systems",
    hourlyRate: 25,
    shiftStart: 13,
    shiftEnd: 21,
    days: [0, 1, 2, 3, 4],
    remote: true,
    description: "Headsets and hold music. The queue never ends, which is the point.",
  },
  {
    id: "callCentre",
    title: "Night call centre",
    employer: "Meridian Claims",
    hourlyRate: 22,
    shiftStart: 22,
    shiftEnd: 24,
    days: [0, 1, 2, 3, 4, 5],
    remote: true,
    description: "Two hours of angry strangers before bed. Pays for the heating.",
  },
  {
    id: "illustration",
    title: "Commissioned illustration",
    employer: "Self-employed",
    hourlyRate: 34,
    shiftStart: 10,
    shiftEnd: 16,
    days: [1, 3, 5],
    remote: true,
    description: "Three days a week, if the commissions keep arriving.",
  },
  {
    id: "resale",
    title: "Online resale",
    employer: "Self-employed",
    hourlyRate: 18,
    shiftStart: 14,
    shiftEnd: 18,
    days: [0, 2, 4],
    remote: true,
    description: "Photograph it, list it, post it. Thin margins, no boss.",
  },
  {
    id: "yardWork",
    title: "Yard and garden work",
    employer: "The property",
    hourlyRate: 20,
    shiftStart: 8,
    shiftEnd: 11,
    days: [2, 5],
    remote: false,
    description: "Outside, but not off the lot. The only fresh air available.",
  },
];

/**
 * The day that a job implies. A shift is not an abstract accrual: it has to be
 * where the character *is*, or the spatial layer will happily place them in the
 * living room while they are being paid to be in the office.
 */
export function scheduleForJob(offer: JobOffer): ScheduleBlock[] {
  const location: LocationId = offer.remote ? "office" : "backyard";
  return fillGaps([
    { startMinute: 23 * 60, endMinute: 24 * 60, activity: "sleep", location: "masterBedroom" },
    { startMinute: 0, endMinute: 6 * 60, activity: "sleep", location: "masterBedroom" },
    { startMinute: 6 * 60, endMinute: 7 * 60, activity: "eat", location: "kitchen" },
    { startMinute: 7 * 60, endMinute: 8 * 60, activity: "care", location: "bathroom" },
    { startMinute: offer.shiftStart * 60, endMinute: offer.shiftEnd * 60, activity: "work", location },
    { startMinute: 18 * 60, endMinute: 19 * 60, activity: "eat", location: "diningRoom" },
    { startMinute: 19 * 60, endMinute: 22 * 60, activity: "leisure", location: "livingRoom" },
  ]);
}

/** The day without work. Used when a job ends, and it consumes no rng. */
export function idleSchedule(): ScheduleBlock[] {
  return fillGaps([
    { startMinute: 23 * 60, endMinute: 24 * 60, activity: "sleep", location: "masterBedroom" },
    { startMinute: 0, endMinute: 7 * 60, activity: "sleep", location: "masterBedroom" },
    { startMinute: 7 * 60, endMinute: 8 * 60, activity: "eat", location: "kitchen" },
    { startMinute: 8 * 60, endMinute: 9 * 60, activity: "care", location: "bathroom" },
    { startMinute: 9 * 60, endMinute: 12 * 60, activity: "home", location: "livingRoom" },
    { startMinute: 12 * 60, endMinute: 13 * 60, activity: "eat", location: "kitchen" },
    { startMinute: 13 * 60, endMinute: 18 * 60, activity: "leisure", location: "livingRoom" },
    { startMinute: 18 * 60, endMinute: 19 * 60, activity: "eat", location: "diningRoom" },
    { startMinute: 19 * 60, endMinute: 22 * 60, activity: "leisure", location: "livingRoom" },
  ]);
}

export type EmploymentStatus = "unemployed" | "employed" | "suspended" | "fired";

export type EmploymentState = {
  jobId: string | null;
  status: EmploymentStatus;
  performance: number;
  minutesWorked: number;
  minutesThisShift: number;
  earningsUnpaid: number;
  absences: number;
  warnings: number;
  shiftsWorked: number;
  lastShiftDay: number;
};

export const MAX_ABSENCES = 3;

export class Employment {
  jobId: string | null = null;
  status: EmploymentStatus = "unemployed";
  performance = 55;
  minutesWorked = 0;
  minutesThisShift = 0;
  earningsUnpaid = 0;
  absences = 0;
  warnings = 0;
  shiftsWorked = 0;
  lastShiftDay = -1;

  constructor(state?: EmploymentState) {
    if (state) this.restore(state);
  }

  get job(): JobOffer | null {
    if (!this.jobId) return null;
    return JOB_MARKET.find((offer) => offer.id === this.jobId) ?? null;
  }

  get employed(): boolean {
    return this.status === "employed" && this.job !== null;
  }

  apply(jobId: string, log: (entry: LogInput) => void): boolean {
    const offer = JOB_MARKET.find((entry) => entry.id === jobId);
    if (!offer) return false;
    this.jobId = offer.id;
    this.status = "employed";
    this.performance = Math.max(this.performance, 55);
    this.absences = 0;
    this.warnings = 0;
    this.minutesThisShift = 0;
    this.earningsUnpaid = 0;
    log({
      kind: "work",
      summary: `Hired: ${offer.title} at ${offer.employer}, $${offer.hourlyRate}/hour.`,
      participants: [],
      gated: false,
    });
    return true;
  }

  quit(log: (entry: LogInput) => void): void {
    const offer = this.job;
    this.status = "unemployed";
    this.jobId = null;
    this.minutesThisShift = 0;
    this.earningsUnpaid = 0;
    log({
      kind: "work",
      summary: offer ? `Quit ${offer.title}.` : "Quit a job that no longer existed.",
      participants: [],
      gated: false,
    });
  }

  onShift(minuteOfTheDay: number): boolean {
    const offer = this.job;
    if (!offer) return false;
    return minuteOfTheDay >= offer.shiftStart * 60 && minuteOfTheDay < offer.shiftEnd * 60;
  }

  /** Called every simulated minute by the world; pays out when a shift ends. */
  tickMinute(clock: Clock, economy: Economy, log: (entry: LogInput) => void): void {
    if (!this.employed) return;
    const offer = this.job;
    if (!offer) return;

    if (this.onShift(minuteOfDay(clock))) {
      this.minutesThisShift += 1;
      this.minutesWorked += 1;
      this.earningsUnpaid += offer.hourlyRate / 60;
      this.performance = Math.min(100, this.performance + 0.01);
      this.lastShiftDay = dayIndex(clock);
      return;
    }

    if (this.minutesThisShift > 0) this.settle(clock.minutes, economy, log);
  }

  /** Pays whatever has accrued. Returns the amount paid. */
  settle(atMinute: number, economy: Economy, log: (entry: LogInput) => void): number {
    const due = Math.round(this.earningsUnpaid * 100) / 100;
    this.minutesThisShift = 0;
    this.earningsUnpaid = 0;
    if (due <= 0) return 0;
    this.shiftsWorked += 1;
    economy.earn(due, "Wages", atMinute);
    log({
      kind: "work",
      summary: `Shift over: $${due.toFixed(2)} paid.`,
      participants: [],
      gated: false,
    });
    return due;
  }

  /**
   * Daily check: was today a scheduled shift, and was any of it worked? Missing
   * three is a firing. Nothing warns you quietly except the log — which is the
   * point, since the bill arrives whether or not you were paying attention.
   */
  /**
   * @param closingDay the day that just ended — not the day that is starting.
   *   Daily systems run at 00:00, so passing the new day counted every worked
   *   shift as an absence and fired the player on their third day of perfect
   *   attendance. `atMinute` is the ledger timestamp for the payout.
   */
  endOfDay(
    closingDay: number,
    weekday: number,
    atMinute: number,
    economy: Economy,
    log: (entry: LogInput) => void,
  ): void {
    if (!this.employed) return;
    const offer = this.job;
    if (!offer) return;

    this.settle(atMinute, economy, log);
    this.minutesThisShift = 0;

    if (!offer.days.includes(weekday)) return;
    if (this.lastShiftDay === closingDay) return;

    this.absences += 1;
    this.performance = Math.max(0, this.performance - 4);

    if (this.absences >= MAX_ABSENCES) {
      this.status = "fired";
      log({
        kind: "work",
        summary: `Fired from ${offer.title} after ${this.absences} missed shifts.`,
        participants: [],
        gated: false,
      });
      return;
    }

    if (this.absences >= 2) {
      this.warnings += 1;
      log({
        kind: "work",
        summary: `A warning from ${offer.employer}: ${this.absences} missed shifts.`,
        participants: [],
        gated: false,
      });
      return;
    }

    log({
      kind: "work",
      summary: `Missed a shift at ${offer.employer}.`,
      participants: [],
      gated: false,
    });
  }

  snapshot(): EmploymentState {
    return {
      jobId: this.jobId,
      status: this.status,
      performance: this.performance,
      minutesWorked: this.minutesWorked,
      minutesThisShift: this.minutesThisShift,
      earningsUnpaid: this.earningsUnpaid,
      absences: this.absences,
      warnings: this.warnings,
      shiftsWorked: this.shiftsWorked,
      lastShiftDay: this.lastShiftDay,
    };
  }

  restore(state: EmploymentState): void {
    this.jobId = state.jobId;
    this.status = state.status;
    this.performance = state.performance;
    this.minutesWorked = state.minutesWorked;
    this.minutesThisShift = state.minutesThisShift;
    this.earningsUnpaid = state.earningsUnpaid;
    this.absences = state.absences;
    this.warnings = state.warnings;
    this.shiftsWorked = state.shiftsWorked;
    this.lastShiftDay = state.lastShiftDay;
  }
}
