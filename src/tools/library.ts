/**
 * Asset library index.
 *
 * The installer cannot browse Fab: there is no API key, no licence and no engine
 * here, and inventing one would be worse than useless. What it *can* do is read an
 * exported library index — the JSON you get from a Fab pack manifest, an internal
 * art tracker, or a `Content/` scan exported to JSON — and match it against the
 * requirements. That is the part of "find the right assets" that is deterministic.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AssetKind } from "./requirements.ts";
import { ASSET_KINDS } from "./requirements.ts";

export type LibraryAsset = {
  /** Unreal soft path, e.g. /Game/Fab/PracticalFX/SM_BloodPool_A */
  id: string;
  name: string;
  kind: AssetKind;
  tags: string[];
  triangles: number;
  lods: number;
  animated: boolean;
  license: string;
  pack: string;
};

export type AssetLibrary = {
  assets: LibraryAsset[];
};

export type LibraryFile = {
  pack: string;
  assets: LibraryAsset[];
};

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function parseLibraryFile(text: string, fallbackPack: string): LibraryFile {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const pack = asString(parsed["pack"], fallbackPack);
  const rawAssets = Array.isArray(parsed["assets"]) ? (parsed["assets"] as Record<string, unknown>[]) : [];

  const assets: LibraryAsset[] = rawAssets.map((raw, index) => {
    const kind = asString(raw["kind"]);
    if (!ASSET_KINDS.includes(kind as AssetKind)) {
      throw new Error(`${pack}: asset ${index} has unknown kind "${kind}"`);
    }
    const id = asString(raw["id"]);
    if (!id) throw new Error(`${pack}: asset ${index} is missing an id`);

    return {
      id,
      name: asString(raw["name"], id),
      kind: kind as AssetKind,
      tags: Array.isArray(raw["tags"]) ? (raw["tags"] as unknown[]).map((tag) => asString(tag)).filter(Boolean) : [],
      triangles: asNumber(raw["triangles"]),
      lods: asNumber(raw["lods"], 1),
      animated: asBoolean(raw["animated"]),
      license: asString(raw["license"], "unknown"),
      pack,
    };
  });

  return { pack, assets };
}

/** Directory scan, sorted by filename so the index is reproducible. */
export function loadLibrary(directory: string): AssetLibrary {
  if (!existsSync(directory)) throw new Error(`asset library directory not found: ${directory}`);

  const files = readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort();

  const assets: LibraryAsset[] = [];
  for (const name of files) {
    const text = readFileSync(join(directory, name), "utf8");
    const file = parseLibraryFile(text, name.replace(/\.json$/, ""));
    assets.push(...file.assets);
  }

  return { assets };
}

export function indexById(library: AssetLibrary): Map<string, LibraryAsset> {
  const map = new Map<string, LibraryAsset>();
  for (const asset of library.assets) map.set(asset.id, asset);
  return map;
}
