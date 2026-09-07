/**
 * Unit + integration tests for dsh-rescue against throwaway profile
 * directories under the OS temp dir. Never touches a real profile.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  RescueError,
  resolveDshHome,
  profileDir,
  readManifest,
  splitBundles,
  isRescuing,
  readState,
  enterRescue,
  exitRescue,
  statusOf,
  STATE_FILENAME,
  BACKUP_FILENAME,
  MANIFEST_FILENAME
} from "../lib/rescue-core.js";

/** Mirrors the shape of the real dsh "web" profile (in-box core NOT in dependencies). */
const ORIGINAL = {
  name: "dsh-profile-web",
  private: true,
  dependencies: {
    "dshmarket": "^1.45.0",
    "@wenaixi/dsh-superpower": "6.3.1",
    "dsh-better-sidebar": "^0.18.0",
    "dsh-mnemon": "^0.5.5"
  },
  dsh: {
    profile: {
      bundles: [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dshmarket",
        "@wenaixi/dsh-superpower",
        "dsh-better-sidebar",
        "dsh-mnemon"
      ]
    }
  }
};

function writeManifest(dir, manifest) {
  writeFileSync(join(dir, MANIFEST_FILENAME), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function makeProfile(t) {
  const dir = mkdtempSync(join(tmpdir(), "dsh-rescue-test-"));
  writeManifest(dir, structuredClone(ORIGINAL));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("resolveDshHome honors DSH_HOME and falls back to ~/.dsh", () => {
  assert.equal(resolveDshHome({ DSH_HOME: "C:/custom/home" }), "C:/custom/home");
  const noEnv = resolveDshHome({});
  assert.ok(noEnv.endsWith(join(".dsh")));
});

test("profileDir builds $DSH_HOME/profiles/<name> and rejects empty names", () => {
  assert.equal(profileDir("H", "web"), join("H", "profiles", "web"));
  assert.throws(() => profileDir("H", "  "), RescueError);
});

test("splitBundles separates in-box core from third-party", (t) => {
  const dir = makeProfile(t);
  const { manifest } = readManifest(dir);
  const { core, thirdParty } = splitBundles(manifest);
  assert.deepEqual(core, ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]);
  assert.deepEqual(thirdParty, ["dshmarket", "@wenaixi/dsh-superpower", "dsh-better-sidebar", "dsh-mnemon"]);
});

test("splitBundles throws when the manifest carries no bundles array", () => {
  assert.throws(() => splitBundles({ name: "x" }), RescueError);
  assert.throws(() => splitBundles({ dsh: { profile: {} } }), RescueError);
});

test("enterRescue parks third-party bundles and keeps dependencies + other keys", (t) => {
  const dir = makeProfile(t);
  const { core, thirdParty } = enterRescue(dir);

  assert.deepEqual(thirdParty, ["dshmarket", "@wenaixi/dsh-superpower", "dsh-better-sidebar", "dsh-mnemon"]);
  const { manifest } = readManifest(dir);
  assert.deepEqual(manifest.dsh.profile.bundles, core); // only core layers remain
  assert.deepEqual(manifest.dependencies, ORIGINAL.dependencies); // untouched
  assert.equal(manifest.name, ORIGINAL.name); // other keys preserved
  assert.equal(manifest.private, true);

  // State + verbatim backup exist, and the manifest parses back to valid JSON.
  assert.ok(existsSync(join(dir, STATE_FILENAME)));
  assert.ok(existsSync(join(dir, BACKUP_FILENAME)));
  assert.ok(isRescuing(dir));
  const state = readState(dir);
  assert.deepEqual(state.bundles, ORIGINAL.dsh.profile.bundles);
  assert.deepEqual(state.dependencies, ORIGINAL.dependencies);
  assert.ok(state.enteredAt);
});

test("enterRescue refuses a second run while rescue is active", (t) => {
  const dir = makeProfile(t);
  enterRescue(dir);
  assert.throws(() => enterRescue(dir), /already in rescue mode/);
});

test("enterRescue fails cleanly on a missing profile directory", () => {
  assert.throws(() => enterRescue(join(tmpdir(), "no-such-profile-dir")), /profile directory not found/);
});

test("enterRescue refuses a profile with no third-party bundles", (t) => {
  const dir = makeProfile(t);
  writeManifest(dir, {
    name: "pure",
    dependencies: {},
    dsh: { profile: { bundles: ["@deepseek-ai/dsh-base"] } }
  });
  assert.throws(() => enterRescue(dir), /no third-party bundles to disable/);
  assert.ok(!existsSync(join(dir, STATE_FILENAME))); // nothing left behind
});

test("exitRescue restores the exact original bundle list and removes artifacts", (t) => {
  const dir = makeProfile(t);
  enterRescue(dir);
  const { restoredBundles } = exitRescue(dir);
  assert.deepEqual(restoredBundles, ORIGINAL.dsh.profile.bundles);

  const { manifest } = readManifest(dir);
  assert.deepEqual(manifest, ORIGINAL); // byte-for-byte semantic equality
  assert.ok(!existsSync(join(dir, STATE_FILENAME)));
  assert.ok(!existsSync(join(dir, BACKUP_FILENAME)));
  assert.ok(!isRescuing(dir));
});

test("exitRescue without a state file fails with a clear message", (t) => {
  const dir = makeProfile(t);
  assert.throws(() => exitRescue(dir), /not in rescue mode/);
});

test("statusOf reports normal, rescue and missing-profile states", (t) => {
  const dir = makeProfile(t);
  assert.equal(statusOf(dir).inRescue, false);
  assert.deepEqual(statusOf(dir).thirdParty, ["dshmarket", "@wenaixi/dsh-superpower", "dsh-better-sidebar", "dsh-mnemon"]);

  enterRescue(dir);
  const rescuing = statusOf(dir);
  assert.equal(rescuing.inRescue, true);
  assert.ok(rescuing.enteredAt);
  assert.deepEqual(rescuing.thirdParty, []); // in rescue there is nothing third-party left in bundles

  const missing = statusOf(join(tmpdir(), "ghost-profile"));
  assert.equal(missing.exists, false);
  assert.equal(missing.inRescue, false);
});

test("roundtrip: plugin removed while in rescue stays removed after exit", (t) => {
  const dir = makeProfile(t);
  enterRescue(dir);

  // Simulate repair inside rescue mode: `dsh plugin --profile web remove
  // dsh-better-sidebar` drops the dependency (pnpm) and reconcile drops the
  // bundle entry.
  const { manifest: repaired } = readManifest(dir);
  delete repaired.dependencies["dsh-better-sidebar"];
  repaired.dsh.profile.bundles = repaired.dsh.profile.bundles.filter((b) => b !== "dsh-better-sidebar");
  writeManifest(dir, repaired);

  // Exit reconciles: in-box core returns, the still-installed third-party
  // bundles return in original order, the removed plugin stays removed — and
  // dependencies are left exactly as the user left them.
  const { restoredBundles } = exitRescue(dir);
  assert.deepEqual(restoredBundles, [
    "@deepseek-ai/dsh-base",
    "@deepseek-ai/dsh-web-app",
    "dshmarket",
    "@wenaixi/dsh-superpower",
    "dsh-mnemon"
  ]);

  const { manifest } = readManifest(dir);
  const expected = structuredClone(ORIGINAL);
  delete expected.dependencies["dsh-better-sidebar"];
  expected.dsh.profile.bundles = expected.dsh.profile.bundles.filter((b) => b !== "dsh-better-sidebar");
  assert.deepEqual(manifest, expected);
});

test("leave no stray files behind across enter/exit", (t) => {
  const dir = makeProfile(t);
  const before = readdirSync(dir).sort();
  enterRescue(dir);
  exitRescue(dir);
  const after = readdirSync(dir).sort();
  assert.deepEqual(after, before);
});

test("exit drops the default patchReload 'live' that a dsh boot wrote during rescue", (t) => {
  const dir = makeProfile(t);
  enterRescue(dir);

  // A dsh boot while in rescue (normalizeShippedProfile) can append the
  // default `patchReload: "live"` to the manifest. Simulate that write.
  const { manifest: duringBoot } = readManifest(dir);
  duringBoot.dsh.profile.patchReload = "live";
  writeManifest(dir, duringBoot);

  exitRescue(dir);
  const { manifest } = readManifest(dir);
  assert.deepEqual(manifest, ORIGINAL); // auto-written default removed, round-trip clean
});

test("exit keeps a user-chosen patchReload set during rescue", (t) => {
  const dir = makeProfile(t);
  enterRescue(dir);

  // User deliberately opts into "startup" reload while rescuing.
  const { manifest: duringBoot } = readManifest(dir);
  duringBoot.dsh.profile.patchReload = "startup";
  writeManifest(dir, duringBoot);

  exitRescue(dir);
  const { manifest } = readManifest(dir);
  assert.equal(manifest.dsh.profile.patchReload, "startup");
  assert.deepEqual(manifest.dsh.profile.bundles, ORIGINAL.dsh.profile.bundles);
});

test("package.json declares an installable dsh.bundle pointing at a real patch file", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.dsh?.bundle?.patch, "./cordis.patch.yml");
  assert.ok(existsSync(new URL(`../${pkg.dsh.bundle.patch}`, import.meta.url)));
});

test("cordis entry is inert but plugin-shaped (name + apply) and re-exports the core API", async () => {
  const entry = await import("../lib/index.js");
  assert.equal(entry.name, "dsh-rescue");
  assert.equal(typeof entry.apply, "function");
  assert.equal(typeof entry.enterRescue, "function");
  assert.equal(typeof entry.exitRescue, "function");
  assert.equal(typeof entry.statusOf, "function");
  assert.equal(entry.STATE_FILENAME, ".dsh-rescue.json");
  // Importing the entry must have no side effects worth testing here beyond
  // being importable in a plain Node process (no @deepseek-ai imports).
  assert.equal(entry.apply(), undefined);
});
