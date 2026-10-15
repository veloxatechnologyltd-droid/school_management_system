-- Home-practice questions for a curriculum indicator. A set holds three levels (easy to harder) of multiple-choice or
-- short number questions that the platform can mark. A teacher or the headteacher reviews and approves a set; approving
-- keeps its wording for good (questions are never changed or deleted). A set is withdrawn by retiring it, once, with a
-- reason; approving a newer set for the same indicator retires the older one. Only one set per indicator is current.
CREATE TABLE practice_sets (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, indicator_id uuid NOT NULL,
  source text NOT NULL CHECK(source IN ('ai','teacher')), ai_run_id uuid,
  approved_by uuid NOT NULL, approved_by_name text NOT NULL CHECK(length(btrim(approved_by_name)) BETWEEN 1 AND 160), approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  retired_at timestamptz, retired_by uuid, retirement_reason text,
  UNIQUE(school_id,id),
  FOREIGN KEY(school_id,indicator_id) REFERENCES curriculum_indicators(school_id,id),
  FOREIGN KEY(school_id,approved_by) REFERENCES memberships(school_id,id), FOREIGN KEY(school_id,retired_by) REFERENCES memberships(school_id,id),
  FOREIGN KEY(school_id,ai_run_id) REFERENCES ai_runs(school_id,id),
  CHECK((source='ai' AND ai_run_id IS NOT NULL) OR (source='teacher' AND ai_run_id IS NULL)),
  CHECK((retired_at IS NULL AND retired_by IS NULL AND retirement_reason IS NULL) OR (retired_at IS NOT NULL AND retired_by IS NOT NULL AND length(btrim(retirement_reason))>=3))
);
CREATE INDEX practice_sets_indicator ON practice_sets(school_id,indicator_id,approved_at);
CREATE INDEX practice_sets_approved_by ON practice_sets(school_id,approved_by);
CREATE INDEX practice_sets_retired_by ON practice_sets(school_id,retired_by);
CREATE INDEX practice_sets_ai_run ON practice_sets(school_id,ai_run_id);
CREATE UNIQUE INDEX practice_sets_current ON practice_sets(school_id,indicator_id) WHERE retired_at IS NULL;

CREATE TABLE practice_questions (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, set_id uuid NOT NULL,
  level smallint NOT NULL CHECK(level BETWEEN 1 AND 3), position smallint NOT NULL CHECK(position BETWEEN 1 AND 8),
  kind text NOT NULL CHECK(kind IN ('choice','number')),
  prompt text NOT NULL CHECK(length(btrim(prompt)) BETWEEN 5 AND 200),
  options jsonb, correct_option smallint, answer_number numeric,
  explanation text CHECK(explanation IS NULL OR length(btrim(explanation)) BETWEEN 3 AND 200),
  UNIQUE(school_id,id), UNIQUE(school_id,set_id,level,position),
  FOREIGN KEY(school_id,set_id) REFERENCES practice_sets(school_id,id),
  CHECK((kind='choice' AND jsonb_typeof(options)='array' AND jsonb_array_length(options) BETWEEN 3 AND 4 AND correct_option BETWEEN 0 AND jsonb_array_length(options)-1 AND answer_number IS NULL)
    OR (kind='number' AND options IS NULL AND correct_option IS NULL AND answer_number IS NOT NULL AND answer_number<>'NaN' AND abs(answer_number)<=1000000000))
);

CREATE FUNCTION preserve_practice_set() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Practice question sets are kept; retire one instead' USING ERRCODE='23514'; END IF;
  IF OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL
    OR (NEW.id,NEW.school_id,NEW.indicator_id,NEW.source,NEW.ai_run_id,NEW.approved_by,NEW.approved_by_name,NEW.approved_at)
      IS DISTINCT FROM (OLD.id,OLD.school_id,OLD.indicator_id,OLD.source,OLD.ai_run_id,OLD.approved_by,OLD.approved_by_name,OLD.approved_at) THEN
    RAISE EXCEPTION 'A practice question set can only be retired, once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER practice_sets_preserved BEFORE UPDATE OR DELETE ON practice_sets FOR EACH ROW EXECUTE FUNCTION preserve_practice_set();
CREATE TRIGGER practice_questions_append_only BEFORE UPDATE OR DELETE ON practice_questions FOR EACH ROW EXECUTE FUNCTION forbid_history_change();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['practice_sets','practice_questions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format($p$CREATE POLICY %I ON %I USING(school_id::text=current_setting('app.school_id',true)) WITH CHECK(school_id::text=current_setting('app.school_id',true))$p$,t||'_school_context',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT ON practice_sets,practice_questions TO school_app;
GRANT UPDATE(retired_at,retired_by,retirement_reason) ON practice_sets TO school_app;
