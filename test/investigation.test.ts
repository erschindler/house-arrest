import assert from "node:assert/strict";
import test from "node:test";
import { createRng } from "../src/core/rng.ts";
import {
  advanceInvestigation,
  arrestRisk,
  createInvestigation,
  recordEvidence,
  recordWitness,
  statusForHeat,
} from "../src/sim/investigation.ts";

test("undiscovered evidence generates no pressure", () => {
  const state = createInvestigation();
  recordEvidence(state, "blood", "player", 0);

  advanceInvestigation(state, 10, createRng("quiet"));
  assert.equal(state.heat, 0);
  assert.equal(state.status, "quiet");
});

test("discovered evidence and reported witnesses raise heat", () => {
  const state = createInvestigation();
  const evidence = recordEvidence(state, "blood", "player", 0);
  evidence.discovered = true;

  const witness = recordWitness(state, "npc-1", 0, 1);
  if (!witness) throw new Error("witness was not recorded");
  witness.reported = true;

  advanceInvestigation(state, 10, createRng("gathering"));
  assert.ok(state.heat > 20, `heat was ${state.heat}`);
  assert.notEqual(state.status, "quiet");
});

test("heat decays when nothing is being discovered", () => {
  const state = createInvestigation();
  state.heat = 40;

  advanceInvestigation(state, 5, createRng("decay"));
  assert.ok(state.heat < 40);
});

test("status thresholds and arrest risk track heat", () => {
  assert.equal(statusForHeat(0), "quiet");
  assert.equal(statusForHeat(30), "gathering");
  assert.equal(statusForHeat(70), "warrant");
  assert.equal(statusForHeat(90), "arrested");

  const state = createInvestigation();
  state.heat = 70;
  const risk = arrestRisk(state);
  assert.ok(risk > 0 && risk < 1, `expected a partial arrest risk, got ${risk}`);
});

test("the same witness is never recorded twice", () => {
  const state = createInvestigation();
  assert.ok(recordWitness(state, "npc-1", 0, 0.5));
  assert.equal(recordWitness(state, "npc-1", 10, 0.9), null);
  assert.equal(state.witnesses.length, 1);
});
