import assert from "node:assert/strict";
import test from "node:test";
import { Economy } from "../src/sim/economy.ts";
import { Employment, MAX_ABSENCES, scheduleForJob } from "../src/sim/jobs.ts";
import { blockAt } from "../src/sim/schedule.ts";
import { World } from "../src/sim/world.ts";

const quiet = (): void => {};

test("the market only offers work available to someone under house arrest", () => {
  const world = World.create({ seed: "jobs-market", npcCount: 8 });
  assert.ok(world.jobMarket.length > 0);
  assert.equal(world.takeJob("bookkeeping"), true);
  assert.equal(world.jobMarket.length, 0);
  assert.equal(world.takeJob("does-not-exist"), false);
});

test("taking a job moves the player to the desk during the shift", () => {
  const world = World.create({ seed: "jobs-schedule", npcCount: 8 });
  world.takeJob("bookkeeping");

  const during = blockAt(world.player, 9 * 60 + 30);
  assert.equal(during.activity, "work");
  assert.equal(during.location, "office");

  const placement = world.space.placementOf(world.player, 9 * 60 + 30);
  if (!placement) throw new Error("the player is not placed during their shift");
  assert.equal(placement.room, "office");
});

test("a job's schedule covers the whole day", () => {
  const offer = { shiftStart: 22, shiftEnd: 24 } as Parameters<typeof scheduleForJob>[0];
  const schedule = scheduleForJob(offer);
  let covered = 0;
  for (const block of schedule) covered += block.endMinute - block.startMinute;
  assert.equal(covered, 1440);
});

test("a worked shift accrues and settles into the economy", () => {
  const employment = new Employment();
  const economy = new Economy({ balance: 1000 });
  assert.equal(employment.apply("bookkeeping", quiet), true);

  const clock = { minutes: 9 * 60 };
  for (let i = 0; i < 60; i += 1) {
    employment.tickMinute(clock, economy, quiet);
    clock.minutes += 1;
  }
  assert.ok(employment.earningsUnpaid > 0, "an hour of work should accrue wages");

  clock.minutes = 13 * 60;
  employment.tickMinute(clock, economy, quiet);

  assert.equal(employment.earningsUnpaid, 0);
  assert.ok(economy.balance > 1000);
  assert.equal(employment.shiftsWorked, 1);
});

test("a shift outside the window does not pay", () => {
  const employment = new Employment();
  const economy = new Economy({ balance: 500 });
  employment.apply("bookkeeping", quiet);

  const clock = { minutes: 15 * 60 };
  employment.tickMinute(clock, economy, quiet);

  assert.equal(employment.earningsUnpaid, 0);
  assert.equal(economy.balance, 500);
});

test("missing three scheduled shifts is a firing", () => {
  const employment = new Employment();
  const economy = new Economy({ balance: 0 });
  employment.apply("bookkeeping", quiet);

  employee: {
    for (let day = 0; day < MAX_ABSENCES; day += 1) employment.endOfDay(day, 0, (day + 1) * 1440, economy, quiet);
  }

  assert.equal(employment.absences, MAX_ABSENCES);
  assert.equal(employment.status, "fired");
  assert.equal(employment.employed, false);
  assert.equal(employment.settle(0, economy, quiet), 0);
});

test("a day the job does not run is not an absence", () => {
  const employment = new Employment();
  const economy = new Economy({ balance: 0 });
  employment.apply("bookkeeping", quiet);

  employment.endOfDay(0, 6, 1440, economy, quiet);

  assert.equal(employment.absences, 0);
  assert.equal(employment.status, "employed");
});

test("a worked shift is not recorded as an absence at midnight", () => {
  const world = World.create({ seed: "jobs-boundary", npcCount: 8 });
  world.takeJob("supportDesk");
  world.clock.minutes = 12 * 60 + 55;

  world.tick(60 * 12);

  assert.equal(world.employment.absences, 0, "the shift that just ended was worked");
  assert.ok(world.employment.shiftsWorked >= 1);
  assert.equal(world.employment.status, "employed");
});

test("employment survives a save and restore", () => {
  const world = World.create({ seed: "jobs-save", npcCount: 10 });
  world.takeJob("callCentre");
  world.tick(1440);

  const restored = World.fromSnapshot(world.snapshot());

  assert.equal(restored.employment.jobId, "callCentre");
  assert.equal(restored.hash(), world.hash());
});
