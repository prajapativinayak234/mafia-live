(function () {
'use strict';
var STYLE_LABELS = { bollywood: '🎬 Bollywood drama', uncle: '👴 Desi uncle gossip', roast: '🎤 Savage roast comedian', noir: '🕯️ Mysterious storyteller' };
var ROLE = {
  mafia: { n: 'Mafia', e: '🔪', d: 'Each night, pick a victim with your team. Lie well by day.' },
  doctor: { n: 'Doctor', e: '💉', d: 'Each night, save one person (yourself allowed).' },
  detective: { n: 'Detective', e: '🕵️', d: 'Each night, check if one person is Mafia.' },
  villager: { n: 'Villager', e: '🏘️', d: 'No power. Talk, accuse, vote. Find the Mafia.' },
  jester: { n: 'Jester', e: '🃏', d: 'Get yourself voted out by the town. If you succeed, you win alone!' },
  bodyguard: { n: 'Bodyguard', e: '🛡️', d: 'Each night, protect one person. If the Mafia target them, you die instead.' },
  sniper: { n: 'Sniper', e: '🎯', d: 'Once per game, shoot someone in the day. Hit the Mafia and you are a hero. Hit an innocent and you die too.' }
};
var TIMER_LABELS = { off: '⏱️ No timer', fast: '⚡ Fast (45s night, 90s day)', normal: '⏱️ Normal (75s night, 3m day)', relaxed: '🐢 Relaxed (2m night, 5m day)' };
var $ = function (id) { return document.getElementById(id); };
var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

function av(n) { var h = 0, i; for (i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360; return '<span class="av" style="--h:' + h + '">' + esc((n.charAt(0) || '?').toUpperCase()) + '</span>'; }

/* ---------- sound effects (WebAudio, no files) ---------- */
var sfxOn = true, actx = null, callMode = false;
/* Privacy: nothing is kept after the tab is closed. Settings live in sessionStorage only, and anything an older version left in localStorage is wiped. */
try { ['mafia_session', 'mafia_name', 'mafia_hat', 'mafia_call', 'mafia_sfx'].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) { /* ignore */ }
var store = (function () { try { return window.sessionStorage; } catch (e) { return null; } })();
try { callMode = store && store.getItem('mafia_call') === '1'; } catch (e) { /* ignore */ }
/* A phone/WhatsApp call takes over the audio session: the browser's audio gets suspended/interrupted and never comes back by itself. Re-wake it on every touch and when the page returns to view. */
function wakeAudio() {
  try {
    if (actx && actx.state === 'interrupted') { try { actx.close(); } catch (e) { /* ignore */ } actx = null; }
    if (actx && actx.state === 'suspended') actx.resume();
    if (window.speechSynthesis && speechSynthesis.paused) speechSynthesis.resume();
  } catch (e) { /* ignore */ }
}
['pointerdown', 'touchstart', 'keydown'].forEach(function (ev) { document.addEventListener(ev, wakeAudio, { passive: true }); });
document.addEventListener('visibilitychange', wakeAudio);
setInterval(function () { if (actx && actx.state !== 'running' && !document.hidden) wakeAudio(); }, 3000);
/* Call mode: when sound can't be heard, every sound also becomes a vibration + screen flash, and narration becomes big subtitles. */
var CUE = { bang: [220], elim: [260], drum: [40, 40, 40, 40, 40, 40, 40, 40, 200], win: [100, 60, 100, 60, 240], lose: [400], bonk: [70], slap: [60], punch: [90], clang: [60, 30, 60], splat: [80], slip: [50, 40, 50, 40, 90], squeak: [30, 30, 30], haha: [40, 30, 40, 30, 40], night: [150, 100, 250], day: [80, 60, 80], save: [60, 40, 60], rimshot: [50, 50, 120], tada: [60, 40, 120] };
function cue(k) {
  if (!callMode || !CUE[k]) return;
  try { if (navigator.vibrate) navigator.vibrate(CUE[k]); } catch (e) { /* ignore */ }
  try { document.body.classList.add('cueflash'); setTimeout(function () { document.body.classList.remove('cueflash'); }, 260); } catch (e) { /* ignore */ }
}
function showSub(t) {
  var old = document.getElementById('subtitle'); if (old) old.remove();
  var d = document.createElement('div'); d.id = 'subtitle'; d.className = 'subtitle'; d.textContent = '🎙️ ' + t;
  d.addEventListener('click', function () { d.remove(); });
  document.body.appendChild(d); setTimeout(function () { if (d.parentNode) d.remove(); }, Math.min(14000, 4000 + t.length * 55));
}
try { if (store && store.getItem('mafia_sfx') === '0') sfxOn = false; } catch (e) { /* ignore */ }
function tone(f, at, d, type, vol, to) {
  var o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + at;
  o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + d + 0.05);
}
function sfx(k) {
  cue(k);
  if (!sfxOn) return;
  try {
    var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    actx = actx || new AC(); if (actx.state === 'suspended') actx.resume();
    switch (k) {
      case 'tick': tone(880, 0, 0.06, 'square', 0.05); break;
      case 'join': tone(660, 0, 0.09, 'triangle', 0.1); tone(990, 0.09, 0.12, 'triangle', 0.1); break;
      case 'reveal': tone(180, 0, 0.7, 'sawtooth', 0.09, 900); tone(90, 0, 0.7, 'sine', 0.12, 450); break;
      case 'night': tone(392, 0, 0.35, 'sawtooth', 0.07); tone(294, 0.3, 0.35, 'sawtooth', 0.07); tone(220, 0.6, 0.7, 'sawtooth', 0.07); break;
      case 'day': tone(523, 0, 0.2, 'triangle', 0.11); tone(659, 0.16, 0.2, 'triangle', 0.11); tone(784, 0.32, 0.4, 'triangle', 0.11); break;
      case 'vote': tone(300, 0, 0.12, 'square', 0.07, 180); break;
      case 'save': [660, 880, 1320].forEach(function (f, i) { tone(f, i * 0.1, 0.25, 'sine', 0.12); }); break;
      case 'bang': tone(90, 0, 0.25, 'sawtooth', 0.25, 30); tone(1800, 0, 0.08, 'square', 0.1, 200); break;
      case 'beep': tone(1000, 0, 0.07, 'square', 0.06); break;
      case 'whoosh': tone(250, 0, 0.2, 'sawtooth', 0.05, 1100); break;
      case 'bonk': tone(180, 0, 0.14, 'square', 0.22, 55); tone(1200, 0, 0.05, 'triangle', 0.1, 400); tone(700, 0.08, 0.12, 'sine', 0.08, 300); break;
      case 'point': tone(880, 0, 0.1, 'triangle', 0.1); tone(1320, 0.09, 0.18, 'triangle', 0.1); break;
      case 'slap': tone(1400, 0, 0.06, 'square', 0.18, 300); tone(300, 0.02, 0.1, 'sawtooth', 0.1, 120); break;
      case 'poof': tone(200, 0, 0.25, 'sine', 0.16, 70); tone(500, 0, 0.18, 'triangle', 0.05, 150); break;
      case 'punch': tone(120, 0, 0.12, 'square', 0.28, 40); tone(900, 0, 0.04, 'sawtooth', 0.12, 200); break;
      case 'splat': tone(500, 0, 0.18, 'sawtooth', 0.14, 60); tone(250, 0.05, 0.2, 'square', 0.08, 70); tone(900, 0.02, 0.1, 'triangle', 0.06, 200); break;
      case 'clang': [880, 1320, 1760, 2349].forEach(function (f) { tone(f, 0, 0.55, 'triangle', 0.1); }); tone(150, 0, 0.1, 'square', 0.18, 60); break;
      case 'slip': tone(900, 0, 0.35, 'sine', 0.14, 200); tone(300, 0.3, 0.12, 'square', 0.15, 80); break;
      case 'squeak': tone(1500, 0, 0.07, 'square', 0.1, 2200); tone(1900, 0.09, 0.09, 'square', 0.1, 2600); tone(1200, 0.2, 0.12, 'square', 0.08, 1800); break;
      case 'boing': tone(200, 0, 0.35, 'sine', 0.2, 900); tone(900, 0.3, 0.2, 'sine', 0.1, 300); break;
      case 'oof': tone(220, 0.1, 0.18, 'sawtooth', 0.12, 130); tone(160, 0.25, 0.22, 'sawtooth', 0.1, 90); break;
      case 'drum': for (var d = 0; d < 14; d++) tone(110 + (d % 2) * 20, d * 0.06, 0.07, 'triangle', 0.05 + d * 0.01, 70); tone(80, 0.88, 0.3, 'sine', 0.3, 40); break;
      case 'haha': for (var h = 0; h < 6; h++) tone(480 + (h % 2) * 90 - h * 20, h * 0.11, 0.09, 'square', 0.07, 330); break;
      case 'rimshot': tone(180, 0, 0.08, 'triangle', 0.2, 100); tone(180, 0.14, 0.08, 'triangle', 0.2, 100); tone(2600, 0.3, 0.45, 'sawtooth', 0.05, 1800); break;
      case 'sad': [392, 370, 349, 330].forEach(function (f, i) { tone(f, i * 0.2, 0.3, 'sawtooth', 0.07); }); break;
      case 'tada': [523, 659, 784].forEach(function (f, i) { tone(f, i * 0.07, 0.3, 'square', 0.07); }); tone(1046, 0.25, 0.5, 'triangle', 0.1); break;
      case 'act': tone(500, 0, 0.1, 'sine', 0.1, 900); break;
      case 'throw': tone(700, 0, 0.3, 'sawtooth', 0.07, 120); break;
      case 'elim': tone(120, 0, 0.6, 'sine', 0.2, 50); tone(240, 0, 0.4, 'sawtooth', 0.05, 60); break;
      case 'win': [523, 659, 784, 1046, 1318].forEach(function (f, i) { tone(f, i * 0.13, 0.3, 'triangle', 0.12); }); break;
      case 'lose': [392, 330, 262, 196].forEach(function (f, i) { tone(f, i * 0.22, 0.45, 'sawtooth', 0.07); }); break;
    }
  } catch (e) { /* ignore */ }
}

var ws = null, session = null, S = null, chat = [], throwsList = [], roastList = [];
var tab = 'town', hideRole = false, narr = true, funTarget = '', lastAid = -1, lastNarr = null, lastNeeds = false;
var WEAPONS = { slipper: '🩴', hammer: '🔨', pillow: '🛏️', fist: '🥊', fish: '🐟', pan: '🍳', banana: '🍌', chicken: '🐔' };
var WSFX = { slipper: 'slap', hammer: 'bonk', pillow: 'poof', fist: 'punch', fish: 'splat', pan: 'clang', banana: 'slip', chicken: 'squeak' };
var WTXT = { slipper: ['CHAPPAL!', 'THWAP!'], hammer: ['BONK!', 'WHACK!'], pillow: ['POOF!', 'FLUFF!'], fist: ['POW!', 'BAM!'], fish: ['SPLAT!', 'SMELLY!'], pan: ['CLANG!', 'DOINK!'], banana: ['WHOA!', 'SLIPPP!'], chicken: ['BAWK!', 'SQUEEE!'] };
var EMOTES = { dance: '💃', cry: '😭', laugh: '😂', facepalm: '🤦', flex: '💪', dizzy: '😵‍💫' };
var HATS = { none: '🚫', crown: '👑', shades: '😎', chef: '👨‍🍳', party: '🥳', cowboy: '🤠', halo: '😇', horns: '😈', tophat: '🎩' };
function myHat() { try { return (store && store.getItem('mafia_hat')) || 'none'; } catch (e) { return 'none'; } }
var tableMode = 'hit', weapon = 'slipper', tableOn = true, hitsTaken = {}, seatPos = {};
var armedShot = '', endAt = null, lastEid = null, eventPrimed = false, lastTick = -1;
var revealPending = true, lastPhase = null, lastAlive = -1, lastPlayers = -1;
var fxCount = {}, retry = 0, pendingEntry = null, inGame = false, homeMsg = '', closing = false;

function load() { try { return JSON.parse((store && store.getItem('mafia_session')) || 'null'); } catch (e) { return null; } }
function save() { try { if (session) store.setItem('mafia_session', JSON.stringify(session)); else store.removeItem('mafia_session'); } catch (e) { /* ignore */ } }
function savedName() { try { return (store && store.getItem('mafia_name')) || ''; } catch (e) { return ''; } }
function saveName(n) { try { store.setItem('mafia_name', n); } catch (e) { /* ignore */ } }

/* ---------- network ---------- */
function connect() {
  var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host + '/ws');
  ws.onopen = function () {
    retry = 0; $('net').hidden = true;
    if (session) send({ t: 'resume', code: session.code, token: session.token });
    else if (pendingEntry) { send(pendingEntry); }
  };
  ws.onmessage = function (ev) { var m; try { m = JSON.parse(ev.data); } catch (e) { return; } onMsg(m); };
  ws.onclose = function () {
    if (closing) return;
    if (inGame || session) $('net').hidden = false;
    retry++; setTimeout(connect, Math.min(5000, 400 * retry));
  };
  ws.onerror = function () {};
}
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
setInterval(function () { send({ t: 'ping' }); }, 20000);

function onMsg(m) {
  switch (m.t) {
    case 'joined':
      session = { code: m.code, token: m.token, id: m.id }; save(); pendingEntry = null;
      throwsList = m.throws; roastList = m.roasts; if (m.ice) voice.ice = m.ice; voice.relayOnly = !!m.relayOnly;
      if (voice.on) { Object.keys(voice.peers).forEach(dropPeer); send({ t: 'voice', on: true }); }
      if (myHat() !== 'none') send({ t: 'hat', hat: myHat() });
      if (!callMode) setTimeout(function () { toast('📞 On a WhatsApp call and can’t hear? Tap the 📞 chip'); }, 1500);
      if (!inGame) { inGame = true; chat = []; fxCount = {}; hitsTaken = {}; eventPrimed = false; lastEid = null; buildShell(); }
      break;
    case 'state': S = m.s; endAt = (m.left == null) ? null : Date.now() + m.left; if (inGame) render(); break;
    case 'chat': addChat({ k: 'm', ch: m.ch, n: m.n, t: m.text }); break;
    case 'roast': addChat({ k: 'roast', n: m.n, t: m.text }); break;
    case 'fx': onFx(m); break;
    case 'hit': doHit(m); break;
    case 'point': doPoint(m); break;
    case 'emote': doEmote(m); break;
    case 'voice': voice.ids = m.ids || []; voiceSync(); break;
    case 'rtc': onRtc(m); break;
    case 'err': if (inGame) toast(m.msg); else { homeMsg = m.msg; var e = $('err'); if (e) e.textContent = m.msg; } break;
    case 'gone': leave('That room has ended. Start or join a new one.'); break;
    case 'kicked': leave('The host removed you from the room.'); break;
  }
}
function leave(msg) { voice.ids = []; voiceStop(); hitsTaken = {}; seatPos = {}; endAt = null; eventPrimed = false; lastEid = null; document.body.removeAttribute('data-phase'); lastPhase = null; lastAlive = -1; lastPlayers = -1; revealPending = true; sigs = {}; session = null; save(); S = null; inGame = false; pendingEntry = null; homeMsg = msg || ''; lastAid = -1; lastNarr = null; homeView(); }

/* ---------- home ---------- */
function homeView() {
  var pre = ''; try { pre = (new URLSearchParams(location.search).get('room') || '').toUpperCase().slice(0, 4); } catch (e) { /* ignore */ }
  $('app').innerHTML = '<h1>🎭 Mafia Live</h1><div class="sub">Roast Edition · play from anywhere</div>' +
    '<div class="card"><div class="eyes">Your name</div><input id="nm" type="text" maxlength="14" autocomplete="off" autocapitalize="words" spellcheck="false" placeholder="e.g. Vinayak" value="' + esc(savedName()) + '">' +
    '<div style="height:8px"></div>' +
    '<div class="eyes">Room code</div><input id="cd" type="text" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="4 letters" style="text-transform:uppercase;text-align:center" value="' + esc(pre) + '">' +
    '<button class="primary" data-a="join">Join room</button>' +
    '<div class="center sub" style="margin:6px 0">or</div>' +
    '<button data-a="create">Create a new room</button></div>' +
    '<p class="center">Tip: run a WhatsApp / Meet voice call at the same time for live talking.</p><div id="err" class="err">' + esc(homeMsg) + '</div>';
}
function enter(kind) {
  var nm = $('nm').value.replace(/[<>&"'\\]/g, '').trim();
  if (!nm) { $('err').textContent = 'Enter your name first.'; return; }
  saveName(nm);
  var m;
  if (kind === 'create') m = { t: 'create', name: nm };
  else {
    var c = $('cd').value.trim().toUpperCase();
    if (c.length !== 4) { $('err').textContent = 'Room code is 4 letters.'; return; }
    m = { t: 'join', code: c, name: nm };
  }
  $('err').textContent = 'Connecting…'; pendingEntry = m;
  if (ws && ws.readyState === 1) send(m);
}

/* ---------- shell ---------- */
function buildShell() {
  sigs = {}; revealPending = true; lastPhase = null; lastAlive = -1; lastPlayers = -1;
  $('app').innerHTML = '<div class="top"><div id="tl"></div><div class="row fix"><span class="chip tm" id="timerchip" hidden></span><span class="chip" id="rolechip" data-a="togglerole"></span><span class="chip" id="sfxchip" data-a="togglesfx">🎵</span><span class="chip" id="callchip" data-a="togglecall" title="On a call? Vibration + subtitles instead of sound">📞</span><span class="chip" id="narrchip" data-a="togglenarr">🔊</span></div></div>' +
    '<div class="voicebar" id="voicebar"></div><div class="card tablecard" id="tablecard"><div class="row tbl-head"><div class="eyes">🪑 The Table</div><span class="chip fix" id="tbltoggle" data-a="tabletoggle">Hide</span></div>' +
    '<div id="tablebody"><svg id="tsvg" viewBox="0 -6 400 364" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Players seated around the table">' +
    '<defs><radialGradient id="tg" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#2a1d5c"/><stop offset="1" stop-color="#0c0824"/></radialGradient></defs>' +
    '<g id="seatsBack"></g><ellipse class="tbl" cx="200" cy="168" rx="116" ry="64" fill="url(#tg)"/><ellipse class="tblin" cx="200" cy="168" rx="94" ry="48" fill="none"/>' +
    '<text id="tcenter" x="200" y="176" text-anchor="middle" class="tcenter"></text><g id="seatsFront"></g><g id="labels"></g><g id="fxlayer"></g></svg>' +
    '<div class="tbl-tools" id="tbltools"></div><div class="sub center" id="tblhint"></div></div></div>' +
    '<div id="main"></div>' +
    '<div class="card"><details><summary>🔥 Roast zone – throw stuff, roast, spy</summary><div id="funbody"></div></details></div>' +
    '<div class="card"><div class="tabs" id="tabs"></div><div id="chatlog"></div>' +
    '<div class="row" style="margin-top:6px"><input id="ci" type="text" maxlength="200" placeholder="Say something…" autocomplete="off"><button class="fix primary" style="width:74px;margin:0" data-a="send">Send</button></div>' +
    '<div class="emo">' + ['😂', '🤨', '👀', '🔥', '😱', '🫡', '🤝', '💀'].map(function (e) { return '<button data-a="emoji" data-v="' + e + '">' + e + '</button>'; }).join('') + '</div></div>';
  $('ci').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendChat(); });
  $('funbody').addEventListener('change', function (e) { if (e.target.id === 'ft') funTarget = e.target.value; });
}

/* ---------- render ---------- */
var sigs = {};
function setHTML(id, html) { if (sigs[id] === html) return; sigs[id] = html; $(id).innerHTML = html; }
function me() { return S && S.players.find(function (p) { return p.id === S.you; }); }
function nameOf(id) { var p = S && S.players.find(function (x) { return x.id === id; }); return p ? p.name : '?'; }
function isHost() { return S && S.hostId === S.you; }
function amAlive() { var m = me(); return !m || m.alive; }

function render() {
  if (!S || !$('main')) return;
  var m = me();
  var phaseLabel = S.phase === 'lobby' ? 'Lobby' : S.phase === 'night' ? '🌙 Night ' + S.day : S.phase === 'over' ? 'Game over' : '☀️ Day ' + S.day;
  var aliveN = S.players.filter(function (p) { return p.alive; }).length;
  setHTML('tl', '<span class="eyes">Room ' + esc(session.code) + ' · ' + phaseLabel + '</span><div class="sub">' + (S.phase === 'lobby' ? S.players.length + ' in lobby' : aliveN + ' alive') + '</div>');
  var rc = $('rolechip');
  rc.textContent = S.me ? (hideRole ? '🙈 role' : ROLE[S.me.role].e + ' ' + ROLE[S.me.role].n + (S.me.alive ? '' : ' 👻')) : '🎭';
  $('narrchip').textContent = narr ? '🔊' : '🔇';
  $('callchip').className = 'chip' + (callMode ? ' on' : '');
  $('sfxchip').textContent = sfxOn ? '🎵' : '🔕';
  document.body.setAttribute('data-phase', S.phase);
  setHTML('main', mainHTML(m));
  funPanel();
  tabsRender();
  chatRender();
  renderTable();
  voiceGate(); renderVoice();
  effects();
}

function mainHTML(m) {
  var h = '';
  if (S.phase === 'lobby') return lobbyHTML();
  if (S.narrator && S.narrator.text) h += '<div class="card narr"><div class="eyes">🎙️ Narrator</div><div class="script">' + esc(S.narrator.text) + '</div></div>';
  var mm = S.me || {};
  if (S.phase === 'night') {
    h += '<div class="card center"><div class="big">🌙</div><div class="script">' + esc(S.announce) + '</div></div>';
    if (!mm.alive) h += '<div class="card center">👻 You\'re out. Watch quietly – ghosts only chat with ghosts.</div>';
    else if (mm.type) {
      var lab = { kill: 'Choose your victim (agree with your team in Mafia chat)', save: 'Choose who to save', probe: 'Choose who to investigate', guard: 'Choose who to protect (you die if they are attacked)' }[mm.type];
      h += '<div class="card"><div class="eyes">' + lab + '</div>' + S.players.filter(function (p) {
        if (!p.alive) return false;
        if (mm.type === 'kill' && (p.id === S.you || (mm.mates || []).some(function (x) { return x.id === p.id; }))) return false;
        if ((mm.type === 'probe' || mm.type === 'guard') && p.id === S.you) return false;
        return true;
      }).map(function (p) {
        var picks = Object.keys(mm.matePicks || {}).filter(function (k) { return mm.matePicks[k] === p.id; }).map(nameOf);
        return '<div class="player pick ' + (mm.acted === p.id ? 'sel' : '') + '" data-a="act" data-type="' + mm.type + '" data-v="' + p.id + '"><span class="pwrap">' + av(p.name) + '<span class="nm">' + esc(p.name) + '</span></span>' + (picks.length ? '<span class="sub">🎯 ' + picks.map(esc).join(', ') + '</span>' : '') + '</div>';
      }).join('') + '<div class="sub">' + (mm.acted ? 'Locked in – you can change it until everyone is done.' : 'Tap a name.') + '</div></div>';
    } else h += '<div class="card center"><p>You sleep. Stay quiet and mute your mic 😴</p></div>';
    if (mm.det && mm.alive) h += detCard(mm.det);
    if (isHost()) h += '<button class="ghost" data-a="skipNight">Host: skip the rest of the night</button>';
  } else if (S.phase === 'day' || S.phase === 'verdict') {
    h += '<div class="card center"><div class="script">' + esc(S.announce) + '</div></div>';
    if (mm.det && mm.alive) h += detCard(mm.det);
    if (mm.canShoot) {
      h += '<div class="card"><div class="eyes">🎯 Sniper – one bullet</div>' + S.players.filter(function (p) { return p.alive && p.id !== S.you; }).map(function (p) {
        var armed = armedShot === p.id;
        return '<div class="player"><span class="pwrap">' + av(p.name) + '<span class="nm">' + esc(p.name) + '</span></span><button class="' + (armed ? 'primary' : '') + '" data-a="shoot" data-v="' + p.id + '">' + (armed ? 'Fire!' : 'Aim') + '</button></div>';
      }).join('') + '<div class="sub">Tap Aim, then Fire. Hit an innocent and you die too.</div></div>';
    }
    var tally = {};
    Object.keys(S.votes).forEach(function (v) { tally[S.votes[v]] = (tally[S.votes[v]] || 0) + 1; });
    h += '<div class="card"><div class="eyes">' + (S.phase === 'day' ? 'Vote someone out' : 'Votes') + '</div>' + S.players.map(function (p) {
      var voters = Object.keys(S.votes).filter(function (v) { return S.votes[v] === p.id; }).map(nameOf);
      var mine = S.votes[S.you] === p.id;
      var canVote = S.phase === 'day' && p.alive && amAlive() && p.id !== S.you;
      return '<div class="player ' + (p.alive ? '' : 'dead') + (p.connected ? '' : ' off') + (mine ? ' sel' : '') + '"><span class="pwrap">' + av(p.name) + '<span><span class="nm">' + esc(p.name) + '</span>' + (p.role ? ' <span class="pill ' + p.role + '">' + ROLE[p.role].e + '</span>' : '') + fxBadge(p.id) + '<div class="sub">' + (voters.length ? '🗳️ ' + voters.map(esc).join(', ') : '') + '</div></span></span>' +
        (canVote ? '<button data-a="vote" data-v="' + (mine ? '' : p.id) + '">' + (tally[p.id] || 0) + ' · ' + (mine ? 'Unvote' : 'Vote') + '</button>' : '<b>' + (tally[p.id] || '') + '</b>') + '</div>';
    }).join('') + '</div>';
    if (isHost() && S.phase === 'day') h += '<button class="gold" data-a="closeVote">Close the vote now</button>';
  } else if (S.phase === 'over') {
    var town = S.winner === 'town', jw = S.winner === 'jester';
    h += '<div class="card center winner"><div class="big">' + (town ? '🎉' : jw ? '🃏' : '🔪') + '</div><h1>' + (town ? 'Town wins!' : jw ? 'Jester wins!' : 'Mafia wins!') + '</h1></div>' +
      '<div class="card"><div class="eyes">Everyone\'s role</div>' + S.players.map(function (p) { return '<div class="player ' + (p.alive ? '' : 'dead') + '"><span class="pwrap">' + av(p.name) + '<span class="nm">' + esc(p.name) + '</span></span><span class="pill ' + p.role + '">' + ROLE[p.role].e + ' ' + ROLE[p.role].n + '</span></div>'; }).join('') + '</div>' +
      boardHTML() +
      '<div class="card"><div class="eyes">🏆 Awards</div>' + (S.awards.map(function (a) { return '<div class="msg">' + esc(a) + '</div>'; }).join('') || '<div class="sub">No awards this time.</div>') + '</div>' +
      '<div class="card center"><div class="eyes">Dare for the losers</div><div class="script">' + esc(S.dare) + '</div></div>' +
      '<div class="card"><div class="eyes">Game log</div>' + S.log.map(function (l) { return '<div class="sub">' + esc(l) + '</div>'; }).join('') + '</div>' +
      (isHost() ? '<button class="primary" data-a="again">Back to lobby (play again)</button>' : '<p class="center">The host can start another round.</p>');
  }
  if (S.me && !hideRole && S.phase !== 'over' && !(S.phase === 'night' && mm.type)) {
    h = '<div class="card rolecard r-' + mm.role + (revealPending ? ' flip' : '') + '"><div class="ric">' + ROLE[mm.role].e + '</div><div><div class="eyes">You are the</div><div class="rn">' + ROLE[mm.role].n + '</div><div class="sub">' + ROLE[mm.role].d + ((mm.mates && mm.mates.length) ? ' Team: ' + mm.mates.map(function (x) { return esc(x.name); }).join(', ') : '') + '</div></div></div>' + h;
  }
  return h;
}
function boardHTML() {
  if (!S.board || !S.board.length) return '';
  return '<div class="card"><div class="eyes">🏅 Scoreboard</div>' + S.board.map(function (b, i) {
    return '<div class="player"><span class="pwrap"><span class="rank">' + (i + 1) + '</span>' + av(b.name) + '<span class="nm">' + esc(b.name) + '</span></span><span class="sub">' + b.wins + 'W / ' + b.games + 'G · <b class="pts">' + b.points + (b.points === 1 ? ' pt' : ' pts') + '</b></span></div>';
  }).join('') + '<div class="sub">Win = 3 pts, survive = 1 pt.</div></div>';
}
function detCard(d) { return '<div class="card center"><div class="eyes">Your investigation</div><div class="big">' + (d.mafia ? '🔪' : '✅') + '</div><h2>' + esc(d.name) + ' is ' + (d.mafia ? 'MAFIA' : 'NOT Mafia') + '</h2></div>'; }

function lobbyHTML() {
  var n = S.players.length, o = S.opts, host = isHost();
  var link = location.origin + '/?room=' + session.code;
  var h = '<div class="card"><div class="eyes">Room code – share with friends</div><div class="code">' + esc(session.code) + '</div><button data-a="share" data-v="' + esc(link) + '">📤 Share invite link</button></div>' +
    '<div class="card"><div class="eyes">Players (' + n + ')</div>' + S.players.map(function (p) {
      return '<div class="player ' + (p.connected ? '' : 'off') + '"><span class="pwrap">' + av(p.name) + '<span class="nm">' + esc(p.name) + (p.id === S.you ? ' (you)' : '') + '</span></span><span>' + (p.id === S.hostId ? '<span class="pill">host</span>' : (host ? '<button data-a="kick" data-v="' + p.id + '">✕</button>' : '')) + '</span></div>';
    }).join('') + '</div>';
  if (host) {
    h += '<div class="card"><div class="toggle"><span>🔪 Mafia</span><span class="row fix"><button data-a="mafia" data-v="-1" style="width:40px">−</button><b>' + o.mafia + '</b><button data-a="mafia" data-v="1" style="width:40px">+</button></span></div>' +
      '<div class="toggle"><span>💉 Doctor</span><input type="checkbox" data-a="doctor" ' + (o.doctor ? 'checked' : '') + '></div>' +
      '<div class="toggle"><span>🕵️ Detective</span><input type="checkbox" data-a="detective" ' + (o.detective ? 'checked' : '') + '></div>' +
      '<div class="toggle"><span>🃏 Jester</span><input type="checkbox" data-a="jester" ' + (o.jester ? 'checked' : '') + '></div>' +
      '<div class="toggle"><span>🛡️ Bodyguard</span><input type="checkbox" data-a="bodyguard" ' + (o.bodyguard ? 'checked' : '') + '></div>' +
      '<div class="toggle"><span>🎯 Sniper</span><input type="checkbox" data-a="sniper" ' + (o.sniper ? 'checked' : '') + '></div>' +
      '<div class="toggle"><span>⏱️ Timer</span></div><select data-a="timer">' + Object.keys(TIMER_LABELS).map(function (k) { return '<option value="' + k + '"' + (o.timer === k ? ' selected' : '') + '>' + TIMER_LABELS[k] + '</option>'; }).join('') + '</select>' +
      '<div class="toggle"><span>🎙️ AI narrator</span><input type="checkbox" data-a="ai" ' + (o.ai ? 'checked' : '') + '></div>' +
      (o.ai ? '<select data-a="style">' + Object.keys(STYLE_LABELS).map(function (k) { return '<option value="' + k + '"' + (o.style === k ? ' selected' : '') + '>' + STYLE_LABELS[k] + '</option>'; }).join('') + '</select>' : '') +
      '</div><button class="primary" data-a="start" ' + (S.canStart ? '' : 'disabled') + '>' + (n < 5 ? 'Need 5+ players' : (S.canStart ? 'Deal roles & start' : 'Fix role settings')) + '</button>';
  } else {
    h += '<div class="card center"><p>Waiting for the host to start…</p><div class="sub">' + o.mafia + ' Mafia' + (o.doctor ? ' · Doctor' : '') + (o.detective ? ' · Detective' : '') + (o.jester ? ' · Jester' : '') + (o.bodyguard ? ' · Bodyguard' : '') + (o.sniper ? ' · Sniper' : '') + (o.timer !== 'off' ? ' · ' + TIMER_LABELS[o.timer].split(' (')[0] : '') + (o.ai ? ' · AI narrator' : '') + '</div></div>';
  }
  return h + boardHTML();
}
function fxBadge(id) { var c = fxCount[id]; if (!c) return ''; return '<span class="badge">' + Object.keys(c).map(function (e) { return e + c[e]; }).join(' ') + '</span>'; }

/* ---------- the stickman table ---------- */
function hue(n) { var h = 0, i; for (i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360; return h; }
function hurtOf(id) { var h = hitsTaken[id] || 0; return h; }
var HATSVG = {
  crown: '<path class="hat" fill="#ffd34d" stroke="#b8860b" stroke-width="1" d="M-9-37l-1-10 5 4 5-8 5 8 5-4-1 10z"/>',
  shades: '<path class="hat" fill="#05030d" stroke="#fff" stroke-width=".8" d="M-10-31h8v5h-8zM2-31h8v5h-8zM-2-30h4v1.5h-4z"/>',
  chef: '<g class="hat"><rect x="-8" y="-45" width="16" height="9" rx="2" fill="#fff"/><circle cx="-6" cy="-48" r="5" fill="#fff"/><circle cx="0" cy="-51" r="5.5" fill="#fff"/><circle cx="6" cy="-48" r="5" fill="#fff"/></g>',
  party: '<g class="hat"><path d="M-8-37L0-57L8-37z" fill="#ff2bd6" stroke="#fff" stroke-width="1"/><path d="M-4-45l8 0M-6-41l12 0" stroke="#ffe34d" stroke-width="1.6"/><circle cx="0" cy="-58" r="2.5" fill="#00e5ff"/></g>',
  cowboy: '<g class="hat"><ellipse cx="0" cy="-37" rx="17" ry="4" fill="#8b5a2b"/><path d="M-8-37q0-12 8-12t8 12z" fill="#a9712f"/><path d="M-8-40h16" stroke="#3b2208" stroke-width="2"/></g>',
  halo: '<ellipse class="hat halo" cx="0" cy="-46" rx="10" ry="3.2" fill="none" stroke="#ffe34d" stroke-width="2.4"/>',
  horns: '<g class="hat"><path d="M-10-33L-13-48L-4-38z" fill="#ff3860"/><path d="M10-33L13-48L4-38z" fill="#ff3860"/></g>',
  tophat: '<g class="hat"><rect x="-8" y="-54" width="16" height="16" fill="#0a0a14" stroke="#aaa" stroke-width=".8"/><rect x="-13" y="-39" width="26" height="3.5" rx="1.5" fill="#0a0a14" stroke="#aaa" stroke-width=".8"/><rect x="-8" y="-45" width="16" height="3" fill="#ff3860"/></g>'
};
function stickman(p, x, y, sc, isMe, votes) {
  var hits = hurtOf(p.id), lvl = hits >= 7 ? 4 : hits >= 5 ? 3 : hits >= 3 ? 2 : hits >= 1 ? 1 : 0, hurt = Math.min(1, hits / 7);
  var dead = !p.alive, eyes = dead ? '<path class="ln sm" d="M-7-30l4 4m0-4l-4 4M3-30l4 4m0-4l-4 4"/>' : '<circle cx="-4" cy="-28" r="1.8" class="eye"/><circle cx="4" cy="-28" r="1.8" class="eye"/>';
  var mouth = dead ? '<path class="ln sm" d="M-4-21h8"/>' : lvl >= 3 ? '<path class="ln sm" d="M-5-19q5-6 10 0"/>' : lvl >= 1 ? '<path class="ln sm" d="M-4-20q4-3 8 0"/>' : '<path class="ln sm" d="M-4-22q4 4 8 0"/>';
  if (!dead && lvl >= 3) eyes = '<path class="ln sm" d="M-7-30l4 4m0-4l-4 4M3-30l4 4m0-4l-4 4"/>';
  var fx = '';
  if (!dead) {
    if (lvl >= 2) fx += '<circle class="bump" cx="8" cy="-36" r="4.5"/>';
    if (lvl >= 1) fx += '<path class="sweat" d="M13-30q-3 5 0 6q3-1 0-6z"/>';
    if (lvl >= 3) fx += '<g class="orbit"><text x="-14" y="-44" font-size="9">⭐</text><text x="8" y="-44" font-size="9">💫</text></g><path class="band" d="M-11-34l22 6"/>';
    if (lvl >= 4) fx += '<g class="steam"><text x="-18" y="-38" font-size="11">💢</text></g><path class="tear" d="M-6-24q-2 4 0 5M6-24q2 4 0 5"/>';
  }
  return '<g id="seat-' + p.id + '" class="seat' + (dead ? ' dead' : '') + (lvl ? ' hurt l' + lvl : '') + (isMe ? ' me' : '') + (p.connected ? '' : ' off') + '" data-a="seat" data-v="' + p.id + '" style="--h:' + hue(p.name) + ';--hurt:' + hurt.toFixed(2) + '" transform="translate(' + x.toFixed(1) + ',' + y.toFixed(1) + ') scale(' + sc.toFixed(3) + ')">' +
    '<ellipse class="shadow" cx="0" cy="46" rx="22" ry="6"/>' + (isMe ? '<ellipse class="mering" cx="0" cy="46" rx="27" ry="8"/>' : '') +
    '<g class="walker"><path class="ln" d="M0-14V24M0-6L-17 6L-9 17M0-6L17 6L9 17M0 24L-9 44M0 24L9 44"/>' +
    '<g class="headg"><circle class="head" cx="0" cy="-26" r="12"/>' + eyes + mouth + fx + (HATSVG[p.hat] || '') + '</g></g>' +
    (votes ? '<g class="vbub"><circle cx="17" cy="-42" r="9"/><text x="17" y="-38.5" text-anchor="middle">' + votes + '</text></g>' : '') + '</g>';
}
function renderTable() {
  if (!S || !$('seatsBack')) return;
  var ps = S.players, n = ps.length, mi = Math.max(0, ps.findIndex(function (p) { return p.id === S.you; }));
  var cx = 200, cy = 168, rx = 160, ry = 112, base = Math.max(0.52, Math.min(1, 1.1 - n * 0.032));
  var tally = {}; if (S.phase === 'day' || S.phase === 'verdict') Object.keys(S.votes).forEach(function (v) { tally[S.votes[v]] = (tally[S.votes[v]] || 0) + 1; });
  var back = '', front = '', labels = '';
  seatPos = {};
  for (var i = 0; i < n; i++) {
    var p = ps[(mi + i) % n], ang = Math.PI / 2 + (i * 2 * Math.PI / n), sn = Math.sin(ang);
    var x = cx + rx * Math.cos(ang), y = cy + ry * sn, sc = base * (0.8 + 0.28 * ((sn + 1) / 2));
    seatPos[p.id] = { x: x, y: y, s: sc };
    var fig = stickman(p, x, y, sc, p.id === S.you, tally[p.id] || 0);
    if (y < cy) back += fig; else front += fig;
    var ly = y < cy ? y - 50 * sc : y + 56 * sc, tag = (p.id === S.hostId ? '👑 ' : '') + esc(p.name) + (p.role ? ' ' + (ROLE[p.role] ? ROLE[p.role].e : '') : '') + (hitsTaken[p.id] ? ' 🤕' + hitsTaken[p.id] : '');
    labels += '<text class="tl' + (p.alive ? '' : ' dead') + (p.id === S.you ? ' me' : '') + '" x="' + x.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="middle" style="font-size:' + Math.max(9, 13 * (0.7 + sc * 0.4)).toFixed(1) + 'px">' + tag + '</text>';
  }
  setHTML('seatsBack', back); setHTML('seatsFront', front); setHTML('labels', labels);
  $('tcenter').textContent = S.phase === 'night' ? '🌙 ASLEEP' : S.phase === 'lobby' ? '🎭' : S.phase === 'over' ? '🏆' : '☀️ DAY ' + S.day;
  $('tsvg').setAttribute('class', S.phase === 'night' ? 'dim' : '');
  $('tablebody').hidden = !tableOn; $('tbltoggle').textContent = tableOn ? 'Hide' : 'Show';
  var tools = '<button class="chip' + (tableMode === 'hit' ? ' on' : '') + '" data-a="tmode" data-v="hit">👊 Hit</button><button class="chip' + (tableMode === 'point' ? ' on' : '') + '" data-a="tmode" data-v="point">👉 Point</button>';
  if (tableMode === 'hit') Object.keys(WEAPONS).forEach(function (k) { tools += '<button class="chip wp' + (weapon === k ? ' on' : '') + '" data-a="weapon" data-v="' + k + '">' + WEAPONS[k] + '</button>'; });
  tools += '<div class="toolrow">';
  Object.keys(EMOTES).forEach(function (k) { tools += '<button class="chip em" data-a="emote" data-v="' + k + '">' + EMOTES[k] + '</button>'; });
  tools += '</div><div class="toolrow hats"><span class="sub">Hat</span>';
  var mh = (me() && me().hat) || 'none';
  Object.keys(HATS).forEach(function (k) { tools += '<button class="chip ht' + (mh === k ? ' on' : '') + '" data-a="hat" data-v="' + k + '">' + HATS[k] + '</button>'; });
  tools += '</div>';
  setHTML('tbltools', tools);
  $('tblhint').textContent = S.phase === 'night' ? '😴 Everyone is asleep – no fighting at night.' : tableMode === 'hit' ? 'Tap a stickman to run over and bonk them with ' + WEAPONS[weapon] : 'Tap a stickman to point at the suspect' + (S.phase === 'day' ? ' (also casts your vote)' : '');
}
function svgEl(name, attrs, text) { var e = document.createElementNS('http://www.w3.org/2000/svg', name); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); if (text != null) e.textContent = text; return e; }
function fxAdd(el, ms) { var l = $('fxlayer'); if (!l) return; l.appendChild(el); setTimeout(function () { if (el.parentNode) el.remove(); }, ms); }
function doHit(m) {
  var a = $('seat-' + m.from), pa = seatPos[m.from], pb = seatPos[m.to];
  hitsTaken[m.to] = (hitsTaken[m.to] || 0) + 1;
  addChat({ k: 'roast', n: m.n, t: 'bonked ' + m.tn + ' with ' + (WEAPONS[m.weapon] || '') });
  if (!a || !pa || !pb || !$('fxlayer')) return;
  sfx('whoosh');
  var clone = a.cloneNode(true); clone.removeAttribute('id'); clone.removeAttribute('data-a'); clone.classList.add('fxclone');
  var walker = clone.querySelector('.walker');
  walker.appendChild(svgEl('text', { class: 'wpn', x: 16, y: -2 }, WEAPONS[m.weapon] || '🩴'));
  a.style.visibility = 'hidden'; $('fxlayer').appendChild(clone);
  var dx = (pb.x - pa.x) * 0.7 / pa.s, dy = (pb.y - pa.y) * 0.7 / pa.s;
  setTimeout(function () { walker.style.transition = 'transform .34s ease-in'; walker.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)'; clone.classList.add('walking'); }, 20);
  setTimeout(function () {
    walker.classList.add('swing'); sfx(WSFX[m.weapon] || 'bonk'); setTimeout(function () { sfx(m.weapon === 'banana' ? 'boing' : 'oof'); }, 120);
    if (S) { sigs.labels = null; renderTable(); }
    var b = $('seat-' + m.to); if (b) b.classList.add(m.weapon === 'banana' ? 'slipped' : m.weapon === 'pan' ? 'dazed' : 'wobble');
    fxAdd(svgEl('text', { class: 'bonk', x: pb.x, y: pb.y - 52 * pb.s }, (WTXT[m.weapon] || ['BONK!'])[Math.floor(Math.random() * 2)]), 1100);
    fxAdd(svgEl('text', { class: 'stars', x: pb.x, y: pb.y - 38 * pb.s }, '💫'), 1100);
    if (m.to === (S && S.you)) { try { if (navigator.vibrate) navigator.vibrate(90); } catch (e) { /* ignore */ } }
    setTimeout(function () { var bb = $('seat-' + m.to); if (bb) bb.classList.remove('wobble', 'slipped', 'dazed'); }, 1100);
  }, 380);
  setTimeout(function () { walker.classList.remove('swing'); walker.style.transition = 'transform .4s ease-out'; walker.style.transform = ''; }, 900);
  setTimeout(function () { clone.remove(); var o = $('seat-' + m.from); if (o) o.style.visibility = ''; }, 1350);
}
function doEmote(m) {
  var pa = seatPos[m.from]; addChat({ k: 'roast', n: m.n, t: EMOTES[m.emote] + ' ' + m.emote });
  if (!pa || !$('fxlayer')) return;
  sfx(m.emote === 'laugh' ? 'haha' : m.emote === 'cry' ? 'sad' : m.emote === 'dance' ? 'tada' : m.emote === 'flex' ? 'punch' : m.emote === 'facepalm' ? 'rimshot' : 'boing');
  fxAdd(svgEl('text', { class: 'emo', x: pa.x, y: pa.y - 56 * pa.s }, EMOTES[m.emote]), 1700);
  var a = $('seat-' + m.from); if (a) { a.classList.add('emo-' + m.emote); setTimeout(function () { var q = $('seat-' + m.from); if (q) q.classList.remove('emo-' + m.emote); }, 1700); }
}
function doPoint(m) {
  var pa = seatPos[m.from], pb = seatPos[m.to];
  addChat({ k: 'roast', n: m.n, t: 'points at ' + m.tn + ' 👉 "You are the Mafia!"' });
  if (!pa || !pb || !$('fxlayer')) return;
  sfx('point');
  var g = svgEl('g', { class: 'pointfx' });
  g.appendChild(svgEl('line', { class: 'beam', x1: pa.x, y1: pa.y - 26 * pa.s, x2: pb.x, y2: pb.y - 26 * pb.s }));
  g.appendChild(svgEl('text', { class: 'pfinger', x: pa.x + (pb.x - pa.x) * 0.5, y: pa.y - 26 * pa.s + (pb.y - pa.y) * 0.5 }, '☝️'));
  g.appendChild(svgEl('text', { class: 'sus', x: pb.x, y: pb.y - 54 * pb.s }, 'SUS!'));
  fxAdd(g, 2600);
  var b = $('seat-' + m.to); if (b) { b.classList.add('accused'); setTimeout(function () { var bb = $('seat-' + m.to); if (bb) bb.classList.remove('accused'); }, 2400); }
}
function seatTap(id) {
  if (!S || id === S.you) return;
  if (S.phase === 'night') { toast('Night: everyone is asleep 😴'); return; }
  if (tableMode === 'hit') send({ t: 'hit', to: id, weapon: weapon });
  else {
    send({ t: 'point', to: id });
    var t = S.players.find(function (p) { return p.id === id; }), m = me();
    if (S.phase === 'day' && m && m.alive && t && t.alive) send({ t: 'vote', target: id });
  }
}

/* ---------- roast zone ---------- */
function funPanel() {
  var players = S.players.filter(function (p) { return p.id !== S.you; });
  if (!players.some(function (p) { return p.id === funTarget; })) funTarget = players[0] ? players[0].id : '';
  var html = '<div class="eyes">Target</div><select id="ft">' + players.map(function (p) { return '<option value="' + p.id + '"' + (p.id === funTarget ? ' selected' : '') + '>' + esc(p.name) + (p.alive ? '' : ' 👻') + '</option>'; }).join('') + '</select>' +
    '<div class="eyes" style="margin-top:8px">Throw something</div><div class="emo">' + throwsList.map(function (e) { return '<button data-a="throw" data-v="' + e + '">' + e + '</button>'; }).join('') + '</div>' +
    '<div class="eyes">Quick roast</div>' + roastList.map(function (r, i) { return '<button class="ghost" style="text-align:left;font-weight:500;font-size:13px" data-a="roast" data-v="' + i + '">' + esc(r.replace('{n}', '…')) + '</button>'; }).join('');
  if (sigs.funbody === html) return;
  sigs.funbody = html; $('funbody').innerHTML = html;
}
function onFx(m) {
  fly(m.emoji); sfx('throw');
  var c = (fxCount[m.to] = fxCount[m.to] || {}); c[m.emoji] = (c[m.emoji] || 0) + 1;
  toast(m.n + (m.emoji === '👀' ? ' is suspicious of ' : ' threw ' + m.emoji + ' at ') + m.tn);
  sigs.main = null; if (S) render();
}
function fly(e) { var d = document.createElement('div'); d.className = 'fly'; d.textContent = e; d.style.left = (10 + Math.random() * 75) + '%'; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2300); }
function toast(t) { var d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2600); }

