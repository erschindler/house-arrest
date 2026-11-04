/**
 * Emergent investigation (brief Section 7: witnesses, memories, reported
 * incidents, physical evidence as abstract game objects, investigative progress,
 * police attention, arrests).
 *
 * No scripted police encounter exists. Heat is a continuous consequence of
 * evidence that has been discovered and witnesses who have reported. It rises
 * slowly, decays slowly, and changes the world's posture toward the player at
 * thresholds. Nothing here describes how to commit or conceal anything: it is a
 * pressure model over abstract evidence objects.
 */

import type { Rng } from "../core/rng.ts";
import type { NpcId } from "./types.ts";

export type EvidenceKind = "blood" | "weapon" | "body" | "testimony" | "camera" | "document";

export type Evidence = {
  id: string;
  kind: EvidenceKind;
  /** Who the evidence points at. */
  subject: NpcId;
  atMinute: number;
  discovered: boolean;
};

export type WitnessRecord = {
  npcId: NpcId;
  atMinute: number;
  /** 0..1 how sure they are of what they saw. */
  confidence: number;
  reported: boolean;
};

export type InvestigationStatus = "quiet" | "gathering" | "warrant" | "arrested";

export type InvestigationState = {
  evidence: Evidence[];
  witnesses: WitnessRecord[];
  /** 0..100. */
  heat: number;
  status: InvestigationStatus;
  counter: number;
};

const HEAT_GATHERING = 20;
const HEAT_WARRANT = 55;
const HEAT_ARREST = 85;

export function createInvestigation(): InvestigationState {
  return { evidence: [], witnesses: [], heat: 0, status: "quiet", counter: 0 };
}

export function recordEvidence(
  state: InvestigationState,
  kind: EvidenceKind,
  subject: NpcId,
  atMinute: number,
): Evidence {
  state.counter += 1;
  const evidence: Evidence = {
    id: `evidence-${state.counter}`,
    kind,
    subject,
    atMinute,
    discovered: false,
  };
  state.evidence.push(evidence);
  return evidence;
}

export function recordWitness(
  state: InvestigationState,
  npcId: NpcId,
  atMinute: number,
  confidence: number,
): WitnessRecord | null {
  if (state.witnesses.some((entry) => entry.npcId === npcId)) return null;
  const witness: WitnessRecord = {
    npcId,
    atMinute,
    confidence: Math.max(0, Math.min(1, confidence)),
    reported: false,
  };
  state.witnesses.push(witness);
  return witness;
}

export function statusForHeat(heat: number): InvestigationStatus {
  if (heat >= HEAT_ARREST) return "arrested";
  if (heat >= HEAT_WARRANT) return "warrant";
  if (heat >= HEAT_GATHERING) return "gathering";
  return "quiet";
}

export function discoveredEvidence(state: InvestigationState): Evidence[] {
  return state.evidence.filter((entry) => entry.discovered);
}

export function reportedWitnesses(state: InvestigationState): WitnessRecord[] {
  return state.witnesses.filter((entry) => entry.reported);
}

/**
 * One day of investigative drift.
 *
 * Pressure comes only from things the world can actually observe: discovered
 * evidence and witnesses who decided to talk. An undiscovered crime leaves no
 * trace, which is what makes concealment a real (and non-instructive) mechanic.
 */
export function advanceInvestigation(state: InvestigationState, dayFraction: number, rng: Rng): void {
  const discovered = discoveredEvidence(state).length;
  const reports = reportedWitnesses(state).length;
  const pressure = discovered * 1.6 + reports * 2.4;
  const drag = 0.5;
  state.heat = Math.max(0, Math.min(100, state.heat + (pressure - drag) * dayFraction));

  for (const witness of state.witnesses) {
    if (witness.reported) continue;
    // Guilt, fear and civic duty are all just "does this person talk".
    const talk = (0.12 + witness.confidence * 0.25) * dayFraction;
    if (rng.chance(talk)) witness.reported = true;
  }

  const discoveryChance = (0.05 + discovered * 0.02) * dayFraction;
  if (rng.chance(discoveryChance)) {
    const undiscovered = state.evidence.filter((entry) => !entry.discovered);
    if (undiscovered.length > 0) rng.pick(undiscovered).discovered = true;
  }

  state.status = statusForHeat(state.heat);
}

/** 0..1 probability that an arrest follows if the player stays put. */
export function arrestRisk(state: InvestigationState): number {
  return Math.max(0, Math.min(1, (state.heat - HEAT_WARRANT) / (HEAT_ARREST - HEAT_WARRANT)));
}

export function isUnderWarrant(state: InvestigationState): boolean {
  return state.status === "warrant" || state.status === "arrested";
}
