'use strict';
// Security + privacy guarantees: headers, origin check, guessing limits, nothing persisted in the browser, nothing written by the server.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const { JSDOM } = require('jsdom');
const { createServer } = require('../server');

const FAST = { resolveMin: 20, resolveMax: 40, dayResolve: 20, verdict: 60000, nightMax: 60000, dayMax: 60000, lobbyGrace: 500, emptyTTL: 60000 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const APPS = [];
test.after(async () => { for (const a of APPS) { try { await a.close(); } catch (e) { /* ignore */ } } });
async function boot(o) { const app = createServer({ timing: FAST, ...(o || {}) }); APPS.push(app); const port = await app.listen(0); return { app, port, url: `ws://127.0.0.1:${port}/ws` }; }
const get = (port, p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: b })); }).on('error', rej));
function ask(url, msgs, opts) {
  return new Promise(res => {
    const out = []; const ws = new WebSocket(url, opts);
    ws.on('open', () => msgs.forEach(m => ws.send(JSON.stringify(m))));
    ws.on('message', d => out.push(JSON.parse(d.toString())));
    ws.on('unexpected-response', (q, r) => res({ rejected: r.statusCode }));
    ws.on('error', () => {});
    ws.on('close', c => res({ out, code: c }));
    setTimeout(() => { try { ws.close(); } catch (e) { /* ignore */ } }, 500);
  });
}

test('every page carries the hardening headers; nothing is cached; mic is allowed only for this site', async () => {
  const { port } = await boot();
  for (const p of ['/', '/app.js', '/style.css', '/healthz']) {
    const r = await get(port, p); assert.equal(r.status, 200, p);
    const h = r.headers;
    assert.match(h['content-security-policy'], /default-src 'self'/); assert.match(h['content-security-policy'], /object-src 'none'/); assert.match(h['content-security-policy'], /form-action 'none'/); assert.match(h['content-security-policy'], /frame-ancestors 'none'/);
    assert.match(h['strict-transport-security'], /max-age=\d{7,}/);
    assert.match(h['permissions-policy'], /microphone=\(self\)/); assert.match(h['permissions-policy'], /camera=\(\)/); assert.match(h['permissions-policy'], /geolocation=\(\)/);
    assert.equal(h['x-content-type-options'], 'nosniff'); assert.equal(h['referrer-policy'], 'no-referrer'); assert.equal(h['x-frame-options'], 'DENY');
    assert.equal(h['cross-origin-opener-policy'], 'same-origin');
    if (p !== '/healthz') assert.equal(h['cache-control'], 'no-store', p + ' must not be cached');
  }
  assert.equal((await get(port, '/%E0%A4%A')).status, 400, 'malformed address is a 400, not a crash');
  assert.equal((await get(port, '/healthz')).status, 200, 'server still alive after malformed request');
  assert.equal((await get(port, '/nope.txt')).headers['x-frame-options'], 'DENY', 'error pages carry headers too');
  assert.equal((await get(port, '/../server.js')).status === 200, false, 'no path traversal');
  assert.equal((await get(port, '/%2e%2e/package.json')).status === 200, false);
});

test('websocket origin check: same-site page OK, other websites rejected, non-browser clients OK', async () => {
  const { port, url } = await boot();
  const create = [{ t: 'create', name: 'Sec' }];
  const same = await ask(url, create, { origin: `http://127.0.0.1:${port}` });
  assert.ok(same.out && same.out.some(m => m.t === 'joined'), 'same origin allowed');
  const evil = await ask(url, create, { origin: 'https://evil.example' });
  assert.ok(evil.rejected >= 400, 'cross-site rejected: ' + JSON.stringify(evil));
  const none = await ask(url, create);
  assert.ok(none.out.some(m => m.t === 'joined'), 'no Origin header (non-browser) allowed');
});

test('guessing room codes is throttled: a connection is cut off after a few wrong codes', async () => {
  const { url } = await boot();
  const guesses = Array.from({ length: 14 }, (_, i) => ({ t: 'join', code: 'ZZ' + String.fromCharCode(65 + i), name: 'Bot' }));
  const r = await ask(url, guesses);
  assert.ok(r.out.some(m => m.t === 'err' && /Too many wrong (codes|tries)/.test(m.msg)), 'told to slow down');
  assert.equal(r.code, 1008, 'connection closed by the server');
});

