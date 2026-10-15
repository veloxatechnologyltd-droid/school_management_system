-- The shared content library (Home Learning Pass, phase 2): curriculum catalogue and practice content written once and
-- reviewed centrally, not per school. These tables belong to the platform, so they carry no school_id; only people
-- holding a content role can touch them, and schools never write to them.
--
-- Roles are separate from school roles and from the platform administrator: author (drafts), reviewer (approves or
-- rejects what someone else wrote) and lead (everything, plus the catalogue). A published item always has a named
-- human reviewer who is not its author. A version's wording is frozen once it is submitted; a fix is a new version.

CREATE TABLE content_staff (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), role text NOT NULL CHECK(role IN ('author','reviewer','lead')),
  granted_by uuid NOT NULL REFERENCES users(id), granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz, revoked_by uuid REFERENCES users(id),
  CHECK((revoked_at IS NULL AND revoked_by IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);
CREATE UNIQUE INDEX content_staff_active ON content_staff(user_id,role) WHERE revoked_at IS NULL;
CREATE INDEX content_staff_granted_by ON content_staff(granted_by);
CREATE INDEX content_staff_revoked_by ON content_staff(revoked_by);
ALTER TABLE content_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_staff FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE content_staff FROM PUBLIC;

-- Lead may do whatever author and reviewer may; the live row decides, so a revoked role stops working at once.
CREATE FUNCTION content_has_role(p_role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS (SELECT 1 FROM public.content_staff WHERE user_id::text=current_setting('app.user_id',true) AND revoked_at IS NULL AND (role=p_role OR role='lead'))
$$;
CREATE FUNCTION content_is_staff() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS (SELECT 1 FROM public.content_staff WHERE user_id::text=current_setting('app.user_id',true) AND revoked_at IS NULL)
$$;
CREATE FUNCTION content_roles() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT coalesce(array_agg(role ORDER BY role),ARRAY[]::text[]) FROM public.content_staff WHERE user_id::text=current_setting('app.user_id',true) AND revoked_at IS NULL
$$;

-- Content roles are granted by the platform administrator only.
CREATE FUNCTION platform_content_staff() RETURNS TABLE(id uuid,user_id uuid,name text,login text,role text,granted_at timestamptz,revoked_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.platform_require_admin();
  RETURN QUERY SELECT c.id,c.user_id,u.display_name,u.synthetic_login,c.role,c.granted_at,c.revoked_at
    FROM public.content_staff c JOIN public.users u ON u.id=c.user_id ORDER BY u.display_name,c.role,c.granted_at;
END $$;
CREATE FUNCTION platform_create_content_user(p_name text,p_login text,p_hash text,p_role text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE admin_id uuid := public.platform_require_admin(); new_user uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.users(id,display_name,synthetic_login,password_hash,must_change_password) VALUES (new_user,p_name,lower(p_login),p_hash,true);
  INSERT INTO public.content_staff(id,user_id,role,granted_by) VALUES (gen_random_uuid(),new_user,p_role,admin_id);
  RETURN new_user;
END $$;
CREATE FUNCTION platform_grant_content_role(p_user uuid,p_role text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE admin_id uuid := public.platform_require_admin(); grant_id uuid := gen_random_uuid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id=p_user) THEN RAISE EXCEPTION 'User unavailable' USING ERRCODE='P0002'; END IF;
  INSERT INTO public.content_staff(id,user_id,role,granted_by) VALUES (grant_id,p_user,p_role,admin_id);
  RETURN grant_id;
END $$;
CREATE FUNCTION platform_revoke_content_role(p_grant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE admin_id uuid := public.platform_require_admin();
BEGIN
  UPDATE public.content_staff SET revoked_at=now(),revoked_by=admin_id WHERE id=p_grant AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Role unavailable' USING ERRCODE='P0002'; END IF;
END $$;

-- People who can publish what every school's children practise sign in with the second step where it is required.
CREATE OR REPLACE FUNCTION user_requires_mfa() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id::text=current_setting('app.user_id',true))
      OR EXISTS (SELECT 1 FROM public.memberships WHERE user_id::text=current_setting('app.user_id',true) AND revoked_at IS NULL AND NOT support_access AND role IN ('headteacher','accountant'))
      OR EXISTS (SELECT 1 FROM public.content_staff WHERE user_id::text=current_setting('app.user_id',true) AND revoked_at IS NULL)
$$;

-- The platform's curriculum catalogue: one entry per indicator, per class level. Wording never changes; the only change
-- allowed is retiring an entry once, with a reason (a corrected entry is added fresh). Every entry says where it came
-- from: 'official' when taken from a published curriculum (the source note names it) or 'platform' when written by us.
CREATE TABLE catalogue_indicators (
  id uuid PRIMARY KEY,
  subject text NOT NULL CHECK(length(btrim(subject)) BETWEEN 2 AND 60),
  level text NOT NULL CHECK(level IN ('Basic 1','Basic 2','Basic 3','Basic 4','Basic 5','Basic 6','JHS 1','JHS 2','JHS 3')),
  code text CHECK(code IS NULL OR length(btrim(code)) BETWEEN 1 AND 40),
  strand text CHECK(strand IS NULL OR length(btrim(strand)) BETWEEN 2 AND 120),
  sub_strand text CHECK(sub_strand IS NULL OR length(btrim(sub_strand)) BETWEEN 2 AND 120),
  description text NOT NULL CHECK(length(btrim(description)) BETWEEN 3 AND 400),
  term_guidance smallint[] CHECK(term_guidance IS NULL OR (cardinality(term_guidance) BETWEEN 1 AND 3 AND term_guidance <@ ARRAY[1,2,3]::smallint[])),
  origin text NOT NULL CHECK(origin IN ('official','platform')),
  source_note text NOT NULL CHECK(length(btrim(source_note)) BETWEEN 3 AND 300),
  created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz, retired_by uuid REFERENCES users(id), retirement_reason text,
  CHECK((retired_at IS NULL AND retired_by IS NULL AND retirement_reason IS NULL) OR (retired_at IS NOT NULL AND retired_by IS NOT NULL AND length(btrim(retirement_reason))>=3))
);
CREATE UNIQUE INDEX catalogue_indicators_active_code ON catalogue_indicators(lower(subject),level,lower(code)) WHERE code IS NOT NULL AND retired_at IS NULL;
CREATE INDEX catalogue_indicators_lookup ON catalogue_indicators(level,lower(subject));
CREATE INDEX catalogue_indicators_created_by ON catalogue_indicators(created_by);
CREATE INDEX catalogue_indicators_retired_by ON catalogue_indicators(retired_by);
CREATE FUNCTION preserve_catalogue_indicator() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Catalogue indicators are kept; retire one instead' USING ERRCODE='23514'; END IF;
  IF OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL
    OR (NEW.id,NEW.subject,NEW.level,NEW.code,NEW.strand,NEW.sub_strand,NEW.description,NEW.term_guidance,NEW.origin,NEW.source_note,NEW.created_by,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.subject,OLD.level,OLD.code,OLD.strand,OLD.sub_strand,OLD.description,OLD.term_guidance,OLD.origin,OLD.source_note,OLD.created_by,OLD.created_at) THEN
    RAISE EXCEPTION 'A catalogue indicator can only be retired, once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER catalogue_indicators_preserved BEFORE UPDATE OR DELETE ON catalogue_indicators FOR EACH ROW EXECUTE FUNCTION preserve_catalogue_indicator();

-- An item is one thing a child or parent sees (a question, a parent guide); its versions are what was written and reviewed.
-- A question carries its difficulty (1 easy to 3 harder); a guide has none.
CREATE TABLE content_items (
  id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('question','guide')),
  indicator_id uuid NOT NULL REFERENCES catalogue_indicators(id), level smallint CHECK(level BETWEEN 1 AND 3),
  created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((kind='question' AND level IS NOT NULL) OR (kind='guide' AND level IS NULL))
);
CREATE INDEX content_items_indicator ON content_items(indicator_id,kind,level);
CREATE INDEX content_items_created_by ON content_items(created_by);
CREATE FUNCTION forbid_content_item_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'Content items are kept as written; add a new version instead' USING ERRCODE='23514'; END $$;
CREATE TRIGGER content_items_kept BEFORE UPDATE OR DELETE ON content_items FOR EACH ROW EXECUTE FUNCTION forbid_content_item_change();

-- draft -> in_review -> published or rejected; published, in review or draft -> retired (with a reason).
-- 'checks' holds what the automatic checks found when the version was submitted (blocking problems stop a submit,
-- warnings are shown to the reviewer). author_kind 'ai' marks a Claude draft; author_id is then the person who asked for it.
CREATE TABLE content_versions (
  id uuid PRIMARY KEY, item_id uuid NOT NULL REFERENCES content_items(id), version integer NOT NULL CHECK(version>0),
  body jsonb NOT NULL,
  author_kind text NOT NULL DEFAULT 'person' CHECK(author_kind IN ('person','ai')), author_id uuid NOT NULL REFERENCES users(id), ai_run_id uuid,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_review','published','rejected','retired')),
  checks jsonb, submitted_at timestamptz,
  reviewer_id uuid REFERENCES users(id), reviewed_at timestamptz, review_note text CHECK(review_note IS NULL OR length(btrim(review_note)) BETWEEN 3 AND 500),
  published_at timestamptz,
  retired_at timestamptz, retired_by uuid REFERENCES users(id), retirement_reason text CHECK(retirement_reason IS NULL OR length(btrim(retirement_reason)) BETWEEN 3 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(item_id,version),
  CHECK(status<>'draft' OR (submitted_at IS NULL AND reviewer_id IS NULL AND reviewed_at IS NULL AND published_at IS NULL AND retired_at IS NULL)),
  CHECK(status<>'in_review' OR (submitted_at IS NOT NULL AND checks IS NOT NULL AND reviewer_id IS NULL AND reviewed_at IS NULL AND published_at IS NULL AND retired_at IS NULL)),
  CHECK(status<>'published' OR (submitted_at IS NOT NULL AND reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL AND published_at IS NOT NULL AND retired_at IS NULL)),
  CHECK(status<>'rejected' OR (submitted_at IS NOT NULL AND reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL AND published_at IS NULL AND retired_at IS NULL AND length(btrim(review_note))>=3)),
  CHECK(status<>'retired' OR (retired_at IS NOT NULL AND retired_by IS NOT NULL AND retirement_reason IS NOT NULL)),
  CHECK(status='retired' OR (retired_at IS NULL AND retired_by IS NULL AND retirement_reason IS NULL)),
  CHECK(published_at IS NULL OR (reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL)),
  -- A person's own writing is never approved by that person; a Claude draft is reviewed by a human.
  CHECK(reviewer_id IS NULL OR author_kind='ai' OR reviewer_id<>author_id)
);
-- One version being written or reviewed at a time, and one live version, per item.
CREATE UNIQUE INDEX content_versions_open ON content_versions(item_id) WHERE status IN ('draft','in_review');
CREATE UNIQUE INDEX content_versions_live ON content_versions(item_id) WHERE status='published';
CREATE INDEX content_versions_status ON content_versions(status,submitted_at);
CREATE INDEX content_versions_author ON content_versions(author_id);
CREATE INDEX content_versions_reviewer ON content_versions(reviewer_id);
CREATE INDEX content_versions_retired_by ON content_versions(retired_by);

CREATE FUNCTION guard_content_version() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE me uuid := nullif(current_setting('app.user_id',true),'')::uuid;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Content versions are kept; retire one instead' USING ERRCODE='23514'; END IF;
  IF (NEW.id,NEW.item_id,NEW.version,NEW.author_kind,NEW.author_id,NEW.ai_run_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.item_id,OLD.version,OLD.author_kind,OLD.author_id,OLD.ai_run_id,OLD.created_at) THEN
    RAISE EXCEPTION 'A content version keeps its identity and author' USING ERRCODE='23514';
  END IF;
  IF NEW.status=OLD.status THEN
    -- Only the author's own draft may still be reworded.
    IF NEW.body IS DISTINCT FROM OLD.body AND (OLD.status<>'draft' OR me IS DISTINCT FROM OLD.author_id) THEN
      RAISE EXCEPTION 'A submitted version cannot be changed; write a new version' USING ERRCODE='23514';
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
  IF NEW.status='in_review' AND me IS DISTINCT FROM OLD.author_id THEN RAISE EXCEPTION 'Only the author submits a draft for review' USING ERRCODE='42501'; END IF;
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
CREATE TRIGGER content_versions_guarded BEFORE UPDATE OR DELETE ON content_versions FOR EACH ROW EXECUTE FUNCTION guard_content_version();

ALTER TABLE catalogue_indicators ENABLE ROW LEVEL SECURITY;  ALTER TABLE catalogue_indicators FORCE ROW LEVEL SECURITY;
ALTER TABLE content_items ENABLE ROW LEVEL SECURITY;         ALTER TABLE content_items FORCE ROW LEVEL SECURITY;
ALTER TABLE content_versions ENABLE ROW LEVEL SECURITY;      ALTER TABLE content_versions FORCE ROW LEVEL SECURITY;
-- Any signed-in person may read the catalogue (schools will match their indicators to it); only a lead writes it.
CREATE POLICY catalogue_read ON catalogue_indicators FOR SELECT USING (nullif(current_setting('app.user_id',true),'') IS NOT NULL);
CREATE POLICY catalogue_add ON catalogue_indicators FOR INSERT WITH CHECK (public.content_has_role('lead') AND created_by::text=current_setting('app.user_id',true));
CREATE POLICY catalogue_retire ON catalogue_indicators FOR UPDATE USING (public.content_has_role('lead')) WITH CHECK (public.content_has_role('lead'));
-- Items and versions are for content staff only; schools will read published content through their own narrow path.
CREATE POLICY content_items_read ON content_items FOR SELECT USING (public.content_is_staff());
CREATE POLICY content_items_add ON content_items FOR INSERT WITH CHECK (public.content_has_role('author') AND created_by::text=current_setting('app.user_id',true));
CREATE POLICY content_versions_read ON content_versions FOR SELECT USING (public.content_is_staff());
CREATE POLICY content_versions_add ON content_versions FOR INSERT WITH CHECK (public.content_has_role('author') AND author_id::text=current_setting('app.user_id',true) AND status='draft');
CREATE POLICY content_versions_move ON content_versions FOR UPDATE USING (public.content_is_staff()) WITH CHECK (public.content_is_staff());

GRANT SELECT,INSERT ON catalogue_indicators,content_items,content_versions TO school_app;
GRANT UPDATE(retired_at,retired_by,retirement_reason) ON catalogue_indicators TO school_app;
GRANT UPDATE(body,status,checks,submitted_at,reviewer_id,reviewed_at,review_note,published_at,retired_at,retired_by,retirement_reason) ON content_versions TO school_app;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['content_has_role(text)','content_is_staff()','content_roles()','platform_content_staff()','platform_create_content_user(text,text,text,text)','platform_grant_content_role(uuid,text)','platform_revoke_content_role(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO school_app',fn);
  END LOOP;
END $$;
