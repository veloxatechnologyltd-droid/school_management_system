-- Manual timetable with clash checks (PRODUCT P4; DOMAIN_RULES: draft → clash check → published version).
-- One timetable per term at a time is published; each version keeps its own bell schedule and lessons. A published
-- version never changes: it is copied into a new draft, and publishing that retires the old one, which stays as history.

-- Rooms that are not a class's own room (labs, art room, field). A lesson without a room is in the class's own room.
CREATE TABLE rooms (
  id uuid PRIMARY KEY, school_id uuid NOT NULL REFERENCES schools(id),
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 60), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id)
);
CREATE UNIQUE INDEX rooms_name ON rooms(school_id,lower(btrim(name)));

-- periods: the school bell for this version, in order, e.g. [{"starts":"07:30","ends":"08:30","kind":"lesson"},{"starts":"10:30","ends":"11:00","kind":"break","label":"Break"}].
CREATE TABLE timetables (
  id uuid PRIMARY KEY, school_id uuid NOT NULL REFERENCES schools(id), term_id uuid NOT NULL,
  version integer NOT NULL CHECK(version>0), status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','retired')),
  periods jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(periods)='array' AND jsonb_array_length(periods)<=16),
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz, published_by uuid, retired_at timestamptz,
  UNIQUE(school_id,id), UNIQUE(school_id,term_id,version),
  FOREIGN KEY(school_id,term_id) REFERENCES terms(school_id,id),
  FOREIGN KEY(school_id,created_by) REFERENCES memberships(school_id,id),
  FOREIGN KEY(school_id,published_by) REFERENCES memberships(school_id,id),
  CHECK((status='draft' AND published_at IS NULL AND published_by IS NULL AND retired_at IS NULL)
    OR (status='published' AND published_at IS NOT NULL AND published_by IS NOT NULL AND retired_at IS NULL)
    OR (status='retired' AND published_at IS NOT NULL AND published_by IS NOT NULL AND retired_at IS NOT NULL))
);
CREATE UNIQUE INDEX timetables_one_draft ON timetables(school_id,term_id) WHERE status='draft';
CREATE UNIQUE INDEX timetables_one_published ON timetables(school_id,term_id) WHERE status='published';
CREATE INDEX timetables_created_by ON timetables(school_id,created_by);
CREATE INDEX timetables_published_by ON timetables(school_id,published_by) WHERE published_by IS NOT NULL;

-- One row per class, weekday and period. A cleared cell keeps its row with nothing in it (no deletes).
-- Clashes are refused here as well as in the service: a teacher or a room in two places in one period.
CREATE TABLE timetable_lessons (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, timetable_id uuid NOT NULL, class_id uuid NOT NULL,
  weekday smallint NOT NULL CHECK(weekday BETWEEN 1 AND 5), period smallint NOT NULL CHECK(period BETWEEN 1 AND 16),
  subject_id uuid, label text CHECK(label IS NULL OR length(btrim(label)) BETWEEN 2 AND 40),
  teacher_membership_id uuid, teacher_name text, room_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_id,id), UNIQUE(timetable_id,class_id,weekday,period),
  FOREIGN KEY(school_id,timetable_id) REFERENCES timetables(school_id,id),
  FOREIGN KEY(school_id,class_id) REFERENCES class_sections(school_id,id),
  FOREIGN KEY(school_id,subject_id) REFERENCES subjects(school_id,id),
  FOREIGN KEY(school_id,teacher_membership_id) REFERENCES memberships(school_id,id),
  FOREIGN KEY(school_id,room_id) REFERENCES rooms(school_id,id),
  CHECK((teacher_membership_id IS NULL)=(teacher_name IS NULL)),
  CHECK(subject_id IS NOT NULL OR label IS NOT NULL OR (teacher_membership_id IS NULL AND room_id IS NULL))
);
CREATE UNIQUE INDEX timetable_teacher_clash ON timetable_lessons(timetable_id,teacher_membership_id,weekday,period) WHERE teacher_membership_id IS NOT NULL;
CREATE UNIQUE INDEX timetable_room_clash ON timetable_lessons(timetable_id,room_id,weekday,period) WHERE room_id IS NOT NULL;
CREATE INDEX timetable_lessons_class ON timetable_lessons(school_id,class_id);
CREATE INDEX timetable_lessons_subject ON timetable_lessons(school_id,subject_id) WHERE subject_id IS NOT NULL;
CREATE INDEX timetable_lessons_teacher ON timetable_lessons(school_id,teacher_membership_id) WHERE teacher_membership_id IS NOT NULL;
CREATE INDEX timetable_lessons_room ON timetable_lessons(school_id,room_id) WHERE room_id IS NOT NULL;

-- Only a draft changes. A published version may only be retired, once; nothing else about it moves.
CREATE FUNCTION preserve_timetable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Timetables are kept' USING ERRCODE='23514'; END IF;
  IF (NEW.id,NEW.school_id,NEW.term_id,NEW.version,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.school_id,OLD.term_id,OLD.version,OLD.created_by,OLD.created_at) THEN
    RAISE EXCEPTION 'A timetable keeps its term and version' USING ERRCODE='23514';
  END IF;
  IF OLD.status='draft' THEN RETURN NEW; END IF;
  IF OLD.status='published' AND NEW.status='retired' AND NEW.periods=OLD.periods AND NEW.published_at=OLD.published_at AND NEW.published_by=OLD.published_by THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'A published timetable does not change; copy it into a new draft' USING ERRCODE='23514';
END $$;
CREATE TRIGGER timetables_preserved BEFORE UPDATE OR DELETE ON timetables FOR EACH ROW EXECUTE FUNCTION preserve_timetable();
CREATE FUNCTION timetable_lesson_in_draft() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Clear a lesson instead of deleting it' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (NEW.id,NEW.school_id,NEW.timetable_id,NEW.class_id,NEW.weekday,NEW.period) IS DISTINCT FROM (OLD.id,OLD.school_id,OLD.timetable_id,OLD.class_id,OLD.weekday,OLD.period) THEN
    RAISE EXCEPTION 'A lesson keeps its place in the grid' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM timetables t WHERE t.school_id=NEW.school_id AND t.id=NEW.timetable_id AND t.status='draft') THEN
    RAISE EXCEPTION 'Only a draft timetable can change' USING ERRCODE='23514';
  END IF;
  NEW.updated_at:=clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER timetable_lessons_in_draft BEFORE INSERT OR UPDATE OR DELETE ON timetable_lessons FOR EACH ROW EXECUTE FUNCTION timetable_lesson_in_draft();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['rooms','timetables','timetable_lessons'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY %I ON %I USING(school_id::text=current_setting(''app.school_id'',true)) WITH CHECK(school_id::text=current_setting(''app.school_id'',true))',t||'_school_context',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT ON rooms,timetables,timetable_lessons TO school_app;
GRANT UPDATE(status,periods,published_at,published_by,retired_at) ON timetables TO school_app;
GRANT UPDATE(subject_id,label,teacher_membership_id,teacher_name,room_id,updated_at) ON timetable_lessons TO school_app;
