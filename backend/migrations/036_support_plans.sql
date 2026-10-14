-- Support plans: when learners fall behind in a subject (or on one curriculum indicator), a named owner commits to an
-- action and a review date. Reviews record the outcome against marks before and since the plan began, then continue
-- with a new review date or close the plan. Plans, their learners and reviews are append-only history.
CREATE TABLE support_plans (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, class_id uuid NOT NULL, term_id uuid NOT NULL, subject_id uuid NOT NULL, indicator_id uuid,
  concern text NOT NULL CHECK(length(btrim(concern)) BETWEEN 3 AND 500), action text NOT NULL CHECK(length(btrim(action)) BETWEEN 3 AND 500),
  owner_membership_id uuid NOT NULL, owner_name text NOT NULL CHECK(length(btrim(owner_name)) BETWEEN 1 AND 160),
  start_date date NOT NULL, first_review_date date NOT NULL CHECK(first_review_date>start_date),
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,id),
  FOREIGN KEY(school_id,class_id) REFERENCES class_sections(school_id,id), FOREIGN KEY(school_id,term_id) REFERENCES terms(school_id,id),
  FOREIGN KEY(school_id,subject_id) REFERENCES subjects(school_id,id), FOREIGN KEY(school_id,indicator_id) REFERENCES curriculum_indicators(school_id,id),
  FOREIGN KEY(school_id,owner_membership_id) REFERENCES memberships(school_id,id), FOREIGN KEY(school_id,created_by) REFERENCES memberships(school_id,id)
);
CREATE INDEX support_plans_class ON support_plans(school_id,class_id,term_id);
CREATE INDEX support_plans_term ON support_plans(school_id,term_id);
CREATE INDEX support_plans_subject ON support_plans(school_id,subject_id);
CREATE INDEX support_plans_indicator ON support_plans(school_id,indicator_id);
CREATE INDEX support_plans_owner ON support_plans(school_id,owner_membership_id);
CREATE INDEX support_plans_created_by ON support_plans(school_id,created_by);
CREATE TABLE support_plan_learners (
  school_id uuid NOT NULL, plan_id uuid NOT NULL, learner_id uuid NOT NULL, PRIMARY KEY(school_id,plan_id,learner_id),
  FOREIGN KEY(school_id,plan_id) REFERENCES support_plans(school_id,id), FOREIGN KEY(school_id,learner_id) REFERENCES learners(school_id,id)
);
CREATE INDEX support_plan_learners_learner ON support_plan_learners(school_id,learner_id);
CREATE TABLE support_plan_reviews (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, plan_id uuid NOT NULL, reviewed_on date NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('improved','no_change','worse')), note text NOT NULL CHECK(length(btrim(note)) BETWEEN 3 AND 500),
  decision text NOT NULL CHECK(decision IN ('continue','close')), next_review_date date,
  evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'), recorded_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(school_id,id),
  FOREIGN KEY(school_id,plan_id) REFERENCES support_plans(school_id,id), FOREIGN KEY(school_id,recorded_by) REFERENCES memberships(school_id,id),
  CHECK((decision='continue' AND next_review_date>reviewed_on) OR (decision='close' AND next_review_date IS NULL))
);
CREATE INDEX support_plan_reviews_plan ON support_plan_reviews(school_id,plan_id,created_at);
CREATE INDEX support_plan_reviews_recorded_by ON support_plan_reviews(school_id,recorded_by);
CREATE UNIQUE INDEX support_plan_reviews_one_close ON support_plan_reviews(school_id,plan_id) WHERE decision='close';
-- A closed plan takes no further reviews.
CREATE FUNCTION support_plan_open() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM support_plan_reviews r WHERE r.school_id=NEW.school_id AND r.plan_id=NEW.plan_id AND r.decision='close') THEN
    RAISE EXCEPTION 'This support plan is closed' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER support_plan_reviews_open BEFORE INSERT ON support_plan_reviews FOR EACH ROW EXECUTE FUNCTION support_plan_open();
CREATE TRIGGER support_plans_append_only BEFORE UPDATE OR DELETE ON support_plans FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
CREATE TRIGGER support_plan_learners_append_only BEFORE UPDATE OR DELETE ON support_plan_learners FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
CREATE TRIGGER support_plan_reviews_append_only BEFORE UPDATE OR DELETE ON support_plan_reviews FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['support_plans','support_plan_learners','support_plan_reviews'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format($p$CREATE POLICY %I ON %I USING(school_id::text=current_setting('app.school_id',true)) WITH CHECK(school_id::text=current_setting('app.school_id',true))$p$,t||'_school_context',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT ON support_plans,support_plan_learners,support_plan_reviews TO school_app;
