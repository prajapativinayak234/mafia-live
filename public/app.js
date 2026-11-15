(function () {
'use strict';
var STYLE_LABELS = { bollywood: '🎬 Bollywood drama', uncle: '👴 Desi uncle gossip', roast: '🎤 Savage roast comedian', noir: '🕯️ Mysterious storyteller' };
var ROLE = {
  mafia: { n: 'Mafia', e: '🔪', d: 'Each night, pick a victim with your team. Lie well by day.' },
  doctor: { n: 'Doctor', e: '💉', d: 'Each night, save one person (yourself allowed).' },
  detective: { n: 'Detective', e: '🕵️', d: 'Each night, check if one person is Mafia.' },
  villager: { n: 'Villager', e: '🏘️', d: 'No power. Talk, accuse, vote. Find the Mafia.' }
};
var $ = function (id) { return document.getElementById(id); };
var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

var ws = null, session = null, S = null, chat = [], throwsList = [], roastList = [];
var tab = 'town', hideRole = false, narr = true, funTarget = '', lastAid = -1, lastNarr = null, lastNeeds = false;
var fxCount = {}, retry = 0, pendingEntry = null, inGame = false, homeMsg = '', closing = false;

function load() { try { return JSON.parse(localStorage.getItem('mafia_session') || 'null'); } catch (e) { return null; } }
function save() { try { if (session) localStorage.setItem('mafia_session', JSON.stringify(session)); else localStorage.removeItem('mafia_session'); } catch (e) { /* ignore */ } }
function savedName() { try { return localStorage.getItem('mafia_name') || ''; } catch (e) { return ''; } }
function saveName(n) { try { localStorage.setItem('mafia_name', n); } catch (e) { /* ignore */ } }

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
      throwsList = m.throws; roastList = m.roasts;
      if (!inGame) { inGame = true; chat = []; fxCount = {}; buildShell(); }
      break;
    case 'state': S = m.s; if (inGame) render(); break;
    case 'chat': addChat({ k: 'm', ch: m.ch, n: m.n, t: m.text }); break;
    case 'roast': addChat({ k: 'roast', n: m.n, t: m.text }); break;
    case 'fx': onFx(m); break;
    case 'err': if (inGame) toast(m.msg); else { homeMsg = m.msg; var e = $('err'); if (e) e.textContent = m.msg; } break;
    case 'gone': leave('That room has ended. Start or join a new one.'); break;
    case 'kicked': leave('The host removed you from the room.'); break;
  }
}
function leave(msg) { sigs = {}; session = null; save(); S = null; inGame = false; pendingEntry = null; homeMsg = msg || ''; lastAid = -1; lastNarr = null; homeView(); }

/* ---------- home ---------- */
function homeView() {
  var pre = ''; try { pre = (new URLSearchParams(location.search).get('room') || '').toUpperCase().slice(0, 4); } catch (e) { /* ignore */ }
  $('app').innerHTML = '<h1>🎭 Mafia Live</h1><div class="sub">Roast Edition – play from anywhere</div>' +
    '<div class="card"><div class="eyes">Your name</div><input id="nm" type="text" maxlength="14" placeholder="e.g. Vinayak" value="' + esc(savedName()) + '">' +
    '<div style="height:8px"></div>' +
    '<div class="eyes">Room code</div><input id="cd" type="text" maxlength="4" placeholder="4 letters" style="text-transform:uppercase;text-align:center" value="' + esc(pre) + '">' +
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
  sigs = {};
  $('app').innerHTML = '<div class="top"><div id="tl"></div><div class="row fix"><span class="chip" id="rolechip" data-a="togglerole"></span><span class="chip" id="narrchip" data-a="togglenarr">🔊</span></div></div>' +
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
  setHTML('main', mainHTML(m));
  funPanel();
  tabsRender();
  chatRender();
  effects();
}

