# Single-account Developer Mode and application Backup/Restore

Updated 2026-10-08. The owner reported successful authenticator enrollment
and the live **Identity verified** screen. Backup/Restore now have an actual
server engine and web UI, replacing the earlier disabled placeholders. Daily
change-aware backups and private encrypted history are now installed.

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
Platform `verify_jwt = true` remains enabled on all three developer functions.
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

Recovery exports use a repeatable-read, read-only database transaction.
History exports use a serializable transaction that reads application tables
and writes only the private archive/history tables. Rows are
stored as PostgreSQL JSON text so bigint/numeric precision, nulls, dates,
raw readings and raw status fields survive without JS number conversion.
The app never recalculates monitoring values during backup or restore.

Downloads use `.ctbackup` JSON envelopes encrypted/authenticated with
AES-256-GCM, random 96-bit IVs and project-specific authenticated data.
Neither rows nor encryption keys appear in the downloadable envelope as
plaintext. Modified archives and other projects/keys cannot be decrypted.
Only the authorized developer with recent MFA can download or restore them.
The automated worker can create encrypted archives but cannot return them.

## Daily backups and history

The server checks daily at **23:55 Asia/Manila** (`55 15 * * *` UTC), even
when the browser is closed. The first check saves a baseline. Subsequent
checks compare a SHA-256 fingerprint of the reviewed tables' canonical row
text and schema with the latest snapshot. Export timestamps, random IVs
and row ordering do not create false changes. Inserts, updates and deletions
that change the final snapshot produce a new archive. No net change means
the check is recorded as skipped, with no duplicate archive. This compares
snapshots; it is not a log of changes that were later undone before checking.

Manual downloads also enter history when changed; unchanged manual downloads
reuse the existing encrypted archive and its original creation date.
An advisory transaction lock and serialization retry prevent overlapping
exporters from creating duplicate snapshots. They do not lock ingestion.

The Developer UI shows schedule status, next check, latest result and dated
backup entries with source, record count and file size. History uses stable
20-entry pagination. Each entry can be downloaded or selected for the same
protected restore preview/recovery/confirmation flow. Selecting an entry
never applies a restore. Old local downloads from before this feature do
not automatically become history entries.

Archives live in `craythrive_private.backups`, with check results in
`backup_runs` and the fixed worker destination in `backup_schedule_config`.
All three tables have RLS, no client policies, and revoked privileges for
PUBLIC/anon/authenticated/service_role. The schema is also inaccessible to
these roles. Snapshots exclude it, so backups never recursively include
backups. No automatic deletion/retention policy is applied.

The history is in the same database as the application. It supports app
recovery, but cannot recover a lost project/database by itself. Download
important archives and retain the encryption key securely outside the project.

The fourth Edge Function, `developer-backup-scheduled`, is an export-only
machine worker with `verify_jwt = false` and its own strict HMAC guard.
`CRAYTHRIVE_BACKUP_SCHEDULER_TOKEN` is a random 256-bit secret stored only
in Edge secrets and Vault (`craythrive_backup_scheduler_token`). A private
invoker function signs the fixed message `craythrive-daily-backup:v1:TIMESTAMP`
using SHA-256 HMAC. The worker verifies the signature and a two-minute
timestamp window, rejects old static-token headers and ignores caller bodies.
Its response contains only saved/skipped status or a fixed failure message,
never an archive, rows, history, SQL or restore capability. This grants no
additional human developer access; all developer endpoints retain UUID + MFA.

