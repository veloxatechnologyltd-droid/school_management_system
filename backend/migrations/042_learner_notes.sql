-- Notes on a learner from the headteacher, teachers and the learner's verified guardians. Notes are kept as written:
-- the author (or the headteacher) can withdraw one with a reason, and it stays in the history. A staff note reaches the
-- family only when the author shares it; a guardian's note is always seen by the school.
CREATE TABLE learner_notes (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, learner_id uuid NOT NULL,
  author_membership_id uuid NOT NULL, author_role text NOT NULL CHECK(author_role IN ('headteacher','teacher','guardian')),
  author_name text NOT NULL CHECK(length(btrim(author_name)) BETWEEN 1 AND 120),
  category text NOT NULL CHECK(category IN ('general','classwork','behaviour','attendance','health','home')),
  body text NOT NULL CHECK(length(btrim(body)) BETWEEN 3 AND 2000),
  shared_with_family boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(school_id,id),
  CHECK(author_role<>'guardian' OR shared_with_family),
  FOREIGN KEY(school_id,learner_id) REFERENCES learners(school_id,id), FOREIGN KEY(school_id,author_membership_id) REFERENCES memberships(school_id,id)
);
CREATE INDEX learner_notes_learner ON learner_notes(school_id,learner_id,created_at DESC);
CREATE INDEX learner_notes_author ON learner_notes(school_id,author_membership_id);
CREATE TABLE learner_note_withdrawals (
  note_id uuid PRIMARY KEY, school_id uuid NOT NULL, withdrawn_by uuid NOT NULL,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 300), withdrawn_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(school_id,note_id) REFERENCES learner_notes(school_id,id), FOREIGN KEY(school_id,withdrawn_by) REFERENCES memberships(school_id,id)
);
CREATE INDEX learner_note_withdrawals_by ON learner_note_withdrawals(school_id,withdrawn_by);
CREATE TRIGGER learner_notes_append_only BEFORE UPDATE OR DELETE ON learner_notes FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
CREATE TRIGGER learner_note_withdrawals_append_only BEFORE UPDATE OR DELETE ON learner_note_withdrawals FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['learner_notes','learner_note_withdrawals'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format($p$CREATE POLICY %I ON %I USING(school_id::text=current_setting('app.school_id',true)) WITH CHECK(school_id::text=current_setting('app.school_id',true))$p$,t||'_school_context',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT ON learner_notes,learner_note_withdrawals TO school_app;
