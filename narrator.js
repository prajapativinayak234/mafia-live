'use strict';
const { CANNED } = require('./lines');

const STYLE_PROMPT = {
  bollywood: 'an over-the-top Bollywood film narrator with dramatic dialogue, hero entries and villain monologues',
  uncle: 'a gossipy Indian desi uncle who sighs dramatically, gives unwanted advice and compares people to Sharma ji ka beta',
  roast: 'a sharp but friendly stand-up roast comedian',
  noir: 'a mysterious noir storyteller with a deep dramatic voice'
};

function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

// Maps a game "last event" to a canned-line key + placeholders
function describe(game) {
  const L = game.last || {};
  if (game.phase === 'over') return { key: game.winner === 'town' ? 'over_town' : 'over_mafia', ctx: {} };
  if (L.kind === 'dawn') {
    if (L.died) return { key: 'dawn_died', ctx: { a: L.died.name, r: roleName(L.died.role) } };
    return { key: L.saved ? 'dawn_safe' : 'dawn_quiet', ctx: {} };
  }
  if (L.kind === 'verdict') {
    if (L.out) return { key: 'verdict_out', ctx: { a: L.out.name, r: roleName(L.out.role) } };
    return { key: 'verdict_tie', ctx: {} };
  }
  return null;
}
const roleName = r => ({ mafia: 'Mafia', doctor: 'Doctor', detective: 'Detective', villager: 'Villager' }[r] || r);

function canned(style, key, ctx, rng) {
  const set = (CANNED[style] || CANNED.bollywood)[key] || CANNED.bollywood[key];
  if (!set) return null;
  return pick(set, rng).replace(/\{(\w)\}/g, (_, k) => ctx[k] || '');
}

// Only PUBLIC facts go to the model. Never roles of living players, never mafia chat.
function publicFacts(game, kind) {
  const names = game.players.map(p => p.name).join(', ');
  const alive = game.alive().map(p => p.name).join(', ');
  const L = game.last || {};
  switch (kind) {
    case 'start': return `The game is starting. Players: ${names}. Welcome them, set a spooky mood and tease two players by name.`;
    case 'night': return `Night ${game.day} begins. Alive: ${alive}. Set a spooky scene in two sentences.`;
    case 'dawn': return `Morning. Fact: ${game.announce} Alive now: ${alive}. React dramatically to this fact only.`;
    case 'verdict': {
      const who = Object.entries(game.votes).map(([a, b]) => `${(game.get(a) || {}).name}->${(game.get(b) || {}).name}`).join(', ') || 'nobody voted';
      return `Vote result: ${game.announce} Who voted for whom: ${who}. React and tease one voter.`;
    }
    case 'over': return `Game over. ${game.winner === 'town' ? 'The town' : 'The Mafia'} won. Roles: ${game.players.map(p => `${p.name}=${roleName(p.role)}${p.alive ? '' : ' (dead)'}`).join(', ')}. Awards: ${game.awards.join('; ') || 'none'}. Give a funny closing speech roasting the losers and praising the winners.`;
    default: return '';
  }
}

async function callModel({ apiKey, model, style, kind, facts, timeoutMs = 8000, fetchImpl = fetch }) {
  const prompt = `You are ${STYLE_PROMPT[style] || STYLE_PROMPT.bollywood}, narrating a live party game of Mafia between friends. Write in English with a playful Indian flavour.
Rules: max 45 words. Light, friendly teasing of players by name is welcome. Never reveal, hint at, or guess anyone's hidden role or who is Mafia (unless the facts below state it). Use only the facts below, never invent events. No jokes about religion, caste, appearance or families. Output only the narration text.
Moment: ${kind}
Facts: ${facts}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 160, messages: [{ role: 'user', content: prompt }] })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    const text = (j.content || []).map(c => c.text || '').join('').trim().replace(/^["']|["']$/g, '');
    if (!text) throw new Error('empty');
    return text.slice(0, 420);
  } finally { clearTimeout(t); }
}

// kind: start | night | dawn | verdict | over
async function narrate(game, kind, { apiKey, model, rng = Math.random, fetchImpl, log = () => {} } = {}) {
  if (!game.opts.ai) return null;
  const style = game.opts.style;
  if (apiKey) {
    try {
      return await callModel({ apiKey, model, style, kind, facts: publicFacts(game, kind), fetchImpl });
    } catch (e) { log('narrator model failed, using canned: ' + e.message); }
  }
  if (kind === 'start' || kind === 'night') return canned(style, kind === 'start' ? 'start' : 'night', {}, rng);
  const d = describe(game);
  return d ? canned(style, d.key, d.ctx, rng) : null;
}

module.exports = { narrate, canned, describe, publicFacts, callModel };