/* ---------- chat ---------- */
function channels() {
  var c = ['town'];
  if (S && S.me && S.me.role === 'mafia') c.push('mafia');
  if (S && S.me && !S.me.alive) c.push('ghost');
  return c;
}
function tabsRender() {
  var cs = channels();
  if (cs.indexOf(tab) < 0) tab = 'town';
  if (S.me && !S.me.alive && S.phase !== 'over' && tab === 'town' && cs.indexOf('ghost') >= 0) tab = 'ghost';
  var lab = { town: '🏘️ Town', mafia: '🔪 Mafia', ghost: '👻 Ghosts' };
  setHTML('tabs', cs.map(function (c) { return '<button class="' + (c === tab ? 'on' : '') + '" data-a="tab" data-v="' + c + '">' + lab[c] + '</button>'; }).join(''));
  var night = S.phase === 'night' && tab === 'town';
  var dead = S.me && !S.me.alive && S.phase !== 'over' && tab === 'town';
  $('ci').disabled = night || dead;
  $('ci').placeholder = night ? '🌙 Night – town chat is silent' : dead ? 'Ghosts chat in the Ghost tab' : 'Say something…';
}
function addChat(m) { chat.push(m); if (chat.length > 200) chat.shift(); if (inGame && $('chatlog')) chatRender(); }
function chatRender() {
  var el = $('chatlog'); if (!el) return;
  var vis = chat.filter(function (m) { return m.k === 'roast' || m.ch === tab; });
  var html = vis.map(function (m) { return m.k === 'roast' ? '<div class="msg roast">🔥 <b>' + esc(m.n) + '</b>: ' + esc(m.t) + '</div>' : '<div class="msg ' + m.ch + '"><b>' + esc(m.n) + '</b>: ' + esc(m.t) + '</div>'; }).join('') || '<div class="msg sys">No messages yet. Say hi 👋</div>';
  if (sigs.chatlog === html) return;
  var near = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  sigs.chatlog = html; el.innerHTML = html;
  if (near) el.scrollTop = el.scrollHeight;
}
function sendChat() { var i = $('ci'); var t = i.value.trim(); if (!t || i.disabled) return; i.value = ''; send({ t: 'chat', ch: tab, text: t }); }

