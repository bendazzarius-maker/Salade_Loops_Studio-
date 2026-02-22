#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const bin = process.platform === 'win32'
  ? path.join(__dirname, '..', 'native', 'sls-audio-engine.exe')
  : path.join(__dirname, '..', 'native', 'sls-audio-engine');

if (!fs.existsSync(bin)) {
  console.error('native engine binary not found:', bin);
  process.exit(2);
}

const proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '';
const pending = new Map();

proc.stdout.on('data', (d) => {
  buf += d.toString('utf8');
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.type === 'res' && pending.has(msg.id)) {
      const r = pending.get(msg.id);
      pending.delete(msg.id);
      r(msg);
    }
  }
});

function req(op, data = {}) {
  const id = `${Date.now()}-${Math.random()}`;
  const payload = { v: 1, type: 'req', op, id, ts: Date.now(), data };
  proc.stdin.write(JSON.stringify(payload) + '\n');
  return new Promise((resolve) => pending.set(id, resolve));
}

(async () => {
  const hello = await req('engine.hello', {});
  if (!hello.ok) throw new Error('engine.hello failed');
  const ping = await req('engine.ping', { nonce: 'smoke' });
  if (!ping.ok) throw new Error('engine.ping failed');
  const noteOn = await req('midi.noteOn', { trackId: 't1', channel: 0, note: 60, velocity: 0.8, when: 'now' });
  if (!noteOn.ok) throw new Error('midi.noteOn failed');
  await new Promise((r) => setTimeout(r, 150));
  const noteOff = await req('midi.noteOff', { trackId: 't1', channel: 0, note: 60, when: 'now' });
  if (!noteOff.ok) throw new Error('midi.noteOff failed');
  const play = await req('transport.play', {});
  if (!play.ok) throw new Error('transport.play failed');
  const stop = await req('transport.stop', { panic: true });
  if (!stop.ok) throw new Error('transport.stop failed');
  console.log('smoke ok');
  proc.kill();
})();
