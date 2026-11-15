'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Game, HATS } = require('./game');
const { THROWS, ROASTS } = require('./lines');
const { narrate } = require('./narrator');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DEFAULT_TIMING = { resolveMin: 2500, resolveMax: 5000, dayResolve: 1200, verdict: 7000, nightMax: 120000, dayMax: 600000, lobbyGrace: 20000, emptyTTL: 600000, idleTTL: 10800000, timerScale: 1 };
const TIMER_PRESETS = { fast: { night: 45000, day: 90000 }, normal: { night: 75000, day: 180000 }, relaxed: { night: 120000, day: 300000 } };

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' ws: wss:; img-src 'self' data:; base-uri 'none'; object-src 'none'; form-action 'none'; media-src 'self' blob: mediastream:; worker-src 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'microphone=(self), camera=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY'
};

const WEAPONS = ['slipper', 'hammer', 'pillow', 'fist', 'fish', 'pan', 'banana', 'chicken'];
const EMOTES = ['dance', 'cry', 'laugh', 'facepalm', 'flex', 'dizzy'];
const uid = () => crypto.randomBytes(6).toString('hex');
const secret = () => crypto.randomBytes(18).toString('hex');

class Room {
  constructor(code, srv) {
    this.code = code;
    this.srv = srv;
    this.game = new Game({ rng: srv.rng });
    this.conns = new Map();     // pid -> ws
    this.tokens = new Map();    // token -> pid
    this.timers = {};
    this.phaseKey = '';
    this.touched = Date.now();
    this.townLines = [];
    this.banterDone = false;
    this.cool = new Map();      // `${pid}:${kind}` -> last ts
    this.closed = false;
    this.deadline = null;
    this.voice = new Set();     // pids currently in live voice chat
  }

  touch() { this.touched = Date.now(); }
  send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
  sendTo(pid, msg) { this.send(this.conns.get(pid), msg); }
  broadcast(msg, filter) { for (const [pid, ws] of this.conns) if (!filter || filter(this.game.get(pid))) this.send(ws, msg); }
  sendVoice(ws) { this.send(ws, { t: 'voice', ids: [...this.voice] }); }
  broadcastVoice() { this.broadcast({ t: 'voice', ids: [...this.voice] }); }
  pushState() {
    const left = this.deadline ? Math.max(0, this.deadline - Date.now()) : null;
    for (const [pid, ws] of this.conns) this.send(ws, { t: 'state', s: this.game.viewFor(pid), left });
  }

  // Phase time limits: host-chosen timer preset, or the long safety nets when the timer is off.
  limits() {
    const T = this.srv.timing, o = this.game.opts.timer, p = TIMER_PRESETS[o];
    if (!p) return { night: T.nightMax, day: T.dayMax, shown: false };
    return { night: p.night * T.timerScale, day: p.day * T.timerScale, shown: true };
  }

  clearTimers() { for (const k of Object.keys(this.timers)) { clearTimeout(this.timers[k]); delete this.timers[k]; } }
  later(name, ms, fn) { if (this.timers[name]) return; this.timers[name] = setTimeout(() => { delete this.timers[name]; if (!this.closed) { fn(); } }, ms); }

  // Re-evaluate timers and narration after any change, then push state.
  sync() {
    const g = this.game, T = this.srv.timing;
    const key = g.phase + ':' + g.day;
    if (key !== this.phaseKey) {
      const prev = this.phaseKey;
      this.clearTimers();
      this.deadline = null;
      this.phaseKey = key;
      this.banterDone = false;
      this.townLines = [];
      this.onPhaseEntered(prev);
    }
    if (g.phase === 'night') {
      if (g.nightComplete()) this.later('resolve', T.resolveMin + this.srv.rng() * (T.resolveMax - T.resolveMin), () => { if (g.nightComplete()) this.resolveNight(); });
      const L = this.limits();
      if (L.shown && !this.deadline) this.deadline = Date.now() + L.night;
      this.later('nightMax', L.night, () => this.resolveNight());
    } else if (g.phase === 'day') {
      if (g.voteComplete()) this.later('dayResolve', T.dayResolve, () => { if (g.voteComplete()) this.resolveDay(); });
      const L = this.limits();
      if (L.shown && !this.deadline) this.deadline = Date.now() + L.day;
      this.later('dayMax', L.day, () => this.resolveDay());
    } else if (g.phase === 'verdict') {
      this.later('verdict', T.verdict, () => { if (g.nextNight()) this.sync(); });
    }
    this.pushState();
  }

