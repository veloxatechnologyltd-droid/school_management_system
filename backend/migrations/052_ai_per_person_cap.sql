-- AI governance: a monthly limit per person as well as per school, so one busy person cannot use up the school's whole month.
ALTER TABLE ai_settings ADD COLUMN per_person_monthly_cap integer NOT NULL DEFAULT 50 CHECK(per_person_monthly_cap BETWEEN 1 AND 5000);
GRANT UPDATE(per_person_monthly_cap) ON ai_settings TO school_app;
CREATE INDEX ai_runs_actor_month ON ai_runs(school_id,actor_membership_id,created_at DESC);
