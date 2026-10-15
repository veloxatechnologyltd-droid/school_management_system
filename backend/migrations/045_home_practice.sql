-- Home practice on a guardian's account. The headteacher's setting decides whether a school offers it (off by default,
-- versioned, separate from sharing progress). A session is a short run of questions from an approved set, on one topic
-- at one level, answered by a child on a verified guardian's phone. The questions given and every answer are kept;
-- the level the child moves to is decided when the session completes and is stored with it, so the rules in force
-- at the time stay visible. Home practice is evidence for staff and is never part of continuous assessment or reports.
CREATE TABLE home_practice_settings (
  school_id uuid PRIMARY KEY REFERENCES schools(id), enabled boolean NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version>0), updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(school_id,updated_by) REFERENCES memberships(school_id,id)
);
CREATE INDEX home_practice_settings_updated_by ON home_practice_settings(school_id,updated_by);

CREATE TABLE practice_sessions (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, learner_id uuid NOT NULL, indicator_id uuid NOT NULL, set_id uuid NOT NULL,
  guardian_membership_id uuid NOT NULL, level smallint NOT NULL CHECK(level BETWEEN 1 AND 3),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz, correct smallint CHECK(correct IS NULL OR correct BETWEEN 0 AND 5),
  outcome text CHECK(outcome IS NULL OR outcome IN ('up','stay','down','done')), level_after smallint CHECK(level_after IS NULL OR level_after BETWEEN 1 AND 3),
  UNIQUE(school_id,id),
  FOREIGN KEY(school_id,learner_id) REFERENCES learners(school_id,id), FOREIGN KEY(school_id,indicator_id) REFERENCES curriculum_indicators(school_id,id),
  FOREIGN KEY(school_id,set_id) REFERENCES practice_sets(school_id,id), FOREIGN KEY(school_id,guardian_membership_id) REFERENCES memberships(school_id,id),
  CHECK((completed_at IS NULL AND correct IS NULL AND outcome IS NULL AND level_after IS NULL) OR (completed_at IS NOT NULL AND correct IS NOT NULL AND outcome IS NOT NULL AND level_after IS NOT NULL))
);
CREATE INDEX practice_sessions_learner ON practice_sessions(school_id,learner_id,indicator_id,started_at DESC);
CREATE INDEX practice_sessions_indicator ON practice_sessions(school_id,indicator_id);
CREATE INDEX practice_sessions_set ON practice_sessions(school_id,set_id);
CREATE INDEX practice_sessions_guardian ON practice_sessions(school_id,guardian_membership_id);
-- A child has at most one unfinished session per topic: starting again resumes it.
CREATE UNIQUE INDEX practice_sessions_open ON practice_sessions(school_id,learner_id,indicator_id) WHERE completed_at IS NULL;

CREATE TABLE practice_session_items (
  school_id uuid NOT NULL, session_id uuid NOT NULL, position smallint NOT NULL CHECK(position BETWEEN 1 AND 5), question_id uuid NOT NULL,
  given text CHECK(given IS NULL OR length(given)<=40), correct boolean, answered_at timestamptz,
  PRIMARY KEY(school_id,session_id,position), UNIQUE(school_id,session_id,question_id),
  FOREIGN KEY(school_id,session_id) REFERENCES practice_sessions(school_id,id), FOREIGN KEY(school_id,question_id) REFERENCES practice_questions(school_id,id),
  CHECK((answered_at IS NULL AND given IS NULL AND correct IS NULL) OR (answered_at IS NOT NULL AND given IS NOT NULL AND correct IS NOT NULL))
);
CREATE INDEX practice_session_items_question ON practice_session_items(school_id,question_id);

-- A session completes once; an answer is recorded once. Nothing else changes and nothing is deleted.
CREATE FUNCTION preserve_practice_session() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Practice sessions are kept' USING ERRCODE='23514'; END IF;
  IF OLD.completed_at IS NOT NULL OR NEW.completed_at IS NULL
    OR (NEW.id,NEW.school_id,NEW.learner_id,NEW.indicator_id,NEW.set_id,NEW.guardian_membership_id,NEW.level,NEW.started_at)
      IS DISTINCT FROM (OLD.id,OLD.school_id,OLD.learner_id,OLD.indicator_id,OLD.set_id,OLD.guardian_membership_id,OLD.level,OLD.started_at) THEN
    RAISE EXCEPTION 'A practice session can only be completed, once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER practice_sessions_preserved BEFORE UPDATE OR DELETE ON practice_sessions FOR EACH ROW EXECUTE FUNCTION preserve_practice_session();
CREATE FUNCTION preserve_practice_item() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Practice answers are kept' USING ERRCODE='23514'; END IF;
  IF OLD.answered_at IS NOT NULL OR NEW.answered_at IS NULL
    OR (NEW.school_id,NEW.session_id,NEW.position,NEW.question_id) IS DISTINCT FROM (OLD.school_id,OLD.session_id,OLD.position,OLD.question_id) THEN
    RAISE EXCEPTION 'A practice answer can only be recorded once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER practice_session_items_preserved BEFORE UPDATE OR DELETE ON practice_session_items FOR EACH ROW EXECUTE FUNCTION preserve_practice_item();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['home_practice_settings','practice_sessions','practice_session_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format($p$CREATE POLICY %I ON %I USING(school_id::text=current_setting('app.school_id',true)) WITH CHECK(school_id::text=current_setting('app.school_id',true))$p$,t||'_school_context',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT ON home_practice_settings,practice_sessions,practice_session_items TO school_app;
GRANT UPDATE(enabled,version,updated_by,updated_at) ON home_practice_settings TO school_app;
GRANT UPDATE(completed_at,correct,outcome,level_after) ON practice_sessions TO school_app;
GRANT UPDATE(given,correct,answered_at) ON practice_session_items TO school_app;
