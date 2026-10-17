-- The lessons' foreign key to their timetable version, (school_id,timetable_id), gets its own supporting index
-- (every foreign key has one; found by the hardening test after 055 was applied locally).
CREATE INDEX timetable_lessons_timetable ON timetable_lessons(school_id,timetable_id);
