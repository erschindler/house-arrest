/**
 * Player economy (Section 13). Balances, recurring bills and a ledger. Money
 * shapes options rather than gating the game: nothing here can grind a player to
 * a halt, but neglect has a cost.
 */

export type Recurring = {
  label: string;
  amount: number;
  everyDays: number;
  nextDay: number;
};

export type LedgerEntry = {
  atMinute: number;
  amount: number;
  label: string;
};

export type EconomySnapshot = {
  balance: number;
  recurring: Recurring[];
  ledger: LedgerEntry[];
  lastProcessedDay: number;
};

const LEDGER_LIMIT = 200;

export class Economy {
  balance: number;
  recurring: Recurring[];
  ledger: LedgerEntry[];
  lastProcessedDay: number;

  constructor(snapshot?: Partial<EconomySnapshot>) {
    this.balance = snapshot?.balance ?? 4200;
    this.recurring = snapshot?.recurring ?? [
      { label: "Mortgage", amount: 1650, everyDays: 30, nextDay: 30 },
      { label: "Utilities", amount: 210, everyDays: 30, nextDay: 14 },
      { label: "Internet", amount: 65, everyDays: 30, nextDay: 7 },
      { label: "Groceries", amount: 95, everyDays: 7, nextDay: 3 },
    ];
    this.ledger = snapshot?.ledger ?? [];
    this.lastProcessedDay = snapshot?.lastProcessedDay ?? 0;
  }

  spend(amount: number, label: string, atMinute: number): boolean {
    if (amount > this.balance) return false;
    this.balance -= amount;
    this.record(-amount, label, atMinute);
    return true;
  }

  earn(amount: number, label: string, atMinute: number): void {
    this.balance += amount;
    this.record(amount, label, atMinute);
  }

  private record(amount: number, label: string, atMinute: number): void {
    this.ledger.push({ atMinute, amount, label });
    if (this.ledger.length > LEDGER_LIMIT) this.ledger.splice(0, this.ledger.length - LEDGER_LIMIT);
  }

  /**
   * Called once per in-game day; returns the net change for that day.
   *
   * Bills are charged whether or not the balance covers them, so the account can
   * go negative: debt is a consequence, not a blocked state. Discretionary
   * spending via spend() is still refused when the money is not there.
   */
  processDay(day: number, atMinute: number): number {
    let net = 0;
    for (const item of this.recurring) {
      if (day < item.nextDay) continue;
      this.balance -= item.amount;
      net -= item.amount;
      this.record(-item.amount, item.label, atMinute);
      item.nextDay = day + item.everyDays;
    }
    this.lastProcessedDay = day;
    return net;
  }

  snapshot(): EconomySnapshot {
    return {
      balance: this.balance,
      recurring: this.recurring.map((item) => ({ ...item })),
      ledger: this.ledger.map((entry) => ({ ...entry })),
      lastProcessedDay: this.lastProcessedDay,
    };
  }
}
