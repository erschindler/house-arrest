"""Scan an imported pack in the editor and draft a library index for the installer.

Run inside Unreal (it needs the asset registry and loadable assets), either:

    UnrealEditor-Cmd <project>.uproject -run=pythonscript -script="<path>\\scan_pack.py" -unattended

or paste this one line into the Output Log's Python console:

    exec(open(r"C:\\ha10\\house-arrest-main\\scripts\\scan_pack.py").read())

Nothing outside Content/ is touched and no asset is modified: the script reads the
asset registry, loads each mesh to count LODs, and writes one JSON file. Beside it it
writes a .report.txt of everything it found, because the Python commandlet's log filter
hides unreal.log and print() output. Review both before running the pipeline -- the
role guesses are guesses.

Configuration (environment variable, or edit the default below):

    HAS_PACK       content folder to scan, e.g. /Game/Fab/TheForgottenRoom
                   (default: all of /Game except HASContent and Maps)
    HAS_OUT        library file to write (default: C:\\HouseArrest\\library\\forgotten-room.json)
    HAS_PACK_NAME  "pack" value written into the file
"""

import json
import os
import re

import unreal

PACK_FOLDER = os.environ.get("HAS_PACK", "")
OUT_PATH = os.environ.get("HAS_OUT", os.path.join("C:\\HouseArrest", "library", "forgotten-room.json"))
PACK_NAME = os.environ.get("HAS_PACK_NAME", "Fab - The Forgotten Room")

# Folders that are never pack art: the installer's own plugin content and the level.
SKIP_PREFIXES = ("/Game/HASContent", "/Game/Maps")

# tag anchor -> name tokens that suggest it. First anchor in this list wins, so the
# specific words come before the generic ones ("desk lamp" is a lamp, not a desk).
ROLE_RULES = [
    ("HAS.RoomProp.drain", ("drain", "grate", "gutter", "trough")),
    ("HAS.RoomProp.computer", ("monitor", "screen", "computer", "laptop", "crt", "terminal", "pc")),
    ("HAS.RoomProp.phone", ("phone", "telephone", "handset", "rotary")),
    ("HAS.RoomProp.cameraRig", ("camera", "camcorder", "tripod", "recorder")),
    ("HAS.RoomProp.chair", ("chair", "seat", "stool", "gurney")),
    ("HAS.RoomProp.desk", ("desk", "table", "bench", "counter")),
    ("HAS.RoomProp.toolRack", ("shelf", "rack", "cabinet", "pegboard", "toolboard", "tools")),
    ("HAS.RoomProp.light", ("lamp", "light", "bulb", "lantern", "fixture")),
]

TOKEN_SPLIT = re.compile(r"[^a-z0-9]+")


LOG = []


def say(message):
    LOG.append(message)
    unreal.log("HAS: " + message)
    print("HAS: " + message)


def report_path():
    return os.path.splitext(OUT_PATH)[0] + ".report.txt"


