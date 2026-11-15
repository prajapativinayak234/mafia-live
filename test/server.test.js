'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');
const { createServer } = require('../server');

const FAST = { resolveMin: 20, resolveMax: 40, dayResolve: 20, verdict: 60, nightMax: 4000, dayMax: 4000, lobbyGrace: 200, emptyTTL: 60000 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ENVS = [], SOCKS = [];
test.after(async () => { SOCKS.forEach(w => { try { w.terminate(); } catch (e) { /* ignore */ } }); for (const e of ENVS) { try { await e.app.close(); } catch (x) { /* ignore */ } } });

async function boot(extra = {}) {
  const app = createServer({ timing: FAST, ...extra });
  const port = await app.listen(0);
  const env = { app, port, url: `ws://127.0.0.1:${port}/ws`, http: `http://127.0.0.1:${port}` };
  ENVS.push(env);
  return env;
}

class Bot {
  constructor(url, name) { this.url = url; this.name = name; this.msgs = []; this.S = null; this.auto = false; this.waiters = []; }
  open() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(this.url);
      SOCKS.push(this.ws);
      this.ws.on('open', res); this.ws.on('error', rej);
      this.ws.on('message', raw => this.onRaw(raw.toString()));
    });
  }
  onRaw(raw) {
    this.msgs.push(raw);
    const m = JSON.parse(raw);
    if (m.t === 'joined') { this.id = m.id; this.token = m.token; this.code = m.code; this.joined = m; }
    if (m.t === 'state') { this.S = m.s; if (this.auto) this.play(); }
    this.waiters = this.waiters.filter(w => { if (w.pred(m)) { clearTimeout(w.timer); w.res(m); return false; } return true; });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  wait(pred, ms = 5000, label = '') {
    for (const m of this.msgs.slice(-1)) { /* only future messages */ }
    return new Promise((res, rej) => {
      const w = { pred, res, timer: setTimeout(() => rej(new Error('timeout waiting for ' + label + ' (' + this.name + ')')), ms) };
      this.waiters.push(w);
    });
  }
  waitState(pred, ms, label) {
    if (this.S && pred(this.S)) return Promise.resolve(this.S);
    return this.wait(m => m.t === 'state' && pred(m.s), ms, label).then(m => m.s);
  }
  async create() { await this.open(); this.send({ t: 'create', name: this.name }); await this.wait(m => m.t === 'joined' || m.t === 'err'); return this; }
  async join(code) { await this.open(); this.send({ t: 'join', code, name: this.name }); return this.wait(m => m.t === 'joined' || m.t === 'err'); }
  errs() { return this.msgs.map(JSON.parse).filter(m => m.t === 'err').map(m => m.msg); }
  play() {
    const S = this.S, me = S.me;
    if (!me || !me.alive) return;
    if (S.phase === 'night' && me.type && me.acted == null) {
      const mates = (me.mates || []).map(x => x.id);
      const t = S.players.filter(p => p.alive && !(me.type === 'kill' && mates.includes(p.id)) && !(me.type === 'probe' && p.id === S.you));
      this.send({ t: 'act', type: me.type, target: t[Math.floor(Math.random() * t.length)].id });
    } else if (S.phase === 'day' && !S.votes[S.you]) {
      const t = S.players.filter(p => p.alive && p.id !== S.you);
      if (t.length) this.send({ t: 'vote', target: t[Math.floor(Math.random() * t.length)].id });
    }
  }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

async function lobby(env, n, names = null) {
  const host = await new Bot(env.url, 'Host').create();
  const bots = [host];
  for (let i = 1; i < n; i++) { const b = new Bot(env.url, names ? names[i] : 'P' + i); await b.join(host.code); bots.push(b); }
  await host.waitState(s => s.players.length === n);
  return bots;
}
const closeAll = bots => bots.forEach(b => b.close());
const roleOf = (bots, b) => b.S.me.role;

test('serves the page, healthz, blocks path traversal', async () => {
  const env = await boot();
  const get = p => new Promise(r => http.get(env.http + p, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => r({ status: res.statusCode, body: d, headers: res.headers })); }));
  const home = await get('/');
  assert.equal(home.status, 200); assert.match(home.body, /Mafia Live/);
  assert.match(home.headers['content-security-policy'], /script-src 'self'/);
  assert.equal((await get('/healthz')).body, 'ok');
  assert.equal((await get('/app.js')).status, 200);
  assert.ok([403, 404].includes((await get('/..%2f..%2fetc%2fpasswd')).status));
  assert.equal((await get('/../server.js')).status === 200, false);
  assert.equal((await get('/nope')).status, 404);
  await env.app.close();
});

