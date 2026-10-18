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
                   poker/eval.ts (best five of up to seven, hand names, and handScore, an
                   allocation-free score for simulations), poker/rank3.ts (three-card ranks,
                   where a straight beats a flush), and one folder per game:
                   blackjack/, uth/, roulette/, baccarat/, threecard/, videopoker/, slots/
                   Each game folder exports a GameEngine (see "Adding a game") and its tests,
                   including a Monte Carlo test that checks the house edge (roulette's is exact).
                   Strategy bots used by those tests live beside the engine (blackjack/strategy.ts,
                   uth/strategy.ts, threecard/strategy.ts, videopoker/strategy.ts). roulette/felt.ts
                   is the phone felt's geometry (tap → bet, bet → chip position), here so it is
                   node-tested. slots/ is machines.ts (machines as data), evaluate.ts (what a spin
                   shows and pays) and rtp.ts (the exact return, multiplied out from the strips).
  src/domain/      types.ts (zod wire types), routes.ts, hands.ts (the hand lifecycle),
                   settle.ts (one settlement → ledger, stats, XP, quests, feed, jackpot),
                   economy.ts (daily bonus, bailout, gifting rules), progress.ts (XP and level curve),
                   social.ts (public names, the big-win rule, board ranks, the in-process cache),
                   quests.ts (achievement and quest definitions + the pure evaluator),
                   catalog.ts (shop items with fixed UUIDs, pure, imported by the SPA too),
                   shop.ts (the purchase step), stats.ts (dashboard figures, chart days),
                   registry.ts (game id → engine + limits)
  src/repo/        types.ts (the port), postgres.ts, firestore.ts
  migrations/      Postgres schema `highroller`
  web/src/
    table/         TableCanvas (mounts a Pixi Application in a resizing container),
                   textures.ts (procedural card faces, backs, chips and felts, rasterised at the
                   device's pixel ratio), paint.ts (the Canvas 2D painters for backs, chips and
                   felts, shared with the shop's previews so they need no Pixi), cosmetics.ts
                   (catalog params → styles), anim.ts (deal, flip, slide, stack, payout tweens),
                   kit.ts (felt, lettering, cards and chip stacks the scenes share)
    games/         one folder per game: Scene.ts (Pixi) + Screen.tsx (React chrome + bet bar),
                   plus useHand.ts (resume, start, act, refusals → toasts) and TableFrame.tsx
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
- **Table limits** live in each engine's module (`BLACKJACK_LIMITS`, `UTH_LIMITS`, `ROULETTE_LIMITS`, …) and the registry points at them, so the SPA checks a bet with the same numbers before sending it. With no VIP rooms, each game has one table. Blackjack 10–5,000; UTH ante 10–1,000; roulette 5–1,000 a spot and 10,000 a spin; baccarat 10–5,000 a spot; Three Card Poker ante 10–2,500 and Pair Plus 5–500; video poker 1–5 coins at 5, 25 or 100; slots 1–20 lines at 1, 5, 25 or 100 a line.
- **Side bets** are 5–500 (`limits.side`). Perfect Pairs and 21+3 settle on blackjack's deal and are paid in the start transaction (`engine.paidEarly`; settlement then pays only the rest); Trips settles at UTH's showdown, even after a fold. Exact edges, asserted by their tests: Perfect Pairs 6.11% (six decks), 21+3 4.62%, Trips 3.50% (from the seven-card hand counts). A suited three of a kind on 21+3 and a royal on Trips set `jackpotEligible` for #57. Stats use the engine's `expectedReturn(state)`, so side bets count at their own edge.
- **Measured edges** (each game's Monte Carlo test checks its bot against these): blackjack with basic strategy 0.31% of the first bet (20M hands; ~1.13 bets wagered per hand); UTH with the Wizard of Odds' simple strategy 2.43% of the ante (12M hands; optimal play is 2.19%, ~4.16 antes wagered per hand); roulette 2.70% / 5.26%, exactly.
- **Wave 2 edges**, exact unless noted:
  - Baccarat (eight decks, every card sequence enumerated): Banker 1.06%, Player 1.24%, Tie 14.36%. The commission's rounding makes a small Banker bet worse (a win on 10 pays 9); `expectedReturn` counts it per stake.
  - Three Card Poker with the optimal Q-6-4 strategy (all 22,100 × 18,424 deals): 3.37% of the ante, 1.674 antes wagered per hand. Pair Plus pays 40-30-6-**4**-1, a 2.32% edge: #54 listed a flush at 3:1 and a 2.3% edge, which can't both hold (3:1 is a 7.28% edge), so the edge won. Pair Plus doesn't feed the jackpot.
  - Video poker, 9/6 Jacks or Better: 99.54% at 5 coins (the published optimal figure); with fewer coins the royal pays 250, about 98.18%. The test checks hold values worked by hand and a brute force, and the simple strategy (99.46% published) by Monte Carlo.
  - Slots, the Fruit Classic: 94.97% (35% of it from scatters and free spins), free spins 1 in 140 spins, the jackpot line 20 in 32⁵ (about 1 in 1.68 million).

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
- **Phone layout:** every scene lays out in a 390 × 560 portrait design space (`web/src/table/scene.ts`) and scales to fit; the felt fills any letterbox. The top ~56 units sit under the frame's bar (back, title, rules), so nothing tappable goes there. The roulette felt runs top to bottom and pans and zooms: outside bets take a chip at full view, a tap on the numbers zooms 2× around it, where every line and corner is a thumb wide (`felt.test.ts` checks a 14-unit square around each bet). Bet chips are placed by tapping, never by dragging.
- **Results land after the animation.** `TableCanvas` calls `onShown(view)` when a view's animation finishes; `useHand` takes a stake off the balance at once but holds a payout and the result toast until then, so the pill never gives the result away.
- **Feel:** a short vibration (`navigator.vibrate` where available) on wins and on your turn. Sound is off by default. Reduced motion shortens or skips tweens, and a "fast deal" setting speeds them up.
- **Latency:** after a tap, the scene starts the action's animation at once (cards slide off the shoe) and lands the result when the response arrives. On an error it rolls back.

## Data model

Postgres schema `highroller`. Each table has a Firestore twin, `highroller_<name>`, written by `createFirestoreClient({ collectionPrefix: "highroller_" })`.

| Postgres | Firestore | Notes |
|---|---|---|
| `players` (user_id PK, display_name, email, balance, xp, daily_streak, last_daily_on, last_bailout_on, gifts_sent_today/received_today + day, leaderboard_listed, equipped jsonb, created_at) | `players/{userId}` | Created on first request from the session. The name and email are refreshed from the session, so gifting and leaderboards need no `shared.users` (which has no cloud twin). Firestore stores the flag as `listed` and a lowercased `emailKey` for gifting's lookup. |
| `ledger` ((user_id, seq) PK) | `ledger/{userId}_{seq}` | `seq` counts up per player (the player row keeps the last one) and orders the ledger, so a bet and its payout written in one transaction keep their order. The deterministic id makes a retried write land on the same document. |
| `hands` (id PK, user_id, game, variant, status, version, state jsonb, view jsonb, wagered, returned, results jsonb, created_at, settled_at) | `hands/{id}` | Partial unique index on (user_id, game) where status = 'active'. Firestore stores `state`, `view` and `results` as JSON strings: engine state can hold nested arrays (split hands), which Firestore can't. |
| `game_stats` (user_id, game) PK | `game_stats/{userId}_{game}` | |
| `weekly_stats` (week, user_id) PK, `listed`; partial indexes (week, net desc) and (week, biggest_win desc) where listed | `weekly_stats/{week}_{userId}` | `listed` is copied from the player on every write and by `PUT /settings`. Composite indexes on (week, listed, net desc) and (week, listed, biggestWin desc). |
| `quest_progress` (user_id, quest_id, period) PK: progress, run, marks jsonb, claimed, updated_at, claimed_at | `quest_progress/{userId}_{questId}_{period}` | Period is `d:2026-10-15`, `w:2026-W42` or `ever`. One row per achievement (not per tier); `claimed` counts tiers paid. |
| `inventory` (user_id, item_id) PK | `inventory/{userId}_{itemId}` | Defaults are never stored. The deterministic id makes a second purchase a conflict the purchase transaction reads. |
| `gifts` (id PK, from/to user and name, amount, message, created_at) | `gifts/{id}` | The client's id, so a retried gift finds itself in its transaction. Index (to_user_id, created_at desc). |
| `feed_events` ((hand_id, kind) PK) | `feed_events/{handId}_{kind}` | Read newest first; a 7-day TTL (Firestore TTL policy on `expiresAt`, which has no index, so reads filter on `createdAt`; plus a check on read). Postgres purges on boot and hourly. |
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
  - `GET /stats/balance?range=7d|30d|90d&timeZone=` samples the ledger at the end of each of the player's days (`balancesAt`: one LATERAL query on Postgres, one `limit 1` query per day on Firestore); today's point is the balance now.
- **Level badge:** a ring next to the balance pill. Hand responses carry the new level; `useHand` holds it with the payout, so the badge and the "Level N!" toast land after the animation.
- **Quests:**
  - Three daily quests and three weekly ones, picked deterministically from a hash of (user, period) out of `quests.ts`, at most one per game. They need no scheduler and no storage until you make progress. The pool is filtered to the registered games, so adding a game changes the picks from its first day.
  - The period is the player's calendar day (`d:`) and the ISO week of that day (`w:`), from the time zone the SPA sends with each start, action and claim. Only the current period's quests can be claimed: yesterday's expire with the day.
  - Progress is folded in the transaction that causes it: settlement for hands, the purchase for the collector achievement. Progress never falls (a streak keeps its current `run` separately), so a completed tier stays completed.
  - Rewards (chips and XP) are paid when you claim them, never automatically, so claiming is visible. `quest_reward` / `achievement_reward` ledger rows.
  - Achievements are permanent, with tiers such as "Play 100 / 1,000 / 10,000 hands", claimed in order.
- **Shop:** about six of each kind priced 5,000 to 1,000,000; the first of each is the free default. `PUT /equipped` (403 `NOT_OWNED`); `/me` carries `equipped`, and the tables and the bet bar draw from it.

## Social

The rules are pure, in `src/domain/social.ts` (public names, the big-win threshold, ranks, the in-process cache) and `economy.ts` (`planGift`).

- **Names:** other players only ever see `publicName`: the display name, or "Player" plus four hex digits of a hash of the user id when the name was taken from the email (`displayNameOf`'s fallback). Never an email.
- **Leaderboards** (`#/leaderboards`, `GET /leaderboards/:board?week=` → `{ rows, me }`):
  - `net` and `biggest_win` (wins only) for an ISO week in UTC, and all-time `level` (XP)
  - the top 50, plus your own row and rank however far down or hidden you are; your rank is 1 + the listed players strictly above you (one `count(*)` on Postgres, a `count()` aggregation on Firestore), so ties share a rank
  - `previous_week` comes with each weekly board, so last week is one tap away
  - each board is cached 30 s in process; your own row is always fresh
  - you can hide yourself in Settings (`PUT /settings { leaderboardListed }`), which also rewrites `listed` on all your weekly rows
- **Gifting** (`POST /gifts { id, to: { email } | { userId }, amount, message?, timeZone }`): to a player by email (any case) or from a leaderboard row. One transaction reads both players (locked in id order on Postgres) and any gift with that id, then writes the debit, the credit, both ledger rows (each naming the other player in `ref`) and both day counters. Errors: 404 `NO_SUCH_PLAYER` (the same for an unknown email and a hidden player, so it can't find out who plays), 409 `SELF_GIFT`, `OVER_SEND_CAP`, `OVER_RECEIVE_CAP`, `BELOW_FLOOR`. Whole chips, at least 100; a message of up to 140 characters, shown as plain text. `GET /gifts/received?since=` drives the lobby's "a gift for you" banner; the SPA remembers the last one dismissed in localStorage.
- **Big-win feed** (`GET /feed?limit=20`, cached 10 s): settlement writes an event when a hand returns at least 20× its stake and at least 5,000 chips (`isBigWin`); #57's jackpot hits will write `jackpot` events. The label comes from the registry's `label(facts)` per game ("Straight up 17", "Royal flush on Trips"), else the game's name. Hidden players show as "A player", decided on read from their current flag. The lobby strip scrolls itself, stops while touched, stays still with reduced motion, and polls every 15 s only while the page is visible.

## Cloud specifics

- **Functions:**
  - `highrollerApi` is `onRequest`, mounting the route table under `/api`.
  - No scheduled function is needed: quests are picked deterministically and the feed expires by TTL.
- **Firestore indexes:**
  - ledger (userId, seq desc) and (userId, createdAt desc, seq desc) for the balance chart
  - hands (userId, createdAt desc) and (userId, game, createdAt desc)
  - weekly_stats (week, listed, net desc) and (week, listed, biggestWin desc)
  - players (listed, xp desc)
  - gifts (toUserId, createdAt desc)
  - feed_events by createdAt: a single-field index, which Firestore makes on its own
- **TTL policy** on `highroller_feed_events.expiresAt` and on settled hands' `purgeAt` (90 days). Postgres deletes settled hands on boot, and expired feed events on boot and hourly.
- No secrets.

## Milestones

**1 · Foundation**
- ✅ #39 Scaffold on both targets: players, ledger, daily bonus, bailout, lobby, PWA
- #40 First cloud deploy: repository variables and manual steps
- ✅ #41 Hand lifecycle and settlement core (`src/games` primitives, `/hands` routes, settlement)
- ✅ #42 PixiJS table kit: TableCanvas, procedural textures, animations, bet bar

**2 · Wave 1 games**
- ✅ #43 Blackjack
- ✅ #44 Ultimate Texas Hold'em (with the poker evaluator)
- ✅ #45 Roulette, European and American
- ✅ #46 Side bets: Perfect Pairs, 21+3, Trips

**3 · Progression**
- ✅ #47 XP, level badge and stats dashboard
- ✅ #48 Shop: card backs, felts and chip sets
- ✅ #49 Achievements and daily/weekly quests

**4 · Social**
- ✅ #50 Leaderboards
- ✅ #51 Chip gifting
- ✅ #52 Big-win feed

**5 · Wave 2 games**
- ✅ #53 Baccarat
- ✅ #54 Three Card Poker
- ✅ #55 Video Poker (Jacks or Better)
- ✅ #56 Slots (flags `jackpotEligible`; #57 pays it)
- #57 Shared progressive jackpot

**6 · Polish**
- #58 Larger-screen layouts, sound, accessibility and low-end phone performance

**Suggested order:** #39 → #40, then #41 and #42 in parallel → #43 → #45 → #44 → #47 → #48 → #46 → #49 → #50 → #51 → #52 → #56 → #57 → #53 / #54 / #55 (any order) → #58.
