'use strict';
// Runs the REAL browser client (public/app.js) inside jsdom against the REAL server.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const { JSDOM } = require('jsdom');
const { createServer } = require('../server');

const FAST = { resolveMin: 20, resolveMax: 40, dayResolve: 20, verdict: 80, nightMax: 4000, dayMax: 4000, lobbyGrace: 500 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 4000, label = '') { const t = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch (e) { /* retry */ } if (Date.now() - t > ms) throw new Error('timeout: ' + label); await sleep(25); } }

function openClient(port, search = '') {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8').replace(/<script src="\/app.js"><\/script>/, '');
  const dom = new JSDOM(html, { url: `http://127.0.0.1:${port}/${search}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.WebSocket = WebSocket;
  const errors = [];
  w.addEventListener('error', e => errors.push(e.message));
  w.eval(fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'));
  const $ = s => w.document.querySelector(s);
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  return { dom, w, $, click, errors, text: () => w.document.body.textContent };
}

test('real client: home -> create -> lobby -> start -> night -> day -> game over, no JS errors', async () => {
  const app = createServer({ timing: FAST });
  const port = await app.listen(0);
  const host = openClient(port);
  assert.match(host.text(), /Create a new room/);
  host.$('#nm').value = 'Vinayak';
  host.click(host.$('[data-a=create]'));
  await until(() => /Room [A-Z]{4}/.test(host.text()), 4000, 'lobby');
  const code = host.text().match(/Room ([A-Z]{4})/)[1];
  assert.match(host.text(), /Players \(1\)/);
  assert.match(host.text(), /Need 5\+ players/);

  // four more real clients join through the UI, one of them via the invite link (?room=CODE)
  const clients = [host];
  for (let i = 1; i <= 4; i++) {
    const c = openClient(port, i === 1 ? '?room=' + code.toLowerCase() : '');
    c.$('#nm').value = 'Friend' + i;
    if (i !== 1) c.$('#cd').value = code;
    assert.equal(c.$('#cd').value.toUpperCase(), code);
    c.click(c.$('[data-a=join]'));
    clients.push(c);
  }
  await until(() => /Players \(5\)/.test(host.text()), 4000, '5 players');
  await until(() => !host.$('[data-a=start]').disabled, 2000, 'start enabled');
  assert.match(clients[1].text(), /Waiting for the host/);
  assert.equal(clients[1].$('[data-a=start]'), null);       // guests have no start button

  host.click(host.$('[data-a=start]'));
  await until(() => clients.every(c => /Night 1/.test(c.text())), 4000, 'night');
  for (const c of clients) assert.match(c.text(), /(Mafia|Doctor|Detective|Villager)/);

  // drive the whole game through the real UI: click targets at night, vote by day
  for (let guard = 0; guard < 60; guard++) {
    if (clients.every(c => /Game over/.test(c.text()))) break;
    for (const c of clients) {
      const pick = c.$('.player.pick:not(.sel)');             // night action target
      if (pick && !c.$('.player.pick.sel')) c.click(pick);
      const vote = [...c.w.document.querySelectorAll('[data-a=vote]')].find(b => /Vote$/.test(b.textContent));
      if (vote && !c.$('.player.sel')) c.click(vote);
    }
    await sleep(60);
  }
  await until(() => clients.every(c => /Game over/.test(c.text())), 8000, 'game over').catch(e => { clients.forEach((c, i) => console.log('CLIENT', i, c.$('#tl').textContent, '|', c.$('#rolechip').textContent, '|', c.$('#main').textContent.slice(0, 300))); throw e; });
  for (const c of clients) {
    assert.match(c.text(), /(Town wins!|Mafia wins!)/);
    assert.match(c.text(), /Everyone's role/);
    assert.match(c.text(), /Dare for the losers/);
    assert.deepEqual(c.errors, []);
  }
  assert.ok(host.$('[data-a=again]'));
  assert.equal(clients[1].$('[data-a=again]'), null);
  clients.forEach(c => c.w.close());
  await app.close();
});

test('real client: chat renders as text (no HTML injection), roast + throw work, room-not-found shows error', async () => {
  const app = createServer({ timing: FAST });
  const port = await app.listen(0);
  const a = openClient(port); a.$('#nm').value = 'Ann'; a.click(a.$('[data-a=create]'));
  await until(() => /Room [A-Z]{4}/.test(a.text()));
  const code = a.text().match(/Room ([A-Z]{4})/)[1];
  const b = openClient(port); b.$('#nm').value = 'Bob'; b.$('#cd').value = code; b.click(b.$('[data-a=join]'));
  await until(() => /Players \(2\)/.test(a.text()));
  b.$('#ci').value = '<img src=x onerror="window.pwned=1"><b>hi</b>';
  b.click(b.$('[data-a=send]'));
  await until(() => /onerror/.test(a.$("#chatlog").textContent), 2000, 'chat arrives');
  assert.equal(a.$('#chatlog img'), null);
  assert.equal(a.$('#chatlog b b'), null);                    // user's <b> is text, not markup
  assert.equal(a.w.pwned, undefined);
  assert.match(a.$('#chatlog').textContent, /<img src=x/);
  // a player name with markup is stripped by the server
  const c = openClient(port); c.$('#nm').value = '<i>Eve</i>'; c.$('#cd').value = code; c.click(c.$('[data-a=join]'));
  await until(() => /Players \(3\)/.test(a.text()));
  assert.equal(a.$('.player i'), null);
  a.click(a.$('[data-a=roast]'));
  await until(() => /🔥/.test(b.$('#chatlog').textContent), 2000, 'roast arrives');
  a.click(a.$('[data-a=throw]'));
  await until(() => b.w.document.querySelector('.fly'), 2000, 'flying emoji');
  const d = openClient(port); d.$('#nm').value = 'Zed'; d.$('#cd').value = 'ZZZZ'; d.click(d.$('[data-a=join]'));
  await until(() => /Room not found/.test(d.$('#err').textContent), 2000, 'error text');
  for (const x of [a, b, c, d]) { assert.deepEqual(x.errors, []); x.w.close(); }
  await app.close();
});

test('real client: refresh restores the seat (session token) mid-game', async () => {
  const app = createServer({ timing: { ...FAST, nightMax: 30000 } });
  const port = await app.listen(0);
  const host = openClient(port); host.$('#nm').value = 'Host'; host.click(host.$('[data-a=create]'));
  await until(() => /Room [A-Z]{4}/.test(host.text()));
  const code = host.text().match(/Room ([A-Z]{4})/)[1];
  const others = [];
  for (let i = 1; i < 5; i++) { const c = openClient(port); c.$('#nm').value = 'P' + i; c.$('#cd').value = code; c.click(c.$('[data-a=join]')); others.push(c); }
  await until(() => !host.$('[data-a=start]').disabled);
  host.click(host.$('[data-a=start]'));
  await until(() => /Night 1/.test(others[0].text()));
  const roleBefore = others[0].$('#rolechip').textContent;
  const saved = others[0].w.sessionStorage.getItem('mafia_session');
  assert.ok(saved);
  others[0].w.close();
  // "refresh": a new page that shares the same tab session (sessionStorage)
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8').replace(/<script src="\/app.js"><\/script>/, '');
  const dom = new JSDOM(html, { url: `http://127.0.0.1:${port}/`, runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.WebSocket = WebSocket;
  dom.window.sessionStorage.setItem('mafia_session', saved);
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'));
  await until(() => /Night 1/.test(dom.window.document.body.textContent), 4000, 'restored');
  assert.equal(dom.window.document.querySelector('#rolechip').textContent, roleBefore);
  dom.window.close(); host.w.close(); others.slice(1).forEach(c => c.w.close());
  await app.close();
});
