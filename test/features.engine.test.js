'use strict';
// Engine tests for: Jester, Bodyguard, Sniper, timer option, scoreboard, public event data.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../game');

function seeded(seed = 1) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

// Build a started game and force roles by player index (p1 is host).
function make(roles, opts = {}) {
  const g = new Game({ rng: seeded(11) });
  roles.forEach((_, i) => assert.ok(g.addPlayer('p' + (i + 1), 'Player' + (i + 1)).ok));
  assert.ok(g.setOpts('p1', opts).ok);
  assert.ok(g.start('p1').ok);
  roles.forEach((r, i) => { g.players[i].role = r; });
  return g;
}
const ALL = { jester: true, bodyguard: true, sniper: true };
const R7 = ['mafia', 'doctor', 'detective', 'bodyguard', 'sniper', 'jester', 'villager'];
const R8 = ['mafia', 'mafia', 'doctor', 'detective', 'bodyguard', 'sniper', 'jester', 'villager'];
const toDay = g => { g.resolveNight(); assert.equal(g.phase, 'day'); };

test('options: new roles and timer are validated and counted', () => {
  const g = new Game();
  for (let i = 1; i <= 5; i++) g.addPlayer('p' + i, 'P' + i);
  assert.equal(g.opts.jester, false); assert.equal(g.opts.timer, 'off');
  assert.ok(g.setOpts('p1', { jester: true, bodyguard: true, sniper: true, timer: 'fast' }).ok);
  assert.deepEqual([g.opts.jester, g.opts.bodyguard, g.opts.sniper, g.opts.timer], [true, true, true, 'fast']);
  g.setOpts('p1', { timer: 'bogus', jester: 'yes' });                      // garbage ignored
  assert.equal(g.opts.timer, 'fast'); assert.equal(g.opts.jester, true);
  assert.equal(g.canStart().ok, false);                                    // mafia+doc+det+jester+bodyguard+sniper = 6 > 5 players
  assert.match(g.canStart().err, /special roles/);
  g.setOpts('p1', { detective: false, doctor: false });                    // 4 specials for 5 players
  assert.equal(g.canStart().ok, true);
  assert.equal(g.setOpts('p2', { sniper: false }).ok, false);              // non-host
  assert.ok(g.start('p1').ok);
  const count = r => g.players.filter(p => p.role === r).length;
  assert.deepEqual([count('mafia'), count('jester'), count('bodyguard'), count('sniper'), count('villager')], [1, 1, 1, 1, 1]);
});

test('night completes only after the Bodyguard acts, and guarding yourself is rejected', () => {
  const g = make(R7, ALL);
  const [m, doc, det, bg, , , vi] = g.players;
  assert.equal(g.act(bg.id, 'guard', bg.id).ok, false);
  assert.equal(g.act(bg.id, 'kill', vi.id).ok, false);                     // wrong action for role
  g.act(m.id, 'kill', vi.id); g.act(doc.id, 'save', vi.id); g.act(det.id, 'probe', m.id);
  assert.equal(g.nightComplete(), false);                                  // bodyguard still pending
  assert.ok(g.act(bg.id, 'guard', det.id).ok);
  assert.equal(g.nightComplete(), true);
});

test('Bodyguard takes the bullet for a guarded victim', () => {
  const g = make(R7, ALL);
  const [m, , , bg, , , vi] = g.players;
  g.act(m.id, 'kill', vi.id); g.act(bg.id, 'guard', vi.id);
  g.resolveNight();
  assert.equal(vi.alive, true); assert.equal(bg.alive, false);
  assert.match(g.announce, /took the bullet for Player7/);
  assert.equal(g.last.guarded, vi.name);
  assert.equal(g.phase, 'day');
});

test('Doctor save beats the Bodyguard; guarding the wrong person does nothing', () => {
  let g = make(R7, ALL);
  let [m, doc, , bg, , , vi] = g.players;
  g.act(m.id, 'kill', vi.id); g.act(doc.id, 'save', vi.id); g.act(bg.id, 'guard', vi.id);
  g.resolveNight();
  assert.equal(vi.alive, true); assert.equal(bg.alive, true); assert.equal(g.last.saved, true);

  g = make(R7, ALL);
  [m, doc, , bg, , , vi] = g.players;
  g.act(m.id, 'kill', vi.id); g.act(bg.id, 'guard', doc.id);
  g.resolveNight();
  assert.equal(vi.alive, false); assert.equal(bg.alive, true);
});