test('room codes use the secure generator and never repeat among live rooms', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(src, /crypto\.randomInt\(CODE_CHARS\.length\)/); assert.doesNotMatch(src, /Math\.random\(\) \* CODE_CHARS/);
  const { url } = await boot(); const codes = new Set();
  for (let i = 0; i < 12; i++) { const r = await ask(url, [{ t: 'create', name: 'R' + i }]); codes.add(r.out.find(m => m.t === 'joined').code); }
  assert.equal(codes.size, 12);
});

test('server never writes to disk and never logs player names or chat', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '../narrator.js'), 'utf8');
  assert.doesNotMatch(src, /writeFile|appendFile|createWriteStream|writeSync|mkdirSync/, 'no file writes');
  const logs = []; const { app, url } = await boot({ log: m => logs.push(m) });
  const r = await ask(url, [{ t: 'create', name: 'SecretName' }, { t: 'chat', ch: 'town', text: 'my private message' }]);
  assert.ok(r.out.some(m => m.t === 'joined'));
  await sleep(100);
  assert.ok(!logs.join('\n').match(/SecretName|private message/), 'logs contain no personal data: ' + logs.join('|'));
  assert.ok(app);
});

test('browser keeps nothing after the tab closes: no localStorage writes, old data is wiped, session lives only in sessionStorage', async () => {
  const { port } = await boot();
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8').replace(/<script src="\/app.js"><\/script>/, '');
  const dom = new JSDOM(html, { url: `http://127.0.0.1:${port}/`, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; w.WebSocket = WebSocket;
  ['mafia_session', 'mafia_name', 'mafia_hat', 'mafia_call', 'mafia_sfx'].forEach(k => w.localStorage.setItem(k, 'old-' + k));   // leftovers from an old version
  w.eval(fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'));
  assert.equal(w.localStorage.length, 0, 'legacy data wiped on load');
  w.document.querySelector('#nm').value = 'Priv'; w.document.querySelector('[data-a=create]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 80 && !/Room [A-Z]{4}/.test(w.document.body.textContent); i++) await sleep(50);
  assert.match(w.document.body.textContent, /Room [A-Z]{4}/);
  w.document.querySelector('[data-a=hat][data-v=crown]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  w.document.querySelector('[data-a=togglecall]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal(w.localStorage.length, 0, 'nothing written to persistent storage');
  assert.ok(w.sessionStorage.getItem('mafia_session'), 'tab session (cleared when the tab closes)');
  assert.equal(w.document.cookie, '', 'no cookies');
  const src = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  assert.doesNotMatch(src.replace(/localStorage\.removeItem\(k\)/, ''), /localStorage\.setItem|indexedDB|document\.cookie\s*=/, 'client source never persists');
  w.close();
});

test('names and chat are always escaped in the page (no script injection)', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const { port, url } = await boot();
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8').replace(/<script src="\/app.js"><\/script>/, '');
  const dom = new JSDOM(html, { url: `http://127.0.0.1:${port}/`, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; w.WebSocket = WebSocket; w.__pwned = false;
  w.eval(src);
  w.document.querySelector('#nm').value = '<img src=x onerror=__pwned=1>';
  w.document.querySelector('[data-a=create]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 80 && !/Room [A-Z]{4}/.test(w.document.body.textContent); i++) await sleep(50);
  const bot = await ask(url, [{ t: 'create', name: 'x' }]);
  assert.ok(bot.out.length);
  assert.equal(w.document.querySelectorAll('img').length, 0, 'no injected <img>'); assert.equal(w.__pwned, false);
  w.close();
});

test('login screen asks the browser not to remember the name or room code', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  assert.match(src, /id="nm"[^>]*autocomplete="off"/); assert.match(src, /id="cd"[^>]*autocomplete="off"/);
});

/* ---------- private group (passcode) ---------- */
test('private group: without the passcode nobody can create or join; with it everything works; reconnecting needs no passcode', async () => {
  const { url, port } = await boot({ passcode: 'friends-only', timing: { ...FAST, lobbyGrace: 60000 } });
  assert.equal((await get(port, '/needpass')).body, 'yes');
  const none = await ask(url, [{ t: 'create', name: 'Stranger' }]);
  assert.ok(!none.out.some(m => m.t === 'joined') && none.out.some(m => m.t === 'err' && /passcode/i.test(m.msg)), 'create refused');
  const wrong = await ask(url, [{ t: 'create', name: 'Stranger', pass: 'guess' }]);
  assert.ok(!wrong.out.some(m => m.t === 'joined'), 'wrong passcode refused');
  const good = await ask(url, [{ t: 'create', name: 'Friend', pass: 'friends-only' }]);
  const j = good.out.find(m => m.t === 'joined'); assert.ok(j, 'right passcode works');
  const noPassJoin = await ask(url, [{ t: 'join', code: j.code, name: 'Sneaky' }]);
  assert.ok(!noPassJoin.out.some(m => m.t === 'joined'), 'join also needs the passcode');
  const friendJoin = await ask(url, [{ t: 'join', code: j.code, name: 'Pal', pass: ' friends-only ' }]);
  assert.ok(friendJoin.out.some(m => m.t === 'joined'), 'friend joins with passcode');
  const resume = await ask(url, [{ t: 'resume', code: j.code, token: j.token }]);
  assert.ok(resume.out.some(m => m.t === 'joined'), 'a refresh/reconnect with the secret token needs no passcode');
});

test('private group: passcode guessing is throttled and cut off', async () => {
  const { url } = await boot({ passcode: 'friends-only' });
  const r = await ask(url, Array.from({ length: 14 }, (_, i) => ({ t: 'create', name: 'Bot', pass: 'guess' + i })));
  assert.ok(r.out.some(m => m.t === 'err' && /Too many wrong tries/.test(m.msg)));
  assert.equal(r.code, 1008);
});

test('no passcode configured: game stays open and /needpass says no', async () => {
  const { url, port } = await boot({ passcode: '' });
  assert.equal((await get(port, '/needpass')).body, 'no');
  assert.ok((await ask(url, [{ t: 'create', name: 'Open' }])).out.some(m => m.t === 'joined'));
});

test('hidden from search engines: robots.txt, meta tag and X-Robots-Tag header', async () => {
  const { port } = await boot();
  const robots = await get(port, '/robots.txt'); assert.equal(robots.status, 200); assert.match(robots.body, /Disallow: \//);
  const home = await get(port, '/'); assert.match(home.body, /name="robots" content="noindex/); assert.match(home.headers['x-robots-tag'], /noindex/);
});

test('UI: passcode box appears only when the server needs one, and the passcode is sent but never stored', async () => {
  for (const needs of [true, false]) {
    const { port } = await boot(needs ? { passcode: 'abc123' } : {});
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8').replace(/<script src="\/app.js"><\/script>/, '');
    const dom = new JSDOM(html, { url: `http://127.0.0.1:${port}/`, runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window; w.WebSocket = WebSocket;
    w.eval(fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'));
    for (let i = 0; i < 60 && needs && w.document.querySelector('#pwbox').hidden; i++) await sleep(50);
    assert.equal(w.document.querySelector('#pwbox').hidden, !needs);
    const click = s => w.document.querySelector(s).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    w.document.querySelector('#nm').value = 'Vin';
    if (needs) {
      click('[data-a=create]'); await sleep(100);
      assert.match(w.document.querySelector('#err').textContent, /passcode/i, 'asks for it before connecting');
      w.document.querySelector('#pw').value = 'nope'; click('[data-a=create]');
      for (let i = 0; i < 60 && !/Wrong group passcode/.test(w.document.body.textContent); i++) await sleep(50);
      assert.match(w.document.body.textContent, /Wrong group passcode/);
      w.document.querySelector('#pw').value = 'abc123'; click('[data-a=create]');
    } else click('[data-a=create]');
    for (let i = 0; i < 80 && !/Room [A-Z]{4}/.test(w.document.body.textContent); i++) await sleep(50);
    assert.match(w.document.body.textContent, /Room [A-Z]{4}/, 'entered the room');
    assert.equal(w.localStorage.length, 0); assert.ok(!/abc123/.test(JSON.stringify(Object.entries(w.sessionStorage))), 'passcode is not stored');
    w.close();
  }
});
