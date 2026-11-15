'use strict';
// Pure game engine: no network, no timers. Fully unit-testable.

const ROLE_NAME = { mafia: 'Mafia', doctor: 'Doctor', detective: 'Detective', villager: 'Villager', jester: 'Jester', bodyguard: 'Bodyguard', sniper: 'Sniper' };
const STYLES = ['bollywood', 'uncle', 'roast', 'noir'];
const SPECIAL = { mafia: 'kill', doctor: 'save', detective: 'probe', bodyguard: 'guard' };
const TIMERS = ['off', 'fast', 'normal', 'relaxed'];
const MAX_PLAYERS = 20;
const MIN_PLAYERS = 5;
const DARES = [
  'Send a voice note with your best villain laugh to the group',
  'Change your WhatsApp status to "I lost at Mafia and I deserved it" for 1 hour',
  'Compliment every winner in dramatic poetry style',
  'Say each winner\'s name in the funniest accent you can',
  'Do a 20-second filmy dialogue on the call, full emotion'
];

function cleanName(s) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
}

class Game {
  constructor({ rng = Math.random } = {}) {
    this.rng = rng;
    this.players = [];
    this.hostId = null;
    this.opts = { mafia: 1, doctor: true, detective: true, jester: false, bodyguard: false, sniper: false, timer: 'off', ai: true, style: 'bollywood' };
    this.phase = 'lobby';
    this.day = 0;
    this.eid = 0;      // increments on every public night/day event (clients animate on change)
    this.board = {};   // scoreboard across rounds in this room
    this._resetRound();
  }

  _resetRound() {
    this.acts = {};
    this.votes = {};
    this.det = {};
    this.announce = '';
    this.aid = 0;
    this.winner = null;
    this.log = [];
    this.awards = [];
    this.dare = '';
    this.narrator = null;
    this.stats = { thrown: {}, roasts: {}, chat: {} };
    this.sniperUsed = {};
    this.jesterWon = false;
    this._scored = false;
    this.last = null; // last resolved event for narrator
  }

  _shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  get(id) { return this.players.find(p => p.id === id); }
  alive() { return this.players.filter(p => p.alive); }
  _say(t) { this.announce = t; this.aid++; this.narrator = null; }

  /* ---------- lobby ---------- */
  addPlayer(id, name) {
    if (this.phase !== 'lobby') return { ok: false, err: 'Game already started' };
    if (this.players.length >= MAX_PLAYERS) return { ok: false, err: 'Room is full' };
    const n = cleanName(name);
    if (!n) return { ok: false, err: 'Enter a name' };
    if (this.players.some(p => p.name.toLowerCase() === n.toLowerCase())) return { ok: false, err: 'That name is taken' };
    this.players.push({ id, name: n, role: null, alive: true, connected: true });
    if (!this.hostId) this.hostId = id;
    return { ok: true };
  }

  setConnected(id, c) {
    const p = this.get(id);
    if (!p) return;
    p.connected = c;
    if (!c && this.hostId === id) this._moveHost();
  }

  _moveHost() {
    const next = this.players.find(p => p.connected && p.id !== this.hostId);
    if (next) this.hostId = next.id;
  }

  removePlayer(id) {
    if (this.phase !== 'lobby') return false;
    const i = this.players.findIndex(p => p.id === id);
    if (i < 0) return false;
    this.players.splice(i, 1);
    if (this.hostId === id) { this.hostId = null; const nx = this.players.find(p => p.connected) || this.players[0]; if (nx) this.hostId = nx.id; }
    return true;
  }

  setOpts(by, o) {
    if (by !== this.hostId) return { ok: false, err: 'Only the host can change settings' };
    if (this.phase !== 'lobby') return { ok: false, err: 'Game already started' };
    o = o || {};
    if (Number.isInteger(o.mafia)) this.opts.mafia = Math.max(1, Math.min(8, o.mafia));
    if (typeof o.doctor === 'boolean') this.opts.doctor = o.doctor;
    if (typeof o.detective === 'boolean') this.opts.detective = o.detective;
    if (typeof o.jester === 'boolean') this.opts.jester = o.jester;
    if (typeof o.bodyguard === 'boolean') this.opts.bodyguard = o.bodyguard;
    if (typeof o.sniper === 'boolean') this.opts.sniper = o.sniper;
    if (TIMERS.includes(o.timer)) this.opts.timer = o.timer;
    if (typeof o.ai === 'boolean') this.opts.ai = o.ai;
    if (STYLES.includes(o.style)) this.opts.style = o.style;
    return { ok: true };
  }

  maxMafia(n = this.players.length) { return Math.max(1, Math.floor((n - 1) / 2)); }

