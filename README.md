# Hexhold

A private hex-island trading game for you and your friends. Plays in the browser, hosted for free on GitHub Pages. Empty seats are filled by bots.

## Play

- **Learn to play:** a guided tutorial where Sly the Bandit walks you through a practice game (24 short steps, about 5 minutes). There's also a Rules page on the home screen and in the in-game menu.

- **Play vs bots:** pick players (3–6), bot level (Easy / Normal / Hard), map and win target, then play.
- **Host a room:** you get a 6-letter code and a link. Friends open the link (or type the code), enter the password if you set one, and take a bot's seat. Press Start.
- **Rejoin:** if a friend's connection drops, they just open the link again and get their seat back. If they stay away for 60 seconds, a bot plays their seat until they return.
- **Save:** solo games autosave (Continue on the home screen). The host can also save to a file from the menu and load it later.
- **Controls:** tap glowing spots on the board to build. Drag to move the camera, scroll or pinch to zoom. Menu (☰) switches the look, sound and bot speed.

## Put it online (GitHub Pages)

1. Create a new GitHub repository and push this folder to its `main` branch.
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The included workflow tests, builds and publishes it. Your game will be at `https://<your-username>.github.io/<repo-name>/`.

Online rooms connect browsers directly (WebRTC) using the free public PeerJS server to find each other. Nothing about your games is stored on a server.

If a friend can't connect (some strict work or school networks block direct connections), you can run your own PeerJS server (`npx peerjs --port 9000`) and add `?peerHost=your.server&peerPort=9000&peerSecure=1` to the link.

## Develop

```bash
npm install
npm test                 # 34 rules/bot/host tests, incl. 200 simulated bot games
npm run dev              # local dev server
npm run build && npm run screenshots          # preview images of every look
npm run build && npm run e2e:features         # clicks through every feature (needs Chrome; set CHROME=/path)
npm run build && npm run e2e:online           # host + 2 friends in 3 browsers via a local signaling server
npm run build && npm run e2e:solo             # plays a whole game by clicking
npm run build && npm run e2e:tutorial         # follows the whole tutorial like a new player
```

Preview a look without playing: `/?mode=pixel3d&moment=mid` (`mode`: pixel3d, smooth3d, iso2d, top2d; `moment`: empty, setup, mid, seven, trade, end, style).

## Layout

- `packages/engine` — rules engine (pure TypeScript, deterministic), bots, tests.
- `packages/client` — the app: `app.ts` (screens + game UI), `controller.ts` (authoritative host, runs bots), `session.ts` + `net.ts` (local / host / friend sessions over PeerJS), `scene3d.ts` + `render2d.ts` (renderers), `sound.ts`.
- `e2e/` — browser tests. `scripts/screenshots.mjs` — preview captures.

All art and sound is generated in code. Fonts: Lilita One and Press Start 2P (SIL Open Font License).
