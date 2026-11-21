const os = require('os');
// Loaded on first use: it takes about 80 ms to load, which would otherwise delay the window.
let siModule;
const si = () => (siModule ??= require('systeminformation'));

let overview; // hardware doesn't change while the app runs, so read it once

async function loadOverview() {
  const [cpu, mem, memLayout, gfx, disks, board, os] = await Promise.all([
    si().cpu(), si().mem(), si().memLayout(), si().graphics(), si().diskLayout(), si().baseboard(), si().osInfo(),
  ]);
  return {
    os: { name: os.distro, release: os.release, arch: os.arch },
    cpu: { name: `${cpu.manufacturer} ${cpu.brand}`, cores: cpu.physicalCores, threads: cpu.cores, ghz: cpu.speedMax || cpu.speed },
    ramTotal: mem.total,
    ramModules: memLayout.map((m) => ({ size: m.size, type: m.type, mhz: m.clockSpeed })),
    gpus: gfx.controllers.filter((g) => g.model).map((g) => ({ model: g.model, vramMb: g.vram, driver: g.driverVersion })),
    disks: disks.map((d) => ({ name: d.name, type: d.type, size: d.size })),
    board: `${board.manufacturer} ${board.model}`.trim(),
  };
}

function getOverview() {
  overview ??= loadOverview().catch((e) => {
    overview = undefined; // let the next call retry
    throw e;
  });
  return overview;
}

let disks = { at: 0, list: [] };

// si.fsSize() starts a PowerShell process (~300 ms) per call, and disk space barely changes, so refresh it every 30 s.
async function getDisks() {
  if (Date.now() - disks.at > 30_000) {
    const fs = await si().fsSize();
    disks = { at: Date.now(), list: fs.filter((d) => d.size > 0).map((d) => ({ name: d.mount, used: d.used, size: d.size })) };
  }
  return disks.list;
}

// CPU and memory only, for the history: two cheap reads that start no process.
async function getCpuRam() {
  const load = await si().currentLoad();
  const total = os.totalmem();
  return { cpu: load.currentLoad, ram: ((total - os.freemem()) / total) * 100 };
}

async function getLive() {
  const [load, list] = await Promise.all([si().currentLoad(), getDisks()]);
  const total = os.totalmem();
  // os.freemem() is Windows' "available" memory, so total - free is Task Manager's "In use". si.mem() would spawn PowerShell each call.
  return { cpu: load.currentLoad, ram: { used: total - os.freemem(), total }, disks: list, uptime: os.uptime() };
}

module.exports = { getOverview, getLive, getDisks, getCpuRam };