function mainHTML(m) {
  var h = '';
  if (S.phase === 'lobby') return lobbyHTML();
  if (S.narrator && S.narrator.text) h += '<div class="card"><div class="eyes">🎙️ Narrator</div><div class="script">' + esc(S.narrator.text) + '</div></div>';
  var mm = S.me || {};
  if (S.phase === 'night') {
    h += '<div class="card center"><div class="big">🌙</div><div class="script">' + esc(S.announce) + '</div></div>';
    if (!mm.alive) h += '<div class="card center">👻 You\'re out. Watch quietly – ghosts only chat with ghosts.</div>';
    else if (mm.type) {
      var lab = { kill: 'Choose your victim (agree with your team in Mafia chat)', save: 'Choose who to save', probe: 'Choose who to investigate' }[mm.type];
      h += '<div class="card"><div class="eyes">' + lab + '</div>' + S.players.filter(function (p) {
        if (!p.alive) return false;
        if (mm.type === 'kill' && (p.id === S.you || (mm.mates || []).some(function (x) { return x.id === p.id; }))) return false;
        if (mm.type === 'probe' && p.id === S.you) return false;
        return true;
      }).map(function (p) {
        var picks = Object.keys(mm.matePicks || {}).filter(function (k) { return mm.matePicks[k] === p.id; }).map(nameOf);
        return '<div class="player pick ' + (mm.acted === p.id ? 'sel' : '') + '" data-a="act" data-type="' + mm.type + '" data-v="' + p.id + '"><span class="nm">' + esc(p.name) + '</span>' + (picks.length ? '<span class="sub">🎯 ' + picks.map(esc).join(', ') + '</span>' : '') + '</div>';
      }).join('') + '<div class="sub">' + (mm.acted ? 'Locked in – you can change it until everyone is done.' : 'Tap a name.') + '</div></div>';
    } else h += '<div class="card center"><p>You sleep. Stay quiet and mute your mic 😴</p></div>';
    if (mm.det && mm.alive) h += detCard(mm.det);
    if (isHost()) h += '<button class="ghost" data-a="skipNight">Host: skip the rest of the night</button>';
  } else if (S.phase === 'day' || S.phase === 'verdict') {
    h += '<div class="card center"><div class="script">' + esc(S.announce) + '</div></div>';
    if (mm.det && mm.alive) h += detCard(mm.det);
    var tally = {};
    Object.keys(S.votes).forEach(function (v) { tally[S.votes[v]] = (tally[S.votes[v]] || 0) + 1; });
    h += '<div class="card"><div class="eyes">' + (S.phase === 'day' ? 'Vote someone out' : 'Votes') + '</div>' + S.players.map(function (p) {
      var voters = Object.keys(S.votes).filter(function (v) { return S.votes[v] === p.id; }).map(nameOf);
      var mine = S.votes[S.you] === p.id;
      var canVote = S.phase === 'day' && p.alive && amAlive() && p.id !== S.you;
      return '<div class="player ' + (p.alive ? '' : 'dead') + (p.connected ? '' : ' off') + (mine ? ' sel' : '') + '"><span><span class="nm">' + esc(p.name) + '</span>' + (p.role ? ' <span class="pill ' + p.role + '">' + ROLE[p.role].e + '</span>' : '') + fxBadge(p.id) + '<div class="sub">' + (voters.length ? '🗳️ ' + voters.map(esc).join(', ') : '') + '</div></span>' +
        (canVote ? '<button data-a="vote" data-v="' + (mine ? '' : p.id) + '">' + (tally[p.id] || 0) + ' · ' + (mine ? 'Unvote' : 'Vote') + '</button>' : '<b>' + (tally[p.id] || '') + '</b>') + '</div>';
    }).join('') + '</div>';
    if (isHost() && S.phase === 'day') h += '<button class="gold" data-a="closeVote">Close the vote now</button>';
  } else if (S.phase === 'over') {
    var town = S.winner === 'town';
    h += '<div class="card center"><div class="big">' + (town ? '🎉' : '🔪') + '</div><h1>' + (town ? 'Town wins!' : 'Mafia wins!') + '</h1></div>' +
      '<div class="card"><div class="eyes">Everyone\'s role</div>' + S.players.map(function (p) { return '<div class="player ' + (p.alive ? '' : 'dead') + '"><span class="nm">' + esc(p.name) + '</span><span class="pill ' + p.role + '">' + ROLE[p.role].e + ' ' + ROLE[p.role].n + '</span></div>'; }).join('') + '</div>' +
      '<div class="card"><div class="eyes">🏆 Awards</div>' + (S.awards.map(function (a) { return '<div class="msg">' + esc(a) + '</div>'; }).join('') || '<div class="sub">No awards this time.</div>') + '</div>' +
      '<div class="card center"><div class="eyes">Dare for the losers</div><div class="script">' + esc(S.dare) + '</div></div>' +
      '<div class="card"><div class="eyes">Game log</div>' + S.log.map(function (l) { return '<div class="sub">' + esc(l) + '</div>'; }).join('') + '</div>' +
      (isHost() ? '<button class="primary" data-a="again">Back to lobby (play again)</button>' : '<p class="center">The host can start another round.</p>');
  }
  if (S.me && !hideRole && S.phase !== 'over' && !(S.phase === 'night' && mm.type)) {
    h = '<div class="card"><div class="eyes">' + ROLE[mm.role].e + ' You are the ' + ROLE[mm.role].n + '</div><div class="sub">' + ROLE[mm.role].d + ((mm.mates && mm.mates.length) ? ' Team: ' + mm.mates.map(function (x) { return esc(x.name); }).join(', ') : '') + '</div></div>' + h;
  }
  return h;
}
function detCard(d) { return '<div class="card center"><div class="eyes">Your investigation</div><div class="big">' + (d.mafia ? '🔪' : '✅') + '</div><h2>' + esc(d.name) + ' is ' + (d.mafia ? 'MAFIA' : 'NOT Mafia') + '</h2></div>'; }

