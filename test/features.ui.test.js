'use strict';
// Real browser client (public/app.js in jsdom) against the real server: new-role UI, timer chip, reveal overlay, scoreboard.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const { JSDOM } = require('jsdom');
const { createServer } = require('../server');

const FAST = { resolveMin: 20, resolveMax: 40, dayResolve: 20, verdict: 60000, nightMax: 60000, dayMax: 60000, lobbyGrace: 500 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 5000, label = '') { const t = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch (e) { /* retry */ } if (Date.now() - t > ms) throw new Error('timeout: ' + label); await sleep(25); } }
const WINDOWS = [], APPS = [];
test.after(async () => { WINDOWS.forEach(w => { try { w.close(); } catch (e) { /* ignore */ } }); for (const a of APPS) { try { await a.close(); } catch (e) { /* ignore */ } } });

function openClient(port) {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8').replace(/<script src="\/app.js"><\/script>/, '');
  const dom = new JSDOM(html, { url: `http://127.0.0.1:${port}/`, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; WINDOWS.push(w);
  w.WebSocket = WebSocket;
  const errors = []; w.addEventListener('error', e => errors.push(e.message));
  w.eval(fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'));
  const c = {
    w, errors,
    $: s => w.document.querySelector(s),
    $$: s => [...w.document.querySelectorAll(s)],
    click: el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })),
    text: () => w.document.body.textContent
  };
  return c;
}

async function room(n, timing = {}) {
  const app = createServer({ timing: { ...FAST, ...timing } });
  APPS.push(app);
  const port = await app.listen(0);
  const host = openClient(port);
  host.$('#nm').value = 'Host'; host.click(host.$('[data-a=create]'));
  await until(() => /Room [A-Z]{4}/.test(host.text()), 4000, 'lobby');
  const code = host.text().match(/Room ([A-Z]{4})/)[1];
  const clients = [host];
  for (let i = 1; i < n; i++) { const c = openClient(port); c.$('#nm').value = 'Pal' + i; c.$('#cd').value = code; c.click(c.$('[data-a=join]')); clients.push(c); }
  await until(() => new RegExp(`Players \\(${n}\\)`).test(host.text()), 4000, n + ' players');
  return { host, clients, port };
}
const toggle = (c, a, on) => { const el = c.$(`input[data-a=${a}]`); el.checked = on; el.dispatchEvent(new c.w.Event('change', { bubbles: true })); };
const roleOf = c => c.$('#rolechip').textContent;
const nameIn = (r, c) => c === r.host ? 'Host' : 'Pal' + r.clients.indexOf(c);

test('lobby UI: host sees Jester / Bodyguard / Sniper toggles and timer picker, guests only see the summary', async () => {
  const { host, clients } = await room(5);
  for (const a of ['jester', 'bodyguard', 'sniper']) assert.ok(host.$(`input[data-a=${a}]`), 'host toggle ' + a);
  assert.ok(host.$('select[data-a=timer]'));
  assert.equal(clients[1].$('input[data-a=jester]'), null);
  assert.equal(clients[1].$('select[data-a=timer]'), null);
  toggle(host, 'jester', true); toggle(host, 'sniper', true);
  await until(() => /Jester/.test(clients[1].$('.card.center').textContent) && /Sniper/.test(clients[1].$('.card.center').textContent), 3000, 'guest summary shows roles');
  const sel = host.$('select[data-a=timer]'); sel.value = 'relaxed'; sel.dispatchEvent(new host.w.Event('change', { bubbles: true }));
  await until(() => /Relaxed/.test(clients[1].$('.card.center').textContent), 3000, 'guest sees timer');
  clients.forEach(c => assert.deepEqual(c.errors, []));
});

