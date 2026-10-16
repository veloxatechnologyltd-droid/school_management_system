-- Home Learning Pass, slice 3: Study. A child reads a topic's current lesson on a parent's phone, then answers a short check. A study session records
-- that the lesson was shown (which lesson, to which child, on whose phone) and when it was finished, so staff can see time on a topic beside class work and
-- a parent's report can name the lesson that was shown. It is evidence for staff and is never part of continuous assessment or reports.
-- A lesson belongs to one topic, so a study session can only name a lesson of its own topic.
ALTER TABLE topic_lessons ADD CONSTRAINT topic_lessons_id_indicator UNIQUE(school_id,id,indicator_id);
CREATE TABLE study_sessions (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, learner_id uuid NOT NULL, indicator_id uuid NOT NULL, lesson_id uuid NOT NULL, guardian_membership_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(), finished_at timestamptz,
  UNIQUE(school_id,id),
  FOREIGN KEY(school_id,learner_id) REFERENCES learners(school_id,id), FOREIGN KEY(school_id,indicator_id) REFERENCES curriculum_indicators(school_id,id),
  FOREIGN KEY(school_id,lesson_id,indicator_id) REFERENCES topic_lessons(school_id,id,indicator_id), FOREIGN KEY(school_id,guardian_membership_id) REFERENCES memberships(school_id,id),
  CHECK(finished_at IS NULL OR finished_at>=started_at)
);
CREATE INDEX study_sessions_learner ON study_sessions(school_id,learner_id,indicator_id,started_at DESC);
CREATE INDEX study_sessions_indicator ON study_sessions(school_id,indicator_id);
CREATE INDEX study_sessions_lesson ON study_sessions(school_id,lesson_id,indicator_id);
CREATE INDEX study_sessions_guardian ON study_sessions(school_id,guardian_membership_id);
-- A study session is finished once; nothing else about it changes and it is never deleted.
CREATE FUNCTION preserve_study_session() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Study sessions are kept' USING ERRCODE='23514'; END IF;
  IF OLD.finished_at IS NOT NULL OR NEW.finished_at IS NULL
    OR (NEW.id,NEW.school_id,NEW.learner_id,NEW.indicator_id,NEW.lesson_id,NEW.guardian_membership_id,NEW.started_at)
      IS DISTINCT FROM (OLD.id,OLD.school_id,OLD.learner_id,OLD.indicator_id,OLD.lesson_id,OLD.guardian_membership_id,OLD.started_at) THEN
    RAISE EXCEPTION 'A study session can only be finished, once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER study_sessions_preserved BEFORE UPDATE OR DELETE ON study_sessions FOR EACH ROW EXECUTE FUNCTION preserve_study_session();
-- Times are the database's own: a session starts now and unfinished, whatever the caller supplies.
CREATE FUNCTION study_session_starts_now() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN NEW.started_at:=clock_timestamp(); NEW.finished_at:=NULL; RETURN NEW; END $$;
CREATE TRIGGER study_sessions_start_now BEFORE INSERT ON study_sessions FOR EACH ROW EXECUTE FUNCTION study_session_starts_now();
ALTER TABLE study_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY study_sessions_school_context ON study_sessions USING(school_id::text=current_setting('app.school_id',true)) WITH CHECK(school_id::text=current_setting('app.school_id',true));
GRANT SELECT,INSERT ON study_sessions TO school_app;
GRANT UPDATE(finished_at) ON study_sessions TO school_app;

-- The check a child answers after studying is an ordinary practice session, tied to the study it followed. The tie is set when the session starts and never changes.
ALTER TABLE practice_sessions ADD COLUMN study_session_id uuid;
ALTER TABLE practice_sessions ADD FOREIGN KEY(school_id,study_session_id) REFERENCES study_sessions(school_id,id);
CREATE INDEX practice_sessions_study ON practice_sessions(school_id,study_session_id) WHERE study_session_id IS NOT NULL;
-- A check follows a study of the same child and the same topic, and a study has one check.
CREATE FUNCTION practice_session_tie_is_honest() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE st record;
BEGIN
  IF NEW.study_session_id IS NULL THEN RETURN NEW; END IF;
  SELECT learner_id,indicator_id,finished_at INTO st FROM study_sessions WHERE school_id=NEW.school_id AND id=NEW.study_session_id;
  IF st.learner_id IS DISTINCT FROM NEW.learner_id OR st.indicator_id IS DISTINCT FROM NEW.indicator_id THEN
    RAISE EXCEPTION 'A check must follow a study by the same child of the same topic' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM practice_sessions p WHERE p.school_id=NEW.school_id AND p.study_session_id=NEW.study_session_id) THEN
    RAISE EXCEPTION 'That study already has its check' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER practice_sessions_tie_honest BEFORE INSERT ON practice_sessions FOR EACH ROW EXECUTE FUNCTION practice_session_tie_is_honest();
CREATE OR REPLACE FUNCTION preserve_practice_session() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Practice sessions are kept' USING ERRCODE='23514'; END IF;
  IF OLD.completed_at IS NOT NULL OR NEW.completed_at IS NULL
    OR (NEW.id,NEW.school_id,NEW.learner_id,NEW.indicator_id,NEW.set_id,NEW.guardian_membership_id,NEW.level,NEW.started_at,NEW.study_session_id)
      IS DISTINCT FROM (OLD.id,OLD.school_id,OLD.learner_id,OLD.indicator_id,OLD.set_id,OLD.guardian_membership_id,OLD.level,OLD.started_at,OLD.study_session_id) THEN
    RAISE EXCEPTION 'A practice session can only be completed, once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

-- A parent's report can name a lesson as well as a question. A report names exactly one of them, and one parent reports a lesson once.
ALTER TABLE content_flags ALTER COLUMN question_id DROP NOT NULL;
ALTER TABLE content_flags ADD COLUMN lesson_id uuid;
ALTER TABLE content_flags ADD FOREIGN KEY(school_id,lesson_id) REFERENCES topic_lessons(school_id,id);
ALTER TABLE content_flags ADD CONSTRAINT content_flags_one_target CHECK((question_id IS NULL) <> (lesson_id IS NULL));
CREATE UNIQUE INDEX content_flags_lesson_person ON content_flags(school_id,lesson_id,raised_by) WHERE lesson_id IS NOT NULL;
CREATE INDEX content_flags_lesson ON content_flags(school_id,lesson_id) WHERE lesson_id IS NOT NULL;
CREATE OR REPLACE FUNCTION preserve_content_flag() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Reports are kept' USING ERRCODE='23514'; END IF;
  IF OLD.handled_at IS NOT NULL OR NEW.handled_at IS NULL
    OR (NEW.id,NEW.school_id,NEW.question_id,NEW.lesson_id,NEW.raised_by,NEW.reason,NEW.note,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.school_id,OLD.question_id,OLD.lesson_id,OLD.raised_by,OLD.reason,OLD.note,OLD.created_at) THEN
    RAISE EXCEPTION 'A report can only be handled, once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
