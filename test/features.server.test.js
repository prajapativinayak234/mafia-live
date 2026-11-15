'use strict';
// Server tests over real WebSockets: timers, Sniper, full games with every role, scoreboard across rematches.
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createServer } = require('../server');

const FAST = { resolveMin: 20, resolveMax: 40, dayResolve: 20, verdict: 60, nightMax: 60000, dayMax: 60000, lobbyGrace: 200, emptyTTL: 60000 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ENVS = [], SOCKS = [];
test.after(async () => { SOCKS.forEach(w => { try { w.terminate(); } catch (e) { /* ignore */ } }); for (const e of ENVS) { try { await e.app.close(); } catch (x) { /* ignore */ } } });

async function boot(timing = {}) {
  const app = createServer({ timing: { ...FAST, ...timing } });
  const port = await app.listen(0);
  const env = { app, url: `ws://127.0.0.1:${port}/ws` };
  ENVS.push(env);
  return env;
}

class Bot {
  constructor(url, name) { this.url = url; this.name = name; this.msgs = []; this.S = null; this.left = undefined; this.auto = false; this.waiters = []; this.violations = []; this.errors = []; }
  open() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(this.url); SOCKS.push(this.ws);
      this.ws.on('open', res); this.ws.on('error', rej);
      this.ws.on('message', raw => this.onRaw(raw.toString()));
    });
  }
  onRaw(raw) {
    const m = JSON.parse(raw);
    this.msgs.push(m);
    if (m.t === 'joined') { this.id = m.id; this.code = m.code; }
    if (m.t === 'err') this.errors.push(m.msg);
    if (m.t === 'state') {
      this.S = m.s; this.left = m.left;
      // secrecy invariant: until the game is over, living players' roles are never sent
      if (m.s.phase !== 'over') m.s.players.filter(p => p.alive && p.role !== undefined).forEach(p => this.violations.push(`${this.name} saw role of living ${p.name}`));
      if (m.s.me && m.s.me.role !== 'sniper' && (m.s.me.canShoot !== undefined || m.s.me.sniperUsed !== undefined)) this.violations.push('sniper flag leaked to ' + m.s.me.role);
      if (this.auto) this.play();
    }
    this.waiters = this.waiters.filter(w => { if (w.pred(m)) { clearTimeout(w.timer); w.res(m); return false; } return true; });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  wait(pred, ms = 6000, label = '') {
    return new Promise((res, rej) => { const w = { pred, res, timer: setTimeout(() => rej(new Error(`timeout waiting for ${label} (${this.name})`)), ms) }; this.waiters.push(w); });
  }
  waitState(pred, ms, label) { if (this.S && pred(this.S)) return Promise.resolve(this.S); return this.wait(m => m.t === 'state' && pred(m.s), ms, label).then(m => m.s); }
  async create() { await this.open(); this.send({ t: 'create', name: this.name }); await this.wait(m => m.t === 'joined' || m.t === 'err'); return this; }
  async join(code) { await this.open(); this.send({ t: 'join', code, name: this.name }); return this.wait(m => m.t === 'joined' || m.t === 'err'); }
  play() {
    const S = this.S, me = S.me;
    if (!me || !me.alive) return;
    if (S.phase === 'night' && me.type && me.acted == null) {
      const mates = (me.mates || []).map(x => x.id);
      const t = S.players.filter(p => p.alive && p.id !== (me.type === 'kill' ? null : S.you) && !(me.type === 'kill' && (mates.includes(p.id) || p.id === S.you)));
      this.send({ t: 'act', type: me.type, target: t[Math.floor(Math.random() * t.length)].id });
    } else if (S.phase === 'day' && !S.votes[S.you]) {
      if (me.canShoot && Math.random() < 0.25) { const t = S.players.filter(p => p.alive && p.id !== S.you); this.send({ t: 'shoot', target: t[Math.floor(Math.random() * t.length)].id }); return; }
      const t = S.players.filter(p => p.alive && p.id !== S.you);
      if (t.length) this.send({ t: 'vote', target: t[Math.floor(Math.random() * t.length)].id });
    }
  }
}

