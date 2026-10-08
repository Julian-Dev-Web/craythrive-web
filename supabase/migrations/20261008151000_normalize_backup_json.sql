-- Normalize early archives double-encoded by the PostgreSQL JSON serializer.
-- Ciphertext, archive timestamps, fingerprints and application rows stay intact.
begin;
update craythrive_private.backups
set payload = (payload #>> '{}')::jsonb
where jsonb_typeof(payload) = 'string'
  and ((payload #>> '{}')::jsonb ->> 'format') = 'craythrive-backup'
  and ((payload #>> '{}')::jsonb ->> 'version') = '1'
  and jsonb_typeof((payload #>> '{}')::jsonb -> 'ciphertext') = 'string'
  and jsonb_typeof((payload #>> '{}')::jsonb -> 'iv') = 'string';

update craythrive_private.backups
set summary = (summary #>> '{}')::jsonb
where jsonb_typeof(summary) = 'string'
  and jsonb_typeof((summary #>> '{}')::jsonb -> 'tables') = 'array';
commit;