  onPhaseEntered() {
    const g = this.game;
    let kind = null;
    if (g.phase === 'night') kind = g.day === 1 ? 'start' : 'night';
    else if (g.phase === 'day') kind = 'dawn';
    else if (g.phase === 'verdict') kind = 'verdict';
    else if (g.phase === 'over') kind = 'over';
    if (kind) this.narrate(kind);
  }

  async narrate(kind) {
    const g = this.game;
    if (!g.opts.ai) return;
    const aid = g.aid;
    const text = await narrate(g, kind, { apiKey: this.srv.narrator.apiKey, model: this.srv.narrator.model, rng: this.srv.rng, fetchImpl: this.srv.narrator.fetchImpl, log: this.srv.log }).catch(() => null);
    if (!text || this.closed || g.aid !== aid) return;
    g.narrator = { id: uid(), kind, text };
    this.pushState();
  }

  resolveNight() { if (this.game.phase === 'night') { this.game.resolveNight(); this.sync(); } }
  resolveDay() { if (this.game.phase === 'day') { this.game.resolveDay(); this.sync(); } }

  allowed(pid, kind, ms) {
    const k = pid + ':' + kind, now = Date.now();
    if (now - (this.cool.get(k) || 0) < ms) return false;
    this.cool.set(k, now);
    return true;
  }

  /* ---------- client messages ---------- */
  handle(ws, msg) {
    this.touch();
    const g = this.game, pid = ws.pid;
    const err = m => this.send(ws, { t: 'err', msg: m });
    const res = r => { if (!r.ok) err(r.err); return r.ok; };
    const isHost = pid === g.hostId;
    switch (msg.t) {
      case 'opts': if (res(g.setOpts(pid, msg.opts))) this.sync(); break;
      case 'kick': {
        if (!isHost || g.phase !== 'lobby') return err('Only the host can remove players in the lobby');
        const target = String(msg.id || '');
        if (target === pid) return err('You cannot remove yourself');
        const tws = this.conns.get(target);
        if (g.removePlayer(target)) { if (tws) { this.send(tws, { t: 'kicked' }); this.conns.delete(target); tws.pid = null; } this.sync(); }
        break;
      }
      case 'start': if (res(g.start(pid))) { this.cool.clear(); this.sync(); } break;
      case 'again': if (res(g.playAgain(pid))) { this.sync(); } break;
      case 'act': {
        if (!res(g.act(pid, String(msg.type), String(msg.target)))) return;
        this.sync();
        break;
      }
      case 'vote': {
        if (!res(g.vote(pid, msg.target == null ? null : String(msg.target)))) return;
        this.sync();
        break;
      }
      case 'shoot': {
        if (!res(g.shoot(pid, String(msg.target)))) return;
        this.sync();
        break;
      }
      case 'closeVote': if (!isHost) return err('Only the host can close the vote'); if (g.phase === 'day') this.resolveDay(); break;
      case 'skipNight': if (!isHost) return err('Only the host can skip the night'); if (g.phase === 'night') this.resolveNight(); break;
      case 'chat': this.chat(ws, msg); break;
      case 'fx': this.fx(ws, msg); break;
      case 'roast': this.roast(ws, msg); break;
      case 'voice': {            // join / leave live voice chat (audio itself flows peer-to-peer over WebRTC)
        const on = !!msg.on;
        if (on === this.voice.has(pid)) { this.sendVoice(ws); break; }
        if (on) this.voice.add(pid); else this.voice.delete(pid);
        this.broadcastVoice();
        break;
      }
      case 'rtc': {              // WebRTC signalling relay: only between two people who are both in voice
        const to = String(msg.to || '');
        if (!this.voice.has(pid) || !this.voice.has(to) || to === pid || !msg.data || typeof msg.data !== 'object') break;
        if (JSON.stringify(msg.data).length > 12000) break;
        this.sendTo(to, { t: 'rtc', from: pid, data: msg.data });
        break;
      }
      case 'hit': this.hit(ws, msg); break;
      case 'emote': this.emote(ws, msg); break;
      case 'hat': if (res(g.setHat(pid, String(msg.hat)))) this.sync(); break;
      case 'point': this.point(ws, msg); break;
      case 'ping': this.send(ws, { t: 'pong' }); break;
      default: err('Unknown action');
    }
  }

