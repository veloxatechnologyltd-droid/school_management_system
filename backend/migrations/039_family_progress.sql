-- Families' view of progress. Published term results are always visible to verified academic guardians; weekly class
-- assessment progress and home-help notes are shared only once the headteacher turns sharing on (off by default,
-- since these are not published records). A support plan may carry a note written for the family, kept apart from
-- the staff's own concern and action (which may name other learners in a group plan).
CREATE TABLE progress_sharing (
  school_id uuid PRIMARY KEY REFERENCES schools(id), share_with_families boolean NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version>0), updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(school_id,updated_by) REFERENCES memberships(school_id,id)
);
CREATE INDEX progress_sharing_updated_by ON progress_sharing(school_id,updated_by);
ALTER TABLE progress_sharing ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_sharing FORCE ROW LEVEL SECURITY;
CREATE POLICY progress_sharing_school_context ON progress_sharing USING(school_id::text=current_setting('app.school_id',true)) WITH CHECK(school_id::text=current_setting('app.school_id',true));
GRANT SELECT,INSERT ON progress_sharing TO school_app;
GRANT UPDATE(share_with_families,version,updated_by,updated_at) ON progress_sharing TO school_app;
ALTER TABLE support_plans ADD COLUMN family_note text CHECK(family_note IS NULL OR length(btrim(family_note)) BETWEEN 3 AND 500);
