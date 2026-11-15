'use strict';
// Stickman table: engine awards, server hit/point broadcast + guards, and the real client (jsdom) driving the SVG table.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const { JSDOM } = require('jsdom');
const { createServer } = require('../server');
const { Game } = require('../game');

const FAST = { resolveMin: 20, resolveMax: 40, dayResolve: 20, verdict: 60000, nightMax: 60000, dayMax: 60000, lobbyGrace: 500, emptyTTL: 60000 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 5000, label = '') { const t = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch (e) { /* retry */ } if (Date.now() - t > ms) throw new Error('timeout: ' + label); await sleep(25); } }
const WINDOWS = [], APPS = [], SOCKS = [];
test.after(async () => { WINDOWS.forEach(w => { try { w.close(); } catch (e) { /* ignore */ } }); SOCKS.forEach(s => { try { s.terminate(); } catch (e) { /* ignore */ } }); for (const a of APPS) { try { await a.close(); } catch (e) { /* ignore */ } } });

/* ---------- engine ---------- */
test('engine: hit/bash stats become Most Beaten + Biggest Basher awards', () => {
  const g = new Game();
  for (let i = 1; i <= 5; i++) assert.ok(g.addPlayer('p' + i, 'P' + i).ok);
  assert.ok(g.start('p1').ok);
  g.stat('bashes', 'p1'); g.stat('bashes', 'p1'); g.stat('hits', 'p4'); g.stat('hits', 'p4'); g.stat('hits', 'p4');
  g.players.forEach(p => { p.alive = p.role === 'mafia'; });          // only mafia left => town loses, game over, awards computed
  g._checkWin();
  assert.equal(g.phase, 'over');
  assert.ok(g.awards.includes('Most Beaten: P4 (3 bonks)'), JSON.stringify(g.awards));
  assert.ok(g.awards.includes('Biggest Basher: P1 (2 hits)'), JSON.stringify(g.awards));
});

/* ---------- server ---------- */
class Bot {
  constructor(url, name) { this.url = url; this.name = name; this.msgs = []; this.S = null; this.errors = []; this.waiters = []; }
  open() { return new Promise((res, rej) => { this.ws = new WebSocket(this.url); SOCKS.push(this.ws); this.ws.on('open', res); this.ws.on('error', rej); this.ws.on('message', raw => this.onRaw(raw.toString())); }); }
  onRaw(raw) { const m = JSON.parse(raw); this.msgs.push(m); if (m.t === 'joined') { this.id = m.id; this.code = m.code; } if (m.t === 'err') this.errors.push(m.msg); if (m.t === 'state') this.S = m.s; this.waiters = this.waiters.filter(w => { if (w.pred(m)) { clearTimeout(w.timer); w.res(m); return false; } return true; }); }
  send(m) { this.ws.send(JSON.stringify(m)); }
  wait(pred, ms = 4000, label = '') { return new Promise((res, rej) => { this.waiters.push({ pred, res, timer: setTimeout(() => rej(new Error('timeout ' + label)), ms) }); }); }
  async create() { await this.open(); this.send({ t: 'create', name: this.name }); await this.wait(m => m.t === 'joined'); return this; }
  async join(code) { await this.open(); this.send({ t: 'join', code, name: this.name }); await this.wait(m => m.t === 'joined'); return this; }
  of(t) { return this.msgs.filter(m => m.t === t); }
}
async function srvRoom(n) {
  const app = createServer({ timing: FAST }); APPS.push(app);
  const port = await app.listen(0), url = `ws://127.0.0.1:${port}/ws`;
  const host = await new Bot(url, 'Host').create(); const bots = [host];
  for (let i = 1; i < n; i++) bots.push(await new Bot(url, 'P' + i).join(host.code));
  await until(() => host.S && host.S.players.length === n, 3000, 'players');
  return bots;
}

test('server: hit is broadcast to everyone, validated, rate-limited, blocked at night', async () => {
  const bots = await srvRoom(5); const [host, b1, b2] = bots;
  host.send({ t: 'hit', to: b1.id, weapon: 'hammer' });
  for (const b of bots) { const m = await b.wait(x => x.t === 'hit', 2000, 'hit'); assert.deepEqual([m.from, m.to, m.n, m.tn, m.weapon], [host.id, b1.id, 'Host', 'P1', 'hammer']); }
  host.send({ t: 'hit', to: b1.id, weapon: 'hammer' });                 // too fast -> silently dropped
  await sleep(150); assert.equal(b2.of('hit').length, 1, 'rate limited');
  host.send({ t: 'hit', to: b1.id, weapon: 'nuke' }); host.send({ t: 'hit', to: 'nobody', weapon: 'fist' }); host.send({ t: 'hit', to: host.id, weapon: 'fist' });
  await sleep(150); assert.equal(b2.of('hit').length, 1, 'bad weapon / unknown target / self ignored');
  await sleep(800);
  host.send({ t: 'opts', opts: { ai: false } }); host.send({ t: 'start' });
  await host.wait(m => m.t === 'state' && m.s.phase === 'night', 3000, 'night');
  const before = b2.of('hit').length;
  host.send({ t: 'hit', to: b1.id, weapon: 'fist' }); host.send({ t: 'point', to: b1.id });
  await sleep(200);
  assert.equal(b2.of('hit').length, before); assert.equal(b2.of('point').length, 0);
  assert.match(host.errors.join(), /asleep/i);
});

