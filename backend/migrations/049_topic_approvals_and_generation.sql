-- Home Learning Pass, slice 1: the teacher approves a term's topics once, and Claude makes the lessons and practice questions from them.
-- Approval of the topic list is the only human approval. Safeguards stand in for per-item approval: automatic checks before anything is
-- stored, a report from a parent that stops a question at once, a teacher's power to retire any item, and an audit by the platform team.
-- Everything is kept: items are retired (once, with who and why), never changed or deleted.

-- A teacher or the headteacher approves one curriculum indicator for one class level in one term. The class level is the indicator's own
-- grade, or the one the approver chose when the indicator names none. Retiring an approval stops more being made; what exists is kept.
CREATE TABLE topic_approvals (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, term_id uuid NOT NULL, indicator_id uuid NOT NULL,
  grade text NOT NULL CHECK(length(btrim(grade)) BETWEEN 1 AND 40),
  approved_by uuid NOT NULL, approved_by_name text NOT NULL CHECK(length(btrim(approved_by_name)) BETWEEN 1 AND 160),
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  retired_at timestamptz, retired_by uuid, retirement_reason text,
  UNIQUE(school_id,id),
  FOREIGN KEY(school_id,term_id) REFERENCES terms(school_id,id), FOREIGN KEY(school_id,indicator_id) REFERENCES curriculum_indicators(school_id,id),
  FOREIGN KEY(school_id,approved_by) REFERENCES memberships(school_id,id), FOREIGN KEY(school_id,retired_by) REFERENCES memberships(school_id,id),
  CHECK((retired_at IS NULL AND retired_by IS NULL AND retirement_reason IS NULL) OR (retired_at IS NOT NULL AND retired_by IS NOT NULL AND length(btrim(retirement_reason))>=3))
);
CREATE UNIQUE INDEX topic_approvals_current ON topic_approvals(school_id,term_id,indicator_id,lower(grade)) WHERE retired_at IS NULL;
CREATE INDEX topic_approvals_indicator ON topic_approvals(school_id,indicator_id,lower(grade)) WHERE retired_at IS NULL;
CREATE INDEX topic_approvals_term ON topic_approvals(school_id,term_id);
CREATE INDEX topic_approvals_approved_by ON topic_approvals(school_id,approved_by);
CREATE INDEX topic_approvals_retired_by ON topic_approvals(school_id,retired_by);
CREATE FUNCTION preserve_topic_approval() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Topic approvals are kept; retire one instead' USING ERRCODE='23514'; END IF;
  IF OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL
    OR (NEW.id,NEW.school_id,NEW.term_id,NEW.indicator_id,NEW.grade,NEW.approved_by,NEW.approved_by_name,NEW.approved_at)
      IS DISTINCT FROM (OLD.id,OLD.school_id,OLD.term_id,OLD.indicator_id,OLD.grade,OLD.approved_by,OLD.approved_by_name,OLD.approved_at) THEN
    RAISE EXCEPTION 'A topic approval can only be retired, once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER topic_approvals_preserved BEFORE UPDATE OR DELETE ON topic_approvals FOR EACH ROW EXECUTE FUNCTION preserve_topic_approval();

-- Claude never leaves the approved topics, and that is a rule of the database: generated content (a set of questions, a question added
-- to one, or a lesson) can only be stored while an approval for that indicator and class level is current.
CREATE FUNCTION topic_is_approved(p_school uuid,p_indicator uuid,p_grade text) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
  SELECT EXISTS (SELECT 1 FROM topic_approvals a WHERE a.school_id=p_school AND a.indicator_id=p_indicator AND lower(a.grade)=lower(p_grade) AND a.retired_at IS NULL)
$$;