function lobbyHTML() {
  var n = S.players.length, o = S.opts, host = isHost();
  var link = location.origin + '/?room=' + session.code;
  var h = '<div class="card"><div class="eyes">Room code – share with friends</div><div class="code">' + esc(session.code) + '</div><button data-a="share" data-v="' + esc(link) + '">📤 Share invite link</button></div>' +
    '<div class="card"><div class="eyes">Players (' + n + ')</div>' + S.players.map(function (p) {
      return '<div class="player ' + (p.connected ? '' : 'off') + '"><span class="nm">' + esc(p.name) + (p.id === S.you ? ' (you)' : '') + '</span><span>' + (p.id === S.hostId ? '<span class="pill">host</span>' : (host ? '<button data-a="kick" data-v="' + p.id + '">✕</button>' : '')) + '</span></div>';
    }).join('') + '</div>';
  if (host) {
    h += '<div class="card"><div class="toggle"><span>🔪 Mafia</span><span class="row fix"><button data-a="mafia" data-v="-1" style="width:40px">−</button><b>' + o.mafia + '</b><button data-a="mafia" data-v="1" style="width:40px">+</button></span></div>' +
      '<div class="toggle"><span>💉 Doctor</span><input type="checkbox" data-a="doctor" ' + (o.doctor ? 'checked' : '') + '></div>' +
      '<div class="toggle"><span>🕵️ Detective</span><input type="checkbox" data-a="detective" ' + (o.detective ? 'checked' : '') + '></div>' +
      '<div class="toggle"><span>🎙️ AI narrator</span><input type="checkbox" data-a="ai" ' + (o.ai ? 'checked' : '') + '></div>' +
      (o.ai ? '<select data-a="style">' + Object.keys(STYLE_LABELS).map(function (k) { return '<option value="' + k + '"' + (o.style === k ? ' selected' : '') + '>' + STYLE_LABELS[k] + '</option>'; }).join('') + '</select>' : '') +
      '</div><button class="primary" data-a="start" ' + (S.canStart ? '' : 'disabled') + '>' + (n < 5 ? 'Need 5+ players' : (S.canStart ? 'Deal roles & start' : 'Fix role settings')) + '</button>';
  } else {
    h += '<div class="card center"><p>Waiting for the host to start…</p><div class="sub">' + o.mafia + ' Mafia' + (o.doctor ? ' · Doctor' : '') + (o.detective ? ' · Detective' : '') + (o.ai ? ' · AI narrator' : '') + '</div></div>';
  }
  return h;
}
function fxBadge(id) { var c = fxCount[id]; if (!c) return ''; return '<span class="badge">' + Object.keys(c).map(function (e) { return e + c[e]; }).join(' ') + '</span>'; }

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
  fly(m.emoji);
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
function speak(t) { if (!narr || !t || !window.speechSynthesis) return; try { var u = new SpeechSynthesisUtterance(t); u.rate = 0.95; speechSynthesis.speak(u); } catch (e) { /* ignore */ } }
function effects() {
  if (S.aid !== lastAid) { lastAid = S.aid; if (S.announce && S.phase !== 'lobby') speak(S.announce); }
  if (S.narrator && S.narrator.id !== lastNarr) { lastNarr = S.narrator.id; speak(S.narrator.text); }
  var needs = !!(S.me && S.me.type && S.me.acted == null && S.phase === 'night');
  if (needs && !lastNeeds) { try { if (navigator.vibrate) navigator.vibrate(300); } catch (e) { /* ignore */ } }
  lastNeeds = needs;
}