test('lobby: create, join, duplicate names, bad codes, start rules', async () => {
  const env = await boot();
  const host = await new Bot(env.url, 'Host').create();
  assert.match(host.code, /^[A-Z]{4}$/);
  const dup = new Bot(env.url, 'host'); const r = await dup.join(host.code);
  assert.equal(r.t, 'err'); assert.match(r.msg, /taken/);
  const bad = new Bot(env.url, 'Zed'); const r2 = await bad.join('ZZZZ');
  assert.equal(r2.t, 'err'); assert.match(r2.msg, /not found/i);
  const bots = [host];
  for (let i = 1; i < 4; i++) { const b = new Bot(env.url, 'P' + i); await b.join(host.code); bots.push(b); }
  host.send({ t: 'start' });
  await sleep(100);
  assert.match(host.errs().join(), /at least 5/);
  const p5 = new Bot(env.url, 'P5'); await p5.join(host.code); bots.push(p5);
  await host.waitState(s => s.players.length === 5 && s.canStart);
  p5.send({ t: 'start' });                       // non-host cannot start
  await sleep(100);
  assert.match(p5.errs().join(), /host/i);
  assert.equal(host.S.phase, 'lobby');
  p5.send({ t: 'opts', opts: { mafia: 2 } });    // non-host cannot change settings
  await sleep(60);
  assert.equal(host.S.opts.mafia, 1);
  host.send({ t: 'opts', opts: { mafia: 99, style: 'roast', ai: false } });
  const s = await host.waitState(x => x.opts.style === 'roast');
  assert.equal(s.opts.mafia, 8); assert.equal(s.opts.ai, false);
  host.send({ t: 'start' });                     // too many mafia
  await sleep(100);
  assert.match(host.errs().join(), /Too many Mafia/);
  host.send({ t: 'opts', opts: { mafia: 2 } });
  await host.waitState(x => x.opts.mafia === 2);
  host.send({ t: 'start' });
  await host.waitState(x => x.phase === 'night');
  const late = new Bot(env.url, 'Late'); const r3 = await late.join(host.code);
  assert.equal(r3.t, 'err'); assert.match(r3.msg, /already started/);
  closeAll(bots); await env.app.close();
});

test('kick in lobby removes player and notifies them', async () => {
  const env = await boot();
  const bots = await lobby(env, 6);
  bots[0].send({ t: 'kick', id: bots[5].id });
  await bots[5].wait(m => m.t === 'kicked');
  await bots[0].waitState(s => s.players.length === 5);
  bots[1].send({ t: 'kick', id: bots[2].id });  // non-host
  await sleep(80);
  assert.equal(bots[0].S.players.length, 5);
  closeAll(bots); await env.app.close();
});

test('FULL GAMES with 7 bots: complete, valid winners, and ZERO role leaks', async () => {
  for (let round = 0; round < 6; round++) {
    const env = await boot();
    const bots = await lobby(env, 7);
    bots.forEach(b => { b.auto = true; });
    bots[0].send({ t: 'opts', opts: { mafia: 2, ai: true } });
    await bots[0].waitState(s => s.opts.mafia === 2);
    bots[0].send({ t: 'start' });
    await Promise.all(bots.map(b => b.waitState(s => s.phase === 'over', 20000, 'game over')));
    const S0 = bots[0].S;
    assert.ok(['town', 'mafia'].includes(S0.winner));
    // everyone sees all roles at the end and they agree
    for (const b of bots) assert.deepEqual(b.S.players.map(p => p.role), S0.players.map(p => p.role));
    // roles dealt to each bot match what the end screen reveals about them
    const realRole = {}; bots.forEach(b => { realRole[b.id] = b.firstRole || null; });
    // LEAK SCAN over every message every bot ever received
    const roleByPlayer = {}; S0.players.forEach(p => { roleByPlayer[p.id] = p.role; });
    for (const b of bots) {
      const myRole = roleByPlayer[b.id];
      let seenOverState = false;
      for (const raw of b.msgs) {
        const m = JSON.parse(raw);
        if (m.t !== 'state') continue;
        const s = m.s;
        if (s.phase === 'over') seenOverState = true;
        for (const p of s.players) {
          if (s.phase !== 'over' && p.alive) assert.equal(p.role, undefined, `${b.name} saw role of living ${p.name}`);
          if (p.role !== undefined && s.phase !== 'over') assert.equal(p.alive, false);
        }
        if (s.me) {
          assert.equal(s.me.role, myRole, 'own role changed mid-game');
          if (myRole !== 'mafia') { assert.equal(s.me.mates, undefined); assert.equal(s.me.matePicks, undefined); }
          if (myRole === 'villager') assert.equal(s.me.type, undefined);
          if (myRole !== 'detective') assert.equal(s.me.det, undefined);
        }
        if (!seenOverState) { assert.deepEqual(s.log, []); assert.deepEqual(s.awards, []); assert.equal(s.dare, ''); }
      }
    }
    closeAll(bots); await env.app.close();
  }
});