test('server: point is broadcast and does not change the game state or votes by itself', async () => {
  const bots = await srvRoom(5); const [host, b1] = bots;
  host.send({ t: 'point', to: b1.id });
  for (const b of bots) { const m = await b.wait(x => x.t === 'point', 2000, 'point'); assert.deepEqual([m.from, m.to, m.tn], [host.id, b1.id, 'P1']); }
  assert.equal(host.S.phase, 'lobby');
});

/* ---------- real client ---------- */
function openClient(port) {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8').replace(/<script src="\/app.js"><\/script>/, '');
  const dom = new JSDOM(html, { url: `http://127.0.0.1:${port}/`, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; WINDOWS.push(w); w.WebSocket = WebSocket;
  const errors = []; w.addEventListener('error', e => errors.push(e.message));
  w.eval(fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'));
  return { w, errors, $: s => w.document.querySelector(s), $$: s => [...w.document.querySelectorAll(s)], click: el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })), text: () => w.document.body.textContent };
}
async function uiRoom(n) {
  const app = createServer({ timing: FAST }); APPS.push(app);
  const port = await app.listen(0), host = openClient(port);
  host.$('#nm').value = 'Host'; host.click(host.$('[data-a=create]'));
  await until(() => /Room [A-Z]{4}/.test(host.text()), 4000, 'lobby');
  const code = host.text().match(/Room ([A-Z]{4})/)[1], clients = [host];
  for (let i = 1; i < n; i++) { const c = openClient(port); c.$('#nm').value = 'Pal' + i; c.$('#cd').value = code; c.click(c.$('[data-a=join]')); clients.push(c); }
  await until(() => new RegExp(`Players \\(${n}\\)`).test(host.text()), 4000, 'players');
  return { host, clients };
}
const seats = c => c.$$('#tsvg g.seat');

test('UI: everyone is seated once around the table; hit via tap makes the stickman walk and BONK on every screen', async () => {
  const { host, clients } = await uiRoom(5);
  for (const c of clients) {
    assert.equal(seats(c).length, 5, 'five stickmen');
    assert.equal(new Set(seats(c).map(s => s.id)).size, 5, 'no duplicate seats');
    assert.equal(c.$$('#tsvg g.seat.me').length, 1);
  }
  const target = host.$$('#tsvg g.seat').find(s => !s.classList.contains('me'));
  const tid = target.getAttribute('data-v');
  host.click(target);
  await until(() => clients.every(c => c.$('#fxlayer .fxclone') && /CHAPPAL|THWAP/.test(c.$('#fxlayer').textContent)), 3000, 'walk + bonk on all screens');
  assert.match(host.$('#labels').textContent, /🤕1/);
  assert.match(host.text(), /bonked/);
  await until(() => !host.$('#fxlayer .fxclone') && seats(host).length === 5, 3000, 'clone removed, seats restored');
  assert.equal(host.$$('#tsvg g.seat').filter(s => s.style.visibility === 'hidden').length, 0);
  assert.ok(tid);
  clients.forEach(c => assert.deepEqual(c.errors, []));
});

test('UI: point mode draws a beam for everyone and (by day) casts the vote; night blocks both', async () => {
  const { host, clients } = await uiRoom(5);
  host.click(host.$('[data-a=tmode][data-v=point]'));
  assert.ok(host.$('[data-a=tmode][data-v=point]').classList.contains('on'));
  assert.equal(host.$$('.wp').length, 0, 'weapon picker hidden in point mode');
  toggleAi(host);
  host.click(host.$('[data-a=start]'));
  await until(() => clients.every(c => /Night 1/.test(c.text())), 4000, 'night');
  host.click(host.$$('#tsvg g.seat').find(s => !s.classList.contains('me')));
  await sleep(200);
  assert.equal(host.$('#fxlayer .beam'), null, 'no pointing at night');
  assert.match(host.text(), /asleep/i);
  host.click(host.$('[data-a=skipNight]'));
  await until(() => clients.every(c => /Day 1/.test(c.text())), 4000, 'day');
  const me = host.$('#tsvg g.seat.me'); assert.ok(me);
  const t = host.$$('#tsvg g.seat').find(s => !s.classList.contains('me') && !s.classList.contains('dead'));
  host.click(t);
  await until(() => clients.every(c => c.$('#fxlayer .beam')), 3000, 'beam everywhere');
  await until(() => host.$$('#tsvg .vbub').length === 1, 3000, 'vote counted on the target');
  clients.forEach(c => assert.deepEqual(c.errors, []));
});
function toggleAi(c) { const el = c.$('input[data-a=ai]'); if (el) { el.checked = false; el.dispatchEvent(new c.w.Event('change', { bubbles: true })); } }

