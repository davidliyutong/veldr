// @vitest-environment jsdom
// Switching the sidebar's tools and the tabs with a swipe (swipe.ts,
// swipeSteps.ts): steps by distance either way while the modifier is held,
// momentum that steps no further, a mouse's notches a step each; up and
// down the sidebar's tools in a list beside the rail, left and right the
// tabs marked on the bar, from the first event; the pick taken on release
// (or after a pause) and dropped with Escape, nothing selected before then,
// the ends where it stops, a tick of the desktop app's trackpad per step.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopShell } from '../shell';

const bridge = vi.hoisted(() => ({ shell: undefined as Partial<DesktopShell> | undefined }));
vi.mock('../shell', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shell')>();
  return {
    ...actual,
    get desktopShell() {
      return bridge.shell;
    },
  };
});
vi.mock('../lib/conn', () => ({ conn: { setTheme: () => {} } }));

import { createElement } from 'react';
import { Files, GitBranch, Search } from 'lucide-react';
import { isMac } from '../keys';
import { actions } from '../actions';
import type { PluginDef } from '../plugins/api';
import { allPlugins, definePlugins } from '../plugins/registry';
import { useStore } from '../state/store';
import { useTerms } from '../state/terms';
import { endSwipe, followSwipe, IDLE_MS, onSwipeWheel, resetSwipe, useSwipe } from '../swipe';
import * as L from '../term/layout';
import { FIRST_STEP_PX, STEP_PX, STREAM_GAP_MS, SwipeSteps, type Step } from '../swipeSteps';

/** Feeds events {dy, t}, taking a held step when no event follows within
 * STREAM_GAP_MS, as swipe.ts does; the steps made. */
function stepsOf(events: { dy: number; t: number }[], s = new SwipeSteps()): Step[] {
  const out: Step[] = [];
  events.forEach((e, i) => {
    const step = s.feed(e.dy, e.t);
    if (step) out.push(step);
    const next = events[i + 1];
    if (s.holding && (!next || next.t - e.t > STREAM_GAP_MS)) out.push(s.flush());
  });
  return out;
}

/** Events of a trackpad at 60 Hz from t0, one per size. */
const frames = (sizes: number[], t0 = 0, dir = 1) => sizes.map((size, i) => ({ dy: dir * size, t: t0 + (i + 1) * 16 }));

describe('the steps of a swipe', () => {
  it('a slow move steps after FIRST_STEP_PX, then every STEP_PX, and back the other way after a turn', () => {
    // 4 px a frame: 0.25 px/ms, too slow to coast.
    const down = frames(Array(6 + 20).fill(4));
    expect(FIRST_STEP_PX).toBe(24);
    expect(STEP_PX).toBe(40);
    const s = new SwipeSteps();
    expect(stepsOf(down, s)).toEqual([1, 1, 1]);
    const t = down[down.length - 1].t;
    expect(stepsOf(frames(Array(16).fill(4), t, -1), s)).toEqual([-1, -1]);
  });

  it("a flick's momentum steps no further, and fingers pushing again during it step again", () => {
    // The fingers speed up to 30 px a frame and leave; momentum decays from there.
    const finger = [3, 8, 15, 24, 30, 30];
    const momentum = Array.from({ length: 60 }, (_, i) => 30 * 0.93 ** (i + 1));
    const flick = frames([...finger, ...momentum]);
    const fingerSteps = stepsOf(frames(finger)).length;
    expect(fingerSteps).toBe(2);
    expect(stepsOf(flick)).toEqual([1, 1]);
    // The same, then the fingers push again while it coasts.
    const again = frames([...finger, ...momentum.slice(0, 15), 4, 10, 18, 26, 30, 30]);
    expect(stepsOf(again).length).toBeGreaterThanOrEqual(fingerSteps + 2);
  });

  it("a mouse's notches are a step each, however fast or slowly they come; lines and pages too", () => {
    let t = 0;
    const notches = [0, 150, 40, 20, 25, 30, 60, 12, 14, 18, 35].map((gap) => ({ dy: 40, t: (t += gap) }));
    expect(stepsOf(notches)).toEqual(Array(notches.length).fill(1));
    const s = new SwipeSteps();
    expect([s.feed(3, 0, true), s.feed(3, 10, true), s.feed(-1, 20, true)]).toEqual([1, 1, -1]);
  });

  it('a step reached while the stroke slows is held, and taken when no momentum follows', () => {
    const s = new SwipeSteps();
    const steps = [10, 12, 14, 9, 6].map((dy, i) => s.feed(dy, (i + 1) * 16));
    expect(steps).toEqual([0, 0, 1, 0, 0]);
    // 9 + 6 after the first step, then a stop: nothing held. A fast stroke
    // that slows down past a step holds it: taken when the stroke ends there,
    // dropped when it goes on slowing down (momentum).
    const fast = new SwipeSteps();
    expect([20, 25, 30, 26].map((dy, i) => fast.feed(dy, (i + 1) * 16))).toEqual([0, 1, 0, 0]);
    expect(fast.holding).toBe(true);
    expect(fast.flush()).toBe(1);
    expect(fast.flush()).toBe(0);
    const coasting = new SwipeSteps();
    expect([20, 25, 30, 26, 22].map((dy, i) => coasting.feed(dy, (i + 1) * 16))).toEqual([0, 1, 0, 0, 0]);
    expect(coasting.holding).toBe(false);
    expect(coasting.coasting).toBe(true);
  });
});