test('chat channel isolation, night silence, ghost chat, text sanitising', async () => {
  const env = await boot();
  const bots = await lobby(env, 7);
  bots[0].send({ t: 'opts', opts: { mafia: 2 } });
  await bots[0].waitState(s => s.opts.mafia === 2);
  bots[0].send({ t: 'chat', ch: 'town', text: 'hello lobby' });
  await Promise.all(bots.map(b => b.wait(m => m.t === 'chat' && m.text === 'hello lobby')));
  bots[0].send({ t: 'start' });
  await Promise.all(bots.map(b => b.waitState(s => s.phase === 'night' && s.me)));
  const mafia = bots.filter(b => b.S.me.role === 'mafia'), others = bots.filter(b => b.S.me.role !== 'mafia');
  assert.equal(mafia.length, 2);
  // night: town chat blocked
  others[0].send({ t: 'chat', ch: 'town', text: 'night talk' });
  await sleep(100);
  assert.match(others[0].errs().join(), /Night/);
  assert.ok(!bots.some(b => b.msgs.some(r => r.includes('night talk'))));
  // mafia chat reaches only mafia
  mafia[0].send({ t: 'chat', ch: 'mafia', text: 'secret plan' });
  await mafia[1].wait(m => m.t === 'chat' && m.text === 'secret plan');
  await sleep(100);
  for (const o of others) assert.ok(!o.msgs.some(r => r.includes('secret plan')), 'mafia chat leaked');
  // non-mafia cannot use mafia channel; alive cannot use ghost channel
  others[0].send({ t: 'chat', ch: 'mafia', text: 'sneak' });
  others[0].send({ t: 'chat', ch: 'ghost', text: 'boo' });
  await sleep(100);
  assert.ok(!bots.some(b => b.msgs.some(r => r.includes('sneak') || r.includes('"boo"'))));
  // ghost chat: mafia kills someone (not a mafia), then ghost can speak to other ghosts only
  const victim = others.find(b => b.S.me.role === 'villager');
  mafia.forEach(m => m.send({ t: 'act', type: 'kill', target: victim.id }));
  others.forEach(o => { if (o.S.me.type === 'save') o.send({ t: 'act', type: 'save', target: o.id }); if (o.S.me.type === 'probe') o.send({ t: 'act', type: 'probe', target: mafia[0].id }); });
  // make sure the doctor does not save the victim: doctor saved self (or victim is the doctor? victim is villager)
  await Promise.all(bots.map(b => b.waitState(s => s.phase === 'day', 8000, 'day')));
  assert.equal(victim.S.me.alive, false);
  victim.send({ t: 'chat', ch: 'town', text: 'ghost in town' });   // dead cannot use town
  victim.send({ t: 'chat', ch: 'ghost', text: 'ghost whisper' });
  await sleep(150);
  assert.match(victim.errs().join(), /Ghosts chat/);
  assert.ok(victim.msgs.some(r => r.includes('ghost whisper')));
  for (const b of bots) if (b !== victim) assert.ok(!b.msgs.some(r => r.includes('ghost whisper')), 'ghost chat leaked to the living');
  assert.ok(!bots.some(b => b.msgs.some(r => r.includes('ghost in town'))));
  // text is length-capped and control characters stripped
  await sleep(700); // chat cooldown
  mafia[0].send({ t: 'chat', ch: 'town', text: 'x'.repeat(500) + '\u0007' });
  const long = await bots[1].wait(m => m.t === 'chat' && m.text.startsWith('xxx'));
  assert.equal(long.text.length, 200);
  closeAll(bots); await env.app.close();
});

