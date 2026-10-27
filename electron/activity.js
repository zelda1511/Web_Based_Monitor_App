const fs = require('fs');
const path = require('path');

// What the automation did, one JSON line per event, newest last: warnings it sent and cleanings it ran. Kept to the last 200 so it never
// grows. The page shows it so nothing the automation did (or warned about) is ever invisible.

const KEEP = 200;
const SLACK = 50; // the file is only rewritten after this many extra lines
const MAX_TEXT = 300;

const clip = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : v);

function createActivity({ file, now = Date.now, fsApi = fs } = {}) {
  let count = null;

  function readAll() {
    try {
      return fsApi.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
        try {
          const o = JSON.parse(l);
          return o && typeof o === 'object' && !Array.isArray(o) ? [o] : [];
        } catch {
          return []; // a damaged line is skipped, never fatal
        }
      });
    } catch {
      return [];
    }
  }

  // entry: { kind: 'warning' | 'clean' | 'note', ...plain values }. Text is clipped; nothing else is changed.
  function add(entry) {
    try {
      const line = { at: now(), ...Object.fromEntries(Object.entries(entry).map(([k, v]) => [k, clip(v)])) };
      fsApi.mkdirSync(path.dirname(file), { recursive: true });
      fsApi.appendFileSync(file, `${JSON.stringify(line)}\n`);
      count = (count ?? readAll().length - 1) + 1;
      if (count > KEEP + SLACK) {
        const keep = readAll().slice(-KEEP);
        fsApi.writeFileSync(file, `${keep.map((o) => JSON.stringify(o)).join('\n')}\n`);
        count = keep.length;
      }
    } catch {
      // the record must never be the thing that breaks the automation
    }
  }

  const recent = (n = 50) => readAll().slice(-Math.max(1, Math.min(KEEP, n))).reverse();

  return { add, recent, file };
}

module.exports = { createActivity, KEEP };
