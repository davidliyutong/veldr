import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HAPTIC_MODULE, hapticPath, hapticsFor, loadHaptic, MIN_GAP_MS } from './haptics';

test("the module is the packaged app's Contents/Resources, or desktop/dist/helper unpackaged", () => {
  assert.equal(hapticPath('/A.app/Contents/Resources', '/A.app/Contents/Resources/app.asar'), `/A.app/Contents/Resources/${HAPTIC_MODULE}`);
  assert.equal(hapticPath(undefined, '/src/desktop'), `/src/desktop/dist/helper/${HAPTIC_MODULE}`);
});

test('loading takes only an absolute path to a file there, whose exports are a function', () => {
  const dir = mkdtempSync(join(tmpdir(), 'haptics-'));
  try {
    const file = join(dir, HAPTIC_MODULE);
    const fn = () => {};
    const opened: string[] = [];
    const dlopen = (exports: unknown) => (module: { exports: unknown }, filename: string) => {
      opened.push(filename);
      module.exports = exports;
    };
    assert.equal(loadHaptic(file, dlopen(fn)), undefined, 'missing');
    writeFileSync(file, '');
    assert.equal(loadHaptic(HAPTIC_MODULE, dlopen(fn)), undefined, 'relative');
    assert.equal(loadHaptic(file, dlopen(fn)), fn);
    assert.equal(loadHaptic(file, dlopen({ tick: fn })), undefined, 'no function');
    const failing = () => {
      throw new Error('dlopen failed');
    };
    assert.equal(loadHaptic(file, failing), undefined);
    assert.deepEqual(opened, [file, file]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ticks load the module once, at the first, drop those too close together, and stop when one throws', () => {
  let t = 0;
  let loads = 0;
  let ticks = 0;
  const haptics = hapticsFor(
    () => {
      loads++;
      return () => {
        ticks++;
        if (ticks === 3) throw new Error('gone');
      };
    },
    () => t,
  );
  assert.equal(loads, 0);
  haptics.tick();
  haptics.tick();
  t += MIN_GAP_MS;
  haptics.tick();
  t += MIN_GAP_MS;
  haptics.tick();
  t += MIN_GAP_MS;
  haptics.tick();
  assert.deepEqual([loads, ticks], [1, 3]);
  const none = hapticsFor(() => undefined);
  none.tick();
});