Supabase manages pg_net object grants, including PUBLIC queue access by
database login roles. The reusable signing secret is therefore **never**
queued in HTTP headers; only a short-lived signature is sent. A signature
may be replayed within its two-minute window, but can only request the same
deduplicated export. Keep `net` out of Data API exposed schemas and database
login access limited to trusted services. See the official
[pg_net permissions](https://supabase.com/docs/guides/troubleshooting/revoking-access-to-pg_net-objects-has-no-effect-0bbc16)
and [queued headers](https://supabase.com/docs/guides/troubleshooting/database-roles-can-read-request-headers-queued-by-pg_net-ad6357)
guidance. A queue delay over two minutes fails closed. Check Cron/Edge logs
if no run is recorded; dispatch failures cannot be written by an uninvoked worker.

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
- `CRAYTHRIVE_BACKUP_SCHEDULER_TOKEN`: separate 32-byte machine signing key.
- Built-in `SUPABASE_URL`, `SUPABASE_ANON_KEY` for JWT verification.
- Built-in `SUPABASE_DB_URL` for PostgreSQL, read only after authorization.

The runtime uses a per-request Postgres.js connection (`prepare: false`,
max 1 connection, TLS required, connection timeout 10s). Transaction-local
statement/lock timeouts are 25s/5s. DB credentials are never sent to React
or returned by the API. No public RPC is added. Private history requires
`supabase/migrations/20261008150000_developer_backup_history.sql`.
`20261008151000_normalize_backup_json.sql` repairs early double-encoded
private envelopes without changing ciphertext or application rows. Raw JSON
parameters use `::text::jsonb` to bypass Postgres.js JSON reserialization,
including precision-preserving restore row arrays.

For a **new project** only, `node scripts/create-backup-key.mjs` generates
`supabase/functions/.env.backup`, ignored by Git. It retains an existing
local key and never prints its value. Upload only this new key using:

```powershell
supabase secrets set --env-file supabase/functions/.env.backup --project-ref YOUR_PROJECT_REF
supabase functions deploy developer-access developer-backup developer-restore --project-ref YOUR_PROJECT_REF --use-api
```

For automatic history, apply the two private migrations, deploy
`developer-backup-scheduled` as well, then run:

```powershell
node scripts/configure-backup-schedule.mjs YOUR_PROJECT_REF
```

The script uses the existing CLI login (`SUPABASE_CLI_PATH` may specify its
executable), generates/reuses ignored `.env.backup-scheduler`, adds only the
worker secret to Vault/Edge, and installs `supabase/schedules/developer-backup.sql`.
It refuses a mismatched existing Vault key, removes its ignored temporary SQL
file, and prints no credentials. Re-running updates the same named Cron job.

Never overwrite an existing production archive key casually. Older files
require their original key and project origin; keep a secure offline copy.
No server secret belongs in `VITE_`, React, Git or this document.

The original encryption key was retained. All four functions are deployed
to the existing project `abtzkqfrwzcocyrwcrfc`; AI/push functions were not
changed. Private history and the active daily Cron job are installed, and
the live Cron timezone was verified as GMT. One initial encrypted archive
was saved. Repeated checks skipped unchanged data without adding archives.
The exact Vault/HMAC/pg_net dispatcher path returned HTTP 200 with no timeout
and recorded `no_data_changes`. Metadata confirms valid encrypted object
envelopes and denied client access to the private schema, tables and dispatcher.
Anonymous requests receive 401 on the three developer endpoints and 403
on the scheduled worker. No production restore or application-row write
was performed; only private backup/setup records were written.

## Limits and validation

- Maximum plaintext archive 8 MiB, encrypted request/file 12 MiB, 20,000
  rows per table and 50,000 total. Exceeding limits fails explicitly, with
  no truncated backup or partial restore. Use database-level backups for
  larger datasets. Current estimated row counts are below these row limits.
- Production build and bundled credential scan: passed, no findings.
- Full source/Git-history scan: six findings, all reviewed synthetic bearer
  strings in `tests/developer-service.test.mjs` and its earlier Git blobs.
  They are mock session values, not real credentials; the history scan therefore
  still exits nonzero. No history rewrite or scanner exemption was applied.
- Unit tests: 87 passed, 1 historical retired-endpoint skip. Seventeen backup/history
  tests use actual PostgreSQL via development-only PGlite, including precision,
  encryption, FK ordering, stale proofs, schema drift, trigger suppression,
  unchanged operational state and rollback after constraint failure. The pinned
  Postgres.js serializers are exercised at the PGlite parameter boundary to
  catch double encoding; this is not a networked PostgreSQL driver integration.
  History tests also cover daily skips, deletion detection, pagination, private
  grants, encrypted storage/normalization and signed worker expiry/denial.
- All 21 Developer browser tests passed, including history download/preview,
  deduplication, pagination, confirmation gates and 390/768/1366px layouts.
  The full browser suite passed: 107 tests, 18 historical retired-form skips.
- Changed-file ESLint: 0 errors/warnings. Full repository: existing 24 errors
  and 5 warnings elsewhere. Existing Vite chunk-size and runner color warnings
  remain. PGlite and the Node test driver are development-only dependencies;
  the Edge runtime imports its own pinned Postgres.js version.
- Actual owner backup download/restore and another signed-in account's live
  403 are pending user testing. Browser backends are mocked; PGlite verifies
  SQL on local synthetic data, not production data. The daily job is live;
  the scheduled future wall-clock invocation has not yet been observed, while
  the exact dispatcher path has been exercised successfully.

References: [Supabase Auth TOTP](https://supabase.com/docs/guides/auth/auth-mfa/totp),
[verified JWT claims](https://supabase.com/docs/reference/javascript/auth-getclaims),
[Edge PostgreSQL connections](https://supabase.com/docs/guides/functions/connect-to-postgres),
[server secrets](https://supabase.com/docs/guides/functions/secrets),
[Postgres.js transactions](https://github.com/porsager/postgres),
and [PGlite](https://pglite.dev/docs/).
