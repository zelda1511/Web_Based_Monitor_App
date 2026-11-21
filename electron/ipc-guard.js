// Only the app's own window may call the IPC channels. A call is accepted when it comes from the top frame of a page whose address is the
// app's own index.html (a different hash or query is fine, that is how the pages are routed); anything else is refused: another file,
// another site, or a frame inside the page.
function isOwnFrame(event, appUrl) {
  const frame = event?.senderFrame;
  if (!frame || frame !== event.sender?.mainFrame) return false;
  try {
    const got = new URL(frame.url);
    const want = new URL(appUrl);
    return got.protocol === 'file:' && got.host === want.host && decodeURIComponent(got.pathname) === decodeURIComponent(want.pathname);
  } catch {
    return false;
  }
}

module.exports = { isOwnFrame };
