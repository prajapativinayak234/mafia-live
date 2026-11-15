'use strict';
// Live voice chat: server signalling rules (ws bots) + a REAL two-browser WebRTC call with fake microphones (Playwright/Chromium).
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createServer } = require('../server');

const FAST = { resolveMin: 20, resolveMax: 40, dayResolve: 20, verdict: 60000, nightMax: 60000, dayMax: 60000, lobbyGrace: 500, emptyTTL: 60000 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 5000, label = '') { const t = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch (e) { /* retry */ } if (Date.now() - t > ms) throw new Error('timeout: ' + label); await sleep(40); } }
const APPS = [], SOCKS = [];
test.after(async () => { SOCKS.forEach(s => { try { s.terminate(); } catch (e) { /* ignore */ } }); for (const a of APPS) { try { await a.close(); } catch (e) { /* ignore */ } } });

class Bot {
  constructor(url, name) { this.url = url; this.name = name; this.msgs = []; this.waiters = []; }
  open() { return new Promise((res, rej) => { this.ws = new WebSocket(this.url); SOCKS.push(this.ws); this.ws.on('open', res); this.ws.on('error', rej); this.ws.on('message', raw => this.onRaw(raw.toString())); }); }
  onRaw(raw) { const m = JSON.parse(raw); this.msgs.push(m); if (m.t === 'joined') { this.id = m.id; this.code = m.code; this.ice = m.ice; } this.waiters = this.waiters.filter(w => { if (w.pred(m)) { clearTimeout(w.timer); w.res(m); return false; } return true; }); }
  send(m) { this.ws.send(JSON.stringify(m)); }
  wait(pred, ms = 3000, label = '') { const had = this.msgs.find(pred); if (had) return Promise.resolve(had); return new Promise((res, rej) => { this.waiters.push({ pred, res, timer: setTimeout(() => rej(new Error('timeout ' + label)), ms) }); }); }
  of(t) { return this.msgs.filter(m => m.t === t); }
  async create() { await this.open(); this.send({ t: 'create', name: this.name }); await this.wait(m => m.t === 'joined'); return this; }
  async join(code) { await this.open(); this.send({ t: 'join', code, name: this.name }); await this.wait(m => m.t === 'joined'); return this; }
}
async function srvRoom(n, opts) {
  const app = createServer({ timing: FAST, ...(opts || {}) }); APPS.push(app);
  const port = await app.listen(0), url = `ws://127.0.0.1:${port}/ws`;
  const host = await new Bot(url, 'Host').create(); const bots = [host];
  for (let i = 1; i < n; i++) bots.push(await new Bot(url, 'P' + i).join(host.code));
  await sleep(100);
  return { bots, port, url, code: host.code };
}

test('voice server: join list is shared, signalling only flows between two people who are both in voice', async () => {
  const { bots } = await srvRoom(4); const [a, b, c, d] = bots;
  assert.ok(a.ice && a.ice[0].urls.length >= 1, 'ICE servers are handed out');
  a.send({ t: 'rtc', to: b.id, data: { sdp: { type: 'offer', sdp: 'x' } } }); await sleep(120);
  assert.equal(b.of('rtc').length, 0, 'not in voice -> blocked');
  a.send({ t: 'voice', on: true }); b.send({ t: 'voice', on: true });
  const l = await c.wait(m => m.t === 'voice' && m.ids.length === 2, 2000, 'voice list'); assert.deepEqual(new Set(l.ids), new Set([a.id, b.id]));
  a.send({ t: 'rtc', to: b.id, data: { sdp: { type: 'offer', sdp: 'hello' } } });
  const r = await b.wait(m => m.t === 'rtc', 2000, 'relay'); assert.equal(r.from, a.id); assert.equal(r.data.sdp.sdp, 'hello');
  a.send({ t: 'rtc', to: c.id, data: { c: {} } }); a.send({ t: 'rtc', to: a.id, data: { c: {} } }); a.send({ t: 'rtc', to: b.id, data: 'str' }); a.send({ t: 'rtc', to: b.id, data: { big: 'x'.repeat(13000) } }); await sleep(150);
  assert.equal(c.of('rtc').length, 0, 'not in voice'); assert.equal(a.of('rtc').length, 0, 'not to self'); assert.equal(b.of('rtc').length, 1, 'junk/oversized dropped');
  d.send({ t: 'rtc', to: b.id, data: { c: {} } }); await sleep(100); assert.equal(b.of('rtc').length, 1, 'outsider blocked');
});

