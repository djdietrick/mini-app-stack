# Highroller — plan

A casino simulator played for fun with in-game chips. No real money goes in or comes out. You play table games and slots against the house on animated tables. Your balance carries from session to session, and you spend winnings on cosmetics. A level badge shows how much you have played, and leaderboards, gifting and a shared jackpot connect you to everyone else in the stack.

Work is tracked in GitHub: **#38** is the tracking issue, with one sub-issue per piece below. Keep this file in step with those issues when decisions change.

## Decisions (locked in)

- **Phone first.** The target is a phone in portrait. Each game has a portrait layout: the table on top, the bet and action bar at thumb height, and tap targets of 44 px or more. Tablet and desktop get wider layouts later (#58), at breakpoints kept in `web/src/breakpoints.ts` as in fretwork.
- **PixiJS 2D canvas.** Tables, cards, chips, the wheel and the reels are drawn with PixiJS (v8, WebGL with a canvas fallback). React draws everything outside the table: balance, bet bar, sheets and screens.
- **The server decides every outcome.** The server shuffles, deals, spins and settles. The browser only sends bets and decisions, and animates what comes back. Your balance can't be edited from the client, which is what makes leaderboards and gifting mean anything.
- **Solo play plus async social features.** You always play against the house. There are leaderboards, chip gifting and a big-win feed. There are no real-time shared tables, because Cloud Functions can't hold websockets and the browser never reads Firestore directly.
- **Going broke:** a daily bonus with a streak multiplier, plus one bailout a day when your balance is below a floor.
- **Levels are a badge only.** XP shows how much you've played. Levels don't unlock games, limits or items.
- **Cosmetics:** card backs, table felts and chip sets.
- **Progression:** achievements, daily and weekly quests, and a stats dashboard.
- **Shared progressive jackpot,** fed by slots and side bets.
- **Side bets:** Perfect Pairs and 21+3 on blackjack, Trips on UTH.
- **Both deployment targets,** like every app in the stack: Fastify + Postgres self-hosted, Functions + Firestore in the cloud. See the root `CLAUDE.md`.
- **Games, in waves:**
  | Wave | Games |
  |---|---|
  | 1 | Blackjack, Ultimate Texas Hold'em, Roulette (European and American) |
  | 2 | Baccarat, Three Card Poker, Video Poker (Jacks or Better), Slots |

  Out of scope for now (rejected in the design round): craps, avatars/frames/titles, win effects, VIP rooms, prestige, strategy coach, tournaments, friends lists.

## Where things live

```
apps/highroller/
  src/games/       pure TS, no deps, shared by the server and the SPA (relative import, like
                   fretwork's theory): cards.ts, rng.ts (the Rng port + a seeded PRNG for tests),
                   poker/eval.ts (5- and 7-card hand ranks), and one folder per game:
                   blackjack/, uth/, roulette/, baccarat/, threecard/, videopoker/, slots/
                   Each game folder exports a GameEngine (see "Adding a game") and its tests,
                   including a Monte Carlo test that checks the house edge.
  src/domain/      types.ts (zod wire types), routes.ts, hands.ts (the hand lifecycle),
                   settle.ts (one settlement → ledger, stats, XP, quests, feed, jackpot),
                   economy.ts (daily bonus, bailout, gifting rules), progress.ts (XP and level curve),
                   quests.ts (achievement and quest definitions + the pure evaluator),
                   catalog.ts (shop items with fixed UUIDs), registry.ts (game id → engine + limits)
  src/repo/        types.ts (the port), postgres.ts, firestore.ts
  migrations/      Postgres schema `highroller`
  web/src/
    table/         TableCanvas (mounts a Pixi Application in a resizing container),
                   textures.ts (procedural card faces, backs, chips and felts, rasterised at the
                   device's pixel ratio), anim.ts (deal, flip, slide, stack, payout tweens)
    games/         one folder per game: Scene.ts (Pixi) + Screen.tsx (React chrome + bet bar)
    screens/       Lobby, Shop, Stats, Quests, Leaderboards, Settings
    settings.ts    per-device settings in localStorage: sound, haptics, reduced motion, speed
  web/public/      sw.js, manifest.webmanifest, icons/
```

## Chips and the economy

- **Chips are integers.** Postgres stores them as `bigint`, which Drizzle returns as a string, so the repo converts to `number` on the way out. Payouts with a fraction (3:2 on an odd bet, a 5% baccarat commission) round down, as at a table with no half chips. The Monte Carlo tests include that rounding.
- **Every balance change is one ledger row:** `kind`, a signed `amount`, `balance_after`, and an optional `hand_id` / `ref`. Kinds are `bet`, `payout`, `daily_bonus`, `bailout`, `purchase`, `gift_in`, `gift_out`, `quest_reward`, `achievement_reward`, `jackpot`. The ledger is the audit trail and drives the balance chart. The balance on the player row is the fast copy, and both change in the same transaction.
- **Starting values** (tunable constants in `economy.ts`):
  - Starting balance: 10,000.
  - Daily bonus: 1,000 × the streak day, capped at day 7. Missing a day resets the streak. "Day" is in the player's time zone, which the SPA sends.
  - Bailout: once a day, while the balance is under 500, tops it up to 2,000.
  - Gifting: up to 5,000 sent and 10,000 received per day. You can't gift below the bailout floor, so bailouts can't be farmed through a second account.
- **Table limits** live in the registry per game. With no VIP rooms, each game has one table.

## Hands: the server-authoritative lifecycle

Every game goes through the same three routes. Games differ only in their engine.

1. `POST /hands` `{ id, game, variant?, bets, timeZone }`. The client generates `id` (a UUID). The server validates the bets against the engine and the table limits, then **draws all the randomness the hand will ever need** (a shuffled shoe or deck, the spin, the reel stops) **before the transaction**. Inside one transaction it debits the stake, writes the `bet` ledger row and stores the hand. A single-decision game (roulette, slots) settles in the same transaction. The response is the public view.
   - Starting the same `id` twice returns the existing hand and never debits twice. Firestore gets this from a deterministic document id, Postgres from the primary key.
   - There is at most one active hand per user per game: a partial unique index on Postgres, an `activeHands` map (game → hand id) on the player doc, read and written in every hand transaction, on Firestore. A second start returns 409 `HAND_IN_PROGRESS` with the hand's id.
2. `POST /hands/:id/actions` `{ action, version }`. This is for hit, stand, double, split, surrender, insurance, check, bet 4×/3×/2×/1×, fold, hold/draw and so on. It applies the action with the engine. An extra wager (double, split, a UTH play bet, a 3CP play bet) is debited in the same transaction. A wrong `version` returns 409 `STALE_HAND`, so a double tap can't act twice. When the engine reports the hand finished, the same transaction settles it.
3. `GET /hands/active` and `GET /hands/:id` return the public view, so a reload or a second device resumes mid-hand.

**The hand's private state (the deck, the dealer's hole card) never leaves the server.** `engine.view(state)` produces what the client may see. The full state (deck included) goes into the hand's history once it is settled, so a hand can be replayed and checked later.