async function lobby(env, n) {
  const host = await new Bot(env.url, 'Host').create();
  const bots = [host];
  for (let i = 1; i < n; i++) { const b = new Bot(env.url, 'P' + i); await b.join(host.code); bots.push(b); }
  await host.waitState(s => s.players.length === n);
  return bots;
}
const closeAll = bots => bots.forEach(b => { try { b.ws.close(); } catch (e) { /* ignore */ } });
const setOpts = async (host, opts, check) => { host.send({ t: 'opts', opts }); await host.waitState(check, 3000, 'opts applied'); };

test('lobby options: new roles and timer sync to every player; guests cannot change them', async () => {
  const env = await boot();
  const bots = await lobby(env, 5);
  const [host, g1] = bots;
  await setOpts(host, { jester: true, bodyguard: true, sniper: false, timer: 'normal' }, s => s.opts.timer === 'normal');
  const s = await g1.waitState(x => x.opts.timer === 'normal', 2000, 'guest sees opts');
  assert.deepEqual([s.opts.jester, s.opts.bodyguard, s.opts.sniper], [true, true, false]);
  g1.send({ t: 'opts', opts: { timer: 'fast', sniper: true } });
  await sleep(100);
  assert.equal(host.S.opts.timer, 'normal'); assert.equal(host.S.opts.sniper, false);
  assert.match(g1.errors.join(), /host/i);
  // too many specials for 5 players -> start refused with a clear message
  await setOpts(host, { sniper: true }, x => x.opts.sniper === true);
  host.send({ t: 'start' }); await sleep(100);
  assert.match(host.errors.join(), /special roles/i);
  assert.equal(host.S.phase, 'lobby');
  closeAll(bots);
});

test('timer OFF: no countdown is sent (state.left is null)', async () => {
  const env = await boot();
  const bots = await lobby(env, 5);
  await setOpts(bots[0], { ai: false }, s => s.opts.ai === false);
  bots[0].send({ t: 'start' });
  await bots[0].waitState(s => s.phase === 'night', 3000, 'night');
  await sleep(100);
  assert.equal(bots[0].left, null);
  closeAll(bots);
});

test('timer ON: countdown is sent and the night + day end by themselves when it hits zero', async () => {
  // fast = 45s night / 90s day; scaled x0.03 => ~1.35s night, ~2.7s day. The 60s safety nets prove the preset is what fires.
  const env = await boot({ timerScale: 0.03 });
  const bots = await lobby(env, 5);
  const host = bots[0];
  await setOpts(host, { timer: 'fast', ai: false }, s => s.opts.timer === 'fast');
  host.send({ t: 'start' });
  await host.waitState(s => s.phase === 'night', 3000, 'night');
  await sleep(50);
  assert.ok(typeof host.left === 'number' && host.left > 0 && host.left <= 1350, 'night countdown within preset, got ' + host.left);
  const first = host.left; await sleep(300);
  host.send({ t: 'ping' }); await sleep(30);
  // nobody acts: the night must resolve on its own around 1.35s
  const t0 = Date.now();
  await host.waitState(s => s.phase === 'day', 4000, 'day by timer');
  assert.ok(Date.now() - t0 < 3500);
  await sleep(50);
  assert.ok(typeof host.left === 'number' && host.left > 0 && host.left <= 2700, 'day countdown within preset, got ' + host.left);
  assert.ok(first <= 1350);
  // nobody votes: the day resolves as a tie, then verdict -> night 2 automatically
  await host.waitState(s => s.phase === 'night' && s.day === 2, 6000, 'night 2 by timer');
  closeAll(bots);
});

