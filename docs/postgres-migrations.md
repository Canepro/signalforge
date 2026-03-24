# Postgres Migration Policy

This document defines how Postgres schema changes are expected to land in SignalForge.

It exists to keep production upgrades boring.

## Rules

1. Migration files are append-only.
2. Never edit a migration file after it has been applied anywhere outside a disposable local database.
3. Every schema change gets a new sequential file in [`../migrations/postgres`](../migrations/postgres).
4. Application code and migration SQL should land in the same change when one depends on the other.
5. Backward-incompatible destructive changes are not a one-step migration.

The migration runner stores each applied filename and checksum in `schema_migrations`.

If a committed migration file is edited later, the runner fails on checksum mismatch by design.

## File Naming

Use monotonically increasing filenames:

- `001_init.sql`
- `002_add_run_index.sql`
- `003_source_health_columns.sql`

Do not use timestamps. The repo should keep a readable ordered history.

## Safe Change Pattern

Preferred pattern for risky schema evolution:

1. Add new nullable column / index / table.
2. Deploy code that writes both old and new shapes if needed.
3. Backfill data in a separate migration if required.
4. Deploy code that reads the new shape only.
5. Drop old column or constraint in a later migration after the rollout is proven.

This is the normal expand-and-contract model. Use it unless the change is provably trivial.

## Rollback Strategy

SignalForge does not use automatic `down` migrations today.

That is intentional.

For now, rollback means one of these:

- revert application code if the schema change is backward-compatible
- apply a new forward-fix migration if the released migration was wrong
- restore the database from backup if an irreversible destructive migration shipped

Because of that, destructive operations need a higher bar.

Before landing a migration that drops or rewrites data, require all of these:

1. A documented restore path.
2. A verified backup or snapshot strategy in the target environment.
3. A staged deploy plan.
4. A clear reason why expand-and-contract is not sufficient.

## CI Expectations

CI should prove two things:

1. The migration runner can apply the checked-in Postgres migrations to a fresh database.
2. The storage parity suite passes against a real Postgres instance.

That does not replace production upgrade testing across multiple migration versions, but it does catch broken fresh installs and backend drift.

## Release Discipline

Before merging a Postgres schema change:

1. Run `bun run db:migrate:postgres` against a clean Postgres database.
2. Run `bun run test:parity` with `DATABASE_URL_TEST` pointed at Postgres.
3. Confirm the app still passes `bun run typecheck`, `bun run test`, and `bun run build`.
4. Update docs if the operator setup changes.

## Current Limitations

- No first-class production backup tooling is bundled in this repo.
- No multi-version upgrade matrix exists yet.
- No automated rollback exists beyond restore-and-redeploy discipline.

Those are known gaps, not accidental omissions.
