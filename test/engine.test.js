'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../game');

function seeded(seed = 1) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

function make(n = 7, roles = null, opts = {}) {
  const g = new Game({ rng: seeded(7) });
  for (let i = 1; i <= n; i++) assert.ok(g.addPlayer('p' + i, 'Player' + i).ok);
  g.setOpts('p1', opts);
  assert.ok(g.start('p1').ok);
  if (roles) roles.forEach((r, i) => { g.players[i].role = r; });
  // after start phase is night day 1; players order = shuffled, so index mapping uses g.players
  return g;
}
const byRole = (g, r) => g.players.filter(p => p.role === r);

test('name cleaning, duplicates and limits', () => {
  const g = new Game();
  assert.ok(g.addPlayer('a', '  <b>Ravi</b> ').ok);
  assert.equal(g.players[0].name, 'bRavi/b'); // angle brackets stripped, rest kept as plain text
  assert.equal(g.addPlayer('b', 'BRAVI/B').ok, false); // case-insensitive duplicate
  assert.equal(g.addPlayer('c', '   ').ok, false);
  assert.equal(g.addPlayer('d', 'x'.repeat(40)).ok, true);
  assert.equal(g.players[1].name.length, 14);
  for (let i = 0; i < 30; i++) g.addPlayer('z' + i, 'N' + i);
  assert.equal(g.players.length, 20);
});

test('start validation', () => {
  const g = new Game();
  for (let i = 1; i <= 4; i++) g.addPlayer('p' + i, 'P' + i);
  assert.equal(g.start('p1').ok, false); // too few
  g.addPlayer('p5', 'P5');
  assert.equal(g.start('p2').ok, false); // not host
  g.setOpts('p1', { mafia: 8 });
  assert.equal(g.canStart().ok, false); // too many mafia
  g.setOpts('p1', { mafia: 2 });
  assert.equal(g.canStart().ok, true);
  assert.equal(g.setOpts('p2', { mafia: 1 }).ok, false); // not host
  assert.ok(g.start('p1').ok);
  assert.equal(g.addPlayer('late', 'Late').ok, false);
});

test('role counts match settings', () => {
  for (const [n, m, d, t] of [[5, 1, true, true], [8, 2, true, false], [10, 3, false, false], [6, 1, false, true]]) {
    const g = make(n, null, { mafia: m, doctor: d, detective: t });
    assert.equal(byRole(g, 'mafia').length, m);
    assert.equal(byRole(g, 'doctor').length, d ? 1 : 0);
    assert.equal(byRole(g, 'detective').length, t ? 1 : 0);
    assert.equal(g.players.length, n);
    assert.ok(g.players.every(p => p.role));
  }
});

test('night: kill resolves, doctor saves', () => {
  const g = make(7, ['mafia', 'doctor', 'detective', 'villager', 'villager', 'villager', 'villager']);
  const [m, d, , v1] = g.players;
  assert.equal(g.act(m.id, 'kill', v1.id).ok, true);
  assert.equal(g.nightComplete(), false);
  g.act(d.id, 'save', v1.id);
  g.act(g.players[2].id, 'probe', m.id);
  assert.equal(g.nightComplete(), true);
  const r = g.resolveNight();
  assert.equal(r.died, null);
  assert.equal(r.saved, true);
  assert.equal(g.phase, 'day');
  assert.ok(g.get(v1.id).alive);
});

test('night: unsaved victim dies and role is public', () => {
  const g = make(7, ['mafia', 'doctor', 'detective', 'villager', 'villager', 'villager', 'villager']);
  const [m, d, t, v1, v2] = g.players;
  g.act(m.id, 'kill', v1.id); g.act(d.id, 'save', v2.id); g.act(t.id, 'probe', v2.id);
  const r = g.resolveNight();
  assert.equal(r.died.id, v1.id);
  assert.equal(g.get(v1.id).alive, false);
  assert.equal(g.viewFor(m.id).players.find(p => p.id === v1.id).role, 'villager');
});

test('act validation', () => {
  const g = make(7, ['mafia', 'mafia', 'doctor', 'detective', 'villager', 'villager', 'villager'], { mafia: 2 });
  const [m1, m2, d, t, v1] = g.players;
  assert.equal(g.act(v1.id, 'kill', m1.id).ok, false);        // villager has no action
  assert.equal(g.act(m1.id, 'save', v1.id).ok, false);        // wrong action type
  assert.equal(g.act(m1.id, 'kill', m2.id).ok, false);        // cannot kill teammate
  assert.equal(g.act(t.id, 'probe', t.id).ok, false);         // cannot probe self
  assert.equal(g.act(d.id, 'save', d.id).ok, true);           // doctor may self-save
  assert.equal(g.act(m1.id, 'kill', 'nobody').ok, false);     // bad target
  g.get(v1.id).alive = false;
  assert.equal(g.act(m1.id, 'kill', v1.id).ok, false);        // dead target
  g.get(d.id).alive = false;
  assert.equal(g.act(d.id, 'save', m1.id).ok, false);         // dead actor
  g.phase = 'day';
  assert.equal(g.act(m1.id, 'kill', t.id).ok, false);         // wrong phase
});

