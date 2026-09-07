#!/usr/bin/env node
/**
 * dsh-rescue CLI — rescue mode for DeepSeek Harness profiles.
 *
 *   dsh-rescue enter  <profile>   quarantine all third-party plugins (pure core boot)
 *   dsh-rescue exit   <profile>   restore the original plugin stack
 *   dsh-rescue status <profile>   show rescue state and the core/third-party split
 *   dsh-rescue help               show this help
 *
 * Works from a plain terminal against $DSH_HOME (default ~/.dsh) even when
 * the dsh GUI itself can no longer start.
 */
import { resolveDshHome, profileDir, enterRescue, exitRescue, statusOf, RescueError } from "../lib/rescue-core.js";

const USAGE = `dsh-rescue — boot DeepSeek Harness on a pure core when plugins break startup

Usage:
  dsh-rescue enter  <profile>   Temporarily disable ALL third-party plugins of the
                                profile by stripping its dsh.profile.bundles down to
                                the in-box core layers (dependencies are kept, so
                                leaving rescue mode is instant and offline).
  dsh-rescue exit   <profile>   Restore the original bundle list from the state file
                                and delete rescue artifacts.
  dsh-rescue status <profile>   Show whether the profile is in rescue mode and list
                                which bundles are core vs third-party (read-only).
  dsh-rescue help               Show this help.

Profiles live under $DSH_HOME/profiles (DSH_HOME defaults to ~/.dsh).
The default dsh web GUI profile is called "web".

Typical rescue workflow:
  1. dsh-rescue enter web            # profile now boots WITHOUT third-party plugins
  2. dsh web                         # pure boot succeeds; repair in the GUI/CLI,
                                     # e.g.  dsh plugin --profile web remove <pkg>
  3. dsh-rescue exit web             # restore the plugin stack
  4. dsh web                         # normal boot again
`;

function fail(message) {
  process.stderr.write(`dsh-rescue: ${message}\n`);
  process.exitCode = 1;
}

function main(argv) {
  const [command, profileArg] = argv;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return;
  }
  if (profileArg === undefined || profileArg.startsWith("-")) {
    fail(`expected a profile name after "${command}"`);
    return;
  }
  const home = resolveDshHome();
  const dir = profileDir(home, profileArg);

  try {
    if (command === "enter") {
      const { core, thirdParty } = enterRescue(dir);
      process.stdout.write(
        `dsh-rescue: rescue mode ON for profile "${profileArg}" (${dir})\n` +
        `  kept    core layers (${core.length}): ${core.join(", ") || "(none)"}\n` +
        `  parked  third-party plugins (${thirdParty.length}): ${thirdParty.join(", ")}\n` +
        `\n` +
        `Next steps:\n` +
        `  1. boot the pure profile:        dsh --profile ${profileArg}\n` +
        `  2. repair inside it, e.g.        dsh plugin --profile ${profileArg} remove <conflicting-plugin>\n` +
        `  3. leave rescue mode:            dsh-rescue exit ${profileArg}\n`
      );
    } else if (command === "exit") {
      const { restoredBundles } = exitRescue(dir);
      process.stdout.write(
        `dsh-rescue: rescue mode OFF for profile "${profileArg}" — restored ${restoredBundles.length} bundle(s):\n` +
        `  ${restoredBundles.join(", ")}\n` +
        `Restart the profile to apply:  dsh --profile ${profileArg}\n`
      );
    } else if (command === "status") {
      const info = statusOf(dir);
      if (!info.exists) {
        process.stdout.write(`dsh-rescue: profile directory not found: ${dir}\n`);
        process.exitCode = 2;
        return;
      }
      const state = info.inRescue ? "RESCUE MODE (third-party plugins disabled)" : "normal";
      process.stdout.write(
        `dsh-rescue: profile "${profileArg}" @ ${dir}\n` +
        `  state:       ${state}${info.enteredAt ? ` (entered ${info.enteredAt})` : ""}\n` +
        `  core layers: ${info.core.length}  ${info.core.join(", ") || "(unreadable manifest)"}\n` +
        `  third-party: ${info.thirdParty.length}  ${info.thirdParty.join(", ") || "(none)"}\n`
      );
    } else {
      fail(`unknown command "${command}" (expected enter | exit | status | help)`);
    }
  } catch (error) {
    if (error instanceof RescueError) fail(error.message);
    else fail(`unexpected error: ${error?.stack ?? error}`);
  }
}

main(process.argv.slice(2));
