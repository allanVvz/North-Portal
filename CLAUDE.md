# CLAUDE.md — North Portal

Next.js App Router + Supabase (auth + Postgres + RLS) + Vercel. Windows/PowerShell is the primary shell; Git Bash is also available for POSIX scripts.

## Commands

```
npm run dev              # next dev
npm run typecheck        # tsc --noEmit
npm test                 # vitest run
npm run verify           # typecheck + test + build — run this before any deploy
npm run check:deploy     # env:check + repo:check + verify
npx playwright test      # e2e (opt-in, creates real data — see docs/REPRODUCAO-DEPLOY.md)
```

**Stop `next dev` before running `npm run build` or `npx tsc --noEmit`.** Running a build while the dev server is still up corrupts `.next` (manifests briefly), producing `/_not-found` / Internal Server Error that looks like an app bug but isn't.

## Deploy

Deploy mechanics (how `main` reaches production, when a manual `vercel deploy` is still useful, the `.vercel/`-in-worktree gotcha) live in `DEPLOY.md` — read that before touching Vercel. Short version: push to `main`, Vercel's GitHub integration builds and publishes on its own; don't also run `vercel deploy --prod`.

## Production Supabase

Production uses project ref `rqwycltgnnvaunvmyxea` (`https://rqwycltgnnvaunvmyxea.supabase.co`) — this diverges from the placeholder in `.env.example`/older docs. Full detail (org, how it was wired, open uncertainties) is in the `prod-supabase-project` memory — check that before assuming which project a local `.env.local` or a script targets.

Migrations in `supabase/migrations/` are the documentation of schema history, but they've also been applied directly to production via the Supabase MCP's `apply_migration` rather than always via `supabase db push`. If you apply a migration that way, add the matching file to the repo by hand — nothing keeps the two in sync automatically.

## CSS gotchas (already bitten this codebase more than once)

- **Never write a bare-element + class selector like `select.foo`** to try to beat a broader rule — it silently loses to a *later-declared* single-class rule of equal-or-lower apparent specificity in unexpected ways in this codebase's cascade. Prefer a class-only selector (`.foo`) and let source order do the work, or raise specificity on the actual class, not by tagging the element.
- **A generic `button, input, textarea { font: inherit }` reset can clobber a more specific rule** (e.g. `button.admin-nav-head { font-size: 10.5px; text-transform: uppercase }`) if the generic rule's selector ends up with equal-or-higher specificity or comes later — this has broken admin menu typography before. When a themed/typed override doesn't seem to apply, check the actual specificity math, not just source order.
- **A `createPortal` into `document.body` leaves the theme behind.** Every `--a-*` token (surface, border, ink) *and* the admin font live on `.admin-shell`, not `:root`. A panel portaled to `body` renders outside that scope, so `var(--a-surface)` fails to resolve, `background` falls back to its initial value and the thing comes out fully transparent with the document font. Portal to `document.querySelector(".admin-shell") ?? document.body` — `CalendarPicker.tsx` and `FloatingPopover.tsx` both do.
- Same family of bug: an attribute-selector theme scope (e.g. `.foo[data-theme="light"] .btn`) can out-rank a plain two-class modifier (`.btn.primary`) regardless of where each is declared. Add an explicit `:not(.primary)` (or similar) rather than reordering rules and hoping.

## Hydration gotcha

Never lazy-initialize React state by reading `localStorage` directly in `useState(() => ...)`. The server always renders the default, so a client that read a different value from `localStorage` diverges from the server-rendered HTML — React throws a hydration error and **discards and re-renders the entire tree**, which is worse than the flash of default content you were trying to avoid. Always start state at the same default the server would render, then correct it in a `useEffect` after mount.

## UI preference pattern

Several screens persist per-user UI prefs (sort order, visible columns, view mode) via `localStorage` + a `CustomEvent` so multiple components mounted on the same screen stay in sync without prop drilling or a backend round-trip. See `app/admin/taskSortPrefs.ts`, `app/admin/kanbanPrefs.ts`, `lib/acquisitionPrefs.ts` for the pattern. Always fall back safely to the default when `localStorage` has no value, or an invalid/stale one (a shape from an older version of the app).

## Identidade visual e foto de perfil

Dois assuntos que já foram duplicados em várias telas e agora têm dono único — leia o README antes de mexer:

- **Marca (bússola, logo, favicon)**: `app/brand/README.md`. A geometria só existe em `app/brand/compass.ts`; `app/icon.svg` é gerado por `npm run brand:icons` e um teste falha o verify se alguém editar o SVG à mão.
- **Foto de perfil**: `app/avatar/README.md`. Mapa dos cinco lugares onde a foto aparece, a regra única de "foto ou iniciais" (`UserAvatar`), e a ressalva de que o autor de comentário é texto congelado — a foto ali é resolvida por nome, não por id.

## Commit style

Commits are in Portuguese, `type(scope): short imperative summary` subject line, followed by a prose body explaining **why** the change was made (not just what changed) — trade-offs considered, bugs that motivated it, edge cases the fix accounts for. Multi-paragraph bodies are normal for anything non-trivial. Every commit ends with:
```
Co-Authored-By: Claude <model name> <noreply@anthropic.com>
Claude-Session: <session URL>
```
Standard git safety rules apply: new commits, never `--amend` on someone else's work; never force-push `main`; never skip hooks.