-- Generated questions live beside the teacher's sets: a set with source 'generated' has no per-set approver (the topic's approval stands
-- for it), names the class level it was written for, and belongs to the run that first made it. A topic has one current generated set per
-- class level, next to at most one current set a teacher wrote.
ALTER TABLE practice_sets ADD COLUMN grade text CHECK(grade IS NULL OR length(btrim(grade)) BETWEEN 1 AND 40);
ALTER TABLE practice_sets ALTER COLUMN approved_by DROP NOT NULL, ALTER COLUMN approved_by_name DROP NOT NULL;
ALTER TABLE practice_sets DROP CONSTRAINT practice_sets_source_check, DROP CONSTRAINT practice_sets_check;
ALTER TABLE practice_sets ADD CONSTRAINT practice_sets_source_check CHECK(source IN ('ai','teacher','generated'));
ALTER TABLE practice_sets ADD CONSTRAINT practice_sets_provenance CHECK(
  (source='ai' AND ai_run_id IS NOT NULL AND approved_by IS NOT NULL AND approved_by_name IS NOT NULL AND grade IS NULL)
  OR (source='teacher' AND ai_run_id IS NULL AND approved_by IS NOT NULL AND approved_by_name IS NOT NULL AND grade IS NULL)
  OR (source='generated' AND ai_run_id IS NOT NULL AND approved_by IS NULL AND approved_by_name IS NULL AND grade IS NOT NULL));
DROP INDEX practice_sets_current;
CREATE UNIQUE INDEX practice_sets_current ON practice_sets(school_id,indicator_id) WHERE retired_at IS NULL AND source<>'generated';
CREATE UNIQUE INDEX practice_sets_current_generated ON practice_sets(school_id,indicator_id,lower(grade)) WHERE retired_at IS NULL AND source='generated';
CREATE OR REPLACE FUNCTION preserve_practice_set() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Practice question sets are kept; retire one instead' USING ERRCODE='23514'; END IF;
  IF OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL
    OR (NEW.id,NEW.school_id,NEW.indicator_id,NEW.source,NEW.ai_run_id,NEW.approved_by,NEW.approved_by_name,NEW.approved_at,NEW.grade)
      IS DISTINCT FROM (OLD.id,OLD.school_id,OLD.indicator_id,OLD.source,OLD.ai_run_id,OLD.approved_by,OLD.approved_by_name,OLD.approved_at,OLD.grade) THEN
    RAISE EXCEPTION 'A practice question set can only be retired, once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION require_approved_topic_for_set() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.source='generated' AND NOT topic_is_approved(NEW.school_id,NEW.indicator_id,NEW.grade) THEN
    RAISE EXCEPTION 'Generated content needs an approved topic for this indicator and class' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER practice_sets_need_approved_topic BEFORE INSERT ON practice_sets FOR EACH ROW EXECUTE FUNCTION require_approved_topic_for_set();