  canStart() {
    const n = this.players.length;
    if (this.phase !== 'lobby') return { ok: false, err: 'Game already started' };
    if (n < MIN_PLAYERS) return { ok: false, err: `Need at least ${MIN_PLAYERS} players` };
    if (this.opts.mafia > this.maxMafia()) return { ok: false, err: `Too many Mafia for ${n} players (max ${this.maxMafia()})` };
    const special = this.opts.mafia + (this.opts.doctor ? 1 : 0) + (this.opts.detective ? 1 : 0) + (this.opts.jester ? 1 : 0) + (this.opts.bodyguard ? 1 : 0) + (this.opts.sniper ? 1 : 0);
    if (special > n) return { ok: false, err: 'Too many special roles for this group' };
    return { ok: true };
  }

  start(by) {
    if (by !== this.hostId) return { ok: false, err: 'Only the host can start' };
    const c = this.canStart();
    if (!c.ok) return c;
    this._resetRound();
    const roles = [];
    for (let i = 0; i < this.opts.mafia; i++) roles.push('mafia');
    if (this.opts.doctor) roles.push('doctor');
    if (this.opts.detective) roles.push('detective');
    if (this.opts.jester) roles.push('jester');
    if (this.opts.bodyguard) roles.push('bodyguard');
    if (this.opts.sniper) roles.push('sniper');
    while (roles.length < this.players.length) roles.push('villager');
    const r = this._shuffle(roles);
    this.players.forEach((p, i) => { p.role = r[i]; p.alive = true; });
    this.day = 0;
    this._beginNight();
    return { ok: true };
  }

  playAgain(by) {
    if (by !== this.hostId) return { ok: false, err: 'Only the host can do that' };
    if (this.phase !== 'over') return { ok: false, err: 'Game is not over' };
    this.players = this.players.filter(p => p.connected);
    this.players.forEach(p => { p.role = null; p.alive = true; });
    if (!this.get(this.hostId)) this.hostId = this.players[0] ? this.players[0].id : null;
    this.phase = 'lobby';
    this.day = 0;
    this._resetRound();
    return { ok: true };
  }

  /* ---------- night ---------- */
  _beginNight() {
    this.day++;
    this.phase = 'night';
    this.acts = {};
    this.det = {};
    this.votes = {};
    this._say(`Night ${this.day}. Everyone, close your eyes and mute your mic.`);
  }

  requiredActors() {
    return this.players.filter(p => p.alive && p.connected && SPECIAL[p.role]);
  }

  act(pid, type, target) {
    if (this.phase !== 'night') return { ok: false, err: 'Not night time' };
    const p = this.get(pid), t = this.get(target);
    if (!p || !p.alive) return { ok: false, err: 'You cannot act' };
    if (SPECIAL[p.role] !== type) return { ok: false, err: 'You have no such action' };
    if (!t || !t.alive) return { ok: false, err: 'Pick a living player' };
    if (type === 'kill' && t.role === 'mafia') return { ok: false, err: 'You cannot target your own team' };
    if (type === 'probe' && t.id === p.id) return { ok: false, err: 'You cannot investigate yourself' };
    if (type === 'guard' && t.id === p.id) return { ok: false, err: 'You cannot guard yourself' };
    this.acts[pid] = { type, target };
    if (type === 'probe') this.det[pid] = { name: t.name, mafia: t.role === 'mafia' };
    return { ok: true };
  }

  nightComplete() {
    return this.phase === 'night' && this.requiredActors().every(p => this.acts[p.id]);
  }

  resolveNight() {
    if (this.phase !== 'night') return null;
    const kills = Object.values(this.acts).filter(a => a.type === 'kill').map(a => a.target);
    let victim = null;
    if (kills.length) {
      const c = {};
      kills.forEach(k => { c[k] = (c[k] || 0) + 1; });
      const mx = Math.max(...Object.values(c));
      const top = Object.keys(c).filter(k => c[k] === mx);
      victim = top[Math.floor(this.rng() * top.length)];
    }
    const save = Object.values(this.acts).find(a => a.type === 'save');
    const guardAct = Object.entries(this.acts).find(([gid, a]) => a.type === 'guard' && a.target === victim && this.get(gid) && this.get(gid).alive);
    const v = victim ? this.get(victim) : null;
    let txt, result;
    if (v && save && save.target === victim) {
      txt = 'Morning! Nobody died - the Doctor saved the target!';
      this.log.push(`Night ${this.day}: nobody died.`);
      result = { died: null, saved: true };
    } else if (v && guardAct) {
      const b = this.get(guardAct[0]);
      b.alive = false;
      txt = `Morning! ${b.name} took the bullet for ${v.name} and died. They were the Bodyguard.`;
      this.log.push(`Night ${this.day}: ${b.name} (Bodyguard) died protecting ${v.name}.`);
      result = { died: { id: b.id, name: b.name, role: b.role }, saved: false, guarded: v.name };
    } else if (v) {
      v.alive = false;
      txt = `Morning! ${v.name} was killed in the night. They were the ${ROLE_NAME[v.role]}.`;
      this.log.push(`Night ${this.day}: ${v.name} (${ROLE_NAME[v.role]}) was killed.`);
      result = { died: { id: v.id, name: v.name, role: v.role } };
    } else {
      txt = 'Morning! Nobody died tonight.';
      this.log.push(`Night ${this.day}: nobody died.`);
      result = { died: null, saved: false };
    }
    this._event({ kind: 'dawn', ...result });
    if (this._checkWin()) { this._say(txt); return this.last; }
    this.phase = 'day';
    this.votes = {};
    this._say(txt + ' Discuss, roast, and vote!');
    return this.last;
  }