The randomness comes from `crypto.randomInt` on the server, injected as the `Rng` port. Tests use a seeded PRNG. Because the randomness is drawn before the transaction and actions are deterministic given the stored deck, a Firestore retry can't re-roll a hand.

### Settlement

`settle.ts` takes a finished hand and returns everything the repo writes in that same transaction. It is pure and computed once from what the transaction read:

- the `payout` ledger row and the new balance
- XP (see Progress) and the new level
- per-game stats: hands, wagered, returned, wins/losses/pushes, biggest win, and expected return (the engine's theoretical RTP × wagered)
- weekly stats for leaderboards: net, wagered, hands, biggest win
- quest and achievement progress (`quests.ts` runs over the hand's `HandSummary`)
- a feed event if the win is big (≥ 20× the stake and ≥ 5,000 chips, or any jackpot)
- a jackpot contribution or jackpot hit (see Jackpot)

That is about 10 writes, far under Firestore's 500.

### Adding a game

1. Write `src/games/<game>/` exporting a `GameEngine<Bets, State, Action, View>` (`src/games/engine.ts`):
   - `validateBets(bets, limits, variant)`
   - `deal(bets, rng, variant)`: draws everything up front and returns the initial state
   - `act(state, action)`: the next state, or null when illegal
   - `staked(state)`: total wagered so far; a rise after an action is an extra wager the lifecycle debits
   - `legalActions(state)`
   - `isFinished(state)`
   - `settle(state)`: returns per-bet results and the total returned
   - `view(state)`
   - `summary(state)`: the facts quests read, such as `blackjack: true`, `handRank: "flush"` or `straightUp: true`
   - `theoreticalRtp(variant)`
2. Add node tests: rules, payouts, and a Monte Carlo house-edge check within tolerance.
3. Register it in `src/domain/registry.ts` with its zod bet and action schemas and its table limits.
4. Add `web/src/games/<game>/Scene.ts` and `Screen.tsx`, and a lobby tile.
5. Add any quests and achievements it needs.

No route, repo or migration changes. That is the test of the core design.

## Rendering (PixiJS)

- **`<TableCanvas>`** owns one Pixi `Application` per screen. It sizes to its container with a ResizeObserver, caps the resolution at a device pixel ratio of 2, stops the ticker while the tab is hidden, and is destroyed on unmount. Scenes receive the public view and **animate the difference from the previous view**. They never decide anything.
- **No binary art.** Cards, card backs, felts and chips are drawn in code (`textures.ts`) and rasterised once per size and pixel ratio. They stay sharp on any screen and the bundle stays small. A cosmetic is a parameter set (colours, pattern, edge style), so adding one is data, not art.
- **Phone layout:** every scene lays out in a 390 × 560 portrait design space (`web/src/table/scene.ts`) and scales to fit; the felt fills any letterbox. Tables built for wide screens (the roulette layout) pan and zoom: pinch, or tap a zone to zoom into it. Bet chips are placed by tapping, never by dragging.
- **Feel:** a short vibration (`navigator.vibrate` where available) on wins and on your turn. Sound is off by default. Reduced motion shortens or skips tweens, and a "fast deal" setting speeds them up.
- **Latency:** after a tap, the scene starts the action's animation at once (cards slide off the shoe) and lands the result when the response arrives. On an error it rolls back.

## Data model

Postgres schema `highroller`. Each table has a Firestore twin, `highroller_<name>`, written by `createFirestoreClient({ collectionPrefix: "highroller_" })`.

| Postgres | Firestore | Notes |
|---|---|---|
| `players` (user_id PK, display_name, email, balance, xp, daily_streak, last_daily_on, last_bailout_on, gifts_sent_today/received_today + day, leaderboard_listed, equipped jsonb, created_at) | `players/{userId}` | Created on first request from the session. The name and email are refreshed from the session, so gifting and leaderboards need no `shared.users` (which has no cloud twin). |
| `ledger` ((user_id, seq) PK) | `ledger/{userId}_{seq}` | `seq` counts up per player (the player row keeps the last one) and orders the ledger, so a bet and its payout written in one transaction keep their order. The deterministic id makes a retried write land on the same document. |
| `hands` (id PK, user_id, game, variant, status, version, state jsonb, view jsonb, wagered, returned, results jsonb, created_at, settled_at) | `hands/{id}` | Partial unique index on (user_id, game) where status = 'active'. Firestore stores `state`, `view` and `results` as JSON strings: engine state can hold nested arrays (split hands), which Firestore can't. |
| `game_stats` (user_id, game) PK | `game_stats/{userId}_{game}` | |
| `weekly_stats` (week, user_id) PK, index (week, net desc) | `weekly_stats/{week}_{userId}` | Composite index on (week, listed, net desc). |
| `quest_progress` (user_id, quest_id, period) PK | `quest_progress/{userId}_{questId}_{period}` | Period is `d:2026-10-15`, `w:2026-W42` or `ever`. |
| `inventory` (user_id, item_id) PK | `inventory/{userId}_{itemId}` | |
| `feed_events` | `feed_events/{uuid}` | Read newest first; a 7-day TTL (Firestore TTL policy, plus a check on read). |
| `jackpot` (one row) + `jackpot_hits` | `jackpot_shards/{0..9}` + `jackpot_hits` | See below. |

## Jackpot

- Starts at 250,000 and resets to that after a hit.
- **Fed by** 2% of every slot spin and every side bet. The house funds it, so payouts are unaffected.
- **Won by:**
  - the jackpot line on a max-line slot spin
  - a suited three of a kind on 21+3
  - a royal flush on UTH Trips
- A hit pays the whole jackpot, writes a `jackpot` ledger row and a feed event, and resets the jackpot, all in the settlement transaction.
- **The hot row:** every user's play touches it. Postgres uses one row and `UPDATE … SET amount = amount + $1`. Firestore spreads contributions over 10 shard docs (a random shard per contribution) and sums them on read. A hit reads all the shards in its transaction and resets them.
- The lobby polls `GET /jackpot` (cached 5 s) and shows the amount ticking up.

## Progress

- **XP per settled hand:** `10 + floor(4 × log2(1 + wagered / 10))`. This rewards play more than bet size, so one max bet can't buy levels. Leveling is a pure function (`level(xp)`, quadratic thresholds), so the curve can be retuned without migrating anything.
- **Stats dashboard** (`#/stats`):
  - hands, wagered, net, win rate and biggest win, per game and in total
  - actual vs expected return, with a line on what variance means
  - a balance chart from the ledger
- **Quests:**
  - Three daily quests and three weekly ones, picked deterministically from a hash of (user, period) out of `quests.ts`. They need no scheduler and no storage until you make progress.
  - Rewards are paid when you claim them, never automatically, so claiming is visible.
  - Achievements are permanent, with tiers such as "Play 100 / 1,000 / 10,000 hands".

## Social

- **Leaderboards** (`#/leaderboards`):
  - this week's net winnings, this week's biggest single win, and all-time level
  - the top 50 plus your own rank
  - weeks are ISO weeks in UTC
  - you can hide yourself in Settings (`leaderboard_listed`)
- **Gifting:** send chips to a player by their email address (they must have played Highroller) or from a leaderboard row. Debit, credit and both ledger rows are one transaction. The daily caps are under "Chips and the economy". The receiver sees it on their next load.
- **Big-win feed:** a lobby strip of recent big wins and jackpot hits from across the stack, showing display names. Hidden players show as "A player".

## Cloud specifics

- **Functions:**
  - `highrollerApi` is `onRequest`, mounting the route table under `/api`.
  - No scheduled function is needed: quests are picked deterministically and the feed expires by TTL.
- **Firestore indexes:**
  - ledger (userId, seq desc)
  - hands (userId, createdAt desc) and (userId, game, createdAt desc)
  - weekly_stats (week, listed, net desc) and (week, listed, biggestWin desc)
  - players (listed, xp desc)
  - feed_events (createdAt desc)
- **TTL policy** on `highroller_feed_events.expiresAt` and on settled hands' `purgeAt` (90 days). Postgres deletes settled hands on boot.
- No secrets.

## Milestones

**1 · Foundation**
- ✅ #39 Scaffold on both targets: players, ledger, daily bonus, bailout, lobby, PWA
- #40 First cloud deploy: repository variables and manual steps
- ✅ #41 Hand lifecycle and settlement core (`src/games` primitives, `/hands` routes, settlement)
- ✅ #42 PixiJS table kit: TableCanvas, procedural textures, animations, bet bar

**2 · Wave 1 games**
- #43 Blackjack
- #44 Ultimate Texas Hold'em (with the poker evaluator)
- #45 Roulette, European and American
- #46 Side bets: Perfect Pairs, 21+3, Trips

**3 · Progression**
- #47 XP, level badge and stats dashboard
- #48 Shop: card backs, felts and chip sets
- #49 Achievements and daily/weekly quests

**4 · Social**
- #50 Leaderboards
- #51 Chip gifting
- #52 Big-win feed

**5 · Wave 2 games**
- #53 Baccarat
- #54 Three Card Poker
- #55 Video Poker (Jacks or Better)
- #56 Slots
- #57 Shared progressive jackpot

**6 · Polish**
- #58 Larger-screen layouts, sound, accessibility and low-end phone performance

**Suggested order:** #39 → #40, then #41 and #42 in parallel → #43 → #45 → #44 → #47 → #48 → #46 → #49 → #50 → #51 → #52 → #56 → #57 → #53 / #54 / #55 (any order) → #58.
