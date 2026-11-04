/**
 * Kink negotiation (Section 5B).
 *
 * The rule the brief sets is that kink is a negotiated layer on top of consent,
 * never a menu the player selects from. So negotiation produces *counter terms*:
 * the NPC's profile can refuse a category outright, accept it enthusiastically,
 * or accept it weakly with a lower intensity ceiling that rises with trust.
 * The player then either accepts those terms or the scene does not happen.
 */

import type { ContentGate, FetishCategory } from "../content/gate.ts";
import { FETISH_INTENSITY_CAP } from "../content/gate.ts";
import type { Npc } from "./types.ts";

export type KinkInterest = "enthusiastic" | "curious" | "offTheTable" | "blocked";

export type SceneTerms = {
  categories: FetishCategory[];
  intensityCeiling: number;
  safewords: string[];
  conditions: string[];
};

export type Refusal = { category: FetishCategory | "intimacy"; reason: string };

export type NegotiationOutcome = {
  accepted: SceneTerms;
  refusals: Refusal[];
  enthusiastic: FetishCategory[];
  curious: FetishCategory[];
  declined: boolean;
};

export function interestIn(npc: Npc, category: FetishCategory, gate: ContentGate): KinkInterest {
  if (!gate.allows({ kind: "fetish", category, intensity: 0 })) return "blocked";
  if (npc.sexual.hardLimits.includes(category)) return "offTheTable";
  if (npc.sexual.interests.includes(category)) return "enthusiastic";
  if (npc.sexual.curiosities.includes(category)) return "curious";
  return "offTheTable";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * @param trust  0..100 current trust between the participants
 * @param comfort 0..1 the lower of the two participants' baseline comfort
 */
export function negotiateTerms(
  gate: ContentGate,
  a: Npc,
  b: Npc,
  requested: SceneTerms,
  trust: number,
  comfort: number,
): NegotiationOutcome {
  const refusals: Refusal[] = [];
  const enthusiastic: FetishCategory[] = [];
  const curious: FetishCategory[] = [];

  const base: SceneTerms = {
    categories: [],
    intensityCeiling: clamp(Math.round(requested.intensityCeiling), 1, FETISH_INTENSITY_CAP),
    safewords: [],
    conditions: [],
  };

  if (!gate.allows({ kind: "sexual", level: "explicit" })) {
    return {
      accepted: base,
      refusals: [{ category: "intimacy", reason: "explicit content is disabled in content settings" }],
      enthusiastic,
      curious,
      declined: true,
    };
  }

  if (comfort < 0.15 && trust < 30) {
    return {
      accepted: base,
      refusals: [{ category: "intimacy", reason: "not comfortable enough with you yet" }],
      enthusiastic,
      curious,
      declined: true,
    };
  }

  // A trust-derived ceiling is the whole point of the comfort curve: what is
  // available on day one is not what is available after months.
  const trustCeiling = clamp(Math.round(2 + (trust / 100) * (FETISH_INTENSITY_CAP - 2)), 2, FETISH_INTENSITY_CAP);
  let ceiling = Math.min(base.intensityCeiling, trustCeiling);

  for (const category of requested.categories) {
    const aInterest = interestIn(a, category, gate);
    const bInterest = interestIn(b, category, gate);

    if (aInterest === "blocked" || bInterest === "blocked") {
      refusals.push({ category, reason: "disabled in content settings" });
      continue;
    }
    if (aInterest === "offTheTable" || bInterest === "offTheTable") {
      refusals.push({ category, reason: "a hard limit for one of the participants" });
      continue;
    }
    if ((aInterest === "curious" || bInterest === "curious") && trust < 35) {
      refusals.push({ category, reason: "curious, but not with someone they trust this little" });
      continue;
    }
    if (aInterest === "curious" || bInterest === "curious") {
      // Curiosity is not enthusiasm: it lowers the ceiling and it needs aftercare.
      ceiling = Math.min(ceiling, 4);
      curious.push(category);
    } else {
      enthusiastic.push(category);
    }
    base.categories.push(category);
  }

  const safewords = new Set<string>();
  for (const word of requested.safewords) safewords.add(word.toLowerCase());
  safewords.add(a.sexual.safeword.toLowerCase());
  safewords.add(b.sexual.safeword.toLowerCase());

  const conditions: string[] = [];
  if (comfort < 0.4) conditions.push("aftercare required");
  if (ceiling >= 7) conditions.push("check-in before each escalation");
  if (curious.length > 0) conditions.push("curiosity is not the same as wanting it — stop at the first hesitation");

  const accepted: SceneTerms = {
    categories: base.categories,
    intensityCeiling: clamp(Math.min(base.intensityCeiling, ceiling), 1, FETISH_INTENSITY_CAP),
    safewords: [...safewords],
    conditions,
  };

  const wantedSomething = requested.categories.length > 0;
  const declined = wantedSomething && accepted.categories.length === 0;

  return { accepted, refusals, enthusiastic, curious, declined };
}
