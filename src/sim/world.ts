/**
 * The world: one object that owns the clock, the population, the social graph,
 * memory, the household, the economy, the event engine and any active scene.
 *
 * The tick pipeline is deliberately ordered and boring, because the whole design
 * promise is that the world keeps running whether or not the player is looking:
 *
 *   clock → tiers → NPC needs/schedule → active scene beat → event engine
 *         → contractor completion → (at midnight) daily systems
 *
 * Everything random comes from `this.rng`, and `snapshot()` captures all of it,
 * so the same seed and the same inputs always produce the same world.
 */

import { ContentGate } from "../content/gate.ts";
import type { ContentSettings } from "../content/gate.ts";
import { advanceClock, createClock, dayIndex, minuteOfDay, weekdayIndex } from "../core/clock.ts";
import type { Clock } from "../core/clock.ts";
import { createRng } from "../core/rng.ts";
import type { Rng } from "../core/rng.ts";
import { SNAPSHOT_VERSION, hashSnapshot } from "../save/serialize.ts";
import type { WorldSnapshot } from "../save/serialize.ts";
import { createPlayerNpc, generatePopulation } from "../worldgen/population.ts";
import { IntimacyScene } from "./consent.ts";
import type { SceneDeps } from "./consent.ts";
import { Economy } from "./economy.ts";
import { EventEngine, builtinEvents } from "./events.ts";
import type { EventContext } from "./events.ts";
import { spreadRumor } from "./gossip.ts";
import type { GossipDeps } from "./gossip.ts";
import { ISSUE_LIBRARY, completeContractorWork, conditionScore, createHouseholdState, dailyHouseholdTick } from "./household.ts";
import type { HouseholdState } from "./household.ts";
import { advanceInjury } from "./injury.ts";
import { advanceInvestigation, createInvestigation, recordEvidence, recordWitness } from "./investigation.ts";
import type { InvestigationState } from "./investigation.ts";
import { applyPsyche, resolveAssault } from "./violence.ts";
import type { AssaultOutcome } from "./violence.ts";
import type { WeaponKind } from "./anatomy.ts";
import { TIER_INTERVAL_MINUTES, assignTiers, countTiers } from "./lod.ts";
import type { SimTier, TierAssignment } from "./lod.ts";
import { MemoryStore } from "./memory.ts";
import { Employment, JOB_MARKET, idleSchedule, scheduleForJob } from "./jobs.ts";
import type { JobOffer } from "./jobs.ts";
import { evaluateEnding, evaluateObjectives, overallProgress } from "./goals.ts";
import type { Ending, GoalInput, Objective } from "./goals.ts";
import { Net } from "./net.ts";
import type { NetDeps, PostKind, SocialPost } from "./net.ts";
import { Phone } from "./phone.ts";
import type { PhoneDeps, PhoneMessage } from "./phone.ts";
import { Space } from "./space.ts";
import type { Placement } from "./space.ts";
import { advanceNeeds, needComfortIndex, moodFromNeeds } from "./needs.ts";
import { RelationshipStore } from "./relationship.ts";
import { blockAt, isOnProperty } from "./schedule.ts";
import type { GameEventLogEntry, LocationId, LogInput, Npc, NpcId } from "./types.ts";

export type WorldOptions = {
  seed?: number | string;
  npcCount?: number;
  settings?: Partial<ContentSettings>;
};

type WorldInit = {
  seed: number;
  rng: Rng;
  gate: ContentGate;
  npcs: Map<NpcId, Npc>;
  relationships: RelationshipStore;
  playerId: NpcId;
  memories?: MemoryStore;
  economy?: Economy;
};

const LOG_LIMIT = 4000;

export class World {
  readonly seed: number;
  readonly rng: Rng;
  readonly clock: Clock;
  readonly gate: ContentGate;
  readonly npcs: Map<NpcId, Npc>;
  readonly relationships: RelationshipStore;
  readonly memories: MemoryStore;
  readonly economy: Economy;
  readonly events: EventEngine;
  readonly playerId: NpcId;
  readonly log: GameEventLogEntry[] = [];

  /** The floorplan and the placement rules. Stateless: derived from schedules. */
  readonly space = new Space();
  readonly phone: Phone;
  readonly net: Net;
  readonly employment: Employment;