test('Sniper: day only, one bullet, hitting the Mafia keeps the Sniper alive', () => {
  const g = make(R8, { ...ALL, mafia: 2 });
  const [m1, m2, , , , sn, , vi] = g.players;
  assert.equal(g.shoot(sn.id, m1.id).ok, false);                           // night: not allowed
  toDay(g);
  assert.equal(g.shoot(vi.id, m1.id).ok, false);                           // not the sniper
  assert.equal(g.shoot(sn.id, sn.id).ok, false);                           // self
  assert.ok(g.shoot(sn.id, m1.id).ok);
  assert.equal(m1.alive, false); assert.equal(sn.alive, true);
  assert.equal(g.phase, 'day');                                            // game goes on: one Mafia left
  assert.match(g.announce, /The vote continues/);
  assert.equal(g.last.backfire, false);
  assert.equal(g.shoot(sn.id, m2.id).ok, false);                           // bullet already used
  assert.match(g.shoot(sn.id, m2.id).err, /already/);
});

test('Sniper shooting the last Mafia ends the game for the town', () => {
  const g = make(R7, ALL);
  const [m, , , , sn] = g.players;
  toDay(g);
  assert.ok(g.shoot(sn.id, m.id).ok);
  assert.equal(g.phase, 'over'); assert.equal(g.winner, 'town');
  assert.ok(g.board[sn.id].wins === 1 && g.board[m.id].wins === 0);
});

test('Sniper hitting an innocent dies too, and dead players\' votes are discarded', () => {
  const g = make(R8, { ...ALL, mafia: 2 });
  const [m1, , doc, , , sn, je, vi] = g.players;
  toDay(g);
  assert.ok(g.vote(je.id, vi.id).ok); assert.ok(g.vote(m1.id, vi.id).ok);
  assert.ok(g.shoot(sn.id, je.id).ok);                                     // jester is not Mafia
  assert.equal(je.alive, false); assert.equal(sn.alive, false);
  assert.equal(g.last.backfire, true);
  assert.equal(g.votes[je.id], undefined);                                 // the dead jester's vote is gone
  assert.equal(g.votes[m1.id], vi.id);
  assert.equal(g.log.length >= 2, true);
  assert.equal(doc.alive, true);
});

test('Jester wins alone when voted out', () => {
  const g = make(R7, ALL);
  const [m, , , , , je] = g.players;
  toDay(g);
  g.players.filter(p => p.id !== je.id).forEach(p => assert.ok(g.vote(p.id, je.id).ok));
  g.vote(je.id, m.id);
  const r = g.resolveDay();
  assert.equal(r.out.role, 'jester');
  assert.equal(g.phase, 'over'); assert.equal(g.winner, 'jester');
  assert.equal(g.board[je.id].wins, 1); assert.equal(g.board[je.id].points, 3);   // win, but dead: no survival point
  assert.equal(g.board[m.id].wins, 0); assert.equal(g.board[m.id].points, 1);     // survived only
});

test('Jester killed at night does not win and the game continues', () => {
  const g = make(R7, ALL);
  const [m, , , , , je] = g.players;
  g.act(m.id, 'kill', je.id);
  g.resolveNight();
  assert.equal(je.alive, false); assert.equal(g.phase, 'day'); assert.equal(g.winner, null);
});

test('scoreboard accumulates across rounds and hides players who left', () => {
  const g = make(['mafia', 'doctor', 'detective', 'villager', 'villager']);
  const [m, doc, det, v1, v2] = g.players;
  toDay(g);
  [doc, det, v1, v2].forEach(p => g.vote(p.id, m.id));
  g.resolveDay();
  assert.equal(g.winner, 'town');
  assert.equal(g.scoreboard().length, 5);
  assert.equal(g.board[doc.id].points, 4); assert.equal(g.board[m.id].points, 0);

  v2.connected = false;                                                    // leaves before the rematch
  assert.ok(g.playAgain('p1').ok);
  assert.equal(g.phase, 'lobby'); assert.equal(g.players.length, 4);
  assert.equal(g.viewFor('p1').board.length, 4);                           // board visible in the lobby, v2 filtered out
  g.addPlayer('p9', 'Newbie'); g.setOpts('p1', { mafia: 1 });
  assert.ok(g.start('p1').ok);
  g.players.forEach((p, i) => { p.role = i < 2 ? 'mafia' : 'villager'; });  // 2 mafia vs 3
  const [a, b, c1] = g.players;
  c1.alive = true;
  g.act(a.id, 'kill', g.players[2].id);
  g.resolveNight();                                                        // 2 mafia vs 2 town => mafia win
  assert.equal(g.winner, 'mafia');
  const board = g.scoreboard();
  const mine = id => board.find(x => x.id === id);
  assert.equal(a.id, m.id);                                                // p1 was the losing Mafia in round 1
  assert.deepEqual([mine(m.id).games, mine(m.id).wins, mine(m.id).points], [2, 1, 4]);       // 0 pts, then win(3)+survive(1)
  assert.deepEqual([mine(doc.id).games, mine(doc.id).wins, mine(doc.id).points], [2, 2, 8]); // 4 pts (town win), then drafted as Mafia in round 2: win+survive = 4 more
  assert.deepEqual([mine('p9').games, mine('p9').wins, mine('p9').points], [1, 0, 1]);       // newcomer: lost, survived
  assert.equal(mine(det.id).points, 4);                                    // round 1 win+survive, killed in round 2
  assert.equal(board.some(x => x.id === v2.id), false);                    // left player hidden
  for (let i = 1; i < board.length; i++) assert.ok(board[i - 1].points >= board[i].points); // sorted
  assert.ok(b.alive);
});

