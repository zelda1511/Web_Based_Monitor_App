const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, getSecurity, avOn } = require('./security');

const NOW = Date.parse('2026-11-21T12:00:00');
const healthy = () => ({
  av: [{ name: 'Windows Defender', state: 397568 }],
  mp: { AntivirusEnabled: true, RealTimeProtectionEnabled: true, AntivirusSignatureAge: 0 },
  fw: [{ name: 'Domain', enabled: true }, { name: 'Private', enabled: true }, { name: 'Public', enabled: true }],
  bl: 1, sb: 1, sac: 1, uac: 1, reboot: false, hotfix: '2026-11-12',
});
const by = (r, id) => r.checks.find((c) => c.id === id);

test('a healthy PC is all fine, and every check has a plain sentence', () => {
  const r = evaluate(healthy(), NOW);
  assert.equal(r.checks.length, 8);
  assert.deepEqual(r.summary, { ok: 8, warn: 0, info: 0 });
  assert.ok(r.checks.every((c) => c.detail.endsWith('.') && c.label));
  assert.match(by(r, 'updates').detail, /9 days ago \(2026-11-12\)/);
  assert.match(by(r, 'antivirus').detail, /up to date today/);
});

test('antivirus: Defender off with no other product is a warning; another product that is on counts; stale definitions warn', () => {
  const off = healthy(); off.mp.RealTimeProtectionEnabled = false;
  assert.equal(by(evaluate(off, NOW), 'antivirus').status, 'warn');
  const other = healthy(); other.mp = { AntivirusEnabled: false, RealTimeProtectionEnabled: false }; other.av = [{ name: 'Windows Defender', state: 393472 }, { name: 'Acme Shield', state: 266240 }];
  const o = by(evaluate(other, NOW), 'antivirus');
  assert.equal(o.status, 'ok');
  assert.match(o.detail, /Acme Shield/);
  const stale = healthy(); stale.mp.AntivirusSignatureAge = 12;
  assert.equal(by(evaluate(stale, NOW), 'antivirus').status, 'warn');
  assert.equal(by(evaluate({}, NOW), 'antivirus').status, 'info', 'nothing reported is not a verdict');
});

test('productState: the 0x1000 digit is 1 only when the product is on', () => {
  assert.equal(avOn(397568), true); // 0x61100
  assert.equal(avOn(266240), true); // 0x41000
  assert.equal(avOn(393472), false); // 0x60100
  assert.equal(avOn(undefined), false);
  assert.equal(avOn('x'), false);
});

test('firewall names the profiles that are off', () => {
  const x = healthy(); x.fw[2].enabled = false;
  const c = by(evaluate(x, NOW), 'firewall');
  assert.equal(c.status, 'warn');
  assert.match(c.detail, /Public network profile\./);
  assert.equal(by(evaluate({ fw: [] }, NOW), 'firewall').status, 'info');
});

test('disk encryption, Secure Boot and UAC: on is fine, off is a warning, unreadable is only a note', () => {
  const x = healthy(); x.bl = 0; x.sb = 0; x.uac = 0;
  const r = evaluate(x, NOW);
  assert.deepEqual(['bitlocker', 'secureboot', 'uac'].map((id) => by(r, id).status), ['warn', 'warn', 'warn']);
  const n = evaluate({}, NOW);
  assert.deepEqual(['bitlocker', 'secureboot', 'uac'].map((id) => by(n, id).status), ['info', 'info', 'info']);
});

test('Smart App Control is a choice: on is fine, off and evaluation are only notes', () => {
  assert.equal(by(evaluate({ sac: 1 }, NOW), 'sac').status, 'ok');
  assert.equal(by(evaluate({ sac: 0 }, NOW), 'sac').status, 'info');
  assert.equal(by(evaluate({ sac: 2 }, NOW), 'sac').status, 'info');
});

test('a pending restart and an old last update warn; a bad date is only a note', () => {
  const x = healthy(); x.reboot = true; x.hotfix = '2026-08-01';
  const r = evaluate(x, NOW);
  assert.equal(by(r, 'restart').status, 'warn');
  assert.equal(by(r, 'updates').status, 'warn');
  assert.match(by(r, 'updates').detail, /112 days ago/);
  assert.equal(by(evaluate({ hotfix: 'yesterday' }, NOW), 'updates').status, 'info');
});

test('anything that is not an object is read as "nothing reported", never an error', () => {
  for (const bad of [null, undefined, 5, 'x', []]) assert.doesNotThrow(() => evaluate(bad, NOW));
  assert.equal(evaluate(null, NOW).summary.warn, 0);
});

test('getSecurity runs one read at a time, and a failed read can be tried again', async () => {
  let runs = 0;
  let release;
  const gate = new Promise((r) => (release = r));
  const run = async () => { runs++; await gate; return healthy(); };
  const a = getSecurity({ run, now: NOW });
  const b = getSecurity({ run, now: NOW });
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(runs, 1);
  assert.equal(ra, rb);
  await assert.rejects(getSecurity({ run: async () => { throw new Error('boom'); } }), /boom/);
  assert.equal((await getSecurity({ run: async () => healthy(), now: NOW })).summary.ok, 8);
});
