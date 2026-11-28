// The right sidebar's tools in the rail's order, which Next / Previous
// Sidebar Tool (commands.ts) and the swipe (swipe.ts) go through.
import type { PanelDef } from './plugins/api';
import { activePanels } from './plugins/registry';
import { orderRailItems, useStore } from './state/store';

/** The tools the rail shows, or every one when the user hid them all. */
export function railPool(): PanelDef[] {
  const s = useStore.getState();
  const ordered = orderRailItems(activePanels(), s.railOrder);
  const visible = ordered.filter((p) => !s.hiddenRailPanels.includes(p.id));
  return visible.length > 0 ? visible : ordered;
}

/** The tool the sidebar shows when opened: the one shown last, else the first. */
export const sidebarPanel = (pool: PanelDef[]): string | undefined =>
  (pool.find((p) => p.id === useStore.getState().lastPanel) ?? pool[0])?.id;
