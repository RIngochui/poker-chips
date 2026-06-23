# Poker Chips

A web-first poker chip tracker. The app *is* the chips — it tracks every player's stack and the pot in realtime while the actual poker is played in real life. Real money never moves through the app; it only does the math and produces a copy-paste settlement summary at the end.

## Stack

- React + Vite + TypeScript + Tailwind CSS
- Firebase Firestore (realtime data) + Anonymous Auth
- All Firestore access lives behind `src/db/` so the rest of the app never imports Firebase directly

## Project structure

```
src/
  db/            Firebase abstraction — the only code that touches Firestore
    firebase.ts  App/auth/firestore init
    identity.ts  Anonymous sign-in + localStorage display name
    tables.ts    Table/lobby CRUD, settings validation
    game.ts      Betting engine — turn order, streets, all-in, pot award
    types.ts     Data model (Table, Player, LedgerEntry, ...)
  lib/
    payouts.ts   Net result + debt settlement calculation
  pages/
    Landing.tsx   /        create or join a table
    Join.tsx      /join    join an existing table by code
    TablePage.tsx /table/:id  routes to Lobby / ActiveGame / Results by table status
    ActiveGame.tsx          the live betting screen
    Results.tsx             final payouts + settle-up summary
  store/
    identityStore.ts  Zustand store for the local player's uid/name
```

## Local development

```bash
npm install
npm run dev       # starts Vite dev server at http://localhost:5173
npm run build     # typecheck + production build
```

## Firestore rules

Security rules live in `firestore.rules` (host-only settings, shared-control table/player updates, append-only ledger). Deploy them with:

```bash
npm run deploy:rules
```

This uses `npx firebase-tools` so no global install is required — you'll need to `npx firebase-tools login` once first.

## Data model

See `src/db/types.ts` for the authoritative shape. At a glance:

- `tables/{code}` — table settings, blinds, pot, current street, turn state
- `tables/{code}/players/{uid}` — per-player stack, status, seat, ready/folded flags
- `tables/{code}/ledger/{eventId}` — append-only audit trail of every chip movement

## Known simplifications

- Single main pot only — no side pots. Uneven all-ins use an "uncalled bet return" instead of a full side-pot engine.
- Blind escalation is hand-count based (`settings.blindIncrease`), not wall-clock based.
- Pot award requires majority confirmation from active players rather than a single declare, except when a fold leaves exactly one contender (auto-awarded).