-- A question is never reworded. It can be retired once (by a teacher, by a parent's report, or by the automatic checks), with a reason;
-- a teacher's name is kept, but a parent's report and the checks record no person on the question itself (the report row keeps the parent, for the
-- one-report-per-person rule and the audit trail, and is never shown to staff);
-- a retired question is no longer given to a child, and a child already in a session finishes the questions already given.
ALTER TABLE practice_questions DROP CONSTRAINT practice_questions_position_check;
ALTER TABLE practice_questions ADD CONSTRAINT practice_questions_position_check CHECK(position BETWEEN 1 AND 100);
ALTER TABLE practice_questions ADD COLUMN ai_run_id uuid, ADD COLUMN retired_at timestamptz, ADD COLUMN retired_by uuid,
  ADD COLUMN retired_cause text CHECK(retired_cause IS NULL OR retired_cause IN ('teacher','flag','check')), ADD COLUMN retirement_reason text;
ALTER TABLE practice_questions ADD FOREIGN KEY(school_id,ai_run_id) REFERENCES ai_runs(school_id,id), ADD FOREIGN KEY(school_id,retired_by) REFERENCES memberships(school_id,id);
ALTER TABLE practice_questions ADD CONSTRAINT practice_questions_retirement CHECK(
  (retired_at IS NULL AND retired_by IS NULL AND retired_cause IS NULL AND retirement_reason IS NULL)
  OR (retired_at IS NOT NULL AND retired_cause IS NOT NULL AND length(btrim(retirement_reason))>=3 AND (retired_by IS NOT NULL OR retired_cause IN ('check','flag'))));
CREATE INDEX practice_questions_ai_run ON practice_questions(school_id,ai_run_id) WHERE ai_run_id IS NOT NULL;
CREATE INDEX practice_questions_retired_by ON practice_questions(school_id,retired_by) WHERE retired_by IS NOT NULL;
DROP TRIGGER practice_questions_append_only ON practice_questions;
CREATE FUNCTION preserve_practice_question() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'practice_questions is append-only: questions are kept; retire one instead' USING ERRCODE='23514'; END IF;
  IF OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL
    OR (NEW.id,NEW.school_id,NEW.set_id,NEW.level,NEW.position,NEW.kind,NEW.prompt,NEW.options,NEW.correct_option,NEW.answer_number,NEW.explanation,NEW.ai_run_id)
      IS DISTINCT FROM (OLD.id,OLD.school_id,OLD.set_id,OLD.level,OLD.position,OLD.kind,OLD.prompt,OLD.options,OLD.correct_option,OLD.answer_number,OLD.explanation,OLD.ai_run_id) THEN
    RAISE EXCEPTION 'practice_questions is append-only: a question can only be retired, once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER practice_questions_preserved BEFORE UPDATE OR DELETE ON practice_questions FOR EACH ROW EXECUTE FUNCTION preserve_practice_question();
CREATE FUNCTION require_approved_topic_for_question() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE s record;
BEGIN
  SELECT source,indicator_id,grade INTO s FROM practice_sets WHERE school_id=NEW.school_id AND id=NEW.set_id;
  IF s.source='generated' AND NOT topic_is_approved(NEW.school_id,s.indicator_id,s.grade) THEN
    RAISE EXCEPTION 'Generated content needs an approved topic for this indicator and class' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER practice_questions_need_approved_topic BEFORE INSERT ON practice_questions FOR EACH ROW EXECUTE FUNCTION require_approved_topic_for_question();

-- A lesson for one topic and class level, written by Claude from the topic's wording. One lesson is current at a time; a teacher can retire it
-- and the next request makes a new one.
CREATE TABLE topic_lessons (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, indicator_id uuid NOT NULL,
  grade text NOT NULL CHECK(length(btrim(grade)) BETWEEN 1 AND 40),
  body jsonb NOT NULL CHECK(jsonb_typeof(body)='object'), ai_run_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  retired_at timestamptz, retired_by uuid, retired_cause text CHECK(retired_cause IS NULL OR retired_cause IN ('teacher','flag','check')), retirement_reason text,
  UNIQUE(school_id,id),
  FOREIGN KEY(school_id,indicator_id) REFERENCES curriculum_indicators(school_id,id), FOREIGN KEY(school_id,ai_run_id) REFERENCES ai_runs(school_id,id),
  FOREIGN KEY(school_id,retired_by) REFERENCES memberships(school_id,id),
  CHECK((retired_at IS NULL AND retired_by IS NULL AND retired_cause IS NULL AND retirement_reason IS NULL)
    OR (retired_at IS NOT NULL AND retired_cause IS NOT NULL AND length(btrim(retirement_reason))>=3 AND (retired_by IS NOT NULL OR retired_cause IN ('check','flag'))))
);
CREATE UNIQUE INDEX topic_lessons_current ON topic_lessons(school_id,indicator_id,lower(grade)) WHERE retired_at IS NULL;
CREATE INDEX topic_lessons_indicator ON topic_lessons(school_id,indicator_id,created_at);
CREATE INDEX topic_lessons_ai_run ON topic_lessons(school_id,ai_run_id);
CREATE INDEX topic_lessons_retired_by ON topic_lessons(school_id,retired_by) WHERE retired_by IS NOT NULL;
CREATE FUNCTION preserve_topic_lesson() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Lessons are kept; retire one instead' USING ERRCODE='23514'; END IF;
  IF OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL
    OR (NEW.id,NEW.school_id,NEW.indicator_id,NEW.grade,NEW.body,NEW.ai_run_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.school_id,OLD.indicator_id,OLD.grade,OLD.body,OLD.ai_run_id,OLD.created_at) THEN
    RAISE EXCEPTION 'A lesson can only be retired, once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER topic_lessons_preserved BEFORE UPDATE OR DELETE ON topic_lessons FOR EACH ROW EXECUTE FUNCTION preserve_topic_lesson();
CREATE FUNCTION require_approved_topic_for_lesson() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT topic_is_approved(NEW.school_id,NEW.indicator_id,NEW.grade) THEN
    RAISE EXCEPTION 'Generated content needs an approved topic for this indicator and class' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER topic_lessons_need_approved_topic BEFORE INSERT ON topic_lessons FOR EACH ROW EXECUTE FUNCTION require_approved_topic_for_lesson();

-- A parent's report that a question looks wrong. The question stops being given at once (retired in the same transaction); the report stays
-- for the school's staff, who see what was reported but never which parent reported it. One report per person and question.
CREATE TABLE content_flags (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, question_id uuid NOT NULL, raised_by uuid NOT NULL,
  reason text NOT NULL CHECK(reason IN ('wrong_answer','unclear','not_taught','other')),
  note text CHECK(note IS NULL OR length(btrim(note)) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  handled_at timestamptz, handled_by uuid, outcome text CHECK(outcome IS NULL OR outcome IN ('was_wrong','was_fine')),
  handled_note text CHECK(handled_note IS NULL OR length(btrim(handled_note)) BETWEEN 1 AND 300),
  UNIQUE(school_id,id), UNIQUE(school_id,question_id,raised_by),
  FOREIGN KEY(school_id,question_id) REFERENCES practice_questions(school_id,id),
  FOREIGN KEY(school_id,raised_by) REFERENCES memberships(school_id,id), FOREIGN KEY(school_id,handled_by) REFERENCES memberships(school_id,id),
  CHECK((handled_at IS NULL AND handled_by IS NULL AND outcome IS NULL AND handled_note IS NULL) OR (handled_at IS NOT NULL AND handled_by IS NOT NULL AND outcome IS NOT NULL))
);
CREATE INDEX content_flags_open ON content_flags(school_id,created_at) WHERE handled_at IS NULL;
CREATE INDEX content_flags_question ON content_flags(school_id,question_id);
CREATE INDEX content_flags_raised_by ON content_flags(school_id,raised_by);
CREATE INDEX content_flags_handled_by ON content_flags(school_id,handled_by) WHERE handled_by IS NOT NULL;
CREATE FUNCTION preserve_content_flag() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Reports are kept' USING ERRCODE='23514'; END IF;
  IF OLD.handled_at IS NOT NULL OR NEW.handled_at IS NULL
    OR (NEW.id,NEW.school_id,NEW.question_id,NEW.raised_by,NEW.reason,NEW.note,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.school_id,OLD.question_id,OLD.raised_by,OLD.reason,OLD.note,OLD.created_at) THEN
    RAISE EXCEPTION 'A report can only be handled, once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER content_flags_preserved BEFORE UPDATE OR DELETE ON content_flags FOR EACH ROW EXECUTE FUNCTION preserve_content_flag();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['topic_approvals','topic_lessons','content_flags'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format($p$CREATE POLICY %I ON %I USING(school_id::text=current_setting('app.school_id',true)) WITH CHECK(school_id::text=current_setting('app.school_id',true))$p$,t||'_school_context',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT ON topic_approvals,topic_lessons,content_flags TO school_app;
GRANT UPDATE(retired_at,retired_by,retirement_reason) ON topic_approvals TO school_app;
GRANT UPDATE(retired_at,retired_by,retired_cause,retirement_reason) ON topic_lessons,practice_questions TO school_app;
GRANT UPDATE(handled_at,handled_by,outcome,handled_note) ON content_flags TO school_app;