test('voice server: leaving, disconnecting and rejoining keep the list accurate; ICE bursts do not trip the rate limit', async () => {
  const { bots } = await srvRoom(3); const [a, b, c] = bots;
  a.send({ t: 'voice', on: true }); b.send({ t: 'voice', on: true });
  await c.wait(m => m.t === 'voice' && m.ids.length === 2, 2000, 'two');
  a.send({ t: 'voice', on: false });
  await c.wait(m => m.t === 'voice' && m.ids.length === 1 && m.ids[0] === b.id, 2000, 'a left');
  b.ws.close();
  await c.wait(m => m.t === 'voice' && m.ids.length === 0, 2000, 'disconnect removes from voice');
  c.send({ t: 'voice', on: true }); a.send({ t: 'voice', on: true }); await sleep(120);
  for (let i = 0; i < 300; i++) a.send({ t: 'rtc', to: c.id, data: { c: { i } } });
  await until(() => c.of('rtc').length >= 300, 4000, '300 candidates relayed');
  assert.equal(a.ws.readyState, 1, 'connection survived the burst');
});

/* ---------- real browsers, real WebRTC, fake microphones ---------- */
let pw = null; try { pw = require('playwright'); } catch (e) { /* optional */ }
test('REAL CALL: two browsers join voice, audio really flows both ways, mute button works, night mutes everyone', { skip: !pw && 'playwright not installed', timeout: 90000 }, async () => {
  const app = createServer({ timing: { ...FAST, dayMax: 60000 } }); APPS.push(app);
  const port = await app.listen(0), url = `http://127.0.0.1:${port}/`;
  const browser = await pw.chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const pages = [];
    for (let i = 0; i < 5; i++) {
      const ctx = await browser.newContext({ permissions: ['microphone'] }); const p = await ctx.newPage();
      await p.addInitScript(() => { window.__pcs = []; const O = window.RTCPeerConnection; window.RTCPeerConnection = function (...a) { const pc = new O(...a); window.__pcs.push(pc); return pc; }; window.RTCPeerConnection.prototype = O.prototype; });
      const errs = []; p.on('pageerror', e => errs.push(e.message)); p.errs = errs;
      await p.goto(url); pages.push(p);
    }
    const [h, p1] = pages;
    await h.fill('#nm', 'Host'); await h.click('[data-a=create]');
    await h.waitForFunction(() => /Room [A-Z]{4}/.test(document.body.textContent));
    const code = (await h.textContent('body')).match(/Room ([A-Z]{4})/)[1];
    for (let i = 1; i < 5; i++) { await pages[i].fill('#nm', 'Pal' + i); await pages[i].fill('#cd', code); await pages[i].click('[data-a=join]'); }
    await h.waitForFunction(() => /Players \(5\)/.test(document.body.textContent));
    await h.click('[data-a=voicejoin]'); await p1.click('[data-a=voicejoin]');
    const inbound = async p => p.evaluate(async () => { let b = 0; for (const pc of window.__pcs) { const st = await pc.getStats(); st.forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'audio') b += r.bytesReceived; }); } return b; });
    await until(async () => (await inbound(h)) > 2000 && (await inbound(p1)) > 2000, 20000, 'audio bytes flowing both ways');
    assert.match(await h.textContent('#voicebar'), /In voice · 2/); assert.match(await h.textContent('#voicebar'), /You are live/);
    // mic gate: mute button silences the outgoing track; unmute restores
    const trackOn = p => p.evaluate(() => window.__pcs.flatMap(pc => pc.getSenders()).filter(s => s.track).every(s => s.track.enabled));
    assert.equal(await trackOn(h), true);
    await h.click('[data-a=voicemute]'); assert.equal(await trackOn(h), false); assert.match(await h.textContent('#voicebar'), /muted/i);
    await h.click('[data-a=voicemute]'); assert.equal(await trackOn(h), true);
    // third person joins -> full mesh of 3 connected peers
    await pages[2].click('[data-a=voicejoin]');
    await until(async () => (await pages[2].evaluate(() => window.__pcs.filter(pc => pc.connectionState === 'connected').length)) === 2, 20000, 'third peer meshes in');
    // night: everybody muted, incoming audio muted too
    await h.uncheck('input[data-a=ai]'); await h.click('[data-a=start]');
    await h.waitForFunction(() => /Night 1/.test(document.body.textContent));
    await until(async () => (await trackOn(h)) === false, 5000, 'mic muted at night');
    assert.equal(await h.evaluate(() => [...document.querySelectorAll('audio.voiceaudio')].every(a => a.muted)), true, 'incoming muted at night');
    assert.match(await h.textContent('#voicebar'), /Night/);
    // day: mics come back
    await h.click('[data-a=skipNight]'); await h.waitForFunction(() => /Day 1/.test(document.body.textContent));
    await until(async () => (await trackOn(h)) === true, 5000, 'mic live by day');
    assert.equal(await h.evaluate(() => [...document.querySelectorAll('audio.voiceaudio')].every(a => !a.muted)), true);
    // leaving closes the connection for the other side
    await p1.click('[data-a=voiceleave]');
    await until(async () => (await h.evaluate(() => window.__pcs.filter(pc => pc.connectionState === 'connected').length)) === 1, 10000, 'host keeps only the remaining peer');
    for (const p of pages) assert.deepEqual(p.errs, []);
  } finally { await browser.close(); }
});