test('timer: a resolved phase gets a fresh countdown (not the old one)', async () => {
  const env = await boot({ timerScale: 0.2 });          // night 9s, day 18s
  const bots = await lobby(env, 5);
  const host = bots[0];
  await setOpts(host, { timer: 'fast', ai: false }, s => s.opts.timer === 'fast');
  host.send({ t: 'start' });
  await host.waitState(s => s.phase === 'night', 3000, 'night');
  await sleep(50);
  assert.ok(host.left > 8000 && host.left <= 9000, 'night countdown starts at the preset: ' + host.left);   // clients tick it down locally
  host.send({ t: 'skipNight' });
  await host.waitState(s => s.phase === 'day', 3000, 'day');
  await sleep(50);
  assert.ok(host.left > 16000 && host.left <= 18000, 'day countdown restarted: ' + host.left);
  closeAll(bots);
});

test('Sniper over the wire: hitting the Mafia ends the game; secrecy holds', async () => {
  const env = await boot();
  const bots = await lobby(env, 5);
  const host = bots[0];
  await setOpts(host, { sniper: true, doctor: false, detective: false, ai: false }, s => s.opts.sniper && !s.opts.doctor);
  host.send({ t: 'start' });
  await Promise.all(bots.map(b => b.waitState(s => s.phase === 'night' && s.me, 3000, 'roles')));
  const sniper = bots.find(b => b.S.me.role === 'sniper');
  const mafia = bots.find(b => b.S.me.role === 'mafia');
  assert.ok(sniper && mafia);
  sniper.send({ t: 'shoot', target: mafia.id }); await sleep(80);            // too early (night)
  assert.match(sniper.errors.join(), /during the day/);
  host.send({ t: 'skipNight' });
  await Promise.all(bots.map(b => b.waitState(s => s.phase === 'day', 3000, 'day')));
  assert.equal(sniper.S.me.canShoot, true);
  const villager = bots.find(b => b.S.me.role === 'villager');
  villager.send({ t: 'shoot', target: mafia.id }); await sleep(80);          // not the sniper
  assert.match(villager.errors.join(), /not the Sniper/);
  assert.equal(mafia.S.players.find(p => p.id === mafia.id).alive, true);
  sniper.send({ t: 'shoot', target: mafia.id });
  const over = await host.waitState(s => s.phase === 'over', 3000, 'game over');
  assert.equal(over.winner, 'town');
  assert.match(over.announce, /BANG/);
  assert.equal(over.event.died.role, 'mafia'); assert.equal(over.event.backfire, false);
  assert.equal(over.board.length, 5);
  const win = over.board.find(b => b.id === sniper.id);
  assert.deepEqual([win.wins, win.games, win.points], [1, 1, 4]);
  bots.forEach(b => assert.deepEqual(b.violations, []));
  closeAll(bots);
});

test('Sniper over the wire: hitting an innocent kills both and the vote goes on', async () => {
  const env = await boot();
  const bots = await lobby(env, 6);
  const host = bots[0];
  await setOpts(host, { sniper: true, doctor: false, detective: false, ai: false }, s => s.opts.sniper);
  host.send({ t: 'start' });
  await Promise.all(bots.map(b => b.waitState(s => s.phase === 'night' && s.me, 3000, 'roles')));
  host.send({ t: 'skipNight' });
  await Promise.all(bots.map(b => b.waitState(s => s.phase === 'day', 3000, 'day')));
  const sniper = bots.find(b => b.S.me.role === 'sniper');
  const innocent = bots.find(b => b.S.me.role === 'villager');
  sniper.send({ t: 'shoot', target: innocent.id });
  const s = await host.waitState(x => x.players.filter(p => !p.alive).length === 2, 3000, 'both dead');
  assert.equal(s.phase, 'day');
  assert.equal(s.event.backfire, true);
  assert.equal(s.players.find(p => p.id === sniper.id).role, 'sniper');         // dead players are revealed
  sniper.send({ t: 'shoot', target: bots.find(b => b.S.me.role === 'mafia').id }); await sleep(80);
  assert.ok(sniper.errors.length > 0);                                          // dead / bullet used
  bots.forEach(b => assert.deepEqual(b.violations, []));
  closeAll(bots);
});

