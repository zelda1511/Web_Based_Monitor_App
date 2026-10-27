// Warnings to the person: a Windows toast, or the tray icon's balloon when toasts are not available. Both were seen working from the
// extracted app (no Start menu shortcut) on 27 October. A warning is always written to the activity list first, so even when Windows hides
// the toast (Focus Assist, Do Not Disturb) nothing is lost. Clicking one opens a page, by route name from a fixed list.

const ROUTES = ['/disk', '/battery', '/updates', '/startup', '/cleanup', '/automation'];

// Electron drops a notification's click when the object has been garbage-collected, so the latest few are kept referenced. A click on one
// still waiting in the Windows notification list (minutes later) must reach the app too.
const KEEP = 10;

// trace: optional, for test copies only (see main.js): says which of the toast's events Windows delivered
function createNotifier({ Notification, getTray, settings, activity, onOpen, log, trace = () => {}, now = Date.now }) {
  const held = [];
  // returns 'shown', 'paused' or 'failed'
  // record: false when the caller writes its own, fuller line in the activity list (a finished cleaning)
  function notify({ id, title, body, route, record = true }) {
    const safeRoute = ROUTES.includes(route) ? route : '/automation';
    const paused = now() < (settings.get().quietUntil ?? 0);
    if (record) activity.add({ kind: 'warning', id, title, body, route: safeRoute, shown: !paused });
    if (paused) return 'paused';
    try {
      if (Notification?.isSupported?.()) {
        const n = new Notification({ title, body });
        n.on('click', () => { trace(`click ${id}`); onOpen(safeRoute); });
        for (const ev of ['show', 'close', 'failed']) n.on(ev, (_e, err) => trace(`${ev} ${id}${err ? ` ${err}` : ''}`));
        n.show();
        held.push(n);
        if (held.length > KEEP) held.shift();
        return 'shown';
      }
      const tray = getTray?.();
      if (tray) {
        tray.displayBalloon({ title, content: body, iconType: 'info' });
        return 'shown';
      }
      return 'failed';
    } catch (e) {
      log?.error?.('notify', e);
      try {
        getTray?.()?.displayBalloon({ title, content: body, iconType: 'info' });
        return 'shown';
      } catch {
        return 'failed';
      }
    }
  }
  return { notify, heldCount: () => held.length };
}

module.exports = { createNotifier, ROUTES, KEEP_NOTIFICATIONS: KEEP };
