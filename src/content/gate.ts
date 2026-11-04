/**
 * Content settings and the content gate.
 *
 * Section 2 of the brief requires that *every* system, including the NPC and
 * event engines, respects the toggles so disabled content never generates. That
 * only holds if generation goes through one choke point. This is it.
 *
 * Two distinct things live here:
 *
 *  1. Toggles. Player-controlled, per-save, changeable at runtime. They can only
 *     ever *narrow* what is possible.
 *  2. Hard invariants (see assertHardInvariants below). Not toggles. No setting
 *     expands them: no non-adult in a sexual or violent context, no family
 *     romance, no scene without live consent. The gate reports them as blocked
 *     regardless of settings.
 */

export const FETISH_CATEGORIES = [
  "powerExchange",
  "bondage",
  "roleplayCostume",
  "exhibitionism",
  "sensoryPlay",
  "impactPlay",
  "humiliation",
  "fetishObjects",
  "groupScenes",
  "publicRisk",
  "captivityRoleplay",
] as const;

export type FetishCategory = (typeof FETISH_CATEGORIES)[number];

export const FETISH_LABELS: Record<FetishCategory, string> = {
  powerExchange: "Dominance / submission and power exchange",
  bondage: "Bondage and restraint",
  roleplayCostume: "Roleplay and costuming",
  exhibitionism: "Exhibitionism",
  sensoryPlay: "Sensory play",
  impactPlay: "Impact play",
  humiliation: "Humiliation and degradation",
  fetishObjects: "Fetish objects and clothing",
  groupScenes: "Group scenarios",
  publicRisk: "Public-risk scenarios",
  captivityRoleplay: "Captivity and forbidden-feeling roleplay",
};

export type SexualContent = "off" | "suggestive" | "explicit";
export type ViolenceLevel = "standard" | "graphic" | "extreme";

export type ContentSettings = {
  sexual: SexualContent;
  violence: ViolenceLevel;
  darkThemes: boolean;
  fetishes: Partial<Record<FetishCategory, boolean>>;
};

export type ContentTag =
  | { kind: "sexual"; level: "suggestive" | "explicit" }
  | { kind: "violence"; level: "graphic" | "extreme" }
  | { kind: "dark" }
  | { kind: "fetish"; category: FetishCategory; intensity: number };

export const FETISH_INTENSITY_CAP = 10;

export function createDefaultSettings(): ContentSettings {
  // Everything opt-in. A new save starts at the most conservative legal state.
  return {
    sexual: "off",
    violence: "standard",
    darkThemes: false,
    fetishes: {},
  };
}

const SEXUAL_RANK: Record<SexualContent, number> = { off: 0, suggestive: 1, explicit: 2 };
const VIOLENCE_RANK: Record<ViolenceLevel, number> = { standard: 0, graphic: 1, extreme: 2 };

export function normalizeSettings(partial: Partial<ContentSettings> | undefined): ContentSettings {
  const base = createDefaultSettings();
  if (!partial) return base;
  const settings: ContentSettings = {
    sexual: partial.sexual ?? base.sexual,
    violence: partial.violence ?? base.violence,
    darkThemes: partial.darkThemes ?? base.darkThemes,
    fetishes: { ...base.fetishes, ...(partial.fetishes ?? {}) },
  };
  assertSettingsValid(settings);
  return settings;
}

export function assertSettingsValid(settings: ContentSettings): void {
  if (!(settings.sexual in SEXUAL_RANK)) throw new Error(`invalid sexual setting: ${settings.sexual}`);
  if (!(settings.violence in VIOLENCE_RANK)) throw new Error(`invalid violence setting: ${settings.violence}`);
  for (const category of Object.keys(settings.fetishes) as FetishCategory[]) {
    if (!FETISH_CATEGORIES.includes(category)) throw new Error(`unknown fetish category: ${category}`);
  }
}

export class ContentGate {
  private current: ContentSettings;

  constructor(settings?: Partial<ContentSettings>) {
    this.current = normalizeSettings(settings);
  }

  get settings(): ContentSettings {
    return this.current;
  }

  /** Replace settings mid-session. Live scenes re-check on every tick. */
  setSettings(next: Partial<ContentSettings>): ContentSettings {
    this.current = normalizeSettings({ ...this.current, ...next, fetishes: { ...this.current.fetishes, ...(next.fetishes ?? {}) } });
    return this.current;
  }

  setFetish(category: FetishCategory, enabled: boolean): void {
    this.current = normalizeSettings({ ...this.current, fetishes: { ...this.current.fetishes, [category]: enabled } });
  }

  sexualRank(): number {
    return SEXUAL_RANK[this.current.sexual];
  }

  violenceRank(): number {
    return VIOLENCE_RANK[this.current.violence];
  }

  allows(tag: ContentTag): boolean {
    switch (tag.kind) {
      case "sexual":
        return tag.level === "suggestive" ? this.sexualRank() >= 1 : this.sexualRank() >= 2;
      case "violence":
        return this.violenceRank() >= VIOLENCE_RANK[tag.level];
      case "dark":
        return this.current.darkThemes;
      case "fetish":
        // Kink is a layer on top of explicit content: it can never be reached
        // while the sexual toggle is lower, whatever the per-category toggles say.
        return (
          this.sexualRank() >= 2 &&
          this.current.fetishes[tag.category] === true &&
          tag.intensity <= FETISH_INTENSITY_CAP
        );
      default:
        return false;
    }
  }

  /** Convenience for the many places that only care whether intimacy is possible at all. */
  get intimacyPossible(): boolean {
    return this.sexualRank() >= 2;
  }

  describe(): string {
    const fetishes = FETISH_CATEGORIES.filter((c) => this.current.fetishes[c] === true).map((c) => FETISH_LABELS[c]);
    return [
      `sexual: ${this.current.sexual}`,
      `violence: ${this.current.violence}`,
      `dark themes: ${this.current.darkThemes ? "on" : "off"}`,
      `kink categories: ${fetishes.length === 0 ? "none" : fetishes.join(", ")}`,
    ].join(" | ");
  }
}

/**
 * Hard invariants. These are not content settings and no configuration can
 * enable them. Section 18 items 2, 3, 4 and 5 rest on this function.
 */
export type ParticipantContext = "sexual" | "violent";

export type InvariantSubject = {
  id: string;
  age: number;
  isMinor: boolean;
  isFamilyOfPlayer?: boolean;
};

export class HardBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HardBlockError";
  }
}

export function assertHardInvariants(subject: InvariantSubject, context: ParticipantContext): void {
  if (subject.isMinor || subject.age < 18) {
    throw new HardBlockError(`${subject.id} is not an adult; hard-blocked from any ${context} context (18.2)`);
  }
  if (context === "sexual" && subject.isFamilyOfPlayer) {
    throw new HardBlockError(`${subject.id} is family; family relationships are never romantic or sexual (18.4)`);
  }
}