/* ---------- clicks ---------- */
document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-a]'); if (!b || b.tagName === 'INPUT' || b.tagName === 'SELECT') return;
  var a = b.getAttribute('data-a'), v = b.getAttribute('data-v');
  switch (a) {
    case 'create': enter('create'); break;
    case 'join': enter('join'); break;
    case 'start': send({ t: 'start' }); break;
    case 'again': send({ t: 'again' }); break;
    case 'act': send({ t: 'act', type: b.getAttribute('data-type'), target: v }); break;
    case 'vote': send({ t: 'vote', target: v || null }); break;
    case 'closeVote': send({ t: 'closeVote' }); break;
    case 'skipNight': send({ t: 'skipNight' }); break;
    case 'kick': send({ t: 'kick', id: v }); break;
    case 'mafia': send({ t: 'opts', opts: { mafia: Math.max(1, Math.min(S.maxMafia, S.opts.mafia + Number(v))) } }); break;
    case 'tab': tab = v; sigs.tabs = null; sigs.chatlog = null; if (S) { tabsRender(); chatRender(); } break;
    case 'send': sendChat(); break;
    case 'emoji': if (!$('ci').disabled) send({ t: 'chat', ch: tab, text: v }); else toast('Chat is closed here right now'); break;
    case 'throw': if (funTarget) send({ t: 'fx', to: funTarget, emoji: v }); break;
    case 'roast': if (funTarget) send({ t: 'roast', to: funTarget, i: Number(v) }); break;
    case 'togglerole': hideRole = !hideRole; sigs.main = null; if (S) render(); break;
    case 'togglenarr': narr = !narr; if (!narr && window.speechSynthesis) { try { speechSynthesis.cancel(); } catch (x) { /* ignore */ } } if (S) render(); break;
    case 'share': share(v); break;
  }
});
document.addEventListener('change', function (e) {
  var t = e.target, a = t.getAttribute && t.getAttribute('data-a'); if (!a) return;
  if (a === 'doctor' || a === 'detective' || a === 'ai') { var o = {}; o[a] = t.checked; send({ t: 'opts', opts: o }); }
  if (a === 'style') send({ t: 'opts', opts: { style: t.value } });
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
