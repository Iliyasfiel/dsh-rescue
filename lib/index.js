/**
 * dsh-rescue — cordis plugin entry.
 *
 * The package is dual-form on purpose:
 *
 *  1. CLI (bin/dsh-rescue): the real rescue mechanism. It works OUTSIDE the
 *     plugin stack by editing a profile's `package.json` bundle list, so it
 *     stays usable when the dsh GUI cannot boot at all. This is where all
 *     the actual behavior lives (see ./rescue-core.js).
 *
 *  2. cordis bundle entry (this file): deliberately INERT. Declaring
 *     `dsh.bundle` in package.json is what makes the package installable via
 *     `dsh plugin add <pkg>` and boot-compatible, which in turn is the
 *     ecosystem's precondition for being listed in awesome-dsh-plugin.
 *
 * A rescue plugin that actually ran at boot would be a contradiction: rescue
 * exists precisely because some bundle may crash startup. So this entry does
 * nothing at runtime — no services registered, no side effects, no imports
 * beyond the shared pure-fs core. All public core functions are re-exported
 * here for API consumers; `dsh-rescue` itself only calls them from the CLI.
 */
export {
  MANIFEST_FILENAME,
  STATE_FILENAME,
  BACKUP_FILENAME,
  RescueError,
  resolveDshHome,
  profileDir,
  readManifest,
  splitBundles,
  isRescuing,
  readState,
  enterRescue,
  exitRescue,
  statusOf
} from "./rescue-core.js";

export const name = "dsh-rescue";

/** Inert by design: rescue must never depend on this bundle having loaded. */
export function apply() {
  /* no-op — see the module docblock above */
}
