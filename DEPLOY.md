# Deploy — North Portal

Canonical entry point for shipping this app. For the full rebuild-from-scratch runbook (fresh Supabase project, migrations, demo users, CI, rollback) see `docs/REPRODUCAO-DEPLOY.md`. For open pre-deploy questions/checklist items see `docs/DUVIDAS-PRE-DEPLOY.md` — both predate some of what's below and reference an older Supabase project ref; see [[prod-supabase-project]] for the one actually in use.

## How production deploys actually happen

The Vercel project `north-portal` is connected to GitHub (`allanVvz/North-Portal`, branch `main`) via Vercel's native Git integration.

**Pushing to `main` triggers a production deploy automatically.** Verified empirically 2026-08-26: several manual `vercel deploy --prod` runs were each followed 2–5 minutes later by a second, independent production deploy correlated with the `git push origin main` that came right after.

**Do not run `vercel deploy --prod` after `git push origin main`.** It's redundant — the Git integration already builds and publishes that commit. Doing both just doubles the build for no benefit.

The correct flow:
```
git commit ...
git push origin main
# Vercel builds and publishes on its own — nothing else to run.
```

Pushing any other branch that exists on `origin` should trigger an automatic **Preview** deploy the same way (not independently re-tested this session, but it's the same Git-integration mechanism).

## When a manual `vercel deploy` still makes sense

Run a plain `vercel deploy` (no `--prod`) when you want to test a branch as a real Vercel deployment **before** merging it to `main` — e.g. checking a preview URL, verifying env vars resolve correctly, or sanity-checking a build that hasn't been pushed yet. This does not touch production.

## Gotcha: `.vercel/` in a fresh worktree

`.vercel/` is gitignored, so a new `git worktree` doesn't have it — `vercel` commands run from a worktree will not know which project to target. Either copy `.vercel/project.json` from the main checkout into the worktree, or run `vercel link` again from inside the worktree before deploying from it.

## Supabase migrations

Migrations in `supabase/migrations/` document the schema, but production has in the past been updated directly via the Supabase MCP's `apply_migration` rather than `supabase db push`. When you apply a migration that way, add the matching file to `supabase/migrations/` by hand so the two stay in sync — nothing enforces this automatically. See [[prod-supabase-project]] for the production project reference and org.

## Related

- [[prod-supabase-project]] — which Supabase project is actually live, and how it diverges from what older docs say.
- Repo `CLAUDE.md` — local dev/build/test commands and codebase gotchas.
- `docs/REPRODUCAO-DEPLOY.md` — full reproduction runbook (env vars, CI, rollback procedure).
- `docs/DUVIDAS-PRE-DEPLOY.md` — older pre-deploy checklist/open-questions doc.
