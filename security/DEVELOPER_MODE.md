# Single-account Developer Mode and application Backup/Restore

Updated 2026-10-08. The owner reported successful authenticator enrollment
and the live **Identity verified** screen. Backup/Restore now have an actual
server engine and web UI, replacing the earlier disabled placeholders.

## Authorization

Exactly one existing Supabase Auth account is authorized by the scalar
server secret `CRAYTHRIVE_DEVELOPER_USER_ID`. Optional
`CRAYTHRIVE_DEVELOPER_EMAIL` is an additional check, never a substitute for
the UUID. Missing/malformed/list/wildcard configuration denies everybody.
There is no super-admin role, second developer, management page or UI for
adding a developer. No real developer identity is stored in tracked files.

Ten sidebar logo clicks invoke `developer-access` using the current session
JWT. The `/developer` page repeats that server check. Each Edge Function
independently validates the user through Auth `getUser(token)` and verified
`getClaims(token)` and matches the verified user ID to both JWT subject and
the server UUID. Anonymous users, service keys, other users and client flags
cannot grant access. Denials reveal no configured identity.

Every Backup/Restore request additionally requires signed `aal2` and a
verified TOTP AMR timestamp within five minutes. Refresh timestamps and
request flags do not qualify. The browser returns to verification on
401/403 and expires its verified UI; the server remains the authority.
Platform `verify_jwt = true` remains enabled on all three functions.
Unauthenticated requests may receive platform 401; other signed-in accounts
receive handler 403. OPTIONS is a data-free 204. Responses are `no-store`.

Authenticator setup uses Auth MFA for the current account only. QR payloads
are normalized into one SVG image URI, without double-encoding SDK URIs.
QR data and operation files/proofs stay in component memory, not localStorage.

## Backup coverage

Backups include all users' rows from these 22 reviewed `public` tables when
present. Live names, column types, primary keys, FK relationships and
application trigger names were inspected through read-only Management API
queries; no production row contents were exported during implementation.

| Tables | Restore behavior |
| --- | --- |
| profiles, tanks, devices, iot_devices, camera_registry | Merge by primary key |
| sensor_readings, ammonia_readings, turbidity_readings | Merge; raw values and metadata preserved |
| threshold_settings, water_thresholds | Merge saved settings |
| alerts, control_logs, tank_automation_logs | Merge history without replaying side effects |
| marketplace_listings, marketplace_orders, seller_profiles | Merge by primary key |
| marketplace_chat_threads, marketplace_chat_messages | Merge without triggering notifications |
| notification_preferences | Merge by user_id primary key |
| device_commands, push_tokens, tank_automation_settings | Export only; current operational state stays unchanged |

Unknown public tables are excluded and listed in the export result. Views,
partitions, Auth accounts/passwords/MFA/sessions, Storage file bytes, server
secrets, SQL schema/functions/policies and external services are outside
this **application-data backup**. Image URL columns are included but image
files are not. This does not replace Supabase database backups/PITR or a
separate Storage backup.

Exports use a repeatable-read, read-only database transaction. Rows are
stored as PostgreSQL JSON text so bigint/numeric precision, nulls, dates,
raw readings and raw status fields survive without JS number conversion.
The app never recalculates monitoring values during backup or restore.

Downloads use `.ctbackup` JSON envelopes encrypted/authenticated with
AES-256-GCM, random 96-bit IVs and project-specific authenticated data.
Neither rows nor encryption keys appear in the downloadable envelope as
plaintext. Modified archives and other projects/keys cannot be decrypted.
Only the authorized developer with recent MFA can export or decrypt them.

## Restore flow and transaction behavior

1. Select a `.ctbackup` file. Client shape/size checks run before upload.
2. **Preview restore** decrypts and validates it on the server, requires the
   same live schema, and reports add/update/unchanged counts per table.
3. The preview also exports/downloads a separate encrypted recovery copy of
   current application data. It makes no application changes.
4. Review the counts, confirm the recovery copy was saved, and type `RESTORE`.
5. The server validates the encrypted preview proof, bound to the current
   developer, exact archive and affected-row fingerprint, valid for two
   minutes. Recent MFA is independently required again.
6. Restore locks affected tables in a stable order, rechecks the fingerprint
   and merges by primary key in FK dependency order in **one transaction**.
   Affected rows changed since preview require a new preview. Unrelated new
   primary keys do not block restore and remain intact.