test('Jester over the wire: everyone votes them out and the Jester wins', async () => {
  const env = await boot();
  const bots = await lobby(env, 5);
  const host = bots[0];
  await setOpts(host, { jester: true, ai: false }, s => s.opts.jester);
  host.send({ t: 'start' });
  await Promise.all(bots.map(b => b.waitState(s => s.phase === 'night' && s.me, 3000, 'roles')));
  host.send({ t: 'skipNight' });
  await Promise.all(bots.map(b => b.waitState(s => s.phase === 'day', 3000, 'day')));
  const jester = bots.find(b => b.S.me.role === 'jester');
  bots.filter(b => b !== jester).forEach(b => b.send({ t: 'vote', target: jester.id }));
  jester.send({ t: 'vote', target: bots.find(b => b !== jester).id });            // everyone must vote for the round to close early
  const over = await host.waitState(s => s.phase === 'over', 4000, 'over');
  assert.equal(over.winner, 'jester');
  assert.equal(over.event.out.role, 'jester');
  const row = over.board.find(b => b.id === jester.id);
  assert.deepEqual([row.wins, row.points], [1, 3]);
  closeAll(bots);
});

test('Bodyguard over the wire: night needs the bodyguard and they die for the victim', async () => {
  const env = await boot();
  const bots = await lobby(env, 6);
  const host = bots[0];
  await setOpts(host, { bodyguard: true, doctor: false, detective: false, ai: false }, s => s.opts.bodyguard);
  host.send({ t: 'start' });
  await Promise.all(bots.map(b => b.waitState(s => s.phase === 'night' && s.me, 3000, 'roles')));
  const bg = bots.find(b => b.S.me.role === 'bodyguard'), mafia = bots.find(b => b.S.me.role === 'mafia');
  const victim = bots.find(b => b.S.me.role === 'villager');
  assert.equal(bg.S.me.type, 'guard');
  bg.send({ t: 'act', type: 'guard', target: bg.id }); await sleep(80);
  assert.match(bg.errors.join(), /cannot guard yourself/);
  mafia.send({ t: 'act', type: 'kill', target: victim.id });
  await sleep(300);
  assert.equal(host.S.phase, 'night');                                          // still waiting for the bodyguard
  bg.send({ t: 'act', type: 'guard', target: victim.id });
  const s = await host.waitState(x => x.phase === 'day', 4000, 'day');
  assert.equal(s.players.find(p => p.id === victim.id).alive, true);
  assert.equal(s.players.find(p => p.id === bg.id).alive, false);
  assert.equal(s.event.guarded, victim.S.me && s.players.find(p => p.id === victim.id).name);
  closeAll(bots);
});

test('full random games with EVERY role + timer finish, scoreboard persists across a rematch, secrets never leak', async () => {
  const env = await boot({ timerScale: 0.02 });
  const bots = await lobby(env, 9);
  const host = bots[0];
  await setOpts(host, { mafia: 2, jester: true, bodyguard: true, sniper: true, timer: 'fast', ai: false }, s => s.opts.sniper && s.opts.timer === 'fast');
  bots.forEach(b => { b.auto = true; });
  for (let round = 1; round <= 2; round++) {
    host.send({ t: 'start' });
    const over = await host.waitState(s => s.phase === 'over' && s.board.length === 9 && s.board.every(r => r.games === round), 30000, 'game over, round ' + round);
    assert.ok(['town', 'mafia', 'jester'].includes(over.winner));
    assert.ok(over.players.every(p => p.role), 'all roles revealed at the end');
    assert.ok(over.board.reduce((n, r) => n + r.wins, 0) >= round, 'someone won each round');
    assert.equal(over.board.length, 9);
    if (round === 1) { host.send({ t: 'again' }); await host.waitState(s => s.phase === 'lobby' && s.board.length === 9, 3000, 'lobby with board'); }
  }
  bots.forEach(b => assert.deepEqual(b.violations, [], b.name));
  closeAll(bots);
});
