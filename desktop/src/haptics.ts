// The trackpad's haptic feedback on macOS: a tick for each step of a swipe
// through the sidebar's tools or the tabs (web/src/swipe.ts), which the page
// asks for without arguments (DesktopShell.haptic). AppKit's
// NSHapticFeedbackManager is called in the shell's own process, the app in
// front, through a Node-API module of a few lines (helper/haptic.m) that
// helper/build.mjs builds beside the Secure Enclave helper: the packaged
// app carries it in Contents/Resources, an unpackaged run finds it in
// desktop/dist/helper. It is loaded at the first tick, by its absolute path
// inside the app; without it (another system, a build without the Xcode
// command line tools) nothing is felt. Ticks closer than MIN_GAP_MS are
// dropped, so a page cannot keep the trackpad buzzing.
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** The module's file name. */
export const HAPTIC_MODULE = 'haptic.node';
/** The least time between two ticks. */
export const MIN_GAP_MS = 15;

/** The module's path: in the packaged app's Contents/Resources, or where
 * desktop/build.mjs puts it for unpackaged development. */
export function hapticPath(resources: string | undefined, appPath: string): string {
  return resources ? join(resources, HAPTIC_MODULE) : join(appPath, 'dist', 'helper', HAPTIC_MODULE);
}

type DLOpen = (module: { exports: unknown }, filename: string) => void;

/** Loads the module at file (an absolute path); its tick, or undefined when
 * it is missing, does not load or exports no function. */
export function loadHaptic(file: string, dlopen: DLOpen = process.dlopen as DLOpen): (() => void) | undefined {
  if (!isAbsolute(file) || !existsSync(file)) return undefined;
  const module = { exports: {} as unknown };
  try {
    dlopen(module, file);
  } catch {
    return undefined;
  }
  return typeof module.exports === 'function' ? (module.exports as () => void) : undefined;
}

export interface Haptics {
  /** One tick, when the last was at least MIN_GAP_MS ago. */
  tick(): void;
}

/** Ticks with the function load gives, called once at the first tick; a
 * tick that throws turns them off. */
export function hapticsFor(load: () => (() => void) | undefined, now: () => number = Date.now): Haptics {
  let fn: (() => void) | undefined;
  let loaded = false;
  let last = -Infinity;
  return {
    tick() {
      const t = now();
      if (t - last < MIN_GAP_MS) return;
      last = t;
      if (!loaded) {
        loaded = true;
        fn = load();
      }
      try {
        fn?.();
      } catch {
        fn = undefined;
      }
    },
  };
}