/* ---------- voice, vibration ---------- */
function speak(t) { if (!narr || !t) return; if (callMode) showSub(t); if (!window.speechSynthesis) return; try { wakeAudio(); var u = new SpeechSynthesisUtterance(t); u.rate = 0.95; u.onstart = function () { voice.speaking++; voiceGate(); }; u.onend = u.onerror = function () { voice.speaking = Math.max(0, voice.speaking - 1); voiceGate(); }; speechSynthesis.speak(u); } catch (e) { /* ignore */ } }
function effects() {
  var alive = S.players.filter(function (p) { return p.alive; }).length;
  if (S.phase !== lastPhase) {
    if (lastPhase !== null) {
      if (S.phase === 'night') sfx('night'); else if (S.phase === 'day') sfx('day');
      else if (S.phase === 'over') { var r = S.me && S.me.role; sfx((S.winner === 'jester' ? r === 'jester' : S.winner === 'mafia' ? r === 'mafia' : (r !== 'mafia' && r !== 'jester')) ? 'win' : 'lose'); }
    }
    if (S.me && S.phase !== 'lobby' && revealPending) { sfx('reveal'); setTimeout(function () { revealPending = false; }, 1300); }
    lastPhase = S.phase;
  }
  if (lastAlive >= 0 && alive < lastAlive && S.phase !== 'lobby') sfx('elim');
  var ev = S.event;
  if (!eventPrimed) { eventPrimed = true; if (ev) lastEid = ev.eid; }
  else if (ev && ev.eid !== lastEid) { lastEid = ev.eid; showReveal(ev); }
  if (S.phase !== 'day') armedShot = '';
  lastAlive = alive;
  if (S.phase === 'lobby') { if (lastPlayers >= 0 && S.players.length > lastPlayers) sfx('join'); lastPlayers = S.players.length; } else lastPlayers = -1;
  if (S.aid !== lastAid) { lastAid = S.aid; if (S.announce && S.phase !== 'lobby') speak(S.announce); }
  if (S.narrator && S.narrator.id !== lastNarr) { lastNarr = S.narrator.id; speak(S.narrator.text); }
  var needs = !!(S.me && S.me.type && S.me.acted == null && S.phase === 'night');
  if (needs && !lastNeeds) { try { if (navigator.vibrate) navigator.vibrate(300); } catch (e) { /* ignore */ } }
  lastNeeds = needs;
}

