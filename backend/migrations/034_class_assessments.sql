-- Dated class assessments (class exercises, homework, quizzes, class tests, projects) so progress can be followed
-- week by week within a term, not only through the term's single CA and exam scores. Marks are append-only: the
-- latest entry per learner is the current mark and earlier ones stay as history.
CREATE TABLE class_assessments (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, term_id uuid NOT NULL, class_id uuid NOT NULL, subject_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('classwork','homework','quiz','class_test','project')),
  title text NOT NULL CHECK(length(btrim(title)) BETWEEN 2 AND 120), held_on date NOT NULL,
  max_mark numeric(6,2) NOT NULL CHECK(max_mark>0 AND max_mark<=1000),
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,id),
  FOREIGN KEY(school_id,term_id) REFERENCES terms(school_id,id), FOREIGN KEY(school_id,class_id) REFERENCES class_sections(school_id,id),
  FOREIGN KEY(school_id,subject_id) REFERENCES subjects(school_id,id), FOREIGN KEY(school_id,created_by) REFERENCES memberships(school_id,id)
);
CREATE INDEX class_assessments_lookup ON class_assessments(school_id,class_id,term_id,subject_id,held_on);
CREATE INDEX class_assessments_term ON class_assessments(school_id,term_id);
CREATE INDEX class_assessments_subject ON class_assessments(school_id,subject_id);
CREATE INDEX class_assessments_created_by ON class_assessments(school_id,created_by);
CREATE TABLE class_assessment_marks (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, assessment_id uuid NOT NULL, learner_id uuid NOT NULL,
  mark numeric(6,2) NOT NULL CHECK(mark>=0), recorded_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(school_id,id),
  FOREIGN KEY(school_id,assessment_id) REFERENCES class_assessments(school_id,id), FOREIGN KEY(school_id,learner_id) REFERENCES learners(school_id,id),
  FOREIGN KEY(school_id,recorded_by) REFERENCES memberships(school_id,id)
);
CREATE INDEX class_assessment_marks_latest ON class_assessment_marks(school_id,assessment_id,learner_id,created_at DESC);
CREATE INDEX class_assessment_marks_learner ON class_assessment_marks(school_id,learner_id);
CREATE INDEX class_assessment_marks_recorded_by ON class_assessment_marks(school_id,recorded_by);
-- A mark can never exceed the assessment's maximum, whatever the application sends.
CREATE FUNCTION check_class_assessment_mark() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.mark > (SELECT a.max_mark FROM class_assessments a WHERE a.school_id=NEW.school_id AND a.id=NEW.assessment_id) THEN
    RAISE EXCEPTION 'A mark cannot be more than the assessment''s maximum' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER class_assessment_marks_within_max BEFORE INSERT ON class_assessment_marks FOR EACH ROW EXECUTE FUNCTION check_class_assessment_mark();
CREATE TRIGGER class_assessments_append_only BEFORE UPDATE OR DELETE ON class_assessments FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
CREATE TRIGGER class_assessment_marks_append_only BEFORE UPDATE OR DELETE ON class_assessment_marks FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['class_assessments','class_assessment_marks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format($p$CREATE POLICY %I ON %I USING(school_id::text=current_setting('app.school_id',true)) WITH CHECK(school_id::text=current_setting('app.school_id',true))$p$,t||'_school_context',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT ON class_assessments,class_assessment_marks TO school_app;