  /* ---------- day ---------- */
  vote(pid, target) {
    if (this.phase !== 'day') return { ok: false, err: 'Voting is closed' };
    const p = this.get(pid);
    if (!p || !p.alive) return { ok: false, err: 'Dead players cannot vote' };
    if (target === null || target === undefined) { delete this.votes[pid]; return { ok: true }; }
    const t = this.get(target);
    if (!t || !t.alive) return { ok: false, err: 'Pick a living player' };
    if (t.id === pid) return { ok: false, err: 'You cannot vote for yourself' };
    this.votes[pid] = target;
    return { ok: true };
  }

  shoot(pid, target) {
    if (this.phase !== 'day') return { ok: false, err: 'You can only shoot during the day' };
    const p = this.get(pid), t = this.get(target);
    if (!p || !p.alive || p.role !== 'sniper') return { ok: false, err: 'You are not the Sniper' };
    if (this.sniperUsed[pid]) return { ok: false, err: 'You already used your bullet' };
    if (!t || !t.alive) return { ok: false, err: 'Pick a living player' };
    if (t.id === pid) return { ok: false, err: 'You cannot shoot yourself' };
    this.sniperUsed[pid] = true;
    t.alive = false;
    const backfire = t.role !== 'mafia';
    if (backfire) p.alive = false;
    Object.keys(this.votes).forEach(k => { const x = this.get(k); if (!x || !x.alive) delete this.votes[k]; });
    let txt;
    if (backfire) {
      txt = `BANG! ${p.name} the Sniper shot ${t.name}, an innocent ${ROLE_NAME[t.role]}. Both are dead.`;
      this.log.push(`Day ${this.day}: Sniper ${p.name} shot ${t.name} (${ROLE_NAME[t.role]}) and died of guilt.`);
    } else {
      txt = `BANG! ${p.name} the Sniper shot ${t.name}. They were the Mafia!`;
      this.log.push(`Day ${this.day}: Sniper ${p.name} shot ${t.name} (Mafia).`);
    }
    this._event({ kind: 'shot', died: { id: t.id, name: t.name, role: t.role }, shooter: { id: p.id, name: p.name }, backfire });
    if (this._checkWin()) { this._say(txt); return { ok: true }; }
    this._say(txt + ' The vote continues!');
    return { ok: true };
  }

  voteComplete() {
    if (this.phase !== 'day') return false;
    const voters = this.players.filter(p => p.alive && p.connected);
    return voters.length > 0 && voters.every(p => this.votes[p.id]);
  }

  resolveDay() {
    if (this.phase !== 'day') return null;
    const c = {};
    Object.values(this.votes).forEach(t => { const x = this.get(t); if (x && x.alive) c[t] = (c[t] || 0) + 1; });
    const entries = Object.entries(c).sort((a, b) => b[1] - a[1]);
    let txt, out = null;
    if (!entries.length || (entries[1] && entries[1][1] === entries[0][1])) {
      txt = 'The vote is tied. Nobody is eliminated.';
      this.log.push(`Day ${this.day}: tie, nobody out.`);
    } else {
      const p = this.get(entries[0][0]);
      p.alive = false;
      out = { id: p.id, name: p.name, role: p.role, votes: entries[0][1] };
      txt = `${p.name} is voted out with ${entries[0][1]} vote${entries[0][1] > 1 ? 's' : ''}. They were the ${ROLE_NAME[p.role]}.`;
      this.log.push(`Day ${this.day}: ${p.name} (${ROLE_NAME[p.role]}) voted out.`);
      if (p.role === 'jester') this.jesterWon = true;
    }
    this._event({ kind: 'verdict', out, tally: c, tie: !out });
    if (this._checkWin()) { this._say(txt); return this.last; }
    this.phase = 'verdict';
    this._say(txt);
    return this.last;
  }

  nextNight() {
    if (this.phase !== 'verdict') return false;
    this._beginNight();
    return true;
  }

