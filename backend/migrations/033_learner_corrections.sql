-- Corrections to existing learner records from a CSV (found running the trial school: offices fix names, dates of birth
-- and sex in bulk from the class registers). A batch is staged and previewed, then applied once by the headteacher with
-- a reason; every changed field is kept as its own correction with the old and new value.
CREATE TABLE learner_update_batches (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, source_name text NOT NULL CHECK(length(btrim(source_name)) BETWEEN 1 AND 160),
  changes jsonb NOT NULL CHECK(jsonb_typeof(changes)='array'), issues jsonb NOT NULL CHECK(jsonb_typeof(issues)='array'),
  status text NOT NULL DEFAULT 'staged' CHECK(status IN ('staged','applied')), version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), approved_by uuid, approved_at timestamptz, approval_reason text,
  UNIQUE(school_id,id), FOREIGN KEY(school_id,created_by) REFERENCES memberships(school_id,id), FOREIGN KEY(school_id,approved_by) REFERENCES memberships(school_id,id),
  CHECK((status='staged' AND approved_by IS NULL AND approved_at IS NULL AND approval_reason IS NULL) OR
    (status='applied' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND length(btrim(approval_reason))>=3))
);
CREATE INDEX learner_update_batches_recent ON learner_update_batches(school_id,created_at DESC,id);
CREATE INDEX learner_update_batches_created_by ON learner_update_batches(school_id,created_by);
CREATE INDEX learner_update_batches_approved_by ON learner_update_batches(school_id,approved_by);
CREATE TABLE learner_corrections (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, learner_id uuid NOT NULL, batch_id uuid,
  field text NOT NULL CHECK(field IN ('full_name','date_of_birth','sex')), old_value text, new_value text NOT NULL,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500), recorded_by uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id), FOREIGN KEY(school_id,learner_id) REFERENCES learners(school_id,id), FOREIGN KEY(school_id,batch_id) REFERENCES learner_update_batches(school_id,id),
  FOREIGN KEY(school_id,recorded_by) REFERENCES memberships(school_id,id)
);
CREATE INDEX learner_corrections_learner ON learner_corrections(school_id,learner_id,recorded_at);
CREATE INDEX learner_corrections_batch ON learner_corrections(school_id,batch_id);
CREATE INDEX learner_corrections_recorded_by ON learner_corrections(school_id,recorded_by);
CREATE TRIGGER learner_corrections_append_only BEFORE UPDATE OR DELETE ON learner_corrections FOR EACH ROW EXECUTE FUNCTION forbid_history_change();

-- A staged batch keeps its source; the only change allowed is being applied once.
CREATE FUNCTION preserve_learner_update_batch() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD.status<>'staged' OR NEW.status<>'applied' OR ROW(NEW.id,NEW.school_id,NEW.source_name,NEW.changes,NEW.issues,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.school_id,OLD.source_name,OLD.changes,OLD.issues,OLD.created_by,OLD.created_at) THEN
    RAISE EXCEPTION 'A learner update batch is applied once and its source never changes' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION preserve_learner_update_batch() FROM PUBLIC;
CREATE TRIGGER learner_update_batch_immutable BEFORE UPDATE OR DELETE ON learner_update_batches FOR EACH ROW EXECUTE FUNCTION preserve_learner_update_batch();

-- A learner's name or date of birth changes only together with a correction recorded in the same transaction.
CREATE FUNCTION require_learner_correction() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.full_name IS DISTINCT FROM OLD.full_name AND NOT EXISTS (SELECT 1 FROM public.learner_corrections WHERE school_id=NEW.school_id AND learner_id=NEW.id
      AND field='full_name' AND new_value=NEW.full_name AND old_value IS NOT DISTINCT FROM OLD.full_name AND recorded_at=now())
    OR NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth AND NOT EXISTS (SELECT 1 FROM public.learner_corrections WHERE school_id=NEW.school_id AND learner_id=NEW.id
      AND field='date_of_birth' AND new_value=NEW.date_of_birth::text AND old_value IS NOT DISTINCT FROM OLD.date_of_birth::text AND recorded_at=now()) THEN
    RAISE EXCEPTION 'A learner name or date of birth changes only with a recorded correction' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION require_learner_correction() FROM PUBLIC;
CREATE TRIGGER learners_corrections_required BEFORE UPDATE ON learners FOR EACH ROW EXECUTE FUNCTION require_learner_correction();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['learner_update_batches','learner_corrections'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format($p$CREATE POLICY %I ON %I USING(school_id::text=current_setting('app.school_id',true)) WITH CHECK(school_id::text=current_setting('app.school_id',true))$p$,t||'_school_context',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT ON learner_update_batches,learner_corrections TO school_app;
GRANT UPDATE(status,version,approved_by,approved_at,approval_reason) ON learner_update_batches TO school_app;
GRANT UPDATE(full_name,date_of_birth) ON learners TO school_app;
