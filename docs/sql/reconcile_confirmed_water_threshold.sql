-- One-time DATA REPAIR, not a migration or a new legacy Apply algorithm.
-- First verify the owner's accepted value, single owned tank and both complete
-- row fingerprints. Replace the two placeholders with that audited snapshot.
-- Stops on concurrent changes, ambiguous tank ownership or other differences.
BEGIN;
SELECT set_config('craythrive.reconcile_legacy_fingerprint','VERIFIED_LEGACY_FINGERPRINT',true);
SELECT set_config('craythrive.reconcile_override_fingerprint','VERIFIED_OVERRIDE_FINGERPRINT',true);
DO $$
DECLARE legacy public.threshold_settings; canonical public.tank_threshold_settings;
 expected_legacy text=current_setting('craythrive.reconcile_legacy_fingerprint');
 expected_override text=current_setting('craythrive.reconcile_override_fingerprint');
 only_tank uuid; tank_count integer; before_logs bigint; accepted numeric;
BEGIN
 IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Administrative reconciliation only; do not fabricate a user Apply'; END IF;
 IF expected_legacy !~ '^[0-9a-f]{32}$' OR expected_override !~ '^[0-9a-f]{32}$' THEN
  RAISE EXCEPTION 'Verified complete-row fingerprints required';
 END IF;
 SELECT * INTO STRICT legacy FROM public.threshold_settings WHERE md5(to_jsonb(threshold_settings)::text)=expected_legacy;
 PERFORM pg_advisory_xact_lock(hashtextextended('craythrive:thresholds:'||legacy.user_id::text,0));
 SELECT * INTO STRICT legacy FROM public.threshold_settings WHERE user_id=legacy.user_id AND md5(to_jsonb(threshold_settings)::text)=expected_legacy FOR UPDATE;
 PERFORM 1 FROM public.tanks WHERE user_id=legacy.user_id ORDER BY id FOR UPDATE;
 SELECT count(*) INTO tank_count FROM public.tanks WHERE user_id=legacy.user_id;
 IF tank_count<>1 THEN RAISE EXCEPTION 'A single verified owned tank is required'; END IF;
 SELECT id INTO STRICT only_tank FROM public.tanks WHERE user_id=legacy.user_id;
 SELECT * INTO STRICT canonical FROM public.tank_threshold_settings
  WHERE user_id=legacy.user_id AND tank_id=only_tank
    AND md5(to_jsonb(tank_threshold_settings)::text)=expected_override FOR UPDATE;
 IF (public.craythrive_threshold_values(to_jsonb(legacy))-'waterLevelMin')
  IS DISTINCT FROM (public.craythrive_threshold_values(to_jsonb(canonical))-'waterLevelMin') THEN
  RAISE EXCEPTION 'Unrelated threshold differences require separate review';
 END IF;
 accepted=(public.craythrive_threshold_values(to_jsonb(legacy))->>'waterLevelMin')::numeric;
 IF accepted IS DISTINCT FROM 3.5 OR legacy.water_level_min IS DISTINCT FROM accepted
  OR (legacy.thresholds->>'waterLevelMin')::numeric IS DISTINCT FROM accepted
  OR legacy.updated_at<=canonical.updated_at THEN
  RAISE EXCEPTION 'Accepted 3.5 cm value and newer legacy evidence required';
 END IF;
 SELECT count(*) INTO before_logs FROM public.control_logs WHERE user_id=legacy.user_id AND action_type='threshold_updated';
 UPDATE public.tank_threshold_settings SET thresholds=jsonb_set(thresholds,'{waterLevelMin}',to_jsonb(accepted)),
  water_level_min=accepted,updated_at=now() WHERE id=canonical.id;
 IF (SELECT count(*) FROM public.control_logs WHERE user_id=legacy.user_id AND action_type='threshold_updated')<>before_logs THEN
  RAISE EXCEPTION 'Reconciliation must not generate threshold activity';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.threshold_settings s WHERE s.id=legacy.id AND md5(to_jsonb(s)::text)=expected_legacy) THEN
  RAISE EXCEPTION 'Legacy data must remain untouched';
 END IF;
 RAISE NOTICE 'One confirmed tank water minimum reconciled to 3.5 cm; no activity created';
END $$;
COMMIT;
