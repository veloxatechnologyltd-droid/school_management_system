-- Continuous assessment made of parts, as the school weights them: class exercises (with quizzes), homework, class tests
-- and projects, each a share of the CA out of 100. The default is a common Ghanaian scheme: exercises 30, homework 30 and
-- two class tests 40 of the CA, which with a 50/50 CA/exam split gives 15% + 15% + 10% + 10% of the final score.
ALTER TABLE assessment_policies ADD COLUMN ca_parts jsonb NOT NULL DEFAULT '{"exercises":30,"homework":30,"tests":40,"projects":0}'::jsonb;
ALTER TABLE assessment_policies ADD CONSTRAINT assessment_policies_ca_parts_check CHECK (
  jsonb_typeof(ca_parts)='object' AND ca_parts ?& ARRAY['exercises','homework','tests','projects']
  AND ca_parts - ARRAY['exercises','homework','tests','projects'] = '{}'::jsonb
  AND jsonb_typeof(ca_parts->'exercises')='number' AND jsonb_typeof(ca_parts->'homework')='number'
  AND jsonb_typeof(ca_parts->'tests')='number' AND jsonb_typeof(ca_parts->'projects')='number'
  AND (ca_parts->>'exercises')::numeric BETWEEN 0 AND 100 AND (ca_parts->>'homework')::numeric BETWEEN 0 AND 100
  AND (ca_parts->>'tests')::numeric BETWEEN 0 AND 100 AND (ca_parts->>'projects')::numeric BETWEEN 0 AND 100
  AND (ca_parts->>'exercises')::numeric+(ca_parts->>'homework')::numeric+(ca_parts->>'tests')::numeric+(ca_parts->>'projects')::numeric=100
);
GRANT UPDATE(ca_parts) ON assessment_policies TO school_app;