  chat(ws, msg) {
    const g = this.game, pid = ws.pid, me = g.get(pid);
    const text = String(msg.text == null ? '' : msg.text).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
    if (!text) return;
    const ch = msg.ch;
    const inGame = g.phase !== 'lobby';
    if (ch === 'town') {
      if (g.phase === 'night') return this.send(ws, { t: 'err', msg: 'Night: town chat is silent' });
      if (inGame && g.phase !== 'over' && !me.alive) return this.send(ws, { t: 'err', msg: 'Ghosts chat in the ghost channel' });
    } else if (ch === 'mafia') {
      if (!inGame || me.role !== 'mafia') return this.send(ws, { t: 'err', msg: 'No access to that channel' });
    } else if (ch === 'ghost') {
      if (!inGame || me.alive) return this.send(ws, { t: 'err', msg: 'No access to that channel' });
    } else return;
    if (!this.allowed(pid, 'chat', 600)) return this.send(ws, { t: 'err', msg: 'Slow down a little' });
    const out = { t: 'chat', ch, from: pid, n: me.name, text, ts: Date.now() };
    if (ch === 'town') {
      this.broadcast(out);
      g.stat('chat', pid);
      if (g.phase === 'day') {
        this.townLines.push(me.name + ': ' + text);
        if (this.townLines.length > 12) this.townLines.shift();
        if (this.townLines.length >= 12 && !this.banterDone && this.srv.narrator.apiKey && g.opts.ai) { this.banterDone = true; this.banter(); }
      }
    } else if (ch === 'mafia') this.broadcast(out, p => p && p.role === 'mafia');
    else this.broadcast(out, p => p && !p.alive);
  }

  async banter() {
    const g = this.game, aid = g.aid;
    const { callModel } = require('./narrator');
    try {
      const text = await callModel({ apiKey: this.srv.narrator.apiKey, model: this.srv.narrator.model, style: g.opts.style, kind: 'banter', facts: `Recent public chat during day discussion:\n${this.townLines.join('\n')}\nComment on the funniest or most suspicious-sounding moment. Do not accuse anyone of being Mafia.`, fetchImpl: this.srv.narrator.fetchImpl });
      if (!this.closed && g.aid === aid && g.phase === 'day') { g.narrator = { id: uid(), kind: 'banter', text }; this.pushState(); }
    } catch (e) { this.srv.log('banter failed: ' + e.message); }
  }

  fx(ws, msg) {
    const g = this.game, pid = ws.pid, me = g.get(pid), to = g.get(String(msg.to));
    if (!to || !THROWS.includes(msg.emoji) || to.id === pid) return;
    if (!this.allowed(pid, 'fx', 700)) return;
    if (msg.emoji !== '👀') g.stat('thrown', to.id);
    this.broadcast({ t: 'fx', from: pid, n: me.name, to: to.id, tn: to.name, emoji: msg.emoji });
  }

  // Table fun: walk over and bonk someone, or point at a suspect. Never changes the game result.
  tableTarget(ws, msg) {
    const g = this.game, pid = ws.pid, me = g.get(pid), to = g.get(String(msg.to));
    if (!me || !to || to.id === pid) return null;
    if (g.phase === 'night') { this.send(ws, { t: 'err', msg: 'Night: everyone is asleep 😴' }); return null; }
    return { g, pid, me, to };
  }