Matching IDs are overwritten with backup values; missing IDs are inserted.
No records are deleted, no tables truncated, and no schema or RLS changed.
This is a merge recovery, not an exact point-in-time replacement; replaying
the recovery copy cannot remove newly inserted IDs. Auth users referenced
by FKs must still exist. Schema changes or cyclic relationships require
a database-level restore instead.

Live triggers create alerts, push notifications and actuator commands.
Restore temporarily disables only application triggers on affected tables,
inside the locked transaction, then restores their original modes. FK,
unique, not-null and check constraints remain enabled. Failure rolls back
row changes and trigger modes. Identity sequences advance to at least the
highest restored ID without moving backward; PostgreSQL sequence advances
can leave harmless gaps even when a transaction rolls back.

Device commands, push tokens and live automation settings are never written
by this restore. No historical commands or notification pushes are replayed.
Successful operation logs contain only action name and table count, never
rows, encrypted files, preview proofs, OTPs or credentials.

## Server setup and deployment

Only Supabase server secrets are used:

- `CRAYTHRIVE_DEVELOPER_USER_ID`: existing single authorized UUID.
- `CRAYTHRIVE_DEVELOPER_EMAIL`: optional secondary email check.
- `CRAYTHRIVE_BACKUP_ENCRYPTION_KEY`: 32 random bytes as 64 hex characters.
- Built-in `SUPABASE_URL`, `SUPABASE_ANON_KEY` for JWT verification.
- Built-in `SUPABASE_DB_URL` for PostgreSQL, read only after authorization.

The runtime uses a per-request Postgres.js connection (`prepare: false`,
max 1 connection, TLS required, connection timeout 10s). Transaction-local
statement/lock timeouts are 25s/5s. DB credentials are never sent to React
or returned by the API. No public RPC or SQL migration is needed.

For a **new project** only, `node scripts/create-backup-key.mjs` generates
`supabase/functions/.env.backup`, ignored by Git. It retains an existing
local key and never prints its value. Upload only this new key using:

```powershell
supabase secrets set --env-file supabase/functions/.env.backup --project-ref YOUR_PROJECT_REF
supabase functions deploy developer-access developer-backup developer-restore --project-ref YOUR_PROJECT_REF --use-api
```

Never overwrite an existing production archive key casually. Older files
require their original key and project origin; keep a secure offline copy.
No server secret belongs in `VITE_`, React, Git or this document.

The new key was added only after a metadata-only presence check confirmed
it absent. The built-in DB URL was present. All three Developer functions
were deployed to the existing project `abtzkqfrwzcocyrwcrfc` and verified
ACTIVE at version 3 with `verify_jwt: true`. Existing AI/push functions
were not deployed or modified. Live smoke checks returned OPTIONS 204 and
unauthenticated POST 401 on each endpoint. No production restore or SQL
write was performed; only schema metadata/estimated row counts were read.

## Limits and validation

- Maximum plaintext archive 8 MiB, encrypted request/file 12 MiB, 20,000
  rows per table and 50,000 total. Exceeding limits fails explicitly, with
  no truncated backup or partial restore. Use database-level backups for
  larger datasets. Current estimated row counts are below these row limits.
- Production build and bundled credential scan: passed, no findings.
- Unit tests: 77 passed, 1 historical retired-endpoint skip. Eight backup
  tests use actual PostgreSQL via development-only PGlite, including precision,
  encryption, FK ordering, stale proofs, schema drift, trigger suppression,
  unchanged operational state and rollback after constraint failure.
- All 17 Developer browser tests passed, including backup/recovery downloads,
  confirmation gates, rejection paths and layouts at 390/768/1366px.
  The full browser suite passed: 103 tests, 18 historical retired-form skips.
- Changed-file ESLint: 0 errors/warnings. Full repository: existing 24 errors
  and 5 warnings elsewhere. Existing Vite chunk-size and runner color warnings
  remain. PGlite is not imported into the production app or Edge Functions.
- Actual owner backup download/restore and another signed-in account's live
  403 are pending user testing. Browser backends are mocked; PGlite verifies
  SQL on local synthetic data, not production data.

References: [Supabase Auth TOTP](https://supabase.com/docs/guides/auth/auth-mfa/totp),
[verified JWT claims](https://supabase.com/docs/reference/javascript/auth-getclaims),
[Edge PostgreSQL connections](https://supabase.com/docs/guides/functions/connect-to-postgres),
[server secrets](https://supabase.com/docs/guides/functions/secrets),
[Postgres.js transactions](https://github.com/porsager/postgres),
and [PGlite](https://pglite.dev/docs/).
