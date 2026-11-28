// The list a swipe picks the sidebar's tool from (swipe.ts), beside the
// rail while the swipe is under way: the tools in the rail's order, the one
// picked marked, and how the pick is taken. It shows from the swipe's first
// event, before any step, so that the swipe is seen to be taken.
import { t } from '../i18n';
import { isMac } from '../keys';
import { usePanels } from '../plugins/registry';
import { useSwipe } from '../swipe';

export function PanelSwitcher() {
  const { target, ids, index, open } = useSwipe();
  const panels = usePanels();
  if (target !== 'panel') return null;
  return (
    <div className="panel-switcher" role="listbox" aria-label={t('plugins.switcher')}>
      {ids.map((id, i) => {
        const panel = panels.find((p) => p.id === id);
        if (!panel) return null;
        const Icon = panel.icon;
        const picked = open && i === index;
        return (
          <div key={id} role="option" aria-selected={picked} className={`panel-switcher-item${picked ? ' picked' : ''}`}>
            <Icon />
            <span className="ellipsis">{t(panel.title)}</span>
          </div>
        );
      })}
      <div className="panel-switcher-hint">{t('app.swipeHint', { key: isMac ? '⌘' : 'Alt' })}</div>
    </div>
  );
}