/* ---------- kill / vote reveal overlay ---------- */
function showReveal(ev) {
  var kind, icon, title, name, sub = '', role = '';
  if (ev.out) {
    kind = 'out'; icon = ev.out.role === 'jester' ? '🃏' : '🗳️'; title = ev.out.role === 'jester' ? 'The Jester wins!' : 'Voted out';
    name = ev.out.name; role = ev.out.role; sub = ev.out.votes + ' vote' + (ev.out.votes > 1 ? 's' : '');
  } else if (ev.died) {
    kind = 'kill'; icon = '💀'; name = ev.died.name; role = ev.died.role;
    if (ev.guarded) { title = 'Bodyguard down'; icon = '🛡️'; sub = 'took the bullet for ' + ev.guarded; }
    else if (ev.shooter) { title = 'Sniper fired'; icon = '🎯'; sub = ev.backfire ? 'Innocent! ' + ev.shooter.name + ' (Sniper) falls too' : 'Direct hit on the Mafia'; }
    else { title = 'Eliminated'; sub = 'Killed in the night'; }
  } else if (ev.saved) { kind = 'save'; icon = '💉'; title = 'Saved!'; name = 'Nobody died'; sub = 'The Doctor foiled the Mafia'; }
  else if (ev.tie) { kind = 'tie'; icon = '⚖️'; title = 'Tie'; name = 'Nobody is eliminated'; sub = 'The town could not decide'; }
  else return;
  if (kind === 'out' || kind === 'kill') { sfx('drum'); setTimeout(function () { sfx(kind === 'out' && role === 'jester' ? 'rimshot' : 'bang'); }, 900); } else sfx(kind === 'save' ? 'tada' : 'tick');
  var d = document.createElement('div'); d.className = 'reveal ' + kind;
  d.innerHTML = '<div class="rv-box"><div class="rv-ic">' + icon + '</div><div class="rv-title">' + esc(title) + '</div><div class="rv-name">' + esc(name) + '</div>' +
    (role && ROLE[role] ? '<span class="pill ' + role + '">' + ROLE[role].e + ' ' + ROLE[role].n + '</span>' : '') + '<div class="rv-sub">' + esc(sub) + '</div></div>';
  var done = function () { if (d.parentNode) d.remove(); };
  d.addEventListener('click', done); document.body.appendChild(d); setTimeout(done, 3300);
  var app = $('app'); if (app && (kind === 'kill' || kind === 'out')) { app.classList.add('shake'); setTimeout(function () { app.classList.remove('shake'); }, 700); }
}