  hit(ws, msg) {
    const w = String(msg.weapon);
    if (!WEAPONS.includes(w)) return;
    const x = this.tableTarget(ws, msg); if (!x) return;
    if (!this.allowed(x.pid, 'hit', 900)) return;
    x.g.stat('bashes', x.pid); x.g.stat('hits', x.to.id);
    this.broadcast({ t: 'hit', from: x.pid, n: x.me.name, to: x.to.id, tn: x.to.name, weapon: w });
  }

  emote(ws, msg) {
    const g = this.game, me = g.get(ws.pid), e = String(msg.emote);
    if (!me || !EMOTES.includes(e)) return;
    if (!this.allowed(ws.pid, 'emote', 1100)) return;
    this.broadcast({ t: 'emote', from: ws.pid, n: me.name, emote: e });
  }

  point(ws, msg) {
    const x = this.tableTarget(ws, msg); if (!x) return;
    if (!this.allowed(x.pid, 'point', 1200)) return;
    this.broadcast({ t: 'point', from: x.pid, n: x.me.name, to: x.to.id, tn: x.to.name });
  }

  roast(ws, msg) {
    const g = this.game, pid = ws.pid, me = g.get(pid), to = g.get(String(msg.to));
    const i = Number(msg.i);
    if (!to || !Number.isInteger(i) || i < 0 || i >= ROASTS.length || to.id === pid) return;
    if (!this.allowed(pid, 'roast', 2500)) return this.send(ws, { t: 'err', msg: 'Reload your roast for a moment 🔥' });
    g.stat('roasts', pid);
    this.broadcast({ t: 'roast', from: pid, n: me.name, text: ROASTS[i].replace('{n}', to.name) });
  }

  /* ---------- connection lifecycle ---------- */
  attach(ws, pid) {
    const old = this.conns.get(pid);
    if (old && old !== ws) { old.pid = null; try { old.close(4000, 'replaced'); } catch (e) { /* ignore */ } }
    ws.pid = pid; ws.room = this;
    this.conns.set(pid, ws);
    this.game.setConnected(pid, true);
    if (this.timers['grace:' + pid]) { clearTimeout(this.timers['grace:' + pid]); delete this.timers['grace:' + pid]; }
    if (this.timers.empty) { clearTimeout(this.timers.empty); delete this.timers.empty; }
  }

  detach(ws) {
    const pid = ws.pid;
    if (!pid || this.conns.get(pid) !== ws) return;
    this.conns.delete(pid);
    if (this.voice.delete(pid)) this.broadcastVoice();
    const g = this.game;
    g.setConnected(pid, false);
    if (g.phase === 'lobby') {
      // grace period for refresh / flaky network, then drop from the lobby
      this.timers['grace:' + pid] = setTimeout(() => {
        delete this.timers['grace:' + pid];
        const p = g.get(pid);
        if (p && !p.connected && g.phase === 'lobby') { g.removePlayer(pid); this.sync(); }
      }, this.srv.timing.lobbyGrace);
    }
    if (this.conns.size === 0) {
      this.timers.empty = setTimeout(() => this.srv.destroyRoom(this.code), this.srv.timing.emptyTTL);
    }
    this.sync();
  }

  close() {
    this.closed = true;
    this.clearTimers();
    if (this.timers.empty) clearTimeout(this.timers.empty);
    for (const ws of this.conns.values()) { try { ws.close(1001, 'room closed'); } catch (e) { /* ignore */ } }
    this.conns.clear();
  }
}

// STUN is enough for most home Wi-Fi; strict mobile networks also need a TURN relay (set TURN_URL / TURN_USER / TURN_PASS).
function iceServers(options) {
  const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const url = options.turnUrl || process.env.TURN_URL;
  if (url) list.push({ urls: url.split(',').map(s => s.trim()).filter(Boolean), username: options.turnUser || process.env.TURN_USER || '', credential: options.turnPass || process.env.TURN_PASS || '' });
  return list;
}

