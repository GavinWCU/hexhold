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

### If a device can't connect (stuck on "Connecting", then "Couldn't connect")

Some devices can't reach each other directly, even on the same Wi-Fi. Android, Windows and some routers are common culprits, while Apple devices usually connect fine with each other. The fix is a free **relay (TURN) server**, which passes game messages along when a direct link fails:

1. Sign up for a free TURN service, for example metered.ca (Open Relay). Create an app and copy its TURN **URLs**, **username** and **credential**.
2. In the GitHub repo go to **Settings → Secrets and variables → Actions**:
   - **Variables** tab: add `TURN_URLS`, a comma-separated list such as `turn:global.relay.metered.ca:80,turn:global.relay.metered.ca:80?transport=tcp,turn:global.relay.metered.ca:443,turns:global.relay.metered.ca:443?transport=tcp`, and add `TURN_USER` with the username.
   - **Secrets** tab: add `TURN_PASS` with the credential.
3. **Actions → Deploy to GitHub Pages → Run workflow.** After about 2 minutes every device can connect.

For local builds, put the same values in `packages/client/.env.local` as `VITE_TURN_URLS`, `VITE_TURN_USER` and `VITE_TURN_PASS`.

If the PeerJS signaling server itself is blocked (some strict work or school networks), run your own (`npx peerjs --port 9000`) and add `?peerHost=your.server&peerPort=9000&peerSecure=1` to the link.

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