/* ---------- live voice chat: WebRTC audio, peers talk directly, our websocket only carries the handshake ---------- */
var voice = { on: false, mic: false, muted: false, stream: null, peers: {}, ids: [], ice: [{ urls: 'stun:stun.l.google.com:19302' }], speaking: 0, ctx: null, lv: {}, talking: {} };
function canTalk() { var m = me(); return !!(S && voice.mic && !voice.muted && !voice.speaking && S.phase !== 'night' && S.phase !== 'over' && (S.phase === 'lobby' || (m && m.alive))); }
function voiceGate() {
  if (voice.stream) voice.stream.getAudioTracks().forEach(function (t) { t.enabled = canTalk(); });
  Object.keys(voice.peers).forEach(function (id) { var a = voice.peers[id].el; if (a) a.muted = !!(S && S.phase === 'night'); });
}
function voiceLevel(id, stream) {
  try {
    voice.ctx = voice.ctx || new (window.AudioContext || window.webkitAudioContext)();
    var an = voice.ctx.createAnalyser(); an.fftSize = 256; voice.ctx.createMediaStreamSource(stream).connect(an);
    voice.lv[id] = { an: an, buf: new Uint8Array(an.frequencyBinCount) };
  } catch (e) { /* speaking rings are optional */ }
}
setInterval(function () {
  if (!voice.on) return;
  var live = {};
  Object.keys(voice.lv).forEach(function (id) {
    var l = voice.lv[id]; l.an.getByteFrequencyData(l.buf); var s = 0, i; for (i = 0; i < l.buf.length; i++) s += l.buf[i];
    live[id] = s / l.buf.length > 14 && (id !== (S && S.you) || canTalk());
  });
  voice.talking = live;
  Object.keys(live).forEach(function (id) { var el = $('seat-' + id); if (el) el.classList.toggle('talking', !!live[id]); });
}, 160);
function vsend(to, data) { send({ t: 'rtc', to: to, data: data }); }
function dropPeer(id) {
  var p = voice.peers[id]; if (!p) return; delete voice.peers[id]; delete voice.lv[id];
  try { p.pc.close(); } catch (e) { /* ignore */ } if (p.el) { p.el.srcObject = null; p.el.remove(); }
}
function makePeer(id, initiator) {
  var pc = new RTCPeerConnection({ iceServers: voice.ice, iceTransportPolicy: voice.relayOnly ? 'relay' : 'all' }), p = { pc: pc, el: null, queue: [] };
  voice.peers[id] = p;
  if (voice.stream) voice.stream.getTracks().forEach(function (t) { pc.addTrack(t, voice.stream); });
  else if (initiator) pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.onicecandidate = function (e) { if (e.candidate) vsend(id, { c: e.candidate }); };
  pc.ontrack = function (e) {
    if (p.el) return;
    var a = document.createElement('audio'); a.autoplay = true; a.setAttribute('playsinline', ''); a.srcObject = e.streams[0]; a.className = 'voiceaudio';
    document.body.appendChild(a); p.el = a; a.muted = !!(S && S.phase === 'night');
    var pr = a.play(); if (pr && pr.catch) pr.catch(function () { /* autoplay retried on next tap */ });
    voiceLevel(id, e.streams[0]);
  };
  pc.onconnectionstatechange = function () {
    var st = pc.connectionState;
    if (st === 'connected') {
      /* voice needs ~24-32 kbps; capping keeps a 6 person mesh light enough for weak mobile data */
      pc.getSenders().forEach(function (sn) { if (sn.track && sn.setParameters) { try { var pr = sn.getParameters(); pr.encodings = pr.encodings && pr.encodings.length ? pr.encodings : [{}]; pr.encodings[0].maxBitrate = 32000; sn.setParameters(pr).catch(function () { /* ignore */ }); } catch (e) { /* ignore */ } } });
    }
    if (st === 'disconnected') setTimeout(function () { if (voice.peers[id] === p && pc.connectionState !== 'connected') { dropPeer(id); voiceSync(); } }, 4000);   // network blip that did not heal: rebuild this one link
    if (st === 'failed' && voice.peers[id] === p) { dropPeer(id); setTimeout(function () { voiceSync(); }, 1200); }
  };
  if (initiator) pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).then(function () { vsend(id, { sdp: pc.localDescription }); }).catch(function () { /* ignore */ });
  return p;
}
function voiceSync() {
  if (!voice.on || !S) return;
  Object.keys(voice.peers).forEach(function (id) { if (voice.ids.indexOf(id) < 0) dropPeer(id); });
  voice.ids.forEach(function (id) { if (id !== S.you && !voice.peers[id] && S.you < id) makePeer(id, true); });   // the lower id always makes the offer: no clashes
  voiceGate(); renderVoice();
}
function onRtc(m) {
  if (!voice.on || !m.data) return;
  var d = m.data, p = voice.peers[m.from];
  if (d.sdp && d.sdp.type === 'offer') {
    if (p) dropPeer(m.from);
    p = makePeer(m.from, false);
    p.pc.setRemoteDescription(d.sdp).then(function () { return p.pc.createAnswer(); }).then(function (a) { return p.pc.setLocalDescription(a); })
      .then(function () { vsend(m.from, { sdp: p.pc.localDescription }); p.ready = true; p.queue.splice(0).forEach(function (c) { p.pc.addIceCandidate(c).catch(function () { /* ignore */ }); }); }).catch(function () { /* ignore */ });
  } else if (d.sdp && d.sdp.type === 'answer' && p) {
    p.pc.setRemoteDescription(d.sdp).then(function () { p.ready = true; p.queue.splice(0).forEach(function (c) { p.pc.addIceCandidate(c).catch(function () { /* ignore */ }); }); }).catch(function () { /* ignore */ });
  } else if (d.c && p) {
    if (p.ready) p.pc.addIceCandidate(d.c).catch(function () { /* ignore */ }); else p.queue.push(d.c);
  }
}
function voiceStart() {
  if (voice.on) return;
  if (!window.RTCPeerConnection) { toast('Voice chat is not supported on this browser'); return; }
  var go = function (stream) {
    voice.stream = stream; voice.mic = !!stream; voice.on = true; voice.muted = false;
    if (stream) voiceLevel(S.you, stream);
    send({ t: 'voice', on: true }); voiceGate(); renderVoice();
    toast(stream ? '🎤 Voice chat on – you can talk during the day' : '🎧 Listen-only (no mic allowed)');
  };
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }).then(go, function () { go(null); });
  } else go(null);
}
function voiceStop(quiet) {
  if (!voice.on && !quiet) return;
  var was = voice.on; voice.on = false;
  Object.keys(voice.peers).forEach(dropPeer);
  if (voice.stream) { voice.stream.getTracks().forEach(function (t) { t.stop(); }); }
  voice.stream = null; voice.mic = false; voice.lv = {}; voice.talking = {};
  if (was) { try { send({ t: 'voice', on: false }); } catch (e) { /* socket may be gone */ } }
  renderVoice();
}
function renderVoice() {
  var box = $('voicebar'); if (!box || !S) return;
  var others = voice.ids.filter(function (i) { return i !== S.you; }).length, h;
  if (!voice.on) h = '<button class="chip vj" data-a="voicejoin">🎙️ Join voice chat' + (voice.ids.length ? ' · ' + voice.ids.length + ' in' : '') + '</button>';
  else {
    var m = me(), why = S.phase === 'night' ? '🌙 Night – everyone is muted' : (S.phase !== 'lobby' && S.phase !== 'over' && m && !m.alive) ? '💀 Ghosts cannot talk' : !voice.mic ? '🎧 Listen-only' : voice.muted ? '🔇 You are muted' : '🎤 You are live';
    h = '<span class="chip on">🔊 In voice · ' + (others + 1) + '</span><button class="chip" data-a="voicemute">' + (voice.muted ? '🔇 Unmute' : '🎤 Mute') + '</button><button class="chip" data-a="voiceleave">Leave</button><div class="sub">' + why + '</div>';
  }
  setHTML('voicebar', h);
}

