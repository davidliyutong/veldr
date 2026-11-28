import { build } from 'esbuild';
import { buildHaptic, buildHelper, clangFound, swiftcFound } from './helper/build.mjs';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.cjs',
  bundle: true,
  minifyWhitespace: true,
  minifySyntax: true,
  platform: 'node',
  target: 'node22',
  external: ['electron'],
});

// Sandboxed preloads may require only a few electron modules, so bundle
// them: the main window's, and the app's other windows' (their frames'
// channels to the hub only).
for (const [entry, out] of [
  ['src/preload.ts', 'dist/preload.cjs'],
  ['src/framePreload.ts', 'dist/frames.cjs'],
]) {
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    minifyWhitespace: true,
    minifySyntax: true,
    platform: 'node',
    target: 'node22',
    external: ['electron'],
  });
}

// macOS: the Secure Enclave helper and the haptic feedback module
// (helper/build.mjs), which the packaged app carries in Contents/Helpers and
// Contents/Resources and the development run finds here. Without swiftc or
// clang the rest still builds, and the app runs without Touch ID unlocks or
// without ticks of the trackpad; electron-builder's beforePack refuses to
// package a Mac app without them.
if (process.platform === 'darwin') {
  if (await swiftcFound()) await buildHelper('dist/helper');
  else console.warn('warning: swiftc not found (Xcode command line tools): the Secure Enclave helper is not built');
  if (await clangFound()) await buildHaptic('dist/helper');
  else console.warn('warning: clang not found (Xcode command line tools): the haptic feedback module is not built');
}