  household: HouseholdState;
  investigation: InvestigationState;
  activeScene: IntimacyScene | null = null;
  reputation = 0;

  private tiers: TierAssignment = new Map();
  private tierRefreshedAt = 0;
  private logCounter = 0;

  private constructor(init: WorldInit) {
    this.seed = init.seed;
    this.rng = init.rng;
    this.clock = createClock(0);
    this.gate = init.gate;
    this.npcs = init.npcs;
    this.relationships = init.relationships;
    this.memories = init.memories ?? new MemoryStore();
    this.economy = init.economy ?? new Economy();
    this.events = new EventEngine(builtinEvents(), 180, 0.45);
    this.playerId = init.playerId;
    this.household = createHouseholdState();
    this.investigation = createInvestigation();
    this.phone = new Phone(this.phoneAndNetDeps());
    this.net = new Net(this.phoneAndNetDeps());
    this.employment = new Employment();
  }

  /**
   * The phone and the net read and write exactly the same world state, so they
   * get the same dependencies. Deliberately narrow: neither can reach the
   * economy or the investigation directly, because both of those refuse or
   * record money and evidence, and a channel that can do that silently is a
   * channel that will eventually bypass a rule.
   */
  private phoneAndNetDeps(): PhoneDeps & NetDeps {
    return {
      gate: this.gate,
      relationships: this.relationships,
      memories: this.memories,
      npcs: this.npcs,
      rng: this.rng,
      now: () => this.clock.minutes,
      log: (entry: LogInput) => this.logEntry(entry),
      playerId: this.playerId,
    };
  }

  static create(options: WorldOptions = {}): World {
    const rng = createRng(options.seed ?? "house-arrest");
    const gate = new ContentGate(options.settings);
    const player = createPlayerNpc("npc-player", rng);
    const generated = generatePopulation({ rng, count: options.npcCount ?? 120, player });

    const npcs = new Map<NpcId, Npc>();
    npcs.set(player.id, player);
    for (const npc of generated.npcs) npcs.set(npc.id, npc);

    return new World({
      seed: rng.seed,
      rng,
      gate,
      npcs,
      relationships: new RelationshipStore(generated.relationships),
      playerId: player.id,
    });
  }

  static fromSnapshot(snapshot: WorldSnapshot): World {
    const npcs = new Map<NpcId, Npc>();
    for (const npc of snapshot.npcs) npcs.set(npc.id, npc);

    const world = new World({
      seed: snapshot.seed,
      rng: createRng(snapshot.seed),
      gate: new ContentGate(snapshot.settings),
      npcs,
      relationships: new RelationshipStore(snapshot.relationships),
      playerId: snapshot.playerId,
      memories: MemoryStore.fromSnapshot(snapshot.memories, snapshot.memoryCounter),
      economy: new Economy(snapshot.economy),
    });

    world.rng.setState(snapshot.rng);
    world.clock.minutes = snapshot.clockMinutes;
    world.household = snapshot.household;
    world.investigation = snapshot.investigation;
    world.events.restoreCooldowns(snapshot.cooldowns);
    world.log.push(...snapshot.log);
    world.logCounter = snapshot.logCounter;
    world.reputation = snapshot.reputation;
    world.phone.restore(snapshot.phone);
    world.net.restore(snapshot.net);
    world.employment.restore(snapshot.employment);
    world.tiers = new Map(snapshot.tiers);
    world.tierRefreshedAt = snapshot.tierRefreshedAt;

    if (snapshot.scene) {
      const a = npcs.get(snapshot.scene.aId);
      const b = npcs.get(snapshot.scene.bId);
      if (a && b) world.activeScene = new IntimacyScene(world.makeSceneDeps(), a, b, snapshot.scene);
    }

    return world;
  }

  get player(): Npc {
    const npc = this.npcs.get(this.playerId);
    if (!npc) throw new Error(`player ${this.playerId} missing from world`);
    return npc;
  }

  tick(minutes = 1): void {
    for (let i = 0; i < minutes; i += 1) this.tickOneMinute();
  }