test('mafia disagreement picks one of their picks', () => {
  const g = make(8, ['mafia', 'mafia', 'villager', 'villager', 'villager', 'villager', 'villager', 'villager'], { mafia: 2, doctor: false, detective: false });
  const [m1, m2, a, b] = g.players;
  g.act(m1.id, 'kill', a.id); g.act(m2.id, 'kill', b.id);
  const r = g.resolveNight();
  assert.ok([a.id, b.id].includes(r.died.id));
});

test('night completes when required actors are disconnected', () => {
  const g = make(7, ['mafia', 'doctor', 'detective', 'villager', 'villager', 'villager', 'villager']);
  g.setConnected(g.players[0].id, false);
  g.act(g.players[1].id, 'save', g.players[3].id);
  g.act(g.players[2].id, 'probe', g.players[3].id);
  assert.equal(g.nightComplete(), true);
  assert.equal(g.resolveNight().died, null);
});

test('day: plurality vote, ties, retract, validation', () => {
  const g = make(7, ['mafia', 'doctor', 'detective', 'villager', 'villager', 'villager', 'villager']);
  g.phase = 'day'; g.day = 1; g.votes = {};
  const P = g.players;
  assert.equal(g.vote(P[0].id, P[0].id).ok, false); // self
  assert.equal(g.vote(P[0].id, 'x').ok, false);
  g.vote(P[0].id, P[3].id); g.vote(P[1].id, P[3].id); g.vote(P[2].id, P[4].id);
  g.vote(P[2].id, null); // retract
  assert.equal(g.votes[P[2].id], undefined);
  const r = g.resolveDay();
  assert.equal(r.out.id, P[3].id);
  assert.equal(g.phase, 'verdict');
  assert.equal(g.nextNight(), true);
  assert.equal(g.phase, 'night'); assert.equal(g.day, 2);
});

test('day: tie and empty vote eliminate nobody', () => {
  const g = make(7, ['mafia', 'doctor', 'detective', 'villager', 'villager', 'villager', 'villager']);
  g.phase = 'day'; g.votes = {};
  g.vote(g.players[0].id, g.players[3].id); g.vote(g.players[1].id, g.players[4].id);
  assert.equal(g.resolveDay().out, null);
  g.phase = 'day'; g.votes = {};
  assert.equal(g.resolveDay().out, null);
  assert.equal(g.alive().length, 7);
});

test('dead players cannot vote; voteComplete ignores disconnected', () => {
  const g = make(5, ['mafia', 'villager', 'villager', 'villager', 'villager'], { doctor: false, detective: false });
  g.phase = 'day'; g.votes = {};
  g.get(g.players[1].id).alive = false;
  assert.equal(g.vote(g.players[1].id, g.players[2].id).ok, false);
  g.setConnected(g.players[4].id, false);
  g.vote(g.players[0].id, g.players[2].id);
  assert.equal(g.voteComplete(), false);
  g.vote(g.players[2].id, g.players[3].id);
  g.vote(g.players[3].id, g.players[2].id);
  assert.equal(g.voteComplete(), true);
});

test('town wins when last mafia is voted out', () => {
  const g = make(5, ['mafia', 'villager', 'villager', 'villager', 'villager'], { doctor: false, detective: false });
  g.phase = 'day'; g.votes = {};
  g.players.slice(1).forEach(p => g.vote(p.id, g.players[0].id));
  g.resolveDay();
  assert.equal(g.phase, 'over'); assert.equal(g.winner, 'town');
  assert.ok(g.dare);
});

test('mafia wins at parity', () => {
  const g = make(5, ['mafia', 'villager', 'villager', 'villager', 'villager'], { doctor: false, detective: false });
  g.get(g.players[3].id).alive = false; g.get(g.players[4].id).alive = false; // 1 mafia vs 2 villagers
  g.act(g.players[0].id, 'kill', g.players[1].id);
  g.resolveNight(); // 1 mafia vs 1 villager => mafia wins
  assert.equal(g.phase, 'over'); assert.equal(g.winner, 'mafia');
});

test('no premature win: 2 mafia vs 5 others continues', () => {
  const g = make(7, ['mafia', 'mafia', 'villager', 'villager', 'villager', 'villager', 'villager'], { mafia: 2, doctor: false, detective: false });
  g.act(g.players[0].id, 'kill', g.players[2].id);
  g.act(g.players[1].id, 'kill', g.players[2].id);
  g.resolveNight();
  assert.equal(g.phase, 'day');
});