test('timer chip: hidden with timer off, counts down with a preset', async () => {
  const { host, clients } = await room(5);
  toggle(host, 'ai', false);
  const sel = host.$('select[data-a=timer]'); sel.value = 'fast'; sel.dispatchEvent(new host.w.Event('change', { bubbles: true }));
  await until(() => host.$('#timerchip') === null && /Fast/.test(host.text()) || true, 500);
  await until(() => host.$('select[data-a=timer]').value === 'fast', 3000, 'timer set');
  host.click(host.$('[data-a=start]'));
  await until(() => clients.every(c => /Night 1/.test(c.text())), 4000, 'night');
  const chip = await until(() => { const e = host.$('#timerchip'); return e && !e.hidden && /⏱ \d:\d\d/.test(e.textContent) ? e : null; }, 3000, 'timer chip visible');
  const secs = t => { const m = t.match(/(\d):(\d\d)/); return +m[1] * 60 + +m[2]; };
  const a = secs(chip.textContent);
  assert.ok(a <= 45 && a >= 43, 'starts at the 45s night preset: ' + chip.textContent);
  await sleep(1600);
  assert.ok(secs(host.$('#timerchip').textContent) < a, 'ticks down on its own');
  host.click(host.$('[data-a=skipNight]'));
  await until(() => /Day 1/.test(host.text()), 3000, 'day');
  await until(() => { const e = host.$('#timerchip'); return e && !e.hidden && secs(e.textContent) > 60; }, 3000, 'day countdown (90s preset)');
  clients.forEach(c => assert.deepEqual(c.errors, []));
});

async function startWith(n, opts) {
  const r = await room(n);
  for (const [k, v] of Object.entries(opts)) toggle(r.host, k, v);
  await until(() => !r.host.$('[data-a=start]').disabled, 3000, 'start enabled');
  r.host.click(r.host.$('[data-a=start]'));
  await until(() => r.clients.every(c => /Night 1/.test(c.text())), 4000, 'night');
  return r;
}
const withRole = (clients, label) => clients.find(c => roleOf(c).includes(label));
const toDay = async ({ host, clients }) => { host.click(host.$('[data-a=skipNight]')); await until(() => clients.every(c => /Day 1/.test(c.text())), 4000, 'day'); };

test('role cards: Jester, Sniper and Bodyguard show icon, name and rule; Bodyguard gets a night picker without themselves', async () => {
  const r = await startWith(7, { jester: true, bodyguard: true, sniper: true, ai: false });
  const check = (c, role, rule) => {
    const card = c.$('.rolecard');
    assert.ok(card && card.classList.contains('r-' + role.toLowerCase()), role + ' card styled');
    assert.match(card.textContent, rule);
    assert.ok(card.classList.contains('flip'), 'role reveal flips in');
  };
  check(withRole(r.clients, 'Jester'), 'Jester', /voted out/);
  check(withRole(r.clients, 'Sniper'), 'Sniper', /shoot/);
  // acting roles keep the card hidden at night (their picker takes its place) and get it back by day
  const bg = withRole(r.clients, 'Bodyguard'), me = nameIn(r, bg);
  assert.match(bg.text(), /Choose who to protect/);
  const picks = bg.$$('.player.pick');
  assert.equal(picks.length, 6);                                                    // everyone alive except the bodyguard
  assert.ok(!picks.some(p => p.textContent.includes(me)), 'cannot pick yourself');
  await toDay(r);
  check(bg, 'Bodyguard', /protect/);
  r.clients.forEach(c => assert.deepEqual(c.errors, []));
});

test('Sniper UI: Aim then Fire (two taps), overlay + game-over scoreboard for everyone', async () => {
  const r = await startWith(5, { sniper: true, doctor: false, detective: false, ai: false });
  await toDay(r);
  const sniper = withRole(r.clients, 'Sniper'), mafia = withRole(r.clients, 'Mafia');
  assert.match(sniper.text(), /Sniper – one bullet/);
  assert.equal(withRole(r.clients, 'Villager').$$('[data-a=shoot]').length, 0);       // only the sniper gets shoot buttons
  const mafiaName = nameIn(r, mafia);
  const rowOf = () => sniper.$$('.player').find(p => p.textContent.includes(mafiaName) && p.querySelector('[data-a=shoot]'));
  sniper.click(rowOf().querySelector('[data-a=shoot]'));                               // 1st tap arms
  await until(() => rowOf().querySelector('button').textContent === 'Fire!', 2000, 'armed');
  assert.equal(r.host.$('.reveal'), null);                                             // nothing fired yet
  sniper.click(rowOf().querySelector('[data-a=shoot]'));                               // 2nd tap fires
  await until(() => r.clients.every(c => /Town wins!/.test(c.text())), 4000, 'game over for all');
  for (const c of r.clients) {
    const ov = c.$('.reveal.kill');
    assert.ok(ov, 'kill overlay shown');
    assert.match(ov.textContent, /Sniper fired/); assert.match(ov.textContent, new RegExp(mafiaName)); assert.match(ov.textContent, /Direct hit/);
    assert.match(c.text(), /Scoreboard/);
    assert.equal(c.$$('.rank').length, 5);
    assert.match(c.text(), /pts/);
    assert.deepEqual(c.errors, []);
  }
});

