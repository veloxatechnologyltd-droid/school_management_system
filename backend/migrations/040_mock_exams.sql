-- Mock exams (e.g. BECE mocks in JHS) are recorded as dated class assessments of their own kind, one per subject in a
-- round that shares a title. They are kept apart from class work: weekly trends, the CA suggestion, support-plan
-- evidence and families' progress leave them out, and the readiness view reads only them.
ALTER TABLE class_assessments DROP CONSTRAINT class_assessments_kind_check;
ALTER TABLE class_assessments ADD CONSTRAINT class_assessments_kind_check CHECK(kind IN ('classwork','homework','quiz','class_test','project','mock'));
