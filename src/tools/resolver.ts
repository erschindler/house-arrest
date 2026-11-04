/**
 * Resolver: match library assets to content classes, under the content gate.
 *
 * Three outcomes per class, and the distinction matters:
 *
 *   resolved    an asset satisfies the requirement and the current settings allow it
 *   gated       art may exist, but the content setting forbids showing it
 *   unresolved  the content setting allows it and we have nothing to show
 *
 * Only "unresolved" is blocking. Conflating it with "gated" is how teams end up
 * buying gore packs they can never ship, or shipping a class with a placeholder.
 */

import type { ContentGate, ContentSettings, ContentTag } from "../content/gate.ts";
import type { AssetClass } from "../content/presentation.ts";
import { requirementFor } from "../content/presentation.ts";
import type { AssetLibrary, LibraryAsset } from "./library.ts";
import type { AssetSpec } from "./requirements.ts";
import { allSpecs, specFor } from "./requirements.ts";

export type ResolutionStatus = "resolved" | "unresolved" | "gated";

export type Rejection = { asset: LibraryAsset; reason: string };

export type ClassResolution = {
  assetClass: AssetClass;
  status: ResolutionStatus;
  primary: LibraryAsset | null;
  fallbacks: LibraryAsset[];
  rejected: Rejection[];
  /** Which content requirements are switched off, when status is "gated". */
  missingContent: string[];
};

export type InstallTotals = {
  classes: number;
  resolved: number;
  unresolved: number;
  gated: number;
};

export type InstallReport = {
  schemaVersion: number;
  contentSettings: ContentSettings;
  totals: InstallTotals;
  resolutions: ClassResolution[];
  blocking: string[];
};

export function formatTag(tag: ContentTag): string {
  switch (tag.kind) {
    case "sexual":
      return `sexual:${tag.level}`;
    case "nudity":
      return `nudity:${tag.level}`;
    case "violence":
      return `violence:${tag.level}`;
    case "dark":
      return "darkThemes";
    case "fetish":
      return `fetish:${tag.category}`;
    default:
      return "unknown";
  }
}

function haystack(asset: LibraryAsset): string {
  return `${asset.name} ${asset.id} ${asset.tags.join(" ")}`.toLowerCase();
}

function scoreKeywords(spec: AssetSpec, asset: LibraryAsset): number {
  const text = haystack(asset);
  return spec.keywords.filter((keyword) => text.includes(keyword.toLowerCase())).length;
}

/**
 * Candidate selection is deterministic: score first, then LOD richness, then id.
 * Two runs over the same library always pick the same asset.
 */
export function resolveClass(spec: AssetSpec, library: AssetLibrary): { primary: LibraryAsset | null; fallbacks: LibraryAsset[]; rejected: Rejection[] } {
  const rejected: Rejection[] = [];
  const candidates: { asset: LibraryAsset; score: number }[] = [];

  for (const asset of library.assets) {
    if (asset.kind !== spec.kind) {
      rejected.push({ asset, reason: `kind mismatch (needs ${spec.kind}, found ${asset.kind})` });
      continue;
    }
    if (spec.requiresLods && asset.lods < 2) {
      rejected.push({ asset, reason: `needs at least 2 LODs, has ${asset.lods}` });
      continue;
    }
    if (asset.triangles > spec.maxTriangles) {
      rejected.push({ asset, reason: `over triangle budget (${asset.triangles} > ${spec.maxTriangles})` });
      continue;
    }
    if (spec.animated && !asset.animated) {
      rejected.push({ asset, reason: "needs an animation, asset is static" });
      continue;
    }

    const score = scoreKeywords(spec, asset);
    if (score === 0) {
      rejected.push({ asset, reason: "no keyword match" });
      continue;
    }
    candidates.push({ asset, score });
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.asset.lods !== a.asset.lods) return b.asset.lods - a.asset.lods;
    return a.asset.id < b.asset.id ? -1 : a.asset.id > b.asset.id ? 1 : 0;
  });

  return {
    primary: candidates.length > 0 ? candidates[0].asset : null,
    fallbacks: candidates.slice(1, 4).map((entry) => entry.asset),
    rejected,
  };
}

export function resolveAssets(gate: ContentGate, library: AssetLibrary): ClassResolution[] {
  const resolutions: ClassResolution[] = [];

  for (const spec of allSpecs()) {
    const requirement = requirementFor(spec.assetClass);
    const missingContent = (requirement?.requires ?? []).filter((tag) => !gate.allows(tag)).map(formatTag);

    if (missingContent.length > 0) {
      resolutions.push({
        assetClass: spec.assetClass,
        status: "gated",
        primary: null,
        fallbacks: [],
        rejected: [],
        missingContent,
      });
      continue;
    }

    const match = resolveClass(spec, library);
    resolutions.push({
      assetClass: spec.assetClass,
      status: match.primary ? "resolved" : "unresolved",
      primary: match.primary,
      fallbacks: match.fallbacks,
      rejected: match.rejected,
      missingContent: [],
    });
  }

  return resolutions;
}

export function buildReport(gate: ContentGate, library: AssetLibrary): InstallReport {
  const resolutions = resolveAssets(gate, library);
  const totals: InstallTotals = {
    classes: resolutions.length,
    resolved: resolutions.filter((entry) => entry.status === "resolved").length,
    unresolved: resolutions.filter((entry) => entry.status === "unresolved").length,
    gated: resolutions.filter((entry) => entry.status === "gated").length,
  };

  const blocking = resolutions
    .filter((entry) => entry.status === "unresolved")
    .map((entry) => `${entry.assetClass} — no asset satisfies the requirement; search: ${specFor(entry.assetClass).searchTerms[0]}`);

  return {
    schemaVersion: 1,
    contentSettings: gate.settings,
    totals,
    resolutions,
    blocking,
  };
}
