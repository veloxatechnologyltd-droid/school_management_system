-- Claude drafting for the shared content library (Home Learning Pass, phase 2, slice 2b).
--
-- Drafting is paid for by the platform, not by a school, so it has its own run log and its own monthly budget; the school
-- ai_runs table carries a school_id and cannot be reused. Both tables are private: no application role may read or write
-- them directly, only the functions below. A Claude draft (author_kind 'ai') can be created in exactly one place, the finish
-- function, which checks that the run was begun by the same person, within the budget, and has not been used before.
-- Every draft still starts as a draft and still needs a named human reviewer before it is published.

-- One row. The platform administrator sets the cap, in tokens (input plus output) per Ghana calendar month. Zero, the
-- default, means nothing may be drafted until a budget is set.
CREATE TABLE content_ai_budget (
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  monthly_token_cap integer NOT NULL DEFAULT 0 CHECK(monthly_token_cap BETWEEN 0 AND 200000000),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  updated_by uuid REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO content_ai_budget(id) VALUES (true);
CREATE INDEX content_ai_budget_updated_by ON content_ai_budget(updated_by);
ALTER TABLE content_ai_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_ai_budget FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE content_ai_budget FROM PUBLIC;

-- Append-only log of drafting runs: who asked, for which indicator and difficulty, what it cost, and what came of it.
-- Never the prompt or the generated text. A run is begun (status 'started', holding a reservation against the budget)
-- and finished exactly once, as 'ok' (drafts were made) or 'failed' (none were).
CREATE TABLE content_ai_runs (
  id uuid PRIMARY KEY,
  requested_by uuid NOT NULL REFERENCES users(id),
  indicator_id uuid NOT NULL REFERENCES catalogue_indicators(id),
  level smallint NOT NULL CHECK(level BETWEEN 1 AND 3),
  requested smallint NOT NULL CHECK(requested BETWEEN 1 AND 30),
  template_version text NOT NULL CHECK(length(btrim(template_version)) BETWEEN 1 AND 60),
  provider text NOT NULL CHECK(length(btrim(provider)) BETWEEN 1 AND 40),
  model text CHECK(model IS NULL OR length(btrim(model)) BETWEEN 1 AND 80),
  reserved_tokens integer NOT NULL CHECK(reserved_tokens BETWEEN 1 AND 1000000),
  status text NOT NULL DEFAULT 'started' CHECK(status IN ('started','ok','failed')),
  drafted smallint CHECK(drafted IS NULL OR drafted BETWEEN 0 AND 30),
  dropped smallint CHECK(dropped IS NULL OR dropped BETWEEN 0 AND 1000),
  input_tokens integer CHECK(input_tokens IS NULL OR input_tokens BETWEEN 0 AND 10000000),
  output_tokens integer CHECK(output_tokens IS NULL OR output_tokens BETWEEN 0 AND 10000000),
  latency_ms integer CHECK(latency_ms IS NULL OR latency_ms>=0),
  output_digest text CHECK(output_digest IS NULL OR output_digest ~ '^[0-9a-f]{64}$'),
  note text CHECK(note IS NULL OR length(note)<=120),
  created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  -- Each rule says IS NOT NULL outright: a CHECK that evaluates to NULL passes.
  CHECK(status<>'started' OR (drafted IS NULL AND dropped IS NULL AND input_tokens IS NULL AND output_tokens IS NULL AND latency_ms IS NULL AND output_digest IS NULL AND note IS NULL AND finished_at IS NULL)),
  CHECK(status='started' OR (finished_at IS NOT NULL AND drafted IS NOT NULL AND dropped IS NOT NULL)),
  CHECK(status<>'ok' OR (drafted IS NOT NULL AND drafted>=1 AND drafted<=requested AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND output_digest IS NOT NULL)),
  CHECK(status<>'failed' OR (drafted IS NOT NULL AND drafted=0))
);
CREATE INDEX content_ai_runs_month ON content_ai_runs(created_at);
CREATE INDEX content_ai_runs_requested_by ON content_ai_runs(requested_by);
CREATE INDEX content_ai_runs_indicator ON content_ai_runs(indicator_id);
ALTER TABLE content_ai_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_ai_runs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE content_ai_runs FROM PUBLIC;

-- A Claude draft carries the label 'ai' and names the run that made it; nothing else may. A person's version cannot name a run (so
-- the label cannot travel), a Claude version must name one that exists, and a Claude draft is never reworded: a person's wording is
-- a new version, labelled as theirs and reviewed as theirs. Without this a person could reword a Claude draft and approve their
-- own writing under the Claude label.
ALTER TABLE content_versions ADD CONSTRAINT content_versions_ai_run_pair CHECK((author_kind='ai')=(ai_run_id IS NOT NULL));
ALTER TABLE content_versions ADD CONSTRAINT content_versions_ai_run_fk FOREIGN KEY (ai_run_id) REFERENCES content_ai_runs(id);
CREATE INDEX content_versions_ai_run ON content_versions(ai_run_id) WHERE ai_run_id IS NOT NULL;

