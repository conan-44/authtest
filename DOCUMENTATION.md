# Developer documentation

## Running and testing

This is a static site, not a Node application. Serve the repository root over HTTP
(for example, `python3 -m http.server 8000`) and open it in a browser. Opening
`index.html` directly as a file does not reliably support `fetch`, modules, or
workers. Supabase, external libraries, game services, and Smiley require network
access; some features also require a signed-in account.

Run the local regression tests with `node --test tests/*.test.cjs`. They use
Node's built-in test runner and need no package installation. Browser checks
should cover sign-in/out, both payment methods, the five packs, the guest guide,
game carousel, mobile layouts, and loading failures. Do not use real accounts or
production writes for test fixtures.

## Project layout

- `index.html` contains the main page, navigation, panels, and script order.
- `css/` contains the site theme, component styles, responsive rules, and sprite
  definitions. Theme colors are CSS variables in `css/variables.css`; settings
  can override them. `chat/smiley/smiley.css` styles Smiley separately.
- `js/` contains authentication, settings, achievement state and rendering,
  dashboard, blog, games integration, Gacha, and tips. Most scripts are
  classic browser scripts; their order in `index.html` matters.
- Supabase auth-state callbacks must return synchronously. Profile queries are
  deferred until after the callback releases the auth lock; account generation
  checks prevent an earlier profile request from overwriting a newer session.
  Sign-in state is dispatched before profile loading, so a failed or stalled
  profile request cannot block the rest of the app. Profile errors are reported.
- `chat/` contains messages, channels, actions, GIFs, profiles, emojis, and the
  Smiley interface and worker. Chat uses Supabase realtime and storage.
- `minigames/` contains standalone game pages. `js/games.js` hosts them in an
  iframe, handles navigation, game ratings, and theme propagation. The games
  communicate with the parent through the exposed game APIs.
- `parsers/` parses the project's configuration and comment-bearing metadata.
  `data/` contains content and configuration; `assets/` contains images, fonts,
  audio, and sprite sheets. `history/` supplies the displayed build history.
- `.github/workflows/suggestion-issues.yml` runs
  `api-config/sync-suggestion-issues.cjs` to synchronize suggestions and issues.
  The workflow needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` GitHub
  secrets; its GitHub token is supplied by Actions. Keep service-role
  credentials out of browser code and source control.

## Content

`data/site-content.json` owns the guest guide paragraphs and game-card
descriptions. The keys match `data-guest-guide` and `data-game-description`
attributes in `index.html`. The carousel's repeated first card uses the same
game key. `js/site-content.js` fills these elements using text content, not
HTML. Missing or invalid descriptions are logged and shown as unavailable.
Update the markup and data together when adding a section or game.

`data/achievements/index.skvwmeta` lists achievement files, each under its
namespace in `data/achievements/`. Achievement JSON contains its title,
description, rarity, and `successors` for the tree. Points and milestone
thresholds come from `data/achievements/config/`. `js/loaders.js` loads the
definitions, `js/achievements.js` records unlocks and synchronizes them, and
`js/renderers.js` builds the views. The local achievement completion map is
merged with the signed-in user's `user_stats`; bonus points are client-side.
`parsers/metajson.js` accepts comments in metadata without stripping text inside
JSON strings. Other content includes the blog index and posts in `data/blog/`,
settings in `data/settings/`, tips in `data/tips/`, and game-specific data in
`data/minigames/`.

## Gacha configuration and economy

`data/gacha/packs.json` supplies pack names, descriptions, draw sizes, strategies,
and probability parameters. `js/gacha-rules.js` validates it and exposes
`GachaRulesReady`, which resolves to the rules used by `js/gacha.js`. A failed
load disables Gacha and displays an error rather than using different odds.
Configuration uses probability fractions: `0.2` means 20%, and `0.001` means
0.1%. The tooltip shows the actual per-item chances at the player's points.

The ordinary shard weights are `rarityWeightRatio` raised to successive powers,
normalized over unlocked rarities. The current milestone permits the next
ordinary rarity, capped at Platinum. At Mythical, the combined fragment chance
is `base + growth * (1 - exp(-(points - mythicalPoints) / scale))`; it is split
equally among the three fragments. Green increases the fragment chance, Blue
shifts weight toward Platinum, and Yellow shifts weight toward higher shards.
Their target expected value is calculated from `shardValues`, `fragmentValue`,
`balancePack`, and each boosted pack's `targetPercent` (100 means the same
expected value as the balancing pack). These are balancing values, not individual fixed
percentages. Some boosts cannot apply until the relevant rarities unlock.

The five pack IDs, shard IDs, and pack sizes are shared with the Supabase Gacha
functions, the ticket store, and sprite classes. The client rejects mismatched
IDs or sizes; changing them requires a coordinated database and UI migration.
Do not treat changing only the JSON as a complete pack-size or economy change.
The client also rejects invalid calculated probabilities.

The current economy starts with 100 orbs; packs cost 20 orbs or a matching
ticket. Achievements award 10 orbs, milestones 25, and each 25 Elo above a
game's previous high awards one orb. Classic tickets accrue every 24 hours;
each milestone permits a choice of one colored ticket. Retroactive rewards are
reconciled when the account synchronizes. Tickets are device-local; shards and
orbs are stored in Supabase. Receipt IDs and a local pending operation allow a
lost response to be retried without repeating the server transaction.
Existing local shard collections are imported on the device where they were
stored. Browser storage must remain available, and Web Locks are used to
serialize operations across tabs. Public profiles read shard counts from
`gacha_inventory`. Tickets, milestone points, and random draws are client
controlled and are not an anti-cheat or payment-security boundary.

The Supabase Gacha tables and RPCs are part of the linked database; this
repository does not currently contain their migration. Schema changes must be
coordinated with the client and tested in an isolated database before deployment.
The client also expects the existing profile, achievement, game-rating, chat,
blog, and suggestion database objects.

## Game and animation invariants

Number Pillars updates the selected answer before its removal animation but
defers checking the sum and advancing the level until that removal finishes;
an animation timeout provides a fallback. Its rendered stack is reversed when
mapping hint indices. Some animation helpers read layout after removing a class
to restart CSS animation. Preserve these ordering and reflow requirements when
changing the game or animations.

## Third-party code

The vendored Dou Dizhu engine and its notice/license are in
`minigames/cards/vendor/doudizhu/`. `minigames/chess/chess.js` includes generated
code and an upstream license; `minigames/chess/stockfish-19-lite-single.js` is a
distributed engine. These files retain their upstream headers and comments.
Do not remove their attribution or casually reformat generated/vendor code.