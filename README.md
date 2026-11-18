# Monopoly Online

A real-time multiplayer Monopoly-style board game for the browser, inspired by richup.io.
Create a room, share the link, and play with 2–6 friends on one of four themed boards in one of five colour themes.

## Stack

**Node.js + Express + Socket.IO on the server, plain HTML/CSS/ES-module JavaScript in the browser.**
Socket.IO gives reliable real-time rooms with automatic reconnection and fallbacks, and is the most widely used WebSocket library in the Node ecosystem. The frontend has no build step, so the whole project runs with `npm install && npm start`. All game rules live in a pure, dependency-free module (`engine/`) that the server calls; the client only renders state and sends intents, so cheating from the browser console is not possible. Tests use Node's built-in test runner, so there's no test framework to install.

## Play online with friends

To get a link you can send to friends and play from phones, follow **[DEPLOY.md](DEPLOY.md)** — it puts the game on Render's free plan in about 10 minutes with no command line, using a 4-file upload kit (`npm run build:flat`).

## Quick start (on your own computer)

Requirements: **Node.js 18 or newer**.

```bash
npm install
npm start            # http://localhost:3000
```

Other scripts:

```bash
npm run dev          # restart automatically on file changes
npm test             # rules, maps and socket integration tests
PORT=8080 npm start  # use a different port
```

## Testing multiplayer

**On one computer**
1. Open http://localhost:3000, enter a name and click **Create a room**.
2. Click **Copy link** in the lobby and open it in a **new tab or window** (each tab is a separate player; a refresh keeps your seat).
3. Enter a second name and click **Join**. Repeat for up to 6 players.
4. In the host tab, choose a board, player limit and starting cash, then click **Start game**.

**On your local network (phones, other laptops)**
1. Find your computer's IP address (`ipconfig` on Windows, `ipconfig getifaddr en0` on macOS, `hostname -I` on Linux).
2. Open `http://<your-ip>:3000` on the other device (same Wi-Fi). Allow Node through your firewall if prompted.
3. Join with the 5-letter room code or the invite link.

**Over the internet**
See [DEPLOY.md](DEPLOY.md) for free hosting on Render (a `render.yaml` blueprint is included). Any Node host with WebSocket support works.

A person who opens the link after the game has started joins as a **spectator**.

## How to play

- **Roll dice** on your turn. Doubles give another roll; three doubles in a row sends you to jail.
- Land on an unowned property: **Buy** it, or send it to **Auction**. Every player can bid; the highest bid wins when everyone else passes or the timer (10 s after the last bid) runs out.
- Click any space (or the coloured chips under a player) to see its title deed. On your own properties you can **build**, **sell buildings**, **mortgage** and **unmortgage**.
- If you can't pay, your cash goes negative: sell or mortgage until you're back to zero, or **declare bankruptcy**. The last player standing wins, and the host can start a new game.

## Project structure

```
engine/          Pure game rules (no I/O) — fully unit-testable
  game.js          Game class: lobby, turns, movement, rent, cards, jail, auctions, building, bankruptcy
  cards.js         Chance & Community Chest decks (map-agnostic) + shuffle
  constants.js     Tokens and default settings
maps/            Boards as data
  layout.js        classicBoard() helper: names + colours -> full 40-space board
  validate.js      Map validator (run at startup and in tests)
  index.js         Registry: auto-loads every file in maps/boards/
  boards/          classic-london, world-tour, space-odyssey, enchanted-kingdom
server/
  index.js         Express static server + Socket.IO bootstrap
  rooms.js         Rooms, join codes, reconnection, spectators, auction timer
public/          Browser client (no build step)
  index.html
  css/themes.css   Colour themes as CSS variables (incl. token colours --p1..--p6)
  css/style.css    Layout, board, lobby, modals
  js/main.js       Networking, lobby and game UI
  js/board.js      Board rendering, dice, title deeds
  js/themes.js     Theme list + persistence
  js/ui.js         DOM helpers
test/
  engine.test.js   Rent, buying, auctions, jail, cards, building, debt and bankruptcy
  maps.test.js     Every map validates; cards resolve on themed maps
  server.test.js   Two real Socket.IO clients create, join, start and play
```

## Adding a board

Drop a new file into `maps/boards/` — it is picked up automatically and validated on startup. The quickest way is the classic-layout helper:

```js
// maps/boards/ocean-cities.js
const { classicBoard } = require('../layout');
module.exports = classicBoard({
  id: 'ocean-cities',
  name: 'Ocean Cities',
  description: 'Harbours of the world.',
  currency: '⚓',
  groups: [ // 8 groups with 2,3,3,3,3,3,3,2 streets
    { key: 'g1', name: 'Reef', color: '#795548', streets: ['Coral Bay', 'Kelp Town'] },
    // …7 more
  ],
  railroads: ['Port A', 'Port B', 'Port C', 'Port D'],
  utilities: ['Tidal Plant', 'Desalination'],
  icons: { railroad: '⛴️' },          // optional
  labels: { railroad: 'ferry port' },  // used in card text
});
```

For full control, export an object with your own `spaces` array instead (any multiple of 4 spaces, min 16). Each space has a `type` of `go`, `street`, `railroad`, `utility`, `tax`, `chance`, `chest`, `jail`, `parking` or `gotojail`, plus `price`, `rent`, `houseCost`, `group`, `multipliers` or `amount` as relevant. A map may also ship custom decks via `cards: { chance: [...], chest: [...] }`. Cards target spaces by type and position (`{ type: 'street', nth: -1 }` = the most expensive street), so the default decks work on any board.

## Adding a colour theme

1. Add a `[data-theme='mytheme'] { … }` block to `public/css/themes.css` (copy an existing one and change the variables, including the token colours `--p1`…`--p6`).
2. Add `{ id: 'mytheme', name: 'My Theme', swatch: [bg, accent] }` to `public/js/themes.js`.

Themes are per-player and saved in the browser, and can be switched from the lobby or the header at any time.

## Rules notes

Implemented: GO salary, dice and doubles, three-doubles jail, jail (pay fine, card, or roll doubles; forced fine on the third failed roll), buying, auctions, street/station/utility rent (doubled rent on unimproved full sets), even building and selling of houses and hotels, mortgages with 10% interest to lift, taxes, 32 Chance / Community Chest cards, debt, bankruptcy to a player or the bank, and a winner.

Deliberate simplifications: no player-to-player trading, unlimited houses and hotels (no building shortage), Free Parking does nothing, and mortgaged properties passed on in bankruptcy carry no extra 10% fee. The "nearest utility" card uses the roll you just made rather than a fresh roll.

## Socket events (for extending the client)

| Client → server | Payload |
|---|---|
| `room:create` | `{ name, secret }` |
| `room:join` | `{ code, name, secret }` |
| `room:leave` | – |
| `lobby:update` | `{ name?, token? }` |
| `lobby:settings` (host) | `{ mapId?, maxPlayers?, startingCash? }` |
| `game:start` / `game:restart` (host) | – |
| `game:action` | `{ type, payload }` — `roll`, `buy`, `auction`, `bid {amount}`, `pass`, `build {space}`, `sell {space}`, `mortgage {space}`, `unmortgage {space}`, `payFine`, `useCard`, `endTurn`, `bankrupt` |

Every request is acknowledged with `{ ok: true, … }` or `{ ok: false, error }`. The server pushes the full public game state to the room as `state` after every change, and sends `meta` (`{ maps, tokens }`) on connect. `secret` is a random per-tab id used to restore your seat after a refresh or reconnect.