// Managed relay (Metered "Open Relay", free 20 GB/month): set METERED_APP (the name before .metered.live) and METERED_API_KEY.
// The server fetches fresh TURN credentials itself and hands them to players, so the key never reaches a browser.
async function fetchMeteredIce(app, key, fetchImpl) {
  const r = await fetchImpl(`https://${encodeURIComponent(app)}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`);
  if (!r.ok) throw new Error('TURN credentials HTTP ' + r.status);
  const list = await r.json();
  if (!Array.isArray(list)) throw new Error('unexpected TURN response');
  return list.filter(x => x && x.urls && typeof x === 'object');
}

function createServer(options = {}) {
  const srv = {
    rooms: new Map(),
    timing: { ...DEFAULT_TIMING, ...(options.timing || {}) },
    narrator: { apiKey: process.env.ANTHROPIC_API_KEY || '', model: process.env.NARRATOR_MODEL || 'claude-haiku-5-5', fetchImpl: undefined, ...(options.narrator || {}) },
    rng: options.rng || Math.random,
    log: options.log || (() => {}),
    maxRooms: options.maxRooms || 300,
    ice: iceServers(options),
    baseIce: null,
    misses: [],
    relayOnly: (options.relayOnly !== undefined ? options.relayOnly : process.env.VOICE_RELAY_ONLY === '1'),
    destroyRoom(code) { const r = srv.rooms.get(code); if (r) { r.close(); srv.rooms.delete(code); } }
  };

  srv.baseIce = srv.ice;
  const metApp = options.meteredApp || process.env.METERED_APP, metKey = options.meteredKey || process.env.METERED_API_KEY;
  const doFetch = options.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  let iceTimer = null;
  async function refreshIce() {
    try {
      const turn = await fetchMeteredIce(metApp, metKey, doFetch);
      if (turn.length) { srv.ice = [...srv.baseIce, ...turn]; srv.log('TURN relay credentials loaded (' + turn.length + ' servers)'); }
    } catch (e) { srv.log('TURN refresh failed: ' + (e && e.message)); }
  }
  if (metApp && metKey && doFetch) {
    refreshIce();
    iceTimer = setInterval(refreshIce, 6 * 3600 * 1000); if (iceTimer.unref) iceTimer.unref();
  }

  const server = http.createServer((req, res) => {
    let url, p;
    try { url = new URL(req.url, 'http://x'); p = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400, { 'content-type': 'text/plain', 'cache-control': 'no-store', ...SECURITY_HEADERS }); return res.end('Bad request'); }
    if (url.pathname === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store', ...SECURITY_HEADERS }); return res.end('ok'); }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain', ...SECURITY_HEADERS }); return res.end('Method not allowed'); }
    if (p.includes('\0')) { res.writeHead(400, { 'content-type': 'text/plain', ...SECURITY_HEADERS }); return res.end('Bad request'); }
    if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, p));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403, { 'content-type': 'text/plain', ...SECURITY_HEADERS }); return res.end('Forbidden'); }
    fs.readFile(file, (e, data) => {
      if (e) { res.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-store', ...SECURITY_HEADERS }); return res.end('Not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', ...SECURITY_HEADERS });
      res.end(data);
    });
  });

  // Only pages served by THIS site may open a game socket (blocks other websites from hijacking a visitor's browser).
  // Non-browser clients send no Origin header and are still allowed; extra origins can be listed in ALLOWED_ORIGINS.
  const extraOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const verifyClient = ({ origin, req }) => {
    if (!origin) return true;
    try { if (new URL(origin).host === req.headers.host) return true; } catch (e) { return false; }
    return extraOrigins.includes(origin);
  };
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16384, verifyClient });

  wss.on('connection', ws => {
    ws.pid = null; ws.room = null; ws.alive = true;
    let count = 0, rtcCount = 0;
    const rl = setInterval(() => { count = 0; rtcCount = 0; }, 10000);
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
      if (!msg || typeof msg !== 'object') return;
      // voice signalling (ICE candidates arrive in bursts) has its own, roomier budget
      if (msg.t === 'rtc' ? ++rtcCount > 600 : ++count > 120) { try { ws.close(1008, 'rate limit'); } catch (e) { /* ignore */ } return; }
      try {
        if (!ws.room) return handleEntry(ws, msg);
        if (!ws.pid) return;
        ws.room.handle(ws, msg);
      } catch (e) { srv.log('handler error: ' + (e && e.stack)); try { ws.send(JSON.stringify({ t: 'err', msg: 'Something went wrong' })); } catch (x) { /* ignore */ } }
    });
    ws.on('close', () => { clearInterval(rl); if (ws.room) ws.room.detach(ws); });
    ws.on('error', () => {});
  });

  function handleEntry(ws, msg) {
    const err = m => ws.send(JSON.stringify({ t: 'err', msg: m }));
    const joined = (room, pid, token) => {
      room.attach(ws, pid);
      ws.send(JSON.stringify({ t: 'joined', code: room.code, token, id: pid, throws: THROWS, roasts: ROASTS, ice: srv.ice, relayOnly: srv.relayOnly }));
      room.sync();
      room.sendVoice(ws);
    };
    if (msg.t === 'create') {
      if (srv.rooms.size >= srv.maxRooms) return err('Server is busy, try again later');
      let code; do { code = Array.from({ length: 4 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join(''); } while (srv.rooms.has(code));
      const room = new Room(code, srv);
      const pid = uid(), token = secret();
      const r = room.game.addPlayer(pid, msg.name);
      if (!r.ok) return err(r.err);
      srv.rooms.set(code, room);
      room.tokens.set(token, pid);
      return joined(room, pid, token);
    }
    const code = String(msg.code || '').toUpperCase().trim();
    const room = srv.rooms.get(code);
    if (!room) {                                   // wrong-code guessing is slowed down (per connection and server-wide)
      const now = Date.now();
      srv.misses = srv.misses.filter(t => now - t < 60000); srv.misses.push(now);
      ws.misses = (ws.misses || 0) + 1;
      if (ws.misses > 8 || srv.misses.length > 150) { err('Too many wrong codes. Wait a minute and try again.'); if (ws.misses > 8) { try { ws.close(1008, 'too many tries'); } catch (e) { /* ignore */ } } return; }
    }
    if (msg.t === 'join') {
      if (!room) return err('Room not found. Check the code.');
      const pid = uid(), token = secret();
      const r = room.game.addPlayer(pid, msg.name);
      if (!r.ok) return err(r.err);
      room.tokens.set(token, pid);
      return joined(room, pid, token);
    }
    if (msg.t === 'resume') {
      if (!room) return ws.send(JSON.stringify({ t: 'gone' }));
      const pid = room.tokens.get(String(msg.token || ''));
      if (!pid || !room.game.get(pid)) return ws.send(JSON.stringify({ t: 'gone' }));
      return joined(room, pid, msg.token);
    }
  }

  // keep-alive pings so proxies do not drop idle sockets
  const hb = setInterval(() => {
    wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; try { ws.ping(); } catch (e) { /* ignore */ } });
    const now = Date.now();
    for (const [code, r] of srv.rooms) if (now - r.touched > srv.timing.idleTTL) srv.destroyRoom(code);
  }, 25000);

  return {
    srv, server, wss,
    listen(port = options.port || 0) { return new Promise(res => server.listen(port, () => res(server.address().port))); },
    close() { clearInterval(hb); if (iceTimer) clearInterval(iceTimer); for (const c of [...srv.rooms.keys()]) srv.destroyRoom(c); wss.clients.forEach(c => c.terminate()); return new Promise(res => wss.close(() => server.close(() => res()))); }
  };
}

if (require.main === module) {
  const app = createServer({ log: m => console.log(new Date().toISOString(), m) });
  const port = Number(process.env.PORT) || 3000;
  app.listen(port).then(p => console.log(`Mafia Live listening on :${p}  AI narrator: ${app.srv.narrator.apiKey ? 'Claude (' + app.srv.narrator.model + ')' : 'preset lines'}`));
  process.on('SIGTERM', () => app.close().then(() => process.exit(0)));
}

module.exports = { createServer };
