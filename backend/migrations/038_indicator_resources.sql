-- Practice materials for a curriculum indicator, as the school uses them: a worksheet or link (e.g. a shared drive file),
-- textbook pages, or a class or home activity. The platform stores titles, references and links only, not the material.
-- Entries are kept; a wrong or outdated one is retired with a reason.
CREATE TABLE indicator_resources (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, indicator_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('worksheet','textbook','link','activity')),
  title text NOT NULL CHECK(length(btrim(title)) BETWEEN 3 AND 160),
  detail text CHECK(detail IS NULL OR length(btrim(detail)) BETWEEN 2 AND 500),
  url text CHECK(url IS NULL OR (url ~ '^https?://[^\s]+$' AND length(url)<=500)),
  for_families boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz, retired_by uuid, retirement_reason text,
  UNIQUE(school_id,id),
  FOREIGN KEY(school_id,indicator_id) REFERENCES curriculum_indicators(school_id,id),
  FOREIGN KEY(school_id,created_by) REFERENCES memberships(school_id,id), FOREIGN KEY(school_id,retired_by) REFERENCES memberships(school_id,id),
  CHECK(detail IS NOT NULL OR url IS NOT NULL),
  CHECK((retired_at IS NULL AND retired_by IS NULL AND retirement_reason IS NULL) OR (retired_at IS NOT NULL AND retired_by IS NOT NULL AND length(btrim(retirement_reason))>=3))
);
CREATE INDEX indicator_resources_indicator ON indicator_resources(school_id,indicator_id,created_at);
CREATE INDEX indicator_resources_created_by ON indicator_resources(school_id,created_by);
CREATE INDEX indicator_resources_retired_by ON indicator_resources(school_id,retired_by);
CREATE FUNCTION preserve_indicator_resource() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Practice materials are kept; retire one instead' USING ERRCODE='23514'; END IF;
  IF OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL
    OR (NEW.id,NEW.school_id,NEW.indicator_id,NEW.kind,NEW.title,NEW.detail,NEW.url,NEW.for_families,NEW.created_by,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.school_id,OLD.indicator_id,OLD.kind,OLD.title,OLD.detail,OLD.url,OLD.for_families,OLD.created_by,OLD.created_at) THEN
    RAISE EXCEPTION 'A practice material can only be retired, once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER indicator_resources_preserved BEFORE UPDATE OR DELETE ON indicator_resources FOR EACH ROW EXECUTE FUNCTION preserve_indicator_resource();
ALTER TABLE indicator_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE indicator_resources FORCE ROW LEVEL SECURITY;
CREATE POLICY indicator_resources_school_context ON indicator_resources USING(school_id::text=current_setting('app.school_id',true)) WITH CHECK(school_id::text=current_setting('app.school_id',true));
GRANT SELECT,INSERT ON indicator_resources TO school_app;
GRANT UPDATE(retired_at,retired_by,retirement_reason) ON indicator_resources TO school_app;
