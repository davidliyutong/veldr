// The note a swipe through the tabs shows under the tab bar (swipe.ts),
// while the bar marks the tab picked: which tab of how many, its name, and
// how the pick is taken. Nothing is selected before then, so the tabs gone
// through are neither shown nor kept in the history of places.
import { tabName } from '../actions';
import { t } from '../i18n';
import { isMac } from '../keys';
import { tabId } from '../state/multiSelect';
import { useSwipe } from '../swipe';
import type * as L from '../term/layout';

export function TabSwitcher({ m, ws }: { m: string; ws: L.Workspace }) {
  const { target, ids, index } = useSwipe();
  if (target !== 'tab') return null;
  const tab = ws.tabs.find((tb) => tabId(tb) === ids[index]);
  return (
    <div className="tab-switcher-anchor">
      <div className="tab-switcher" role="status">
        <span className="tab-switcher-at">{t('workspace.tabSwitcher', { n: index + 1, total: ids.length })}</span>
        {tab && <span className="tab-switcher-name ellipsis">{tabName(m, tab)}</span>}
        <span className="tab-switcher-hint">{t('app.swipeHint', { key: isMac ? '⌘' : 'Alt' })}</span>
      </div>
    </div>
  );
}
