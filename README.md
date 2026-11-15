# 🎭 Mafia Live – Roast Edition

Multiplayer Mafia you play on your own phones. One person creates a room, shares a 4-letter code or invite link, everyone joins from their own location.

- Server-authoritative: roles live only on the server. Each phone only ever receives what that player is allowed to see.
- Roles: Mafia, Doctor, Detective, Villager.
- Chat channels: Town, private Mafia, Ghosts (dead players). Town chat is silent at night.
- Fun: throw tomatoes/chappals, one-tap roasts, 👀 sus, awards and a dare for the losers.
- AI narrator in four styles (Bollywood drama, Desi uncle, Roast comedian, Noir). Uses preset lines by default; set `ANTHROPIC_API_KEY` to have Claude write fresh lines. It only ever receives public facts (never hidden roles, never Mafia chat).
- Reconnect after a refresh or a dropped signal: you get your seat back.
- For live voice, run a WhatsApp / Meet / Discord call alongside.

## Run locally
```
npm install
npm start          # http://localhost:3000
npm test           # engine + server + real-browser-client tests
npm run load       # 40 rooms x 8 players load test
```

## Deploy on Render (free to start)
1. Push this folder to a GitHub repo.
2. In Render: **New → Blueprint** (or **Web Service**), pick the repo. `render.yaml` sets everything up.
3. Open the URL Render gives you. Share it. Done.
4. Optional AI narrator: Render dashboard → your service → **Environment** → add `ANTHROPIC_API_KEY`.

Notes: the free plan sleeps when idle (first visit after a pause takes ~1 minute to wake) and games live in memory, so a redeploy or restart ends running games. A paid plan stays awake.

## Settings (environment variables)
| Name | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | Set automatically by Render |
| `ANTHROPIC_API_KEY` | none | Enables Claude-written narration |
| `NARRATOR_MODEL` | claude-haiku-5-5 | Model used for narration |

## Layout
- `game.js` – pure game rules and per-player views (most important file for fairness)
- `server.js` – HTTP + WebSocket, rooms, timers, chat, anti-spam
- `narrator.js`, `lines.js` – narrator and preset lines, roast and throw lists
- `public/` – the phone web app
- `test/` – unit, server (simulated players), real-client (jsdom) and load tests