CREATE OR REPLACE FUNCTION guard_content_version() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE me uuid := nullif(current_setting('app.user_id',true),'')::uuid;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Content versions are kept; retire one instead' USING ERRCODE='23514'; END IF;
  IF (NEW.id,NEW.item_id,NEW.version,NEW.author_kind,NEW.author_id,NEW.ai_run_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.item_id,OLD.version,OLD.author_kind,OLD.author_id,OLD.ai_run_id,OLD.created_at) THEN
    RAISE EXCEPTION 'A content version keeps its identity and author' USING ERRCODE='23514';
  END IF;
  IF NEW.status=OLD.status THEN
    IF NEW.body IS DISTINCT FROM OLD.body THEN
      IF OLD.status<>'draft' THEN RAISE EXCEPTION 'A submitted version cannot be changed; write a new version' USING ERRCODE='23514'; END IF;
      IF OLD.author_kind='ai' THEN RAISE EXCEPTION 'A Claude draft cannot be reworded; withdraw it and write a new version' USING ERRCODE='23514'; END IF;
      IF me IS DISTINCT FROM OLD.author_id OR NOT public.content_has_role('author') THEN RAISE EXCEPTION 'Only the author, while still a content author, rewords a draft' USING ERRCODE='42501'; END IF;
    END IF;
    IF (NEW.checks,NEW.submitted_at,NEW.reviewer_id,NEW.reviewed_at,NEW.review_note,NEW.published_at,NEW.retired_at,NEW.retired_by,NEW.retirement_reason)
      IS DISTINCT FROM (OLD.checks,OLD.submitted_at,OLD.reviewer_id,OLD.reviewed_at,OLD.review_note,OLD.published_at,OLD.retired_at,OLD.retired_by,OLD.retirement_reason) THEN
      RAISE EXCEPTION 'A content version only changes by moving to its next status' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (OLD.status,NEW.status) NOT IN (('draft','in_review'),('in_review','published'),('in_review','rejected'),('draft','retired'),('in_review','retired'),('published','retired')) THEN
    RAISE EXCEPTION 'A % version cannot become %',OLD.status,NEW.status USING ERRCODE='23514';
  END IF;
  IF NEW.body IS DISTINCT FROM OLD.body THEN RAISE EXCEPTION 'The wording cannot change while the status changes' USING ERRCODE='23514'; END IF;
  IF (NEW.status='in_review' AND (NEW.reviewer_id,NEW.reviewed_at,NEW.review_note,NEW.published_at,NEW.retired_at,NEW.retired_by,NEW.retirement_reason)
        IS DISTINCT FROM (OLD.reviewer_id,OLD.reviewed_at,OLD.review_note,OLD.published_at,OLD.retired_at,OLD.retired_by,OLD.retirement_reason))
    OR (NEW.status IN ('published','rejected') AND (NEW.checks,NEW.submitted_at,NEW.retired_at,NEW.retired_by,NEW.retirement_reason)
        IS DISTINCT FROM (OLD.checks,OLD.submitted_at,OLD.retired_at,OLD.retired_by,OLD.retirement_reason))
    OR (NEW.status='retired' AND (NEW.checks,NEW.submitted_at,NEW.reviewer_id,NEW.reviewed_at,NEW.review_note,NEW.published_at)
        IS DISTINCT FROM (OLD.checks,OLD.submitted_at,OLD.reviewer_id,OLD.reviewed_at,OLD.review_note,OLD.published_at)) THEN
    RAISE EXCEPTION 'A move to this status keeps the rest of the version''s history as it was' USING ERRCODE='23514';
  END IF;
  IF NEW.status='in_review' AND (me IS DISTINCT FROM OLD.author_id OR NOT public.content_has_role('author')) THEN RAISE EXCEPTION 'Only the author, while still a content author, submits a draft for review' USING ERRCODE='42501'; END IF;
  IF NEW.status IN ('published','rejected') AND (NEW.reviewer_id IS DISTINCT FROM me OR NOT public.content_has_role('reviewer')) THEN
    RAISE EXCEPTION 'A reviewer must approve or reject, in their own name' USING ERRCODE='42501';
  END IF;
  -- A draft may be withdrawn by its author; anything already submitted or live is retired by a reviewer.
  IF NEW.status='retired' AND NEW.retired_by IS DISTINCT FROM me THEN RAISE EXCEPTION 'A version is retired in the name of the person who retires it' USING ERRCODE='42501'; END IF;
  IF NEW.status='retired' AND NOT (OLD.status='draft' AND me IS NOT DISTINCT FROM OLD.author_id) AND NOT public.content_has_role('reviewer') THEN
    RAISE EXCEPTION 'Only a reviewer retires a submitted or published version' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION guard_content_ai_run() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Drafting runs are kept in the log' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'started' OR NEW.status NOT IN ('ok','failed')
    OR (NEW.id,NEW.requested_by,NEW.indicator_id,NEW.level,NEW.requested,NEW.template_version,NEW.provider,NEW.model,NEW.reserved_tokens,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.requested_by,OLD.indicator_id,OLD.level,OLD.requested,OLD.template_version,OLD.provider,OLD.model,OLD.reserved_tokens,OLD.created_at) THEN
    RAISE EXCEPTION 'A logged run cannot be rewritten; it only moves from started to finished, once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER content_ai_runs_guarded BEFORE UPDATE OR DELETE ON content_ai_runs FOR EACH ROW EXECUTE FUNCTION guard_content_ai_run();