/* ---------- phase countdown ---------- */
setInterval(function () {
  var chip = $('timerchip'); if (!chip) return;
  if (endAt == null || !S || (S.phase !== 'night' && S.phase !== 'day')) { chip.hidden = true; return; }
  var left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
  chip.hidden = false; chip.textContent = '⏱ ' + Math.floor(left / 60) + ':' + ('0' + (left % 60)).slice(-2);
  chip.className = 'chip tm' + (left <= 10 ? ' low' : '');
  if (left <= 5 && left > 0 && left !== lastTick) sfx('beep');
  lastTick = left;
}, 500);

/* ---------- clicks ---------- */
document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-a]'); if (!b || b.tagName === 'INPUT' || b.tagName === 'SELECT') return;
  var a = b.getAttribute('data-a'), v = b.getAttribute('data-v');
  if (a !== 'togglesfx') sfx(a === 'act' ? 'act' : a === 'vote' ? 'vote' : 'tick');
  switch (a) {
    case 'create': enter('create'); break;
    case 'join': enter('join'); break;
    case 'start': send({ t: 'start' }); break;
    case 'again': send({ t: 'again' }); break;
    case 'act': send({ t: 'act', type: b.getAttribute('data-type'), target: v }); break;
    case 'vote': send({ t: 'vote', target: v || null }); break;
    case 'closeVote': send({ t: 'closeVote' }); break;
    case 'shoot': if (armedShot === v) { armedShot = ''; sfx('bang'); send({ t: 'shoot', target: v }); } else { armedShot = v; sigs.main = null; if (S) render(); } break;
    case 'skipNight': send({ t: 'skipNight' }); break;
    case 'kick': send({ t: 'kick', id: v }); break;
    case 'mafia': send({ t: 'opts', opts: { mafia: Math.max(1, Math.min(S.maxMafia, S.opts.mafia + Number(v))) } }); break;
    case 'tab': tab = v; sigs.tabs = null; sigs.chatlog = null; if (S) { tabsRender(); chatRender(); } break;
    case 'send': sendChat(); break;
    case 'emoji': if (!$('ci').disabled) send({ t: 'chat', ch: tab, text: v }); else toast('Chat is closed here right now'); break;
    case 'throw': if (funTarget) send({ t: 'fx', to: funTarget, emoji: v }); break;
    case 'roast': if (funTarget) send({ t: 'roast', to: funTarget, i: Number(v) }); break;
    case 'togglerole': hideRole = !hideRole; sigs.main = null; if (S) render(); break;
    case 'togglecall': callMode = !callMode; try { store.setItem('mafia_call', callMode ? '1' : '0'); } catch (x) { /* ignore */ } if (callMode) { toast('📞 Call mode ON: vibration, flashes and subtitles'); cue('bang'); } else { var sb = $('subtitle'); if (sb) sb.remove(); toast('📞 Call mode off'); } if (S) render(); break;
    case 'togglenarr': narr = !narr; if (!narr && window.speechSynthesis) { try { speechSynthesis.cancel(); } catch (x) { /* ignore */ } } if (S) render(); break;
    case 'togglesfx': sfxOn = !sfxOn; try { store.setItem('mafia_sfx', sfxOn ? '1' : '0'); } catch (x) { /* ignore */ } if (sfxOn) sfx('tick'); if (S) render(); break;
    case 'seat': seatTap(v); break;
    case 'emote': send({ t: 'emote', emote: v }); break;
    case 'voicejoin': voiceStart(); break;
    case 'voiceleave': voiceStop(); break;
    case 'voicemute': voice.muted = !voice.muted; voiceGate(); renderVoice(); break;
    case 'hat': try { store.setItem('mafia_hat', v); } catch (e) { /* ignore */ } send({ t: 'hat', hat: v }); break;
    case 'tmode': tableMode = v; sigs.tbltools = null; if (S) renderTable(); break;
    case 'weapon': weapon = v; sigs.tbltools = null; if (S) renderTable(); break;
    case 'tabletoggle': tableOn = !tableOn; if (S) renderTable(); break;
    case 'share': share(v); break;
  }
});
document.addEventListener('change', function (e) {
  var t = e.target, a = t.getAttribute && t.getAttribute('data-a'); if (!a) return;
  if (a === 'doctor' || a === 'detective' || a === 'ai' || a === 'jester' || a === 'bodyguard' || a === 'sniper') { var o = {}; o[a] = t.checked; send({ t: 'opts', opts: o }); }
  if (a === 'style') send({ t: 'opts', opts: { style: t.value } });
  if (a === 'timer') send({ t: 'opts', opts: { timer: t.value } });
});
function share(link) {
  var text = 'Join my Mafia game! Room ' + session.code + ' ' + link;
  if (navigator.share) { navigator.share({ title: 'Mafia Live', text: text, url: link }).catch(function () {}); return; }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast('Invite link copied'); }, function () { toast(link); });
  else toast(link);
}
document.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target && e.target.id === 'cd') enter('join'); });
window.addEventListener('beforeunload', function () { closing = true; });

/* ---------- boot ---------- */
session = load();
if (session) { $('app').innerHTML = '<h1>🎭 Mafia Live</h1><p class="center">Reconnecting to your game…</p>'; } else { homeView(); }
connect();
})();