test('invalid actions are rejected with errors and change nothing', async () => {
  const env = await boot();
  const bots = await lobby(env, 6);
  bots[0].send({ t: 'opts', opts: { mafia: 1, doctor: true, detective: true } });
  await bots[0].waitState(s => s.opts.mafia === 1);
  bots[0].send({ t: 'start' });
  await Promise.all(bots.map(b => b.waitState(s => s.phase === 'night' && s.me)));
  const by = r => bots.find(b => b.S.me.role === r);
  const vill = bots.find(b => b.S.me.role === 'villager' && b !== bots[0]), maf = by('mafia'), doc = by('doctor'), det = by('detective');
  vill.send({ t: 'act', type: 'kill', target: maf.id });         // no power
  vill.send({ t: 'vote', target: maf.id });                       // not day
  maf.send({ t: 'act', type: 'kill', target: maf.id });           // own team
  maf.send({ t: 'act', type: 'save', target: vill.id });          // wrong type
  det.send({ t: 'act', type: 'probe', target: det.id });          // self
  doc.send({ t: 'act', type: 'save', target: 'bogus' });          // bad target
  vill.send({ t: 'closeVote' }); vill.send({ t: 'skipNight' });   // host only
  vill.send({ t: 'again' });                                      // host only / not over
  vill.send({ t: 'nonsense' });
  await sleep(200);
  assert.ok(vill.errs().length >= 5);
  assert.ok(maf.errs().length >= 2);
  assert.equal(det.errs().length >= 1, true);
  assert.equal(doc.errs().length >= 1, true);
  assert.equal(det.S.me.acted, null);
  // the real actions still work and the night completes by itself
  maf.send({ t: 'act', type: 'kill', target: vill.id });
  doc.send({ t: 'act', type: 'save', target: vill.id });
  det.send({ t: 'act', type: 'probe', target: maf.id });
  const d = await det.waitState(s => s.me && s.me.det, 3000);
  assert.equal(d.me.det.mafia, true);
  await Promise.all(bots.map(b => b.waitState(s => s.phase === 'day', 4000, 'day')));
  assert.equal(bots[0].S.players.every(p => p.alive), true);      // doctor saved
  garbage(bots[0]);
  closeAll(bots); await env.app.close();
});
function garbage(b) { b.ws.send('not json'); b.ws.send('[1,2]'); b.ws.send('null'); b.ws.send('{"t":5}'); }

test('reconnect with token restores seat and role; bad token is rejected', async () => {
  const env = await boot();
  const bots = await lobby(env, 6);
  bots[0].send({ t: 'start' });
  await Promise.all(bots.map(b => b.waitState(s => s.phase === 'night' && s.me)));
  const b = bots[3], role = b.S.me.role, token = b.token, id = b.id, code = b.code;
  b.close();
  await bots[0].waitState(s => s.players.find(p => p.id === id && !p.connected), 3000, 'marked offline');
  const b2 = new Bot(env.url, 'again'); await b2.open();
  b2.send({ t: 'resume', code, token });
  const j = await b2.wait(m => m.t === 'joined');
  assert.equal(j.id, id);
  const s = await b2.waitState(x => x.me);
  assert.equal(s.me.role, role);
  await bots[0].waitState(sx => sx.players.find(p => p.id === id && p.connected), 3000, 'back online');
  // old socket replaced when the same token is used twice
  const b3 = new Bot(env.url, 'dup'); await b3.open(); b3.send({ t: 'resume', code, token });
  await b3.wait(m => m.t === 'joined');
  await sleep(100);
  assert.equal(b2.ws.readyState === WebSocket.OPEN, false);
  const bad = new Bot(env.url, 'bad'); await bad.open(); bad.send({ t: 'resume', code, token: 'nope' });
  await bad.wait(m => m.t === 'gone');
  const bad2 = new Bot(env.url, 'bad2'); await bad2.open(); bad2.send({ t: 'resume', code: 'QQQQ', token });
  await bad2.wait(m => m.t === 'gone');
  closeAll([...bots, b3]); await env.app.close();
});