test('TURN relay: credentials are fetched server-side from the managed relay and handed to players; failure falls back to STUN', async () => {
  const calls = [];
  const fetchImpl = async url => { calls.push(url); return { ok: true, json: async () => ([{ urls: 'turn:relay.example:443?transport=tcp', username: 'u1', credential: 'c1' }, { urls: 'turns:relay.example:443', username: 'u1', credential: 'c1' }]) }; };
  const { bots } = await srvRoomOpts({ meteredApp: 'mygame', meteredKey: 'KEY123', fetchImpl });
  assert.match(calls[0], /^https:\/\/mygame\.metered\.live\/api\/v1\/turn\/credentials\?apiKey=KEY123$/);
  const ice = bots[0].ice;
  assert.ok(ice.some(s => String(s.urls).includes('stun:')), 'STUN kept');
  assert.ok(ice.some(s => s.username === 'u1' && s.credential === 'c1' && String(s.urls).startsWith('turn:')), 'TURN handed out');
  const bad = await srvRoomOpts({ meteredApp: 'mygame', meteredKey: 'KEY', fetchImpl: async () => ({ ok: false, status: 401 }) });
  assert.ok(bad.bots[0].ice.length >= 1 && !bad.bots[0].ice.some(s => s.username), 'fallback to STUN only');
  const stat = await srvRoomOpts({ turnUrl: 'turn:a.example:3478,turns:a.example:5349', turnUser: 'x', turnPass: 'y' });
  assert.deepEqual(stat.bots[0].ice[1].urls, ['turn:a.example:3478', 'turns:a.example:5349']);
});
async function srvRoomOpts(opts) { await sleep(0); const r = await srvRoom(2, opts); await sleep(120); const late = await new Bot(r.url, 'Late').join(r.code); r.bots[0] = late; return r; }
