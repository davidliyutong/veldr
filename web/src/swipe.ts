// Switching the right sidebar's tools and the workspace's tabs with a
// swipe: with Cmd held (Alt on Windows and Linux, whose Ctrl with the wheel
// zooms), two fingers moved up or down on a trackpad, or the wheel turned,
// pick a tool of the sidebar in the rail's order; moved left or right, a tab
// of the workspace shown. A swipe keeps to the direction of its first event.
// swipeSteps.ts turns the events into steps either way, so the fingers may
// go back and forth while the key is held; the list stops at its ends. The
// pick shows at once, in a list beside the rail (components/PanelSwitcher.tsx)
// and on the rail, or on the tab bar with a note under it (Workspace.tsx),
// and is felt as a tick of the trackpad in the desktop app on macOS
// (DesktopShell.haptic). The sidebar or the workspace shows it when the key
// is released, or IDLE_MS after the last swipe when the page does not see
// the release (the focus in a frame); Escape leaves them as they were. A
// hidden sidebar's first step opens it on the tool it showed last, as
// view.panel.next does. What is left of a stroke after the pick (its
// momentum) scrolls nothing. Anywhere in the main window but a VS Code
// pane, whose frame keeps its events; nothing while a dialog is open.
import { create } from 'zustand';
import { actions, current } from './actions';
import { shownTabs } from './detachedWindow';
import { keyContext } from './keymap';
import { isMac } from './keys';
import { railPool, sidebarPanel } from './railPool';
import { desktopShell } from './shell';
import { tabId } from './state/multiSelect';
import { useStore } from './state/store';
import { STREAM_GAP_MS, STROKE_GAP_MS, SwipeSteps, type Step } from './swipeSteps';

/** Without a swipe or a release seen for this long, the pick is taken. */
export const IDLE_MS = 1200;

/** What a swipe picks: a tool of the sidebar (up and down) or a tab (left and right). */
export type SwipeTarget = 'panel' | 'tab';

/** The swipe under way, as the UI shows it. */
export interface SwipePick {
  /** What it picks; undefined while no swipe is under way. */
  target?: SwipeTarget;
  /** The items in order, by id: tools, or tabs by their first pane. */
  ids: string[];
  /** The item picked. */
  index: number;
  /** Whether the pick is to be shown: the sidebar shows a tool, or a hidden
   * one's first step was made. */
  open: boolean;
}

export const useSwipe = create<SwipePick>(() => ({ ids: [], index: -1, open: false }));

/** The items a swipe goes through, and how the one picked is shown. */
interface Target {
  /** The items, the one shown (-1: none, the swipe starts on `opens` and
   * opens it at its first step); undefined with nothing to pick from. */
  list(): { ids: string[]; shown: number; opens: number } | undefined;
  /** Shows the item id, when it is still there and not shown. */
  show(id: string): void;
}

const targets: Record<SwipeTarget, Target> = {
  panel: {
    list() {
      const pool = railPool();
      if (!pool.length) return undefined;
      const ids = pool.map((p) => p.id);
      return { ids, shown: ids.indexOf(useStore.getState().panel ?? ''), opens: ids.indexOf(sidebarPanel(pool) ?? '') };
    },
    show(id) {
      const s = useStore.getState();
      if (id !== s.panel && railPool().some((p) => p.id === id)) s.setPanel(id);
    },
  },
  tab: {
    list() {
      const c = current();
      const tabs = c?.ws ? shownTabs(c.m, c.ws) : [];
      if (!c || tabs.length < 2) return undefined;
      return { ids: tabs.map(({ tb }) => tabId(tb)), shown: tabs.findIndex(({ i }) => i === c.tabIndex), opens: 0 };
    },
    show(id) {
      const c = current();
      const at = c?.ws ? shownTabs(c.m, c.ws).find(({ tb }) => tabId(tb) === id) : undefined;
      if (c?.ws && at && at.i !== c.tabIndex) actions.selectTab(c.m, c.ws.id, at.i);
    },
  },
};

const steps = new SwipeSteps();
/** Whether the pick moved from the item shown. */
let moved = false;
/** When the swipe last took a wheel event: the rest of its stroke is its own. */
let lastTaken = -Infinity;
let idle: ReturnType<typeof setTimeout> | undefined;
let held: ReturnType<typeof setTimeout> | undefined;

const active = () => useSwipe.getState().target !== undefined;

type Modifiers = Pick<MouseEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>;

