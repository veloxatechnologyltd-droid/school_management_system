-- Indicators can name the grade they belong to (e.g. "Basic 5"), so a subject loaded for several grades does not
-- show every grade's indicators when tagging a class's assessment. Optional: indicators without a grade suit every class.
ALTER TABLE curriculum_indicators ADD COLUMN grade text CHECK(grade IS NULL OR length(btrim(grade)) BETWEEN 1 AND 40);
CREATE OR REPLACE FUNCTION preserve_curriculum_indicator() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Curriculum indicators are kept; retire one instead' USING ERRCODE='23514'; END IF;
  IF OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL
    OR (NEW.id,NEW.school_id,NEW.subject_id,NEW.code,NEW.strand,NEW.sub_strand,NEW.description,NEW.origin,NEW.source_note,NEW.created_by,NEW.created_at,NEW.grade)
      IS DISTINCT FROM (OLD.id,OLD.school_id,OLD.subject_id,OLD.code,OLD.strand,OLD.sub_strand,OLD.description,OLD.origin,OLD.source_note,OLD.created_by,OLD.created_at,OLD.grade) THEN
    RAISE EXCEPTION 'A curriculum indicator can only be retired, once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
