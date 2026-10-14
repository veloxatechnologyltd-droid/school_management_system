-- The school's own curriculum indicators per subject (codes, strands and wording as the school supplies them, with
-- their source), tagged on dated class assessments so a class's gaps show indicator by indicator. The platform ships
-- no curriculum text: official codes are recorded only as the school enters them, and local additions are marked.
CREATE TABLE curriculum_indicators (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, subject_id uuid NOT NULL,
  code text CHECK(code IS NULL OR length(btrim(code)) BETWEEN 1 AND 40),
  strand text CHECK(strand IS NULL OR length(btrim(strand)) BETWEEN 2 AND 120),
  sub_strand text CHECK(sub_strand IS NULL OR length(btrim(sub_strand)) BETWEEN 2 AND 120),
  description text NOT NULL CHECK(length(btrim(description)) BETWEEN 3 AND 400),
  origin text NOT NULL CHECK(origin IN ('official','local')),
  source_note text NOT NULL CHECK(length(btrim(source_note)) BETWEEN 3 AND 300),
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz, retired_by uuid, retirement_reason text,
  UNIQUE(school_id,id),
  FOREIGN KEY(school_id,subject_id) REFERENCES subjects(school_id,id), FOREIGN KEY(school_id,created_by) REFERENCES memberships(school_id,id),
  FOREIGN KEY(school_id,retired_by) REFERENCES memberships(school_id,id),
  CHECK((retired_at IS NULL AND retired_by IS NULL AND retirement_reason IS NULL) OR (retired_at IS NOT NULL AND retired_by IS NOT NULL AND length(btrim(retirement_reason))>=3))
);
-- One active indicator per code in a subject; a retired code may be entered again.
CREATE UNIQUE INDEX curriculum_indicators_active_code ON curriculum_indicators(school_id,subject_id,lower(code)) WHERE code IS NOT NULL AND retired_at IS NULL;
CREATE INDEX curriculum_indicators_subject ON curriculum_indicators(school_id,subject_id,code);
CREATE INDEX curriculum_indicators_created_by ON curriculum_indicators(school_id,created_by);
CREATE INDEX curriculum_indicators_retired_by ON curriculum_indicators(school_id,retired_by);
-- An indicator's wording never changes; the only change allowed is retiring it once, with a reason.
CREATE FUNCTION preserve_curriculum_indicator() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Curriculum indicators are kept; retire one instead' USING ERRCODE='23514'; END IF;
  IF OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL
    OR (NEW.id,NEW.school_id,NEW.subject_id,NEW.code,NEW.strand,NEW.sub_strand,NEW.description,NEW.origin,NEW.source_note,NEW.created_by,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.school_id,OLD.subject_id,OLD.code,OLD.strand,OLD.sub_strand,OLD.description,OLD.origin,OLD.source_note,OLD.created_by,OLD.created_at) THEN
    RAISE EXCEPTION 'A curriculum indicator can only be retired, once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER curriculum_indicators_preserved BEFORE UPDATE OR DELETE ON curriculum_indicators FOR EACH ROW EXECUTE FUNCTION preserve_curriculum_indicator();

CREATE TABLE class_assessment_indicators (
  school_id uuid NOT NULL, assessment_id uuid NOT NULL, indicator_id uuid NOT NULL, PRIMARY KEY(school_id,assessment_id,indicator_id),
  FOREIGN KEY(school_id,assessment_id) REFERENCES class_assessments(school_id,id), FOREIGN KEY(school_id,indicator_id) REFERENCES curriculum_indicators(school_id,id)
);
CREATE INDEX class_assessment_indicators_indicator ON class_assessment_indicators(school_id,indicator_id);
CREATE TRIGGER class_assessment_indicators_append_only BEFORE UPDATE OR DELETE ON class_assessment_indicators FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['curriculum_indicators','class_assessment_indicators'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format($p$CREATE POLICY %I ON %I USING(school_id::text=current_setting('app.school_id',true)) WITH CHECK(school_id::text=current_setting('app.school_id',true))$p$,t||'_school_context',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT ON curriculum_indicators,class_assessment_indicators TO school_app;
GRANT UPDATE(retired_at,retired_by,retirement_reason) ON curriculum_indicators TO school_app;