test('scoring happens once per game', () => {
  const g = make(R7, ALL);
  const [m, , , , sn] = g.players;
  toDay(g);
  g.shoot(sn.id, m.id);
  const before = JSON.stringify(g.board);
  g._checkWin(); g._score();
  assert.equal(JSON.stringify(g.board), before);
});

test('public event data: eid increments, no secrets leak', () => {
  const g = make(R7, ALL);
  const [m, , , , sn, , vi] = g.players;
  const e0 = g.eid;
  g.act(m.id, 'kill', vi.id);
  g.resolveNight();
  const ev = g.viewFor(sn.id).event;
  assert.equal(ev.eid, e0 + 1);
  assert.equal(ev.died.name, vi.name); assert.equal(ev.died.role, 'villager');
  assert.equal(JSON.stringify(ev).includes('mafia'), false);               // living mafia never appears in the event
  const view = g.viewFor(sn.id);
  assert.equal(view.players.find(p => p.id === m.id).role, undefined);     // alive: role hidden
  assert.equal(view.players.find(p => p.id === vi.id).role, 'villager');   // dead: revealed
  assert.equal(view.me.canShoot, true);
  assert.equal(g.viewFor(m.id).me.canShoot, undefined);                    // only the sniper sees the flag
  g.shoot(sn.id, m.id);                                                    // ends the game
  assert.equal(g.viewFor('p1').event.eid, e0 + 2);
});

test('quiet night produces no event payload; tie produces a tie event', () => {
  const g = make(R7, ALL);
  g.resolveNight();                                                        // nobody acted
  assert.equal(g.viewFor('p1').event, null);
  g.resolveDay();                                                          // no votes => tie
  assert.equal(g.phase, 'verdict');
  assert.equal(g.viewFor('p1').event.tie, true);
});

test('randomised full games with every role always finish with a valid winner', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const g = new Game({ rng: seeded(seed) });
    for (let i = 1; i <= 9; i++) g.addPlayer('p' + i, 'P' + i);
    g.setOpts('p1', { mafia: 2, ...ALL });
    assert.ok(g.start('p1').ok);
    let guard = 0;
    while (g.phase !== 'over' && guard++ < 80) {
      const alive = g.alive();
      const pick = (pred = () => true) => { const c = alive.filter(pred); return c[Math.floor(g.rng() * c.length)]; };
      if (g.phase === 'night') {
        g.requiredActors().forEach(p => {
          const t = p.role === 'mafia' ? pick(x => x.role !== 'mafia') : pick(x => x.id !== p.id);
          if (t) g.act(p.id, require('../game').SPECIAL[p.role], t.id);
        });
        g.resolveNight();
      } else if (g.phase === 'day') {
        const sn = alive.find(p => p.role === 'sniper');
        if (sn && g.rng() < 0.3) g.shoot(sn.id, pick(x => x.id !== sn.id).id);
        if (g.phase !== 'day') continue;
        g.alive().forEach(p => { const t = g.alive().filter(x => x.id !== p.id); if (t.length) g.vote(p.id, t[Math.floor(g.rng() * t.length)].id); });
        g.resolveDay();
      } else if (g.phase === 'verdict') g.nextNight();
    }
    assert.equal(g.phase, 'over', 'seed ' + seed + ' finished');
    assert.ok(['town', 'mafia', 'jester'].includes(g.winner));
    const a = g.alive(), m = a.filter(p => p.role === 'mafia').length;
    if (g.winner === 'town') assert.equal(m, 0);
    if (g.winner === 'mafia') assert.ok(m >= a.length - m);
    if (g.winner === 'jester') assert.ok(g.players.some(p => p.role === 'jester' && !p.alive));
    assert.equal(g.scoreboard().length, 9);
    assert.ok(g.scoreboard().every(x => x.games === 1));
    assert.equal(g.scoreboard().reduce((s, x) => s + x.wins, 0) > 0, true);
  }
});
