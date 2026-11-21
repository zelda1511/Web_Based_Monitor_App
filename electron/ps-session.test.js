const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createPsSession, END, ERR } = require('./ps-session');

// A stand-in for powershell.exe: each line on stdin is answered by `reply(n)` (the n-th request), unless it returns undefined (no answer).
function fakeSpawn(reply) {
  const spawned = [];
  const spawn = (exe, args) => {
    const c = new EventEmitter();
    c.stdin = new PassThrough();
    c.stdout = new PassThrough();
    c.killed = false;
    c.kill = () => { c.killed = true; setImmediate(() => c.emit('exit', 1)); };
    c.args = args;
    let n = 0;
    c.stdin.on('data', (d) => {
      for (let i = 0; i < String(d).split('\n').length - 1; i++) {
        const out = reply(++n, spawned.length);
        if (out !== undefined) setImmediate(() => c.stdout.write(`${out}\r\n${END}\r\n`));
      }
    });
    spawned.push(c);
    return c;
  };
  return { spawn, spawned };
}

test('answers each request from the same PowerShell', async () => {
  const f = fakeSpawn((n) => `[{"n":${n}}]`);
  const s = createPsSession({ script: 'Get-Process', spawn: f.spawn });
  assert.equal(await s.run(), '[{"n":1}]');
  assert.equal(await s.run(), '[{"n":2}]');
  assert.equal(f.spawned.length, 1);
  assert.ok(f.spawned[0].args.at(-1).includes('Get-Process'));
  s.stop();
  assert.equal(f.spawned[0].killed, true);
});

test('runs requests one at a time, in order', async () => {
  const f = fakeSpawn((n) => String(n));
  const s = createPsSession({ script: 'x', spawn: f.spawn });
  const all = await Promise.all([s.run(), s.run(), s.run()]);
  assert.deepEqual(all, ['1', '2', '3']);
  s.stop();
});

test('a script error is a rejected request, and the session stays usable', async () => {
  const f = fakeSpawn((n) => (n === 1 ? `${ERR}Access denied` : 'ok'));
  const s = createPsSession({ script: 'x', spawn: f.spawn });
  await assert.rejects(s.run(), /Access denied/);
  assert.equal(await s.run(), 'ok');
  assert.equal(f.spawned.length, 1);
  s.stop();
});

test('a request with no answer times out, and the next one starts a fresh PowerShell', async () => {
  const f = fakeSpawn((n, which) => (which === 1 ? undefined : 'fresh'));
  const s = createPsSession({ script: 'x', spawn: f.spawn, timeoutMs: 30 });
  await assert.rejects(s.run(), /too long/);
  assert.equal(f.spawned[0].killed, true);
  assert.equal(await s.run(), 'fresh');
  assert.equal(f.spawned.length, 2);
  s.stop();
});

test('PowerShell exiting mid-request rejects it', async () => {
  const f = fakeSpawn(() => undefined);
  const s = createPsSession({ script: 'x', spawn: f.spawn });
  const r = s.run();
  setImmediate(() => f.spawned[0].emit('exit', 1));
  await assert.rejects(r, /stopped/);
  assert.equal(s.running(), false);
});

test('stops by itself after the idle time', async () => {
  const f = fakeSpawn(() => 'ok');
  const s = createPsSession({ script: 'x', spawn: f.spawn, idleMs: 20 });
  await s.run();
  assert.equal(s.running(), true);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(s.running(), false);
  assert.equal(f.spawned[0].killed, true);
});

test('output larger than the limit is refused', async () => {
  const f = fakeSpawn(() => 'x'.repeat(200));
  const s = createPsSession({ script: 'x', spawn: f.spawn, maxBytes: 100 });
  await assert.rejects(s.run(), /more output/);
});