test('SECRECY: views never leak living players roles', () => {
  const g = make(9, ['mafia', 'mafia', 'doctor', 'detective', 'villager', 'villager', 'villager', 'villager', 'villager'], { mafia: 2 });
  const check = () => {
    for (const viewer of g.players) {
      const v = g.viewFor(viewer.id);
      for (const p of v.players) {
        const real = g.get(p.id);
        if (g.phase !== 'over' && real.alive) assert.equal(p.role, undefined, 'leaked role of living player');
      }
      if (viewer.role !== 'mafia') { assert.equal(v.me.mates, undefined); assert.equal(v.me.matePicks, undefined); }
      if (viewer.role === 'villager') assert.equal(v.me.type, undefined);
      const s = JSON.stringify(v);
      if (g.phase !== 'over') {
        for (const other of g.players) if (other.alive && other.id !== viewer.id && other.role === 'mafia' && viewer.role !== 'mafia') {
          assert.ok(!s.includes('"role":"mafia"') || v.players.some(p => p.role === 'mafia' && !g.get(p.id).alive) || viewer.role === 'mafia' || (v.me && v.me.det));
        }
      }
    }
  };
  check();
  const [m1, m2, d, t, v1, v2] = g.players;
  g.act(m1.id, 'kill', v1.id); g.act(m2.id, 'kill', v1.id); g.act(d.id, 'save', v2.id); g.act(t.id, 'probe', m1.id);
  check();
  g.resolveNight(); check();
  assert.equal(g.viewFor(t.id).me.det.mafia, true);
  assert.equal(g.viewFor(v2.id).me.det, undefined);
  assert.equal(g.viewFor(m1.id).me.mates[0].id, m2.id);
});

test('lobby view hides everything role related', () => {
  const g = new Game();
  for (let i = 1; i <= 5; i++) g.addPlayer('p' + i, 'P' + i);
  const v = g.viewFor('p1');
  assert.equal(v.me, undefined);
  assert.ok(v.players.every(p => p.role === undefined));
});

test('host transfer on disconnect, play again, awards', () => {
  const g = make(5, ['mafia', 'villager', 'villager', 'villager', 'villager'], { doctor: false, detective: false });
  const h = g.hostId;
  g.setConnected(h, false);
  assert.notEqual(g.hostId, h);
  g.setConnected(h, true);
  g.stat('thrown', g.players[1].id, 3); g.stat('roasts', g.players[2].id, 2); g.stat('chat', g.players[3].id, 5);
  g.phase = 'day'; g.votes = {};
  g.players.slice(1).forEach(p => g.vote(p.id, g.players[0].id));
  g.resolveDay();
  assert.equal(g.awards.length, 3);
  assert.equal(g.playAgain(h === g.hostId ? 'nobody' : g.hostId).ok, true);
  assert.equal(g.phase, 'lobby');
  assert.ok(g.players.every(p => p.role === null && p.alive));
  assert.ok(g.start(g.hostId).ok);
});

test('removePlayer only in lobby and reassigns host', () => {
  const g = new Game();
  for (let i = 1; i <= 6; i++) g.addPlayer('p' + i, 'P' + i);
  assert.equal(g.removePlayer('p1'), true);
  assert.equal(g.hostId, 'p2');
  g.start('p2');
  assert.equal(g.removePlayer('p3'), false);
});

test('1000 random complete games always terminate with a valid winner', () => {
  const rng = seeded(99);
  for (let i = 0; i < 1000; i++) {
    const n = 5 + Math.floor(rng() * 10);
    const g = new Game({ rng });
    for (let k = 0; k < n; k++) g.addPlayer('p' + k, 'P' + k);
    g.setOpts('p0', { mafia: 1 + Math.floor(rng() * g.maxMafia()), doctor: rng() > 0.3, detective: rng() > 0.3 });
    if (!g.canStart().ok) continue;
    g.start('p0');
    let guard = 0;
    while (g.phase !== 'over') {
      assert.ok(++guard < 200, 'game did not terminate');
      if (g.phase === 'night') {
        const al = g.alive();
        for (const p of g.requiredActors()) {
          const targets = al.filter(t => !(p.role === 'mafia' && t.role === 'mafia') && !(p.role === 'detective' && t.id === p.id));
          g.act(p.id, { mafia: 'kill', doctor: 'save', detective: 'probe' }[p.role], targets[Math.floor(rng() * targets.length)].id);
        }
        assert.ok(g.nightComplete());
        g.resolveNight();
      } else if (g.phase === 'day') {
        const al = g.alive();
        for (const p of al) { const t = al.filter(x => x.id !== p.id); g.vote(p.id, t[Math.floor(rng() * t.length)].id); }
        assert.ok(g.voteComplete());
        g.resolveDay();
      } else if (g.phase === 'verdict') g.nextNight();
    }
    assert.ok(['town', 'mafia'].includes(g.winner));
    const m = g.alive().filter(p => p.role === 'mafia').length;
    if (g.winner === 'town') assert.equal(m, 0); else assert.ok(m >= g.alive().length - m);
  }
});