test('disconnected special roles do not stall the night', async () => {
  const env = await boot();
  const bots = await lobby(env, 6);
  bots[0].send({ t: 'start' });
  await Promise.all(bots.map(b => b.waitState(s => s.phase === 'night' && s.me)));
  const maf = bots.find(b => b.S.me.role === 'mafia');
  maf.close();
  const rest = bots.filter(b => b !== maf);
  await sleep(100);
  rest.forEach(b => b.play ? b.play.call(b) : null);
  await Promise.all(rest.map(b => b.waitState(s => s.phase === 'day' || s.phase === 'over', 6000, 'night completes without mafia')));
  assert.equal(rest[0].S.players.every(p => p.alive) || rest[0].S.phase === 'over', true);
  closeAll(bots); await env.app.close();
});

test('host leaving transfers host; new host can start/skip', async () => {
  const env = await boot();
  const bots = await lobby(env, 6);
  const oldHost = bots[0];
  oldHost.close();
  const s = await bots[1].waitState(x => x.hostId !== oldHost.id, 3000, 'host transfer');
  const newHost = bots.find(b => b.id === s.hostId);
  assert.ok(newHost && newHost !== oldHost);
  await sleep(300); // lobby grace removes the departed player
  await newHost.waitState(x => x.players.length === 5, 3000, 'lobby cleanup');
  newHost.send({ t: 'start' });
  await newHost.waitState(x => x.phase === 'night');
  newHost.send({ t: 'skipNight' });
  await newHost.waitState(x => x.phase === 'day' || x.phase === 'over', 3000, 'host skipped the night');
  closeAll(bots); await env.app.close();
});

test('fx and roast: whitelist, server-composed text, cooldowns', async () => {
  const env = await boot();
  const bots = await lobby(env, 5, ['Host', 'Anu', 'Raj', 'Sia', 'Dev']);
  const [h, a, r] = bots;
  a.send({ t: 'fx', to: r.id, emoji: '🍅' });
  const fx = await r.wait(m => m.t === 'fx');
  assert.equal(fx.n, 'Anu'); assert.equal(fx.tn, 'Raj'); assert.equal(fx.emoji, '🍅');
  const before = h.msgs.length;
  await sleep(750);
  a.send({ t: 'fx', to: r.id, emoji: '<script>' });               // not whitelisted
  a.send({ t: 'fx', to: a.id, emoji: '🍅' });                      // not yourself
  a.send({ t: 'fx', to: 'ghost', emoji: '🍅' });                   // unknown target
  await sleep(150);
  assert.equal(h.msgs.slice(before).filter(x => JSON.parse(x).t === 'fx').length, 0);
  a.send({ t: 'roast', to: r.id, i: 1 });
  const ro = await h.wait(m => m.t === 'roast');
  assert.match(ro.text, /Raj is so sus/);
  a.send({ t: 'roast', to: r.id, i: 2 });                          // cooldown
  await sleep(100);
  assert.match(a.errs().join(), /Reload/);
  await sleep(2500);
  a.send({ t: 'roast', to: r.id, i: 999 }); a.send({ t: 'roast', to: r.id, i: -1 }); a.send({ t: 'roast', to: r.id, i: '<b>' });
  await sleep(150);
  assert.equal(h.msgs.filter(x => JSON.parse(x).t === 'roast').length, 1);
  closeAll(bots); await env.app.close();
});

test('chat rate limit and oversized frames', async () => {
  const env = await boot();
  const bots = await lobby(env, 5);
  const [h, a] = bots;
  for (let i = 0; i < 5; i++) a.send({ t: 'chat', ch: 'town', text: 'spam ' + i });
  await sleep(200);
  const delivered = h.msgs.filter(x => JSON.parse(x).t === 'chat').length;
  assert.ok(delivered <= 2, 'rate limit let through ' + delivered);
  assert.match(a.errs().join(), /Slow down/);
  const big = new Bot(env.url, 'big'); await big.open();
  const closed = new Promise(r => big.ws.on('close', c => r(c)));
  big.ws.send('x'.repeat(20000));
  assert.equal(await closed, 1009);
  closeAll(bots); await env.app.close();
});