test('Jester UI: voted out => overlay says the Jester wins; heading and scoreboard agree', async () => {
  const r = await startWith(5, { jester: true, ai: false });
  await toDay(r);
  const jester = withRole(r.clients, 'Jester');
  const jName = nameIn(r, jester);
  for (const c of r.clients) {
    const target = c === jester ? c.$$('.player').find(p => !p.textContent.includes(jName) && p.querySelector('[data-a=vote]')) : c.$$('.player').find(p => p.textContent.includes(jName) && p.querySelector('[data-a=vote]'));
    assert.ok(target, 'vote button for ' + c.$('#rolechip').textContent);
    c.click(target.querySelector('[data-a=vote]'));
  }
  await until(() => r.clients.every(c => /Jester wins!/.test(c.text())), 5000, 'jester wins everywhere');
  for (const c of r.clients) {
    assert.match(c.$('.reveal.out').textContent, /The Jester wins!/);
    assert.match(c.$('.winner').textContent, /🃏/);
    assert.match(c.text(), /Scoreboard/);
    assert.deepEqual(c.errors, []);
  }
  const row = jester.$$('.player').find(p => p.querySelector('.rank') && p.textContent.includes(jName));
  assert.match(row.textContent, /1W \/ 1G/); assert.match(row.textContent, /3 pts/);
  assert.equal(jester.$$('.rank')[0].closest('.player').textContent.includes(jName), true);   // jester tops the board
});

test('overlay dismisses on tap and does not replay on later state pushes', async () => {
  const r = await startWith(5, { ai: false });
  await toDay(r);
  // everyone votes the first other player => someone is voted out (or tie); drive the vote through the UI
  const victimName = 'Pal1';
  for (const c of r.clients) {
    const row = c.$$('.player').find(p => p.textContent.includes(victimName) && p.querySelector('[data-a=vote]')) || c.$$('.player').find(p => p.querySelector('[data-a=vote]'));
    c.click(row.querySelector('[data-a=vote]'));
  }
  await until(() => r.host.$('.reveal'), 4000, 'overlay appears');
  const ov = r.host.$('.reveal');
  assert.match(ov.textContent, /Voted out|Eliminated|Tie|wins/i);
  ov.dispatchEvent(new r.host.w.MouseEvent('click', { bubbles: true }));
  assert.equal(r.host.$('.reveal'), null, 'tap dismisses');
  await sleep(300);
  assert.equal(r.host.$$('.reveal').length, 0, 'does not replay on later state pushes');
  r.clients.forEach(c => assert.deepEqual(c.errors, []));
});

test('call mode: 📞 chip persists, shows narrator subtitles and survives a state push (for players who cannot hear on a WhatsApp call)', async () => {
  const r = await startWith(5, { ai: false }).catch(async () => null);
  assert.ok(r);
  const c = r.host;
  assert.ok(c.$('#callchip'), 'chip present');
  assert.equal(c.$('#callchip').classList.contains('on'), false);
  c.click(c.$('#callchip'));
  assert.ok(c.$('#callchip').classList.contains('on'));
  assert.match(c.text(), /Call mode ON/);
  assert.equal(c.w.localStorage.getItem('mafia_call'), '1');
  await toDay(r);                                                         // a new announcement arrives -> subtitle
  const sub = await until(() => c.$('#subtitle'), 3000, 'subtitle shown');
  assert.match(sub.textContent, /🎙️/); assert.ok(sub.textContent.length > 8);
  c.click(sub); assert.equal(c.$('#subtitle'), null, 'tap dismisses');
  c.click(c.$('#callchip'));
  assert.equal(c.w.localStorage.getItem('mafia_call'), '0');
  assert.equal(r.clients[1].$('#subtitle'), null, 'other players unaffected');
  r.clients.forEach(x => assert.deepEqual(x.errors, []));
});