def write_report():
    """Write what the scan said, so it is readable even when the log is filtered."""
    directory = os.path.dirname(OUT_PATH)
    if directory and not os.path.isdir(directory):
        os.makedirs(directory)
    with open(report_path(), "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(LOG) + "\n" if LOG else "the scan said nothing\n")


def tokens(*parts):
    found = set()
    for part in parts:
        for token in TOKEN_SPLIT.split(str(part).lower()):
            if token and len(token) > 1:
                found.add(token)
    return sorted(found)


def game_summary(limit=20):
    """(asset count, top-level folders) under /Game, so a wrong HAS_PACK is correctable."""
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    folders = set()
    count = 0
    for asset in registry.get_assets_by_path("/Game", True):
        count += 1
        package = str(asset.package_name)
        if package.startswith("/Game/"):
            folders.add(package.split("/")[2])
    return count, sorted(folders)[:limit]


def scan_roots():
    if PACK_FOLDER:
        return [PACK_FOLDER]
    return ["/Game"]


def mesh_stats(package_path):
    """Return (triangles, lods, triangles_readable) for a static mesh package."""
    mesh = unreal.EditorAssetLibrary.load_asset(package_path)
    if mesh is None:
        return 0, 1, False

    lods = 1
    try:
        lods = int(unreal.EditorStaticMeshLibrary.get_lod_count(mesh))
    except Exception:
        pass

    # The triangle accessor has moved between engine versions, so try the known
    # spellings and take the first that answers; unreadable counts are reported
    # rather than silently written as zero.
    for getter in (
        lambda: unreal.EditorStaticMeshLibrary.get_number_triangles(mesh, 0),
        lambda: unreal.EditorStaticMeshLibrary.get_number_triangles(mesh),
        lambda: mesh.get_num_triangles(0),
    ):
        try:
            value = int(getter())
        except Exception:
            continue
        if value > 0:
            return value, max(1, lods), True
    return 0, max(1, lods), False


CLASS_ATTRS = ("asset_class_path", "asset_class")


def class_text(asset):
    """Class name of a registry asset, however this engine version spells it."""
    for attr in CLASS_ATTRS:
        value = getattr(asset, attr, None)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text.rsplit(".", 1)[-1]
    return ""


def mesh_class_path():
    """TopLevelAssetPath for UStaticMesh, when the engine exposes a constructor."""
    ctor = getattr(unreal, "TopLevelAssetPath", None)
    if ctor is None:
        return None
    for args in (("/Script/Engine", "StaticMesh"), ("/Script/Engine.StaticMesh",)):
        try:
            return ctor(*args)
        except Exception:
            continue
    return None


def registry():
    return unreal.AssetRegistryHelpers.get_asset_registry()


def skipped_by_prefix(package):
    return any(package == prefix or package.startswith(prefix + "/") for prefix in SKIP_PREFIXES)


def static_meshes(roots):
    """Static meshes under the roots as (package, name), plus the class names seen and
    the meshes a SKIP_PREFIX dropped, so a scan that finds nothing can explain itself."""
    found = {}
    classes = {}
    skipped = []
    for root in roots:
        for asset in registry().get_assets_by_path(root, True):
            package = str(asset.package_name)
            label = class_text(asset) or "(no class reported)"
            classes[label] = classes.get(label, 0) + 1
            if "staticmesh" not in label.lower():
                continue
            if skipped_by_prefix(package):
                skipped.append(package)
                continue
            found[package] = str(asset.asset_name)

    # Ask the registry for the class by name, which does not depend on how an asset
    # reports its own class string.
    class_path = mesh_class_path()
    if class_path is not None:
        try:
            for asset in registry().get_assets_by_class(class_path, True):
                package = str(asset.package_name)
                if skipped_by_prefix(package):
                    continue
                if any(package == root or package.startswith(root + "/") for root in roots):
                    found[package] = str(asset.asset_name)
        except Exception as problem:
            say("class query failed, relying on class names: %s" % problem)

    return sorted(found.items()), classes, skipped


def draft_roles(entries):
    """One asset per anchor, in sorted order, so re-running gives the same answer."""
    taken = {}
    for entry in entries:
        name_tokens = set(entry["_tokens"])
        for role, needles in ROLE_RULES:
            if role in taken:
                continue
            if name_tokens & set(needles):
                taken[role] = entry["id"]
                entry["role"] = role
                break
    return taken


def main():
    roots = scan_roots()
    say("scanning %s" % ", ".join(roots))

    entries = []
    unreadable = []
    meshes, classes, skipped = static_meshes(roots)
    say("%d static meshes under %s" % (len(meshes), ", ".join(roots)))
    for package, name in meshes:
        triangles, lods, readable = mesh_stats(package)
        if not readable:
            unreadable.append(package)
        folder_tokens = tokens(package.replace("/Game/", "").replace("/", " "))
        entries.append(
            {
                "id": "%s.%s" % (package, name),
                "name": name,
                "kind": "prop",
                "tags": sorted(set(["fab", "prop"] + folder_tokens + tokens(name))),
                "triangles": triangles,
                "lods": lods,
                "animated": False,
                "license": "unverified",
                "_tokens": tokens(name),
            }
        )

    if not entries:
        say("no static meshes under %s - set HAS_PACK to the folder Fab imported into" % ", ".join(roots))
        count, folders = game_summary()
        if folders:
            say("/Game holds %d assets in: %s" % (count, ", ".join(folders)))
        else:
            say("/Game holds no assets at all - import the pack into the project first")
        if skipped:
            say("%d static meshes were dropped by SKIP_PREFIXES: %s" % (len(skipped), ", ".join(skipped[:5])))
        if classes:
            ranked = sorted(classes.items(), key=lambda item: (-item[1], item[0]))[:12]
            say("classes seen: %s" % ", ".join("%s x%d" % (name, count) for name, count in ranked))
        return 1

    roles = draft_roles(entries)
    assets = [{key: value for key, value in entry.items() if key != "_tokens"} for entry in entries]

    directory = os.path.dirname(OUT_PATH)
    if directory and not os.path.isdir(directory):
        os.makedirs(directory)
    with open(OUT_PATH, "w", encoding="utf-8") as handle:
        json.dump({"pack": PACK_NAME, "assets": assets}, handle, indent=2, sort_keys=True)
        handle.write("\n")

    say("%d meshes drafted into %s" % (len(assets), OUT_PATH))
    for role in sorted(roles):
        say("  %-26s <- %s" % (role, roles[role]))
    missing = [role for role, _ in ROLE_RULES if role not in roles]
    if missing:
        say("no mesh matched: %s (assign these by hand)" % ", ".join(missing))
    if unreadable:
        say("%d meshes reported no triangle count - fill those in before relying on a class budget" % len(unreadable))
        for path in unreadable[:10]:
            say("  ? %s" % path)
    say("review the file, then build: npm.cmd run run -- --library <dir> ...")
    return 0


# Called unconditionally on purpose: -run=pythonscript imports this file as a module
# named after the file, so __name__ is never "__main__" and the usual guard would
# leave the scan silently doing nothing. The report is written on every path and a
# failure raises, so the commandlet cannot report success for a scan that found
# nothing.
try:
    status = main()
except Exception:
    import traceback

    LOG.append("scan failed:\n" + traceback.format_exc())
    write_report()
    unreal.log_error("HAS: scan failed, report: %s\n%s" % (report_path(), traceback.format_exc()))
    raise

write_report()
if status:
    raise RuntimeError("scan finished with status %d, report: %s" % (status, report_path()))