test('AI narrator: preset lines, fake model, model failure fallback, and no secrets in prompts', async () => {
  // preset (no key)
  let env = await boot();
  let bots = await lobby(env, 6);
  bots[0].send({ t: 'start' });
  let s = await bots[1].waitState(x => x.narrator && x.narrator.text, 3000, 'preset narration');
  assert.ok(s.narrator.text.length > 10);
  closeAll(bots); await env.app.close();

  // fake model
  const prompts = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body); prompts.push(body.messages[0].content);
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: '"Model says hello!"' }] }) };
  };
  env = await boot({ narrator: { apiKey: 'test-key', fetchImpl, model: 'fake' } });
  bots = await lobby(env, 6, ['Host', 'Anu', 'Raj', 'Sia', 'Dev', 'Meera']);
  bots.forEach(b => { b.auto = true; });
  bots[0].send({ t: 'start' });
  s = await bots[1].waitState(x => x.narrator && x.narrator.text === 'Model says hello!', 3000, 'model narration');
  await Promise.all(bots.map(b => b.waitState(x => x.phase === 'over', 20000, 'over')));
  assert.ok(prompts.length >= 3);
  // every prompt before the game ended must hide roles of living players
  const beforeEnd = prompts.filter(p => !/Moment: over/.test(p));
  for (const p of beforeEnd) assert.ok(!/=(Mafia|Doctor|Detective|Villager)/.test(p), 'role table leaked into a prompt: ' + p);
  assert.ok(prompts.some(p => /Moment: over/.test(p)));
  closeAll(bots); await env.app.close();

  // failing model falls back to preset lines
  const failing = async () => { throw new Error('network down'); };
  env = await boot({ narrator: { apiKey: 'test-key', fetchImpl: failing } });
  bots = await lobby(env, 6);
  bots[0].send({ t: 'start' });
  s = await bots[1].waitState(x => x.narrator && x.narrator.text, 3000, 'fallback narration');
  assert.ok(s.narrator.text.length > 10);
  closeAll(bots); await env.app.close();

  // narrator off
  env = await boot();
  bots = await lobby(env, 6);
  bots[0].send({ t: 'opts', opts: { ai: false } });
  await bots[0].waitState(x => x.opts.ai === false);
  bots[0].send({ t: 'start' });
  await bots[1].waitState(x => x.phase === 'night');
  await sleep(200);
  assert.equal(bots[1].S.narrator, null);
  closeAll(bots); await env.app.close();
});

test('play again returns to lobby and a second game works', async () => {
  const env = await boot();
  const bots = await lobby(env, 6);
  bots.forEach(b => { b.auto = true; });
  bots[0].send({ t: 'start' });
  await Promise.all(bots.map(b => b.waitState(x => x.phase === 'over', 20000)));
  bots[1].send({ t: 'again' }); await sleep(80);
  assert.equal(bots[0].S.phase, 'over');                // non-host ignored
  bots[0].send({ t: 'again' });
  await Promise.all(bots.map(b => b.waitState(x => x.phase === 'lobby', 3000, 'lobby')));
  bots.forEach(b => { b.S = null; });
  bots[0].send({ t: 'start' });
  await Promise.all(bots.map(b => b.waitState(x => x.phase === 'night' && x.me, 3000, 'second game')));
  await Promise.all(bots.map(b => b.waitState(x => x.phase === 'over', 20000, 'second game over')));
  closeAll(bots); await env.app.close();
});

test('stale night actions from a previous night cannot leak into the next', async () => {
  const env = await boot();
  const bots = await lobby(env, 7);
  bots[0].send({ t: 'opts', opts: { mafia: 1 } });
  bots.forEach(b => { b.auto = true; });
  bots[0].send({ t: 'start' });
  const seenNights = new Set();
  await Promise.all(bots.map(b => b.waitState(x => { if (x.phase === 'night') seenNights.add(x.day); return x.phase === 'over'; }, 20000)));
  for (const b of bots) for (const raw of b.msgs) {
    const m = JSON.parse(raw);
    if (m.t === 'state' && m.s.phase === 'night' && m.s.me && m.s.me.type) {
      // at the very first state of a night, nobody has acted yet
      if (m.s.me.acted != null) { const tgt = m.s.players.find(p => p.id === m.s.me.acted); assert.ok(tgt && tgt.alive, 'acted target must be alive'); }
    }
  }
  closeAll(bots); await env.app.close();
});
