/**
 * The spatial layer (the README's "next, in order" item 1).
 *
 * Until now every character had a location id and nothing else: a schedule said
 * `kitchen` and there was no kitchen. That is fine for a headless simulation and
 * useless for an engine, which needs a transform.
 *
 * The layout is hand-authored rather than generated. A procedurally rectangled
 * house is deterministic and worthless — an artist cannot light it, a level
 * designer cannot block it, and two runs that agree on a rectangle still agree on
 * nothing a player would recognize. So the house is a fixed floorplan, and the
 * *placement* is what varies: which anchor in a room a character stands on is
 * derived from their id and the schedule block, so the same character occupies the
 * same corner on every replay, and two characters in the dining room are not
 * stacked inside each other.
 *
 * Placement consumes no randomness on purpose. Adding a room must not shift the
 * simulation's rng stream, or every room added would change every save's future.
 * `hashString` gives stable per-character variation without touching the stream.
 *
 * Off-site locations (`workplace`, `store`, `gym`, `elsewhere`) deliberately have
 * no room: an NPC who is out of the house has no transform on the home level, and
 * `placementOf` returns null rather than inventing a coordinate in a space that
 * does not exist yet.
 */

import { MINUTES_PER_DAY } from "../core/clock.ts";
import { hashString } from "../core/rng.ts";
import { blockAt } from "./schedule.ts";
import type { Activity, LocationId, Npc, NpcId } from "./types.ts";

export type Vec3 = { x: number; y: number; z: number };

export type RoomPrivacy = "public" | "semi" | "private";

/**
 * What a character is doing in a room, in terms the level *can* represent. These
 * are mount points, not animations: a UE client maps a niche to a socket on the
 * furniture it placed there.
 */
export type AnchorNiche =
  | "stand"
  | "sit"
  | "sleep"
  | "work"
  | "cook"
  | "wash"
  | "store"
  | "door"
  | "window"
  | "exercise";

export type Anchor = {
  id: string;
  room: LocationId;
  niche: AnchorNiche;
  /** Absolute position in the house, metres. */
  position: Vec3;
  /** Yaw in degrees, 0 = +X, so a character faces the thing the anchor is for. */
  yaw: number;
};

export type Room = {
  id: LocationId;
  label: string;
  /** 0 = ground, 1 = upstairs, -1 = basement. */
  level: -1 | 0 | 1;
  bounds: { x: number; y: number; width: number; depth: number };
  ceiling: number;
  privacy: RoomPrivacy;
  outdoor: boolean;
};

export type Placement = {
  npcId: NpcId;
  room: LocationId;
  anchorId: string;
  position: Vec3;
  yaw: number;
};

export const FLOOR_HEIGHT = 3.2;

/**
 * The floorplan. Bounds are (x, y) origin plus width/depth, in metres, and they do
 * not overlap on the same level — the tests assert that anchors land inside their
 * own room, which is what catches a typo that would put a character in a wall.
 */
export const HOUSE_ROOMS: Room[] = [
  { id: "livingRoom", label: "Living room", level: 0, bounds: { x: 0, y: 0, width: 7, depth: 6 }, ceiling: 2.7, privacy: "public", outdoor: false },
  { id: "kitchen", label: "Kitchen", level: 0, bounds: { x: 7, y: 0, width: 4.5, depth: 4 }, ceiling: 2.7, privacy: "semi", outdoor: false },
  { id: "diningRoom", label: "Dining room", level: 0, bounds: { x: 7, y: 4, width: 4.5, depth: 3 }, ceiling: 2.7, privacy: "semi", outdoor: false },
  { id: "bathroom", label: "Bathroom", level: 0, bounds: { x: 0, y: 6, width: 3, depth: 2.5 }, ceiling: 2.4, privacy: "private", outdoor: false },
  { id: "office", label: "Office", level: 0, bounds: { x: 3, y: 6, width: 4, depth: 2.5 }, ceiling: 2.7, privacy: "semi", outdoor: false },
  { id: "laundry", label: "Laundry", level: 0, bounds: { x: 11.5, y: 0, width: 2.5, depth: 3 }, ceiling: 2.4, privacy: "semi", outdoor: false },
  { id: "garage", label: "Garage", level: 0, bounds: { x: 11.5, y: 3, width: 4, depth: 6 }, ceiling: 3, privacy: "semi", outdoor: false },
  { id: "porch", label: "Front porch", level: 0, bounds: { x: 0, y: -3, width: 6, depth: 3 }, ceiling: 0, privacy: "public", outdoor: true },
  { id: "backyard", label: "Back yard", level: 0, bounds: { x: 0, y: 9.5, width: 12, depth: 6 }, ceiling: 0, privacy: "public", outdoor: true },
  { id: "masterBedroom", label: "Master bedroom", level: 1, bounds: { x: 0, y: 0, width: 6, depth: 5 }, ceiling: 2.7, privacy: "private", outdoor: false },
  { id: "guestBedroom", label: "Guest bedroom", level: 1, bounds: { x: 6, y: 0, width: 5, depth: 5 }, ceiling: 2.7, privacy: "private", outdoor: false },
  { id: "basement", label: "Basement", level: -1, bounds: { x: 0, y: 0, width: 8, depth: 5 }, ceiling: 2.4, privacy: "semi", outdoor: false },
];

