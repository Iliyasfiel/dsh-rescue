/**
 * dsh-rescue core — rescue mode for a DeepSeek Harness profile.
 *
 * How dsh profiles work (apps/cli launcher, `dsh` package):
 *  - A profile lives at `$DSH_HOME/profiles/<name>/` and its `package.json`
 *    lists plugin packages under `dependencies` and their load order under
 *    `dsh.profile.bundles`.
 *  - At boot the launcher composes ONE patch stack from every entry in
 *    `bundles` (in-box core layers such as `@deepseek-ai/dsh-base` and
 *    third-party bundles alike) and boots fail-loud: one broken bundle = the
 *    whole profile refuses to start.
 *  - In-box core bundles are NOT listed in `dependencies` (they resolve from
 *    the dsh installation itself), while every third-party bundle installed
 *    via `dsh plugin --profile <name> add <pkg>` lands in `dependencies`.
 *
 * Therefore "pure boot" = rewrite `dsh.profile.bundles` to keep only entries
 * that are not dependencies. This module performs that rewrite transactionally
 * (backup → state → manifest) without touching `dependencies`, so leaving
 * rescue mode is an instant, offline restore of the original bundle list.
 *
 * Everything here is plain Node, no dependencies, no network — it works even
 * when the dsh GUI can no longer boot at all.
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

/** Files the tool owns inside a profile directory. */
export const MANIFEST_FILENAME = "package.json";
export const STATE_FILENAME = ".dsh-rescue.json";
export const BACKUP_FILENAME = "package.json.dsh-rescue.bak";

/** Error type whose message is safe to show to the user directly. */
export class RescueError extends Error {
  constructor(message) {
    super(message);
    this.name = "RescueError";
  }
}

/** Resolve $DSH_HOME the same way dsh does: env var, else ~/.dsh. */
export function resolveDshHome(env = process.env) {
  return env.DSH_HOME || join(os.homedir(), ".dsh");
}

/** Absolute directory of a named profile. */
export function profileDir(home, name) {
  if (typeof name !== "string" || name.trim() === "") {
    throw new RescueError("missing profile name (usage: dsh-rescue <enter|exit|status> <profile>)");
  }
  return join(home, "profiles", name.trim());
}