test('UI: Hide/Show toggles the table, weapon choice is sent', async () => {
  const { host, clients } = await uiRoom(5);
  host.click(host.$('[data-a=tabletoggle]'));
  assert.equal(host.$('#tablebody').hidden, true);
  host.click(host.$('[data-a=tabletoggle]'));
  assert.equal(host.$('#tablebody').hidden, false);
  host.click(host.$('[data-a=weapon][data-v=pillow]'));
  assert.ok(host.$('[data-a=weapon][data-v=pillow]').classList.contains('on'));
  const t = host.$$('#tsvg g.seat').find(s => !s.classList.contains('me'));
  host.click(t);
  await until(() => clients[1].text().includes('🛏️'), 3000, 'pillow weapon used');
  clients.forEach(c => assert.deepEqual(c.errors, []));
});

test('UI: every bonk makes the victim redder and more battered (levels 1 to 4), resets after the game is left', async () => {
  const { host, clients } = await uiRoom(5);
  const victim = clients[1].$('#tsvg g.seat.me').getAttribute('data-v');
  const seatOf = c => c.$$('#tsvg g.seat').find(s => s.getAttribute('data-v') === victim);
  assert.equal(seatOf(host).classList.contains('hurt'), false);
  const levels = [];
  for (let i = 1; i <= 7; i++) {
    host.click(seatOf(host));
    await until(() => /🤕/.test(host.$('#labels').textContent) && host.$('#labels').textContent.includes('🤕' + i), 3000, 'hit ' + i);
    await sleep(1000);                                                     // respect the 900ms rate limit
    const s = seatOf(host);
    levels.push([i, +s.style.getPropertyValue('--hurt'), (s.getAttribute('class').match(/ l(\d)/) || [])[1]]);
  }
  assert.deepEqual(levels.map(l => l[2]), ['1', '1', '2', '2', '3', '3', '4'].map((x, i) => ['1', '1', '2', '2', '3', '3', '4'][i]).map(x => x === '2' ? '2' : x));
  assert.ok(levels[6][1] === 1 && levels[0][1] < levels[3][1] && levels[3][1] < levels[6][1], 'redness grows: ' + JSON.stringify(levels));
  const s = seatOf(host);
  assert.ok(s.querySelector('.bump') && s.querySelector('.orbit') && s.querySelector('.steam') && s.querySelector('.tear'), 'battered effects at level 4');
  host.errors && assert.deepEqual(host.errors, []);
  clients.forEach(c => assert.deepEqual(c.errors, []));
});

test('server: all 8 silly weapons work, emotes are validated + rate-limited, hats sync to everyone (and reject junk)', async () => {
  const bots = await srvRoom(5); const [host, b1, b2] = bots;
  for (const w of ['fish', 'pan', 'banana', 'chicken']) { host.send({ t: 'hit', to: b1.id, weapon: w }); await b2.wait(m => m.t === 'hit' && m.weapon === w, 2000, w); await sleep(950); }
  host.send({ t: 'emote', emote: 'dance' });
  const e = await b2.wait(m => m.t === 'emote', 2000, 'emote'); assert.deepEqual([e.from, e.emote, e.n], [host.id, 'dance', 'Host']);
  host.send({ t: 'emote', emote: 'dance' }); host.send({ t: 'emote', emote: 'explode' }); await sleep(150);
  assert.equal(b2.of('emote').length, 1, 'rate-limited + unknown emote ignored');
  b1.send({ t: 'hat', hat: 'crown' });
  await until(() => host.S.players.find(p => p.id === b1.id).hat === 'crown', 2000, 'hat synced');
  b1.send({ t: 'hat', hat: 'rocket' }); await sleep(150);
  assert.equal(host.S.players.find(p => p.id === b1.id).hat, 'crown', 'unknown hat rejected');
  b1.send({ t: 'hat', hat: 'none' });
  await until(() => host.S.players.find(p => p.id === b1.id).hat === '', 2000, 'hat removed');
});

test('UI: hat picker puts a hat on your stickman for everyone; emote plays on all screens', async () => {
  const { host, clients } = await uiRoom(5);
  host.click(host.$('[data-a=hat][data-v=crown]'));
  await until(() => clients.every(c => c.$$('#tsvg g.seat').some(s => s.querySelector('.hat'))), 3000, 'hat everywhere');
  assert.equal(host.$$('#tsvg .hat').length, 1);
  assert.ok(host.$('[data-a=hat][data-v=crown]').classList.contains('on'));
  host.click(host.$('[data-a=emote][data-v=laugh]'));
  await until(() => clients.every(c => /😂/.test(c.$('#fxlayer').textContent)), 3000, 'emote bubble');
  clients.forEach(c => assert.deepEqual(c.errors, []));
});