/** Whether ev's modifiers are the swipe's, and no others. */
function holds(ev: Modifiers): boolean {
  return isMac ? ev.metaKey && !ev.ctrlKey && !ev.altKey && !ev.shiftKey : ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey;
}

/** A wheel delta in CSS pixels. */
function px(delta: number, mode: number): number {
  if (mode === 1) return delta * 16;
  if (mode === 2) return delta * (typeof window === 'undefined' ? 800 : window.innerHeight);
  return delta;
}

/** The delta of ev along the target's direction. */
const along = (target: SwipeTarget, ev: WheelEvent) => px(target === 'panel' ? ev.deltaY : ev.deltaX, ev.deltaMode);

/** Starts a swipe through target's items on the one shown; false with
 * nothing to pick from. */
function begin(target: SwipeTarget): boolean {
  const list = targets[target].list();
  if (!list) return false;
  moved = false;
  steps.reset();
  const index = list.shown >= 0 ? list.shown : Math.max(0, list.opens);
  useSwipe.setState({ target, ids: list.ids, index, open: list.shown >= 0 });
  return true;
}

/** Moves the pick one item along (a hidden sidebar's first step picks the
 * tool it would open on), with a tick. */
function step(dir: Step) {
  const { target, ids, index, open } = useSwipe.getState();
  if (!target || !dir) return;
  if (!open) useSwipe.setState({ open: true });
  else {
    const next = Math.min(Math.max(index + dir, 0), ids.length - 1);
    if (next === index) return;
    useSwipe.setState({ index: next });
  }
  moved = true;
  desktopShell?.haptic?.();
}

/** Ends the swipe under way: the pick is shown (take) or all stays as it was. */
export function endSwipe(take: boolean) {
  if (!active()) return;
  clearTimeout(idle);
  clearTimeout(held);
  if (take) step(steps.flush());
  const { target, ids, index, open } = useSwipe.getState();
  useSwipe.setState({ target: undefined, ids: [], index: -1, open: false });
  if (take && moved && open && target && ids[index]) targets[target].show(ids[index]);
}

/** Takes ev for the swipe: it goes no further. */
function take(ev: WheelEvent, now: number): true {
  ev.preventDefault();
  ev.stopPropagation();
  lastTaken = now;
  return true;
}

/** Takes a wheel event that is a swipe's (true: it is cancelled and goes no
 * further), moving the pick. */
export function onSwipeWheel(ev: WheelEvent, now = performance.now()): boolean {
  // The key released, seen with the wheel: the pick is taken.
  if (active() && !holds(ev)) endSwipe(true);
  if (!active()) {
    if (now - lastTaken <= STROKE_GAP_MS) return take(ev, now);
    if (!holds(ev) || keyContext() === 'dialog') return false;
    const dy = Math.abs(along('panel', ev));
    const dx = Math.abs(along('tab', ev));
    if (dx === dy || !begin(dy > dx ? 'panel' : 'tab')) return false;
  }
  take(ev, now);
  step(steps.feed(along(useSwipe.getState().target!, ev), now, ev.deltaMode !== 0));
  clearTimeout(held);
  // A step held while the stroke slowed down is taken when no momentum follows.
  if (steps.holding) held = setTimeout(() => step(steps.flush()), STREAM_GAP_MS);
  clearTimeout(idle);
  idle = setTimeout(() => endSwipe(true), IDLE_MS);
  return true;
}

/** Follows the window's wheel events, before panes and editors get them,
 * and the keys and moves that end a swipe. */
export function followSwipe(): () => void {
  const onWheel = (ev: WheelEvent) => void onSwipeWheel(ev);
  const onKeyDown = (ev: KeyboardEvent) => {
    if (!active() || ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    endSwipe(false);
  };
  // The key released (keyup), or seen up with a move of the pointer.
  const onRelease = (ev: KeyboardEvent | PointerEvent) => {
    if (active() && !holds(ev)) endSwipe(true);
  };
  const onBlur = () => endSwipe(true);
  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onRelease, true);
  window.addEventListener('pointermove', onRelease, { capture: true, passive: true });
  window.addEventListener('blur', onBlur);
  return () => {
    endSwipe(false);
    window.removeEventListener('wheel', onWheel, { capture: true });
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onRelease, true);
    window.removeEventListener('pointermove', onRelease, { capture: true });
    window.removeEventListener('blur', onBlur);
  };
}

/** Forgets the swipe under way (tests). */
export function resetSwipe() {
  endSwipe(false);
  steps.reset();
  lastTaken = -Infinity;
}
