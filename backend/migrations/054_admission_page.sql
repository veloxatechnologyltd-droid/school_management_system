-- The parent or guardian named on an application, as the family gave it at the front desk. Optional, because
-- applications recorded before this change have none; kept as written (no edit), like the rest of the application.
ALTER TABLE admissions
  ADD COLUMN guardian_name text CHECK(guardian_name IS NULL OR length(btrim(guardian_name)) BETWEEN 2 AND 120),
  ADD COLUMN guardian_relationship text CHECK(guardian_relationship IS NULL OR length(btrim(guardian_relationship)) BETWEEN 2 AND 40),
  ADD COLUMN guardian_phone text CHECK(guardian_phone IS NULL OR guardian_phone ~ '^\+233[0-9]{9}$'),
  ADD CHECK(guardian_name IS NOT NULL OR (guardian_relationship IS NULL AND guardian_phone IS NULL));

-- Staff-only notes on an application (for example "Visited on Monday; bring last school's report").
-- Never shown to families. Append-only: a note is kept as written with who wrote it and when; nothing edits or removes it.
CREATE TABLE admission_notes (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, admission_id uuid NOT NULL,
  note text NOT NULL CHECK(length(btrim(note)) BETWEEN 3 AND 1000),
  author_membership_id uuid NOT NULL, author_name text NOT NULL CHECK(length(btrim(author_name)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(school_id,id),
  FOREIGN KEY(school_id,admission_id) REFERENCES admissions(school_id,id),
  FOREIGN KEY(school_id,author_membership_id) REFERENCES memberships(school_id,id)
);
CREATE INDEX admission_notes_admission ON admission_notes(school_id,admission_id,created_at DESC);
CREATE INDEX admission_notes_author ON admission_notes(school_id,author_membership_id);
CREATE FUNCTION preserve_admission_note() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'Admission notes are kept as written' USING ERRCODE='23514'; END $$;
CREATE TRIGGER admission_notes_preserved BEFORE UPDATE OR DELETE ON admission_notes FOR EACH ROW EXECUTE FUNCTION preserve_admission_note();
CREATE FUNCTION admission_note_starts_now() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN NEW.created_at:=clock_timestamp(); RETURN NEW; END $$;
CREATE TRIGGER admission_notes_start_now BEFORE INSERT ON admission_notes FOR EACH ROW EXECUTE FUNCTION admission_note_starts_now();
ALTER TABLE admission_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE admission_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY admission_notes_school_context ON admission_notes USING(school_id::text=current_setting('app.school_id',true)) WITH CHECK(school_id::text=current_setting('app.school_id',true));
GRANT SELECT,INSERT ON admission_notes TO school_app;

-- An application's page reads its decisions from the audit log by target.
CREATE INDEX audit_target ON audit_events(school_id,target_id,created_at);

-- Names of the staff who acted on one application, for its timeline. Memberships and users are row-secured and
-- staff_list() is for the headteacher only, so this narrow lookup lets the front desk see who made each decision too.
CREATE FUNCTION admission_actor_names(p_admission uuid) RETURNS TABLE(membership_id uuid,display_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE school uuid := nullif(current_setting('app.school_id',true),'')::uuid;
BEGIN
  IF school IS NULL OR NOT EXISTS (SELECT 1 FROM public.active_membership(school) a WHERE a.role IN ('headteacher','frontdesk')) THEN
    RAISE EXCEPTION 'Admissions staff required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT DISTINCT m.id,u.display_name FROM public.audit_events e
    JOIN public.memberships m ON m.school_id=e.school_id AND m.id=e.actor_membership_id
    JOIN public.users u ON u.id=m.user_id
    WHERE e.school_id=school AND e.target_id=p_admission AND e.action LIKE 'admission.%';
END $$;
REVOKE ALL ON FUNCTION admission_actor_names(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admission_actor_names(uuid) TO school_app;