const plugin = (id: string, icon = Files): PluginDef => ({
  id,
  title: 'plugins.gui.title',
  icon,
  panels: [{ id, title: 'plugins.gui.title', icon, component: () => createElement('div') }],
});

/** A workspace of n tabs, of one terminal each (t1, t2, …), showing the first. */
function layoutOf(n: number): L.Layout {
  const tabs = Array.from({ length: n }, (_, i) => ({ root: { terminal: `t${i + 1}` }, focused: `t${i + 1}` }));
  return { version: 2, selected: 0, workspaces: [{ id: 'ws1', name: 'demo', cwd: '/tmp', selected: 0, tabs }] };
}

const shownTab = () => {
  const ws = useTerms.getState().machines.local?.layout?.workspaces[0];
  return ws?.tabs[ws.selected]?.focused;
};

describe('the swipe', () => {
  const saved = [...allPlugins()];
  const mod = isMac ? { metaKey: true } : { altKey: true };
  const key = isMac ? 'Meta' : 'Alt';
  const haptic = vi.fn();
  const selected: number[] = [];
  let off: () => void;
  let now = 0;
  /** A wheel event with the modifier held (or o's), 16 ms after the last. */
  const wheel = (deltaY: number, o: WheelEventInit = mod) => {
    const ev = new WheelEvent('wheel', { deltaY, cancelable: true, ...o });
    return { ev, taken: onSwipeWheel(ev, (now += 16)) };
  };
  const sideways = (deltaX: number, o: WheelEventInit = mod) => wheel(0, { deltaX, ...o });
  /** A slow move of n frames of 4 px (a step after 24 px, then every 40):
   * up and down, or left and right. */
  const move = (n: number, dir = 1) => {
    for (let i = 0; i < n; i++) wheel(4 * dir);
  };
  const slide = (n: number, dir = 1) => {
    for (let i = 0; i < n; i++) sideways(4 * dir);
  };
  const pause = () => (now += 500);
  const pick = () => {
    const { ids, index, open } = useSwipe.getState();
    return open ? ids[index] : undefined;
  };

  /** A machine "local" whose workspace has n tabs; selectTab is recorded. */
  function tabs(n: number) {
    useStore.setState({ machineId: 'local' });
    useTerms.setState({ machines: { local: { backend: { phase: 'ready', code: '', version: '' }, layout: layoutOf(n), terminals: {} } } });
    vi.spyOn(actions, 'selectTab').mockImplementation((m, ws, index) => {
      selected.push(index);
      useTerms.setState((s) => ({
        machines: { ...s.machines, [m]: { ...s.machines[m], layout: L.selectTab(s.machines[m].layout!, ws, index) } },
      }));
    });
  }

  beforeEach(() => {
    definePlugins([plugin('git', GitBranch), plugin('files'), plugin('search', Search)]);
    useStore.setState({ railOrder: ['git', 'files', 'search'], hiddenRailPanels: [], panel: 'git', lastPanel: 'git' });
    bridge.shell = { haptic };
    haptic.mockClear();
    selected.length = 0;
    resetSwipe();
    now = 1000;
    off = followSwipe();
  });
  afterEach(() => {
    off();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.querySelector('.modal-backdrop')?.remove();
    useStore.setState({ railOrder: [], hiddenRailPanels: [], panel: undefined, lastPanel: undefined, machineId: undefined });
    useTerms.setState({ machines: {} });
    definePlugins(saved);
    bridge.shell = undefined;
  });

  describe('through the sidebar, up and down', () => {
    it('without the modifier a wheel is left alone, and so is a diagonal swipe or one under a dialog', () => {
      expect(wheel(200, {}).taken).toBe(false);
      const diagonal = wheel(50, { deltaX: 50, ...mod });
      expect(diagonal.taken).toBe(false);
      expect(diagonal.ev.defaultPrevented).toBe(false);
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      document.body.append(backdrop);
      expect(wheel(50).taken).toBe(false);
      expect(useSwipe.getState().target).toBeUndefined();
    });

    it('shows the list at the first event on the tool shown; each step moves the pick with a tick, and the sidebar follows on release', () => {
      const first = wheel(2);
      expect(first.taken).toBe(true);
      expect(first.ev.defaultPrevented).toBe(true);
      expect(useSwipe.getState()).toMatchObject({ target: 'panel', ids: ['git', 'files', 'search'] });
      expect(pick()).toBe('git');
      move(6);
      expect(pick()).toBe('files');
      expect(haptic).toHaveBeenCalledTimes(1);
      expect(useStore.getState().panel).toBe('git');
      window.dispatchEvent(new KeyboardEvent('keyup', { key }));
      expect(useStore.getState().panel).toBe('files');
      expect(useSwipe.getState().target).toBeUndefined();
    });

    it('goes back and forth while the key is held, and stops at the ends without a tick', () => {
      wheel(4);
      move(6 + 10 + 10 + 10);
      expect(pick()).toBe('search');
      expect(haptic).toHaveBeenCalledTimes(2);
      move(6, -1);
      expect(pick()).toBe('files');
      move(6 + 10 + 10, -1);
      expect(pick()).toBe('git');
      expect(haptic).toHaveBeenCalledTimes(4);
      move(6);
      expect(pick()).toBe('files');
      endSwipe(true);
      expect(useStore.getState().panel).toBe('files');
    });

    it('Escape leaves the sidebar as it was, and the rest of the stroke scrolls nothing', () => {
      move(7);
      expect(pick()).toBe('files');
      const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      window.dispatchEvent(esc);
      expect(esc.defaultPrevented).toBe(true);
      expect(useStore.getState().panel).toBe('git');
      expect(useSwipe.getState().target).toBeUndefined();
      // Its momentum, the key released: taken, without a list.
      expect(wheel(3, {}).taken).toBe(true);
      expect(useSwipe.getState().target).toBeUndefined();
      pause();
      expect(wheel(3, {}).taken).toBe(false);
    });

    it("a hidden sidebar's first step opens it on the tool shown last; a swipe that picks nothing leaves it hidden", () => {
      useStore.setState({ panel: undefined, lastPanel: 'files' });
      wheel(4);
      endSwipe(true);
      expect(useStore.getState().panel).toBeUndefined();
      pause();
      wheel(4);
      expect(useSwipe.getState().ids).toHaveLength(3);
      expect(pick()).toBeUndefined();
      move(6);
      expect(pick()).toBe('files');
      expect(haptic).toHaveBeenCalledTimes(1);
      move(10);
      expect(pick()).toBe('search');
      endSwipe(true);
      expect(useStore.getState().panel).toBe('search');
    });

    it('the release is also seen in a wheel event without the key, and the pick is taken after IDLE_MS', () => {
      vi.useFakeTimers();
      move(7);
      pause();
      expect(wheel(4, {}).taken).toBe(false);
      expect(useStore.getState().panel).toBe('files');
      pause();
      move(7, -1);
      expect(pick()).toBe('git');
      vi.advanceTimersByTime(IDLE_MS);
      expect(useStore.getState().panel).toBe('git');
      expect(useSwipe.getState().target).toBeUndefined();
    });
  });

  describe('through the tabs, left and right', () => {
    it('picks tabs in the bar’s order back and forth, stopping at the ends, and selects only the last one, once, on release', () => {
      tabs(4);
      sideways(2);
      expect(useSwipe.getState()).toMatchObject({ target: 'tab', ids: ['t1', 't2', 't3', 't4'], index: 0, open: true });
      slide(6 + 10);
      expect(pick()).toBe('t3');
      slide(6, -1);
      expect(pick()).toBe('t2');
      slide(6 + 10 + 10, -1);
      expect(pick()).toBe('t1');
      slide(6 + 10 + 10 + 10 + 10);
      expect(pick()).toBe('t4');
      expect(haptic).toHaveBeenCalledTimes(2 + 1 + 1 + 3);
      // Nothing is selected on the way: the tabs gone through are not shown,
      // nor kept in the history of places.
      expect(selected).toEqual([]);
      expect(shownTab()).toBe('t1');
      window.dispatchEvent(new KeyboardEvent('keyup', { key }));
      expect(selected).toEqual([3]);
      expect(shownTab()).toBe('t4');
    });

    it('back to the tab shown, or Escape, selects nothing', () => {
      tabs(3);
      slide(7);
      expect(pick()).toBe('t2');
      slide(7, -1);
      expect(pick()).toBe('t1');
      endSwipe(true);
      pause();
      slide(7);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
      expect(selected).toEqual([]);
      expect(shownTab()).toBe('t1');
    });

    it('keeps to the direction it started in, and a workspace of one tab is no swipe', () => {
      tabs(3);
      slide(7);
      move(20);
      expect(useSwipe.getState().target).toBe('tab');
      expect(pick()).toBe('t2');
      endSwipe(true);
      expect(useStore.getState().panel).toBe('git');
      expect(shownTab()).toBe('t2');
      pause();
      move(7);
      slide(20);
      expect(useSwipe.getState().target).toBe('panel');
      expect(pick()).toBe('files');
      endSwipe(true);
      expect(shownTab()).toBe('t2');
      pause();
      tabs(1);
      expect(sideways(40).taken).toBe(false);
      expect(useSwipe.getState().target).toBeUndefined();
    });
  });
});
