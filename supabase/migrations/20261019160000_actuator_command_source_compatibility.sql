-- Additive repair for Web/firmware command metadata during staged rollout.
-- Does not enqueue commands, alter safety locks, replace alert functions,
-- change schedules, or rewrite execution history. Safe to run once or again.
BEGIN;
ALTER TABLE public.device_commands ADD COLUMN IF NOT EXISTS command_source text;
NOTIFY pgrst, 'reload schema';
COMMIT;
