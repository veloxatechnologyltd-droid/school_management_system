-- Home Learning Pass, slice 4: a teacher's learning note for one student: how to help ("use money examples", "short instructions"), optionally
-- naming a topic to put first on the student's list until a date. Notes stay within the school: the headteacher and the student's own teachers
-- read and write them, families never see them, and nothing here is sent to the AI. A note is kept as written; its author (or the headteacher)
-- withdraws it, once, with a reason, and it stays in the history. A separate table from the school's other notes (which have a health category and
-- can be shared with families) so the two cannot be mixed up.
CREATE TABLE learning_notes (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, learner_id uuid NOT NULL, indicator_id uuid,
  note text NOT NULL CHECK(length(btrim(note)) BETWEEN 5 AND 240),
  focus_until date,
  author_membership_id uuid NOT NULL, author_name text NOT NULL CHECK(length(btrim(author_name)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  withdrawn_at timestamptz, withdrawn_by uuid, withdrawal_reason text,
  UNIQUE(school_id,id),
  FOREIGN KEY(school_id,learner_id) REFERENCES learners(school_id,id), FOREIGN KEY(school_id,indicator_id) REFERENCES curriculum_indicators(school_id,id),
  FOREIGN KEY(school_id,author_membership_id) REFERENCES memberships(school_id,id), FOREIGN KEY(school_id,withdrawn_by) REFERENCES memberships(school_id,id),
  CHECK(focus_until IS NULL OR indicator_id IS NOT NULL),
  CHECK((withdrawn_at IS NULL AND withdrawn_by IS NULL AND withdrawal_reason IS NULL) OR (withdrawn_at IS NOT NULL AND withdrawn_by IS NOT NULL AND withdrawal_reason IS NOT NULL AND length(btrim(withdrawal_reason))>=3))
);
CREATE INDEX learning_notes_learner ON learning_notes(school_id,learner_id,created_at DESC);
CREATE INDEX learning_notes_indicator ON learning_notes(school_id,indicator_id) WHERE indicator_id IS NOT NULL;
CREATE INDEX learning_notes_author ON learning_notes(school_id,author_membership_id);
CREATE INDEX learning_notes_withdrawn_by ON learning_notes(school_id,withdrawn_by) WHERE withdrawn_by IS NOT NULL;
CREATE FUNCTION preserve_learning_note() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Learning notes are kept; withdraw one instead' USING ERRCODE='23514'; END IF;
  IF OLD.withdrawn_at IS NOT NULL OR NEW.withdrawn_at IS NULL
    OR (NEW.id,NEW.school_id,NEW.learner_id,NEW.indicator_id,NEW.note,NEW.focus_until,NEW.author_membership_id,NEW.author_name,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.school_id,OLD.learner_id,OLD.indicator_id,OLD.note,OLD.focus_until,OLD.author_membership_id,OLD.author_name,OLD.created_at) THEN
    RAISE EXCEPTION 'A learning note can only be withdrawn, once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER learning_notes_preserved BEFORE UPDATE OR DELETE ON learning_notes FOR EACH ROW EXECUTE FUNCTION preserve_learning_note();
-- A note is written now and live, whatever the caller supplies; only the withdrawal columns change later.
CREATE FUNCTION learning_note_starts_now() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN NEW.created_at:=clock_timestamp(); NEW.withdrawn_at:=NULL; NEW.withdrawn_by:=NULL; NEW.withdrawal_reason:=NULL; RETURN NEW; END $$;
CREATE TRIGGER learning_notes_start_now BEFORE INSERT ON learning_notes FOR EACH ROW EXECUTE FUNCTION learning_note_starts_now();
ALTER TABLE learning_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_notes_school_context ON learning_notes USING(school_id::text=current_setting('app.school_id',true)) WITH CHECK(school_id::text=current_setting('app.school_id',true));
GRANT SELECT,INSERT ON learning_notes TO school_app;
GRANT UPDATE(withdrawn_at,withdrawn_by,withdrawal_reason) ON learning_notes TO school_app;
