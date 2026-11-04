/**
 * Violence resolution (brief Section 7): clumsy, exhausting, consequential.
 *
 * The brief asks for fights that are ugly rather than cinematic — weapons jam,
 * hands slip, victims fight back, the attacker ends up injured and covered in
 * evidence — and for every act to carry persistent simulated consequence. This
 * module produces the physical outcome and the psychological one; the world
 * records evidence, witnesses and rumors from it.
 *
 * Gating: with violence below "graphic", an assault resolves as a shove. No wound
 * object is created at all, so no gore asset has anything to attach to. That is
 * how the toggle suppresses generation rather than merely hiding it.
 */

import type { ContentGate } from "../content/gate.ts";
import type { Rng } from "../core/rng.ts";
import type { BodyRegion, WeaponKind } from "./anatomy.ts";
import { BODY_REGIONS, WEAPON_PROFILES } from "./anatomy.ts";
import { applyWound, maxSeverity, painIndex } from "./injury.ts";
import type { Npc } from "./types.ts";

export type VictimResponse = "defiant" | "bargaining" | "dissociated" | "broken" | "playingDead";

export type AssaultOutcome = {
  landed: boolean;
  weaponJammed: boolean;
  attackerWounded: boolean;
  victimWoundId: string | null;
  victimDied: boolean;
  gated: boolean;
  summary: string;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function resolveAssault(
  gate: ContentGate,
  rng: Rng,
  attacker: Npc,
  victim: Npc,
  weapon: WeaponKind,
  atMinute: number,
): AssaultOutcome {
  const graphic = gate.allows({ kind: "violence", level: "graphic" });
  const jamChance = weapon === "firearm" ? 0.05 : weapon === "improvised" ? 0.14 : 0.06;

  const base: AssaultOutcome = {
    landed: false,
    weaponJammed: false,
    attackerWounded: false,
    victimWoundId: null,
    victimDied: false,
    gated: !graphic,
    summary: "",
  };

  if (!victim.alive) {
    return { ...base, summary: "Nothing happened. They were already dead." };
  }

  if (rng.chance(jamChance)) {
    return {
      ...base,
      weaponJammed: true,
      summary: `${WEAPON_PROFILES[weapon].label} jammed or slipped. It took far longer than expected.`,
    };
  }

  if (!graphic) {
    // No injury state is created, so no gore presentation exists downstream.
    victim.stress = Math.min(100, victim.stress + 15);
    return {
      ...base,
      landed: true,
      summary: "A shove and a struggle. Nobody is hurt — graphic violence is disabled.",
    };
  }

  const accuracy = clamp01(0.55 + (attacker.personality.conscientiousness - 0.5) * 0.2);
  if (!rng.chance(accuracy)) {
    return { ...base, summary: "It went wide. Furniture was damaged; nobody was." };
  }

  const region: BodyRegion = rng.pick(BODY_REGIONS);
  const severityBase = weapon === "firearm" ? 0.55 : weapon === "blade" ? 0.4 : 0.3;
  const severity = clamp01(severityBase + rng.next() * 0.55);
  const wound = applyWound(victim.injury, weapon, region, severity, atMinute, attacker.id);

  // The victim fights back. Close quarters is not a cutscene.
  const fightBack = clamp01(0.2 + (1 - victim.personality.agreeableness) * 0.25 + victim.personality.neuroticism * 0.15);
  let attackerWounded = false;
  if (rng.chance(fightBack)) {
    applyWound(attacker.injury, "improvised", rng.pick(BODY_REGIONS), 0.15 + rng.next() * 0.3, atMinute, victim.id);
    attackerWounded = true;
  }

  attacker.stress = Math.min(100, attacker.stress + 12);

  const severityLabel = maxSeverity(wound).toFixed(2);
  return {
    landed: true,
    weaponJammed: false,
    attackerWounded,
    victimWoundId: wound.id,
    victimDied: !victim.injury.alive,
    gated: false,
    summary:
      `A hit with a ${WEAPON_PROFILES[weapon].label} (${region}, severity ${severityLabel}).` +
      (attackerWounded ? " They fought back and drew blood." : " They did not fight back effectively."),
  };
}

/** Victim psychology under sustained harm: the brief's defiance/bargaining/breaking. */
export function victimResponse(victim: Npc, pain: number): VictimResponse {
  if (!victim.injury.alive) return "broken";
  const shock = victim.injury.vitals.shock;
  if (shock >= 75) return "playingDead";
  if (victim.personality.agreeableness > 0.65 && pain > 25) return "bargaining";
  if (victim.personality.neuroticism > 0.7 && shock > 50) return "dissociated";
  if (victim.personality.conscientiousness > 0.6 || victim.personality.extraversion > 0.7) return "defiant";
  return pain > 60 ? "broken" : "defiant";
}

/**
 * The attacker's mind degrades in response (Section 7: obsession, sadism,
 * addiction, dissociation, paranoia, moral collapse — tracked state, not a
 * cutscene). Repeated acts compound; time alone does not undo them.
 */
export function applyPsyche(attacker: Npc, victim: Npc, severity: number): void {
  const s = Math.max(0, Math.min(1, severity));
  attacker.guilt = Math.min(100, attacker.guilt + 7 * s);
  attacker.paranoia = Math.min(100, attacker.paranoia + 5 * s);
  attacker.detachment = Math.min(100, attacker.detachment + 6 * s);
  attacker.stress = Math.min(100, attacker.stress + 9 * s);
  victim.stress = 100;
}

export function isIncapacitated(npc: Npc): boolean {
  return !npc.injury.alive || npc.injury.vitals.consciousness <= 5;
}

export function injuryBurden(npc: Npc): number {
  return painIndex(npc.injury);
}
