import { whenVisible } from './visible';

function fakeDoc(state: DocumentVisibilityState) {
  const target = new EventTarget();
  const doc = target as unknown as Document & { visibilityState: DocumentVisibilityState };
  Object.defineProperty(doc, 'visibilityState', { value: state, writable: true });
  return doc;
}

describe('whenVisible', () => {
  it('resolves at once while the page is visible', async () => {
    await expect(whenVisible(fakeDoc('visible'))).resolves.toBeUndefined();
  });

  it('waits while hidden and resolves when the page is shown again', async () => {
    const doc = fakeDoc('hidden');
    let done = false;
    const p = whenVisible(doc).then(() => (done = true));
    doc.dispatchEvent(new Event('visibilitychange')); // still hidden: keeps waiting
    await Promise.resolve();
    expect(done).toBe(false);
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await p;
    expect(done).toBe(true);
  });
});
