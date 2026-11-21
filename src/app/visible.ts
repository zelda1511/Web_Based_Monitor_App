// Polls wait here while the window is minimized or closed to the tray, so a hidden window reads nothing (and starts no PowerShell).
// Resolves at once when the page is visible, else on the first visibilitychange that shows it, so the page refreshes as soon as it is seen again.
export function whenVisible(doc: Document = document): Promise<void> {
  if (doc.visibilityState !== 'hidden') return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = () => {
      if (doc.visibilityState === 'hidden') return;
      doc.removeEventListener('visibilitychange', onChange);
      resolve();
    };
    doc.addEventListener('visibilitychange', onChange);
  });
}
