const test = require('node:test');
const assert = require('node:assert/strict');
const { fitWindow } = require('./window-size');

const base = { width: 1200, height: 780, minWidth: 960, minHeight: 600 };

test('a big screen keeps the normal size', () => {
  assert.deepEqual(fitWindow(base, { width: 1920, height: 1040 }), base);
});

test('a 1080p laptop at 150% scale (about 1280x672 free) gets a window that fits', () => {
  assert.deepEqual(fitWindow(base, { width: 1280, height: 672 }), { width: 1200, height: 672, minWidth: 960, minHeight: 600 });
});

test('a screen smaller than the minimum cuts the minimum down too', () => {
  assert.deepEqual(fitWindow(base, { width: 800, height: 500 }), { width: 800, height: 500, minWidth: 800, minHeight: 500 });
});

test('a missing or odd work area falls back to the normal size', () => {
  assert.deepEqual(fitWindow(base, undefined), base);
  assert.deepEqual(fitWindow(base, { width: 0, height: 0 }), { width: 1, height: 1, minWidth: 1, minHeight: 1 });
});