  openScene(aId: NpcId, bId: NpcId): IntimacyScene {
    if (this.activeScene && !this.activeScene.isFinished) {
      throw new Error("a scene is already running; close it before opening another");
    }
    const a = this.npcs.get(aId);
    const b = this.npcs.get(bId);
    if (!a || !b) throw new Error("unknown participant");
    const scene = new IntimacyScene(this.makeSceneDeps(), a, b);
    this.activeScene = scene;
    return scene;
  }

  closeFinishedScene(): void {
    if (this.activeScene && this.activeScene.isFinished) this.activeScene = null;
  }

  tierCounts(): Record<SimTier, number> {
    return countTiers(this.tiers);
  }

  get houseCondition(): number {
    return conditionScore(this.household);
  }

  hash(): string {
    return hashSnapshot(this.snapshot());
  }

  snapshot(): WorldSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      seed: this.seed,
      rng: this.rng.getState(),
      clockMinutes: this.clock.minutes,
      settings: this.gate.settings,
      playerId: this.playerId,
      npcs: [...this.npcs.values()],
      relationships: this.relationships.all(),
      memories: this.memories.snapshotItems(),
      memoryCounter: this.memories.snapshotCounter(),
      economy: this.economy.snapshot(),
      employment: this.employment.snapshot(),
      phone: this.phone.snapshot(),
      net: this.net.snapshot(),
      household: this.household,
      investigation: this.investigation,
      cooldowns: this.events.cooldownEntries(),
      log: this.log,
      logCounter: this.logCounter,
      tiers: [...this.tiers.entries()],
      tierRefreshedAt: this.tierRefreshedAt,
      reputation: this.reputation,
      scene: this.activeScene ? this.activeScene.toSnapshot() : null,
    };
  }

  logEntry(input: LogInput): void {
    this.logCounter += 1;
    const entry: GameEventLogEntry = {
      id: `log-${this.logCounter}`,
      atMinute: this.clock.minutes,
      ...input,
    };
    this.log.push(entry);
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);

    // A scene that ended badly becomes a rumor about the player.
    if (input.kind === "scene.withdrawn" && input.participants.includes(this.playerId)) {
      this.reputation += spreadRumor(this.gossipDeps(), this.playerId, {
        subject: this.playerId,
        summary: "Someone said no in the middle of something and it did not end well.",
        tags: ["intimacy", "boundary"],
        salience: 0.55,
        valence: -0.5,
      }).reputationDelta;
    }
  }

  private gossipDeps(): GossipDeps {
    return {
      relationships: this.relationships,
      memories: this.memories,
      npcs: this.npcs,
      rng: this.rng,
      now: () => this.clock.minutes,
      log: (entry) => this.logEntry(entry),
      playerId: this.playerId,
    };
  }

  private makeSceneDeps(): SceneDeps {
    return {
      gate: this.gate,
      relationships: this.relationships,
      memories: this.memories,
      now: () => this.clock.minutes,
      log: (entry) => this.logEntry(entry),
    };
  }

  private eventContext(): EventContext {
    return {
      rng: this.rng,
      minute: this.clock.minutes,
      player: this.player,
      npcs: this.npcs,
      relationships: this.relationships,
      memories: this.memories,
      household: this.household,
      economy: this.economy,
      gate: this.gate,
    };
  }

  private tickOneMinute(): void {
    advanceClock(this.clock, 1);
    this.refreshTiersIfNeeded();
    this.simulateNpcs();

    if (this.activeScene && this.clock.minutes % 5 === 0) {
      this.activeScene.tick(this.rng);
      if (this.activeScene.isFinished) this.activeScene = null;
    }

    this.phone.tick();
    this.net.tick();
    this.employment.tickMinute(this.clock, this.economy, (entry) => this.logEntry(entry));

    const resolution = this.events.tick(this.eventContext());
    if (resolution) {
      this.logEntry({
        kind: resolution.kind,
        summary: resolution.summary,
        participants: resolution.participants,
        gated: resolution.gated,
      });
    }

    const finished = completeContractorWork(this.household, this.clock.minutes);
    for (const issue of finished) {
      this.logEntry({
        kind: "household",
        summary: `A contractor finished: ${ISSUE_LIBRARY[issue.kind].label}.`,
        participants: [this.playerId],
        gated: false,
      });
    }

    if (minuteOfDay(this.clock) === 0) this.runDaily();
  }

  private refreshTiersIfNeeded(): void {
    if (this.clock.minutes - this.tierRefreshedAt < 60) return;
    this.tiers = assignTiers({
      npcs: [...this.npcs.values()],
      budget: { full: 16, coarse: 90 },
      isOnProperty: (npc) => isOnProperty(npc, this.clock.minutes),
      isExpected: (npc) => this.relationships.get(npc.id, this.playerId).axes.familiarity >= 20,
    });
    this.tierRefreshedAt = this.clock.minutes;
  }

  private simulateNpcs(): void {
    for (const npc of this.npcs.values()) {
      if (!npc.alive) continue;
      const tier = this.tiers.get(npc.id) ?? "statistical";
      const elapsed = this.clock.minutes - npc.lastSimulatedMinute;
      if (elapsed < TIER_INTERVAL_MINUTES[tier]) continue;

      const elapsedMinutes = Math.min(elapsed, 1440);
      const block = blockAt(npc, this.clock.minutes);
      advanceNeeds(npc, elapsedMinutes, block.activity);
      npc.lastSimulatedMinute = this.clock.minutes;
      npc.mood = moodFromNeeds(npc);

      // Stress relaxes toward the level implied by unmet needs rather than
      // accumulating: an NPC simulated every minute must not build 1440 times the
      // stress of one simulated daily. Acute events push it up; this pulls it back.
      const dayFraction = elapsedMinutes / 1440;
      const target = Math.max(0, Math.min(100, (100 - needComfortIndex(npc)) * 0.75));
      const pull = 1 - Math.exp(-0.8 * dayFraction);
      npc.stress = Math.max(0, Math.min(100, npc.stress + (target - npc.stress) * pull));

      const injury = advanceInjury(npc.injury, elapsedMinutes, this.clock.minutes);
      if (injury.died) {
        npc.alive = false;
        this.logEntry({
          kind: "death",
          summary: `${npc.givenName} ${npc.familyName} died of ${npc.injury.causeOfDeath ?? "their injuries"}.`,
          participants: [npc.id],
          gated: true,
        });
        this.memories.add({
          atMinute: this.clock.minutes,
          kind: "violence",
          summary: `${npc.givenName} ${npc.familyName} died.`,
          participants: [npc.id, this.playerId],
          tags: ["death"],
          salience: 1,
          valence: -1,
        });
        // A death is discoverable evidence, attributable to whoever caused it.
        recordEvidence(this.investigation, "body", npc.injury.attributedTo ?? npc.id, this.clock.minutes);
      }
    }
  }

  private runDaily(): void {
    const minute = this.clock.minutes;
    const day = dayIndex(this.clock);

    this.relationships.decayDaily(minute);
    this.memories.decayDaily();
    // Daily systems run at 00:00, so the day that just ended is `day - 1`.
    const closingDay = day - 1;
    if (closingDay >= 0) {
      const closingWeekday = ((closingDay % 7) + 7) % 7;
      this.employment.endOfDay(
        closingDay,
        closingWeekday,
        this.clock.minutes,
        this.economy,
        (entry) => this.logEntry(entry),
      );
    }

    const net = this.economy.processDay(day, minute);
    if (net !== 0) {
      this.logEntry({
        kind: "economy",
        summary: `Bills taken: $${Math.abs(net)}. Balance $${this.economy.balance}.`,
        participants: [this.playerId],
        gated: false,
      });
    }

    const issue = dailyHouseholdTick(this.household, this.rng, minute);
    if (issue) {
      const profile = ISSUE_LIBRARY[issue.kind];
      this.logEntry({
        kind: "household",
        summary: `${profile.label} developed overnight (severity ${profile.severity}).`,
        participants: [this.playerId],
        gated: false,
      });
    }

    this.player.stress = Math.max(0, Math.min(100, this.player.stress * 0.98));
    advanceInvestigation(this.investigation, 1, this.rng);
  }

  /**
   * Characters whose home this is. Everyone else's schedule describes their own
   * house, using the same generic room vocabulary — which is why residency, not
   * the room id, decides who is actually here.
   */
  residents(): Npc[] {
    const out: Npc[] = [];
    for (const npc of this.npcs.values()) {
      if (npc.homeLocation !== "elsewhere") out.push(npc);
    }
    return out;
  }

  /** Every resident currently on the property has a transform. Off-site does not. */
  placements(): Placement[] {
    return this.space.transforms(this.clock.minutes, this.residents());
  }

  occupants(): Map<LocationId, NpcId[]> {
    return this.space.occupants(this.clock.minutes, this.residents());
  }

  /** The objective/ending inputs, read straight off the world. */
  goalInput(): GoalInput {
    const relationships = this.relationships
      .all()
      .filter((rel) => rel.a === this.playerId || rel.b === this.playerId)
      .map((rel) => ({
        familiarity: rel.axes.familiarity,
        trust: rel.axes.trust,
        friendship: rel.axes.friendship,
      }));

    return {
      balance: this.economy.balance,
      houseCondition: conditionScore(this.household),
      heat: this.investigation.heat,
      employed: this.employment.employed,
      reputation: this.reputation,
      day: dayIndex(this.clock),
      relationships,
    };
  }

  objectives(): Objective[] {
    return evaluateObjectives(this.goalInput());
  }

  progress(): number {
    return overallProgress(this.objectives());
  }

  /** Non-null once the run is decided. The simulation continues either way. */
  ending(): Ending | null {
    return evaluateEnding(this.goalInput());
  }

  /** The job board, filtered to what a person under house arrest could actually take. */
  get jobMarket(): JobOffer[] {
    return this.employment.employed ? [] : JOB_MARKET;
  }

  /**
   * Taking a job rewrites the player's day. That is the whole point: the pay is
   * not the feature, the *where* is. During a shift the spatial layer puts the
   * player at the desk, and the phone stops finding them free.
   */
  takeJob(jobId: string): boolean {
    const offer = JOB_MARKET.find((entry) => entry.id === jobId);
    if (!offer) return false;
    if (!this.employment.apply(jobId, (entry) => this.logEntry(entry))) return false;
    this.player.schedule = scheduleForJob(offer);
    this.player.occupation = offer.title;
    return true;
  }

  quitJob(): void {
    this.employment.quit((entry) => this.logEntry(entry));
    this.player.schedule = idleSchedule();
    this.player.occupation = "unemployed";
  }

  readPhone(npcId: NpcId): PhoneMessage[] {
    const thread = this.phone.threads.find((entry) => entry.npcId === npcId);
    return thread ? thread.messages.slice() : [];
  }

  feed(limit = 10): SocialPost[] {
    return this.net.feed(limit);
  }

  share(kind: PostKind, body?: string): SocialPost {
    return this.net.post(kind, body);
  }

  /**
   * Resolve an assault and record everything it implies: the wound, the
   * attacker's state of mind, physical evidence, whoever was in the house to see
   * it, and the log entry the rest of the world reacts to.
   */
  assault(attackerId: NpcId, victimId: NpcId, weapon: WeaponKind): AssaultOutcome {
    const attacker = this.npcs.get(attackerId);
    const victim = this.npcs.get(victimId);
    if (!attacker || !victim) throw new Error("unknown participant");

    const outcome = resolveAssault(this.gate, this.rng, attacker, victim, weapon, this.clock.minutes);

    if (outcome.victimWoundId) {
      applyPsyche(attacker, victim, outcome.victimDied ? 1 : 0.6);
      this.memories.add({
        atMinute: this.clock.minutes,
        kind: "violence",
        summary: outcome.summary,
        participants: [attackerId, victimId],
        tags: ["violence"],
        salience: 0.95,
        valence: -0.9,
      });
      recordEvidence(this.investigation, "blood", attackerId, this.clock.minutes);

      for (const npc of this.npcs.values()) {
        if (npc.id === attackerId || npc.id === victimId || !npc.alive) continue;
        if (!isOnProperty(npc, this.clock.minutes)) continue;
        recordWitness(this.investigation, npc.id, this.clock.minutes, 0.3 + npc.personality.openness * 0.4);
      }

      if (outcome.victimDied) {
        recordEvidence(this.investigation, "body", attackerId, this.clock.minutes);
        victim.alive = false;
        victim.injury.alive = false;
      }
    }

    this.logEntry({
      kind: "violence",
      summary: outcome.summary,
      participants: [attackerId, victimId],
      gated: outcome.gated,
    });
    return outcome;
  }
}