-- Tokens spent this Ghana month. A run that has not reported its tokens (still open, or failed before the provider said)
-- is charged its reservation, so an unknown spend can only make the budget stricter, never looser.
CREATE FUNCTION content_ai_month_tokens() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT coalesce(sum(CASE WHEN input_tokens IS NOT NULL AND output_tokens IS NOT NULL THEN input_tokens::bigint+output_tokens ELSE reserved_tokens END),0)::bigint
  FROM public.content_ai_runs WHERE created_at >= (date_trunc('month', now() AT TIME ZONE 'Africa/Accra') AT TIME ZONE 'Africa/Accra')
$$;

-- The budget and the log are read by the content team and by the platform administrator.
CREATE FUNCTION content_ai_budget_status() RETURNS TABLE(monthly_token_cap integer, used_tokens bigint, version integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT (public.content_is_staff() OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id::text=current_setting('app.user_id',true))) THEN
    RAISE EXCEPTION 'Content access is for the content team' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT b.monthly_token_cap, public.content_ai_month_tokens(), b.version FROM public.content_ai_budget b;
END $$;

CREATE FUNCTION content_ai_runs_list(p_limit integer) RETURNS TABLE(id uuid, requested_by uuid, requested_by_name text, subject text, class_level text, code text, description text, level smallint, requested smallint,
  drafted smallint, dropped smallint, drafts_waiting integer, status text, provider text, model text, input_tokens integer, output_tokens integer, reserved_tokens integer, latency_ms integer, note text, created_at timestamptz, finished_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT (public.content_is_staff() OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id::text=current_setting('app.user_id',true))) THEN
    RAISE EXCEPTION 'Content access is for the content team' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT r.id,r.requested_by,u.display_name,c.subject,c.level,c.code,c.description,r.level,r.requested,r.drafted,r.dropped,
      (SELECT count(*)::integer FROM public.content_versions v WHERE v.ai_run_id=r.id AND v.status='draft'),r.status,r.provider,r.model,
      r.input_tokens,r.output_tokens,r.reserved_tokens,r.latency_ms,r.note,r.created_at,r.finished_at
    FROM public.content_ai_runs r JOIN public.users u ON u.id=r.requested_by JOIN public.catalogue_indicators c ON c.id=r.indicator_id
    ORDER BY r.created_at DESC,r.id LIMIT greatest(1,least(coalesce(p_limit,20),100));