  /* ---------- end ---------- */
  _checkWin() {
    const a = this.alive();
    const m = a.filter(p => p.role === 'mafia').length;
    const t = a.length - m;
    if (this.jesterWon) this.winner = 'jester';
    else if (m === 0) this.winner = 'town';
    else if (m >= t) this.winner = 'mafia';
    else return false;
    this.phase = 'over';
    this._score();
    this.dare = DARES[Math.floor(this.rng() * DARES.length)];
    const top = o => { const e = Object.entries(o).sort((x, y) => y[1] - x[1])[0]; return e && e[1] > 0 ? e : null; };
    const nm = id => (this.get(id) || { name: '?' }).name;
    const aw = [];
    let x;
    if ((x = top(this.stats.thrown))) aw.push(`Most Pelted: ${nm(x[0])} (${x[1]} hits)`);
    if ((x = top(this.stats.roasts))) aw.push(`Roast Master: ${nm(x[0])} (${x[1]} roasts)`);
    if ((x = top(this.stats.chat))) aw.push(`Biggest Talker: ${nm(x[0])} (${x[1]} messages)`);
    this.awards = aw;
    this.last = { ...(this.last || {}), kind: 'over', winner: this.winner };
    return true;
  }

  _event(e) { this.last = e; this.eid++; }

  _score() {
    if (this._scored) return;
    this._scored = true;
    const won = p => this.winner === 'jester' ? p.role === 'jester' : this.winner === 'mafia' ? p.role === 'mafia' : (p.role !== 'mafia' && p.role !== 'jester');
    this.players.forEach(p => {
      const b = this.board[p.id] || (this.board[p.id] = { name: p.name, games: 0, wins: 0, survived: 0, points: 0 });
      b.name = p.name; b.games++;
      if (won(p)) { b.wins++; b.points += 3; }
      if (p.alive) { b.survived++; b.points += 1; }
    });
  }

  scoreboard() {
    return Object.keys(this.board).filter(id => this.get(id)).map(id => ({ id, ...this.board[id] }))
      .sort((x, y) => y.points - x.points || y.wins - x.wins || x.name.localeCompare(y.name));
  }

  stat(kind, id, n = 1) {
    this.stats[kind][id] = (this.stats[kind][id] || 0) + n;
  }

  /* ---------- per-player view (the ONLY thing sent to clients) ---------- */
  viewFor(pid) {
    const me = this.get(pid);
    const over = this.phase === 'over';
    const revealRole = p => (over || !p.alive) ? p.role : undefined;
    const v = {
      phase: this.phase,
      day: this.day,
      hostId: this.hostId,
      you: pid,
      opts: this.opts,
      announce: this.announce,
      aid: this.aid,
      narrator: this.narrator,
      players: this.players.map(p => ({ id: p.id, name: p.name, alive: p.alive, connected: p.connected, role: revealRole(p) })),
      votes: (this.phase === 'day' || this.phase === 'verdict' || over) ? this.votes : {},
      winner: this.winner,
      awards: over ? this.awards : [],
      dare: over ? this.dare : '',
      log: over ? this.log : [],
      maxMafia: this.maxMafia(),
      canStart: this.canStart().ok,
      board: this.scoreboard(),
      event: (this.last && (this.last.died || this.last.out || this.last.saved || this.last.tie))
        ? { eid: this.eid, died: this.last.died || null, saved: !!this.last.saved, out: this.last.out ? { name: this.last.out.name, role: this.last.out.role, votes: this.last.out.votes } : null, tie: !!this.last.tie, guarded: this.last.guarded || null, shooter: this.last.shooter || null, backfire: !!this.last.backfire }
        : null
    };
    if (me && this.phase !== 'lobby') {
      const m = { role: me.role, alive: me.alive };
      if (me.role === 'mafia') {
        const mates = this.players.filter(p => p.role === 'mafia' && p.id !== me.id);
        m.mates = mates.map(p => ({ id: p.id, name: p.name }));
        if (this.phase === 'night') {
          m.matePicks = {};
          mates.forEach(p => { if (this.acts[p.id]) m.matePicks[p.id] = this.acts[p.id].target; });
        }
      }
      if (this.phase === 'night' && me.alive && SPECIAL[me.role]) {
        m.type = SPECIAL[me.role];
        m.acted = this.acts[me.id] ? this.acts[me.id].target : null;
      }
      if (me.role === 'sniper') m.canShoot = me.alive && this.phase === 'day' && !this.sniperUsed[me.id];
      if (me.role === 'sniper') m.sniperUsed = !!this.sniperUsed[me.id];
      if (this.det[me.id]) m.det = this.det[me.id]; // detective keeps last result until next night
      v.me = m;
    }
    return v;
  }
}

module.exports = { Game, ROLE_NAME, STYLES, SPECIAL, TIMERS, MAX_PLAYERS, MIN_PLAYERS, cleanName };
