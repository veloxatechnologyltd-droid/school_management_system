-- Optional details about a student and about a staff member: one row each, every field optional, so a school records only what it
-- needs and what the family or the person agrees to share. Religion, blood group and health notes are sensitive personal data
-- under the Data Protection Act, 2012: none is ever required, the API shows religion, nationality and home address to the
-- headteacher only (teachers see health, emergency contact and previous school for the students in their class), and the audit
-- event for a change names the fields that changed, never their values.
CREATE TABLE learner_details (
  school_id uuid NOT NULL, learner_id uuid NOT NULL,
  nationality text CHECK(nationality IS NULL OR length(btrim(nationality)) BETWEEN 2 AND 60),
  religion text CHECK(religion IS NULL OR religion IN ('Christian','Muslim','Traditional','Other')),
  home_address text CHECK(home_address IS NULL OR length(btrim(home_address)) BETWEEN 3 AND 200),
  previous_school text CHECK(previous_school IS NULL OR length(btrim(previous_school)) BETWEEN 2 AND 120),
  blood_group text CHECK(blood_group IS NULL OR blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  health_notes text CHECK(health_notes IS NULL OR length(btrim(health_notes)) BETWEEN 3 AND 500),
  emergency_name text CHECK(emergency_name IS NULL OR length(btrim(emergency_name)) BETWEEN 2 AND 120),
  emergency_relationship text CHECK(emergency_relationship IS NULL OR length(btrim(emergency_relationship)) BETWEEN 2 AND 40),
  emergency_phone text CHECK(emergency_phone IS NULL OR emergency_phone ~ '^\+233[0-9]{9}$'),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(school_id,learner_id),
  FOREIGN KEY(school_id,learner_id) REFERENCES learners(school_id,id),
  CHECK(emergency_name IS NOT NULL OR (emergency_relationship IS NULL AND emergency_phone IS NULL))
);

CREATE TABLE staff_details (
  school_id uuid NOT NULL, membership_id uuid NOT NULL,
  staff_number text CHECK(staff_number IS NULL OR length(btrim(staff_number)) BETWEEN 1 AND 30),
  job_title text CHECK(job_title IS NULL OR length(btrim(job_title)) BETWEEN 2 AND 60),
  qualification text CHECK(qualification IS NULL OR length(btrim(qualification)) BETWEEN 2 AND 120),
  licence_number text CHECK(licence_number IS NULL OR length(btrim(licence_number)) BETWEEN 2 AND 40),
  date_joined date,
  employment_type text CHECK(employment_type IS NULL OR employment_type IN ('Full time','Part time','Contract','Volunteer')),
  subjects text CHECK(subjects IS NULL OR length(btrim(subjects)) BETWEEN 2 AND 200),
  home_address text CHECK(home_address IS NULL OR length(btrim(home_address)) BETWEEN 3 AND 200),
  emergency_name text CHECK(emergency_name IS NULL OR length(btrim(emergency_name)) BETWEEN 2 AND 120),
  emergency_relationship text CHECK(emergency_relationship IS NULL OR length(btrim(emergency_relationship)) BETWEEN 2 AND 40),
  emergency_phone text CHECK(emergency_phone IS NULL OR emergency_phone ~ '^\+233[0-9]{9}$'),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(school_id,membership_id),
  FOREIGN KEY(school_id,membership_id) REFERENCES memberships(school_id,id),
  CHECK(emergency_name IS NOT NULL OR (emergency_relationship IS NULL AND emergency_phone IS NULL))
);
-- A staff number identifies one person in a school (when the school uses them), whatever the letter case.
CREATE UNIQUE INDEX staff_details_number ON staff_details(school_id,lower(btrim(staff_number))) WHERE staff_number IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['learner_details','staff_details'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format($p$CREATE POLICY %I ON %I USING(school_id::text=current_setting('app.school_id',true)) WITH CHECK(school_id::text=current_setting('app.school_id',true))$p$,t||'_school_context',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT ON learner_details,staff_details TO school_app;
-- Who the row belongs to never changes; everything else is edited with a version check.
GRANT UPDATE(nationality,religion,home_address,previous_school,blood_group,health_notes,emergency_name,emergency_relationship,emergency_phone,version,updated_at) ON learner_details TO school_app;
GRANT UPDATE(staff_number,job_title,qualification,licence_number,date_joined,employment_type,subjects,home_address,emergency_name,emergency_relationship,emergency_phone,version,updated_at) ON staff_details TO school_app;