END $$;

-- Only the platform administrator sets the budget. A stale version is refused so two people cannot overwrite each other.
CREATE FUNCTION platform_set_content_ai_budget(p_cap integer, p_version integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE admin_id uuid := public.platform_require_admin(); next_version integer;
BEGIN
  IF p_cap IS NULL OR p_cap<0 OR p_cap>200000000 THEN RAISE EXCEPTION 'The monthly budget is 0 to 200,000,000 tokens' USING ERRCODE='23514'; END IF;
  UPDATE public.content_ai_budget SET monthly_token_cap=p_cap,version=version+1,updated_by=admin_id,updated_at=now() WHERE version=p_version RETURNING version INTO next_version;
  IF next_version IS NULL THEN RAISE EXCEPTION 'The budget changed. Reload before saving' USING ERRCODE='40001'; END IF;
  RETURN next_version;
END $$;

-- Begins a run. XB001: no budget has been set. XB002: this month's budget cannot cover the reservation.
-- The budget row is locked first, so batches begun at the same moment queue here and none can spend what another has reserved.
CREATE FUNCTION content_ai_begin_run(p_indicator uuid, p_level integer, p_count integer, p_template text, p_provider text, p_model text, p_reserve integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE me uuid := nullif(current_setting('app.user_id',true),'')::uuid; entry_retired boolean; cap integer; new_run uuid := gen_random_uuid();
BEGIN
  IF me IS NULL OR NOT public.content_has_role('author') THEN RAISE EXCEPTION 'Only a content author drafts with Claude' USING ERRCODE='42501'; END IF;
  SELECT retired_at IS NOT NULL INTO entry_retired FROM public.catalogue_indicators WHERE id=p_indicator;
  IF NOT FOUND THEN RAISE EXCEPTION 'Catalogue entry unavailable' USING ERRCODE='P0002'; END IF;
  IF entry_retired THEN RAISE EXCEPTION 'That catalogue entry is retired' USING ERRCODE='23514'; END IF;
  SELECT monthly_token_cap INTO cap FROM public.content_ai_budget WHERE id FOR UPDATE;
  -- A missing row is no budget: NULL would otherwise pass both comparisons below.
  IF cap IS NULL OR cap=0 THEN RAISE EXCEPTION 'Drafting has no budget: the platform administrator sets one' USING ERRCODE='XB001'; END IF;
  IF public.content_ai_month_tokens()+p_reserve>cap THEN RAISE EXCEPTION 'This month''s drafting budget cannot cover this batch' USING ERRCODE='XB002'; END IF;
  INSERT INTO public.content_ai_runs(id,requested_by,indicator_id,level,requested,template_version,provider,model,reserved_tokens)
    VALUES (new_run,me,p_indicator,p_level,p_count,p_template,p_provider,p_model,p_reserve);
  RETURN new_run;
END $$;

-- Finishes a run once, for the person who began it. With bodies, each becomes a Claude draft (version 1, status draft) of a
-- new question item on the run's indicator and difficulty, named to the requester; without, the run is closed as failed.
-- A Claude draft exists nowhere else: people cannot insert one (migration 047), only this function can, for a valid open run.
CREATE FUNCTION content_ai_finish_run(p_run uuid, p_bodies jsonb, p_dropped integer, p_input integer, p_output integer, p_latency integer, p_digest text, p_note text) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE me uuid := nullif(current_setting('app.user_id',true),'')::uuid; v_run public.content_ai_runs%ROWTYPE; made uuid[] := ARRAY[]::uuid[];
  v_body jsonb; v_item uuid; v_version uuid; n integer;
BEGIN
  SELECT * INTO v_run FROM public.content_ai_runs WHERE id=p_run AND requested_by=me FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Run unavailable' USING ERRCODE='P0002'; END IF;
  IF v_run.status<>'started' THEN RAISE EXCEPTION 'This run is already finished' USING ERRCODE='23514'; END IF;
  n := CASE WHEN p_bodies IS NULL THEN 0 WHEN jsonb_typeof(p_bodies)='array' THEN jsonb_array_length(p_bodies) ELSE -1 END;
  IF n<0 THEN RAISE EXCEPTION 'Drafts come as a list' USING ERRCODE='23514'; END IF;
  IF n>0 THEN
    IF NOT public.content_has_role('author') THEN RAISE EXCEPTION 'Only a content author keeps Claude drafts' USING ERRCODE='42501'; END IF;
    IF EXISTS (SELECT 1 FROM public.catalogue_indicators WHERE id=v_run.indicator_id AND retired_at IS NOT NULL) THEN RAISE EXCEPTION 'That catalogue entry is retired' USING ERRCODE='23514'; END IF;
    IF n>v_run.requested THEN RAISE EXCEPTION 'More drafts than the batch asked for' USING ERRCODE='23514'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_bodies) AS t(e) WHERE jsonb_typeof(t.e)<>'object') THEN RAISE EXCEPTION 'Each draft is an object' USING ERRCODE='23514'; END IF;
    FOR v_body IN SELECT t.e FROM jsonb_array_elements(p_bodies) WITH ORDINALITY AS t(e,i) ORDER BY t.i LOOP
      v_item := gen_random_uuid(); v_version := gen_random_uuid();
      INSERT INTO public.content_items(id,kind,indicator_id,level,created_by) VALUES (v_item,'question',v_run.indicator_id,v_run.level,me);
      INSERT INTO public.content_versions(id,item_id,version,body,author_kind,author_id,ai_run_id) VALUES (v_version,v_item,1,v_body,'ai',me,v_run.id);
      made := made || v_version;
    END LOOP;
  END IF;
  UPDATE public.content_ai_runs SET status=CASE WHEN n>0 THEN 'ok' ELSE 'failed' END, drafted=n, dropped=least(greatest(coalesce(p_dropped,0),0),1000),
    input_tokens=p_input, output_tokens=p_output, latency_ms=p_latency, output_digest=p_digest, note=left(p_note,120), finished_at=now() WHERE id=v_run.id;
  RETURN made;
END $$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['guard_content_ai_run()','content_ai_month_tokens()','content_ai_budget_status()','content_ai_runs_list(integer)','platform_set_content_ai_budget(integer,integer)',
    'content_ai_begin_run(uuid,integer,integer,text,text,text,integer)','content_ai_finish_run(uuid,jsonb,integer,integer,integer,integer,text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
  END LOOP;
  -- The month's total and the guard are internal; the rest are what the application role may call.
  FOREACH fn IN ARRAY ARRAY['content_ai_budget_status()','content_ai_runs_list(integer)','platform_set_content_ai_budget(integer,integer)',
    'content_ai_begin_run(uuid,integer,integer,text,text,text,integer)','content_ai_finish_run(uuid,jsonb,integer,integer,integer,integer,text,text)'] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO school_app',fn);
  END LOOP;
END $$;
