# OSRS Drop Simulator

A browser-based Old School RuneScape loot simulator for monsters, bosses and clue scroll reward caskets.

It reads drop tables and prices **live from the OSRS Wiki** every time you load a monster, so it stays current when Jagex changes a table or adds a new boss, with no data files to maintain.

## What it does

- Simulate any number of kills (up to 2,000,000) on any wiki page that has a drop table: bosses, Slayer monsters, regular monsters.
- Simulate clue scroll reward caskets for every tier (beginner to master), using the correct number of reward rolls per casket.
- Handles always drops, the main drop table, tertiary drops (clues, keys, jars), pets, and shared tables such as the rare drop table and gem drop table.
- Loot tally with GE value of every item, using the wiki's real-time prices.
- Collection log view with first-drop kill count and a luck percentile for each slot.
- "Simulate until collection log is complete", compared against 300 simulated players.
- Kills-to-pet with the share of players who would have the pet by then.
- GP luck percentile, compared against hundreds of simulated players doing the same number of kills.

## Doom of Mokhaiotl

Doom's loot works differently from a normal drop table, so it has its own module (`src/lib/doom.ts`, `src/DoomPanel.tsx`). Pick **Doom of Mokhaiotl** from the boss list or search for it.

- Each delve level you clear adds a common roll, a unique roll, a pet roll, an elite clue roll and (from delve 3) a fixed stack of demon tears to a loot pile.
- Unique rates rise with depth (cloth from delve 2, Eye of ayak from 3, Avernic treads from 4, Dom from 6) and stop improving at delve 9. Common quantities scale from −50% at delve 1 to +20% at delve 9+.
- You choose the delve to claim at, whether to claim early when a unique drops, and your own chance of dying on each delve. Dying forfeits the whole pile for that run.
- A "How deep should you go?" table gives exact expected GP per run, GP per level, survival and unique chance for every claim depth, so you can compare strategies.

The per-delve rates are kept in the module by hand because the wiki publishes them as per-level tables rather than an item-drops table. Two details the wiki does not spell out are assumptions: the three uniques share one roll per level, and the common roll still happens on a level that gives a unique.

## Running it

```bash
npm install
npm run dev     # local dev server
npm test        # unit tests
npm run build   # static site in dist/
```

The built site is plain static files, so it can be hosted anywhere. Pushing to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml` (turn it on once in **Settings → Pages → Source: GitHub Actions**).

## How the data is read

- **Drop tables**: the app asks the wiki's MediaWiki API (`action=parse`) for the rendered page and reads every `item-drops` table on it. Using the rendered page means every shared template (herb tables, tertiary tables, etc.) is already expanded. The section heading above each table decides how it rolls: `Tertiary` and `Pet` sections roll independently each kill, `Always` drops always come, and everything else shares the main roll.
- **Sub-tables**: a row such as "Rare drop table" or "Gem drop table" is followed to its own wiki page and rolled as a nested table.
- **Clue caskets**: the wiki lists casket rewards per roll. The app rolls 1–3 (beginner), 2–4 (easy), 3–5 (medium), 4–6 (hard and elite) or 5–7 (master) times per casket, and tertiary rewards (like the master clue from elite caskets) once per casket. Mimic rewards are left out.
- **Prices**: `prices.runescape.wiki/api/v1/osrs/latest` and `/mapping`, using the midpoint of the latest buy and sell. Untradeable items count as 0 gp.
- Pages are cached in your browser for 24 hours and prices for 10 minutes. "Clear cached data" in the footer forces a refresh.
- The wiki asks API users to identify themselves; since browsers can't set `User-Agent`, requests send an `Api-User-Agent` header instead.

Every loaded source has a "Show the drop table as read from the wiki" panel so you can check the parsed rates against the wiki page.

## Known limits

- Pages that list several variants of a monster in one table (for example different combat levels) are merged; if their rates add up to more than 100% they are scaled down and a note says so. Use the variant's own page when there is one.
- Doom of Mokhaiotl's rates are hand-kept in `src/lib/doom.ts` and need updating by hand if Jagex changes them.
- Raids (Chambers of Xeric, Theatre of Blood, Tombs of Amascut) use points-based loot rather than drop tables and are not modelled yet.
- Ring of wealth and other drop-rate modifiers are not modelled yet.
- The "collection log" is approximated as pets plus every item rarer than a chosen rate (default 1/100) that drops directly from the source.

## Credits

Drop data from the [Old School RuneScape Wiki](https://oldschool.runescape.wiki/), licensed CC BY-NC-SA 3.0. Prices from the [OSRS Wiki real-time prices API](https://prices.runescape.wiki/). Item sprites are loaded directly from the wiki's image server and are not stored in this repository; they are © Jagex. Not affiliated with Jagex.