type AnchorSpec = [id: string, niche: AnchorNiche, x: number, y: number, yaw: number];

const ANCHOR_SPECS: { room: LocationId; items: AnchorSpec[] }[] = [
  {
    room: "livingRoom",
    items: [
      ["livingRoom.sofa", "sit", 2.2, 2.0, 0],
      ["livingRoom.armchair", "sit", 5.0, 2.2, 180],
      ["livingRoom.window", "window", 1.0, 0.4, 0],
      ["livingRoom.door", "door", 6.6, 1.0, 90],
      ["livingRoom.floor", "stand", 3.5, 4.5, 0],
    ],
  },
  {
    room: "kitchen",
    items: [
      ["kitchen.counter", "cook", 8.4, 1.2, 90],
      ["kitchen.sink", "cook", 7.6, 0.6, 0],
      ["kitchen.island", "sit", 9.6, 2.2, 270],
      ["kitchen.floor", "stand", 9.0, 3.2, 0],
    ],
  },
  {
    room: "diningRoom",
    items: [
      ["diningRoom.table", "sit", 9.2, 5.6, 0],
      ["diningRoom.floor", "stand", 8.0, 6.4, 45],
    ],
  },
  {
    room: "bathroom",
    items: [
      ["bathroom.shower", "wash", 0.8, 6.6, 45],
      ["bathroom.sink", "wash", 2.4, 6.4, 0],
      ["bathroom.floor", "stand", 1.6, 8.0, 0],
    ],
  },
  {
    room: "office",
    items: [
      ["office.desk", "work", 4.4, 7.2, 0],
      ["office.chair", "sit", 4.4, 6.9, 0],
      ["office.floor", "stand", 5.6, 8.0, 90],
    ],
  },
  {
    room: "laundry",
    items: [
      ["laundry.washer", "wash", 12.2, 0.8, 90],
      ["laundry.bench", "work", 12.6, 2.2, 180],
    ],
  },
  {
    room: "garage",
    items: [
      ["garage.bench", "work", 12.4, 4.0, 90],
      ["garage.bay", "stand", 14.0, 6.0, 180],
      ["garage.door", "door", 11.9, 3.4, 270],
    ],
  },
  {
    room: "porch",
    items: [
      ["porch.chair", "sit", 1.2, -1.8, 0],
      ["porch.door", "door", 3.0, -0.4, 180],
      ["porch.floor", "stand", 4.6, -1.6, 0],
    ],
  },
  {
    room: "backyard",
    items: [
      ["backyard.patch", "exercise", 5.0, 11.0, 0],
      ["backyard.tree", "stand", 2.0, 12.0, 90],
      ["backyard.gate", "door", 10.0, 10.2, 180],
    ],
  },
  {
    room: "masterBedroom",
    items: [
      ["masterBedroom.bed", "sleep", 2.6, 1.8, 0],
      ["masterBedroom.bedSide", "sleep", 4.2, 1.8, 180],
      ["masterBedroom.dresser", "stand", 0.8, 4.2, 270],
      ["masterBedroom.window", "window", 5.2, 0.6, 0],
      ["masterBedroom.chair", "sit", 4.4, 3.6, 180],
    ],
  },
  {
    room: "guestBedroom",
    items: [
      ["guestBedroom.bed", "sleep", 7.6, 2.0, 0],
      ["guestBedroom.bedTwo", "sleep", 8.6, 2.2, 180],
      ["guestBedroom.chair", "sit", 9.8, 3.8, 180],
      ["guestBedroom.window", "window", 9.4, 0.6, 0],
    ],
  },
  {
    room: "basement",
    items: [
      ["basement.bench", "work", 2.0, 2.0, 0],
      ["basement.crate", "stand", 5.0, 3.6, 180],
      ["basement.floor", "stand", 6.8, 1.2, 270],
    ],
  },
];

function levelZ(level: -1 | 0 | 1): number {
  return level * FLOOR_HEIGHT;
}

function buildAnchors(): Anchor[] {
  const anchors: Anchor[] = [];
  for (const group of ANCHOR_SPECS) {
    const room = HOUSE_ROOMS.find((entry) => entry.id === group.room);
    if (!room) continue;
    for (const [id, niche, x, y, yaw] of group.items) {
      anchors.push({ id, room: room.id, niche, position: { x, y, z: levelZ(room.level) }, yaw });
    }
  }
  return anchors;
}

export const HOUSE_ANCHORS: Anchor[] = buildAnchors();

/** Which mount point an activity wants. Falls back to any anchor in the room. */
const NICHE_FOR_ACTIVITY: Record<Activity, AnchorNiche> = {
  sleep: "sleep",
  work: "work",
  commute: "door",
  eat: "sit",
  shop: "store",
  socialize: "sit",
  exercise: "exercise",
  appointment: "sit",
  leisure: "sit",
  home: "stand",
  care: "wash",
};

export class Space {
  readonly rooms: Room[];
  readonly anchors: Anchor[];

  private readonly roomById = new Map<LocationId, Room>();
  private readonly anchorsByRoom = new Map<LocationId, Anchor[]>();

  constructor(rooms: Room[] = HOUSE_ROOMS, anchors: Anchor[] = HOUSE_ANCHORS) {
    this.rooms = rooms;
    this.anchors = anchors;
    for (const room of rooms) {
      this.roomById.set(room.id, room);
      this.anchorsByRoom.set(room.id, []);
    }
    for (const anchor of anchors) {
      const list = this.anchorsByRoom.get(anchor.room);
      if (list) list.push(anchor);
    }
  }

  room(id: LocationId): Room | undefined {
    return this.roomById.get(id);
  }

  /** True when this location is a room in this house (not `workplace` and friends). */
  hasRoom(id: LocationId): boolean {
    return this.roomById.has(id);
  }

  anchorsIn(id: LocationId): Anchor[] {
    return this.anchorsByRoom.get(id) ?? [];
  }

  isPrivate(id: LocationId): boolean {
    return this.roomById.get(id)?.privacy === "private";
  }

  isIndoors(id: LocationId): boolean {
    const room = this.roomById.get(id);
    return room ? !room.outdoor : false;
  }

  /** Stable choice among the room's matching anchors. Consumes no rng. */
  anchorFor(roomId: LocationId, niche: AnchorNiche, salt: string): Anchor | undefined {
    const list = this.anchorsByRoom.get(roomId) ?? [];
    if (list.length === 0) return undefined;
    const matching = list.filter((anchor) => anchor.niche === niche);
    const pool = matching.length > 0 ? matching : list;
    return pool[hashString(salt) % pool.length];
  }

  /**
   * Where this character is right now, or null if they are off-site.
   *
   * The salt is the character, the day and the start of the schedule block: a
   * character keeps the same spot for a whole block (they do not jitter every
   * minute) and takes a different spot the next time the block comes around.
   */
  placementOf(npc: Npc, minute: number): Placement | null {
    if (!npc.alive) return null;
    const block = blockAt(npc, minute);
    const room = this.roomById.get(block.location);
    if (!room) return null;
    const niche = NICHE_FOR_ACTIVITY[block.activity];
    const day = Math.floor(minute / MINUTES_PER_DAY);
    const anchor = this.anchorFor(room.id, niche, `${npc.id}|${day}|${block.startMinute}`);
    if (!anchor) return null;
    return {
      npcId: npc.id,
      room: room.id,
      anchorId: anchor.id,
      position: { ...anchor.position },
      yaw: anchor.yaw,
    };
  }

  /** Everyone indoors right now, grouped by room. Derived, so it cannot drift from the schedules. */
  occupants(minute: number, npcs: Iterable<Npc>): Map<LocationId, NpcId[]> {
    const map = new Map<LocationId, NpcId[]>();
    for (const room of this.rooms) map.set(room.id, []);
    for (const npc of npcs) {
      if (!npc.alive) continue;
      const block = blockAt(npc, minute);
      if (!this.roomById.has(block.location)) continue;
      map.get(block.location)?.push(npc.id);
    }
    return map;
  }

  /** The per-frame payload a UE client needs: transforms for everyone on the lot. */
  transforms(minute: number, npcs: Iterable<Npc>): Placement[] {
    const out: Placement[] = [];
    for (const npc of npcs) {
      const placement = this.placementOf(npc, minute);
      if (placement) out.push(placement);
    }
    return out;
  }

  describe(id: LocationId): string {
    const room = this.roomById.get(id);
    if (!room) return `${id} (off-site)`;
    return `${room.label} (level ${room.level}, ${room.privacy}${room.outdoor ? ", outdoor" : ""})`;
  }
}
