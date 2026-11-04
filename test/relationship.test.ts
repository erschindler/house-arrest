import assert from "node:assert/strict";
import test from "node:test";
import { RelationshipStore } from "../src/sim/relationship.ts";

test("axes clamp to their range", () => {
  const store = new RelationshipStore();
  store.apply("a", "b", { trust: 500, resentment: -500 });
  const rel = store.get("a", "b");
  assert.equal(rel.axes.trust, 100);
  assert.equal(rel.axes.resentment, -100);
});

test("A->B and B->A resolve to the same record", () => {
  const store = new RelationshipStore();
  store.apply("b", "a", { friendship: 20 });
  assert.equal(store.get("a", "b").axes.friendship, 20);
  assert.equal(store.all().length, 1);
});

test("family pairs can never gain romantic or sexual axes", () => {
  const store = new RelationshipStore();
  store.markFamily("a", "b");
  assert.throws(() => store.apply("a", "b", { romanticInterest: 10 }), /family pair/);
  assert.throws(() => store.apply("a", "b", { attraction: 5 }), /family pair/);
});

test("neglect cools attraction but leaves the record intact", () => {
  const store = new RelationshipStore();
  store.apply("a", "b", { attraction: 60, friendship: 40 }, 0);
  store.decayDaily(1440 * 12);
  const rel = store.get("a", "b");
  assert.ok(rel.axes.attraction < 60, "attraction should cool with neglect");
  assert.ok(rel.axes.friendship <= 40);
});

test("romantic status follows the romanticInterest axis", () => {
  const store = new RelationshipStore();
  store.apply("a", "b", { romanticInterest: 40 });
  assert.equal(store.get("a", "b").romantic, true);
});