/** Read and JSON-parse a profile manifest. Throws RescueError on any problem. */
export function readManifest(dir) {
  const path = join(dir, MANIFEST_FILENAME);
  if (!existsSync(path)) {
    throw new RescueError(`not a dsh profile: ${dir} (no ${MANIFEST_FILENAME})`);
  }
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new RescueError(`cannot read ${path}: ${error.message}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    throw new RescueError(`cannot parse ${path}: ${error.message}`);
  }
  return { manifest, raw, path };
}

/**
 * Split a manifest's bundle list into core (in-box, not in `dependencies`)
 * and third-party (in `dependencies`). Throws when the manifest carries no
 * usable `dsh.profile.bundles` array.
 */
export function splitBundles(manifest) {
  const bundles = manifest?.dsh?.profile?.bundles;
  if (!Array.isArray(bundles)) {
    throw new RescueError("manifest has no dsh.profile.bundles array — not a plugin-carrying profile");
  }
  const deps = new Set(Object.keys(manifest?.dependencies ?? {}));
  const core = bundles.filter((bundle) => !deps.has(bundle));
  const thirdParty = bundles.filter((bundle) => deps.has(bundle));
  return { bundles, core, thirdParty };
}

/** True when the profile is currently under rescue (state file present). */
export function isRescuing(dir) {
  return existsSync(statePathOf(dir));
}

/** Read the rescue state file, or null when absent/corrupt. */
export function readState(dir) {
  const path = statePathOf(dir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function statePathOf(dir) {
  return join(dir, STATE_FILENAME);
}

function backupPathOf(dir) {
  return join(dir, BACKUP_FILENAME);
}

/**
 * Enter rescue mode: quarantine every third-party bundle.
 * @returns {{ core: string[], thirdParty: string[] }}
 */
export function enterRescue(dir) {
  if (!existsSync(dir)) {
    throw new RescueError(`profile directory not found: ${dir}`);
  }
  if (readState(dir)) {
    throw new RescueError("already in rescue mode — run `dsh-rescue exit <profile>` first");
  }
  const { manifest, raw } = readManifest(dir);
  const { core, thirdParty } = splitBundles(manifest);
  if (core.length === 0) {
    throw new RescueError("no in-box core bundle identified — refusing to disable every layer");
  }
  if (thirdParty.length === 0) {
    throw new RescueError("no third-party bundles to disable — this profile is already pure");
  }
  // 1. Safety net: verbatim copy of the untouched manifest.
  copyFileSync(join(dir, MANIFEST_FILENAME), backupPathOf(dir));
  // 2. State used by `exit` to restore exactly the original list. The
  //    dependency snapshot lets exit reconcile: a third-party plugin removed
  //    (via `dsh plugin remove`) while rescue was active stays removed. The
  //    patchReload marker lets exit drop the default `patchReload: "live"`
  //    that a dsh boot during rescue may auto-write into the manifest
  //    (normalizeShippedProfile), keeping the round-trip clean.
  const originalProfile = manifest.dsh?.profile ?? {};
  writeJson(statePathOf(dir), {
    version: 1,
    enteredAt: new Date().toISOString(),
    bundles: originalProfile.bundles,
    dependencies: manifest.dependencies ?? {},
    patchReload: originalProfile.patchReload ?? null
  });
  // 3. Rewrite the manifest with only core layers. Dependencies stay intact,
  //    so leaving rescue mode needs no pnpm step and no network.
  const rescued = {
    ...manifest,
    dsh: {
      ...manifest.dsh,
      profile: { ...manifest.dsh.profile, bundles: core }
    }
  };
  try {
    writeJson(join(dir, MANIFEST_FILENAME), rescued);
  } catch (error) {
    try {
      writeFileSync(join(dir, MANIFEST_FILENAME), raw, "utf8");
    } catch {
      /* best-effort rollback */
    }
    try {
      rmSync(statePathOf(dir), { force: true });
      rmSync(backupPathOf(dir), { force: true });
    } catch {
      /* best-effort rollback */
    }
    throw new RescueError(`failed to write rescue manifest: ${error.message} (rolled back)`);
  }
  return { core, thirdParty };
}

/**
 * Leave rescue mode: restore the original bundle list recorded in the state
 * file and delete the tool's own files.
 *
 * Restoration is *reconciled*, not blind: every original in-box core bundle
 * returns, and every original third-party bundle returns only while its
 * package is still present in `dependencies` — so a plugin the user removed
 * (e.g. `dsh plugin --profile <name> remove <pkg>`) while in rescue mode
 * stays removed instead of being resurrected into an unresolvable layer.
 * @returns {{ restoredBundles: string[] }}
 */
export function exitRescue(dir) {
  const state = readState(dir);
  if (!state || !Array.isArray(state.bundles)) {
    throw new RescueError("not in rescue mode — no usable state file found");
  }
  const originalDeps = state.dependencies ?? {};
  const { manifest } = readManifest(dir);
  const currentDeps = Object.keys(manifest.dependencies ?? {});
  const stillInstalled = new Set(currentDeps);
  const restoredBundles = state.bundles.filter(
    (bundle) => !(bundle in originalDeps) || stillInstalled.has(bundle)
  );
  const profile = { ...manifest.dsh.profile, bundles: restoredBundles };
  // Drop the default `patchReload: "live"` only when the original manifest
  // had none and dsh itself wrote the default during a rescue-mode boot.
  // Any other (user-chosen) value survives.
  if (state.patchReload === null && profile.patchReload === "live") delete profile.patchReload;
  const restored = {
    ...manifest,
    dsh: {
      ...manifest.dsh,
      profile
    }
  };
  writeJson(join(dir, MANIFEST_FILENAME), restored);
  rmSync(statePathOf(dir), { force: true });
  rmSync(backupPathOf(dir), { force: true });
  return { restoredBundles };
}

/** Read-only snapshot used by `status`. Never throws for missing/broken state. */
export function statusOf(dir) {
  const exists = existsSync(dir);
  const state = readState(dir);
  const info = { dir, exists, inRescue: Boolean(state), enteredAt: state?.enteredAt ?? null, core: [], thirdParty: [] };
  if (!exists) return info;
  try {
    const { manifest } = readManifest(dir);
    const { core, thirdParty } = splitBundles(manifest);
    info.core = core;
    info.thirdParty = thirdParty;
  } catch {
    // Broken manifest: keep dir/exists/inRescue, leave lists empty.
  }
  return info;
}
