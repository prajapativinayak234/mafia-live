'use strict';
// Load test: many rooms playing complete games at the same time.
const WebSocket = require('ws');
const { createServer } = require('../server');
const ROOMS = Number(process.argv[2] || 40), PLAYERS = Number(process.argv[3] || 8);
(async () => {
  const app = createServer({ timing: { resolveMin: 20, resolveMax: 60, dayResolve: 20, verdict: 60, nightMax: 8000, dayMax: 8000 }, maxRooms: 1000 });
  const port = await app.listen(0);
  const url = `ws://127.0.0.1:${port}/ws`;
  let finished = 0, errors = 0, wsCount = 0; const errKinds = {};
  const t0 = Date.now();
  function bot(name, onJoined) {
    const ws = new WebSocket(url); wsCount++;
    const b = { ws, S: null };
    ws.on('message', raw => {
      const m = JSON.parse(raw);
      if (m.t === 'err') { errors++; errKinds[m.msg] = (errKinds[m.msg] || 0) + 1; }
      if (m.t === 'joined') { b.id = m.id; b.code = m.code; onJoined && onJoined(b); }
      if (m.t === 'state') {
        const S = m.s; b.S = S; const me = S.me;
        if (S.phase === 'over') { if (!b.done) { b.done = true; if (b.host) finished++; } return; }
        if (!me || !me.alive) return;
        if (S.phase === 'night' && me.type && me.acted == null) {
          const mates = (me.mates || []).map(x => x.id);
          const t = S.players.filter(p => p.alive && p.id !== S.you && !(me.type === 'kill' && mates.includes(p.id)));
          ws.send(JSON.stringify({ t: 'act', type: me.type, target: t[Math.floor(Math.random() * t.length)].id }));
        } else if (S.phase === 'day' && !S.votes[S.you]) {
          const t = S.players.filter(p => p.alive && p.id !== S.you);
          ws.send(JSON.stringify({ t: 'vote', target: t[Math.floor(Math.random() * t.length)].id }));
        }
      }
    });
    ws.on('open', () => onJoined === 'create' ? ws.send(JSON.stringify({ t: 'create', name })) : null);
    return b;
  }
  for (let r = 0; r < ROOMS; r++) {
    const host = bot('Host', null); host.host = true;
    host.ws.on('open', () => host.ws.send(JSON.stringify({ t: 'create', name: 'Host' })));
    host.ws.once('message', () => {});
    const wait = setInterval(() => {
      if (!host.code) return; clearInterval(wait);
      let joined = 1;
      for (let i = 1; i < PLAYERS; i++) {
        const b = bot('P' + i, () => { if (++joined === PLAYERS) setTimeout(() => host.ws.send(JSON.stringify({ t: 'start' })), 100); });
        b.ws.on('open', () => b.ws.send(JSON.stringify({ t: 'join', code: host.code, name: 'P' + i })));
      }
    }, 20);
  }
  const iv = setInterval(() => {
    const mem = Math.round(process.memoryUsage().rss / 1048576);
    if (finished >= ROOMS || Date.now() - t0 > 90000) {
      clearInterval(iv);
      console.log(errKinds); console.log(`rooms=${ROOMS} players/room=${PLAYERS} sockets=${wsCount} finished=${finished} protocolErrors=${errors} seconds=${((Date.now() - t0) / 1000).toFixed(1)} rssMB=${mem}`);
      process.exit(finished >= ROOMS ? 0 : 1);
    }
  }, 500);
})();
