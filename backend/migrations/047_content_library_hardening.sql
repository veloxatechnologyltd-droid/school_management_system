-- Hardening of the content library after an independent review of migration 046. Nothing here changes what people do;
-- it closes places where the database trusted the application to keep a rule.

-- A person cannot mark their own insert as written by Claude: that would lift the rule that a reviewer is not the author.
-- Claude drafts will be created through a definer function that checks the run (a later slice); until then every
-- insert is a person's, and an 'ai' version must name its run.
DROP POLICY content_versions_add ON content_versions;
CREATE POLICY content_versions_add ON content_versions FOR INSERT
  WITH CHECK (public.content_has_role('author') AND author_id::text=current_setting('app.user_id',true) AND status='draft' AND author_kind='person');
ALTER TABLE content_versions ADD CONSTRAINT content_versions_ai_run CHECK(author_kind='person' OR ai_run_id IS NOT NULL);

-- A missing reason or note made the earlier length checks NULL, and a CHECK accepts NULL.
ALTER TABLE catalogue_indicators ADD CONSTRAINT catalogue_indicators_retired_reason CHECK(retired_at IS NULL OR retirement_reason IS NOT NULL);
ALTER TABLE content_versions ADD CONSTRAINT content_versions_rejected_note CHECK(status<>'rejected' OR review_note IS NOT NULL);

-- Retiring a catalogue entry is recorded in the name of the lead who does it.
DROP POLICY catalogue_retire ON catalogue_indicators;
CREATE POLICY catalogue_retire ON catalogue_indicators FOR UPDATE USING (public.content_has_role('lead'))
  WITH CHECK (public.content_has_role('lead') AND (retired_by IS NULL OR retired_by::text=current_setting('app.user_id',true)));

-- Each move of a version changes only what that move owns: submitting writes the checks and the submit time; a review
-- writes the reviewer, time, note and publish time; retiring writes the retirement. Everything else stays as it was,
-- so a retire cannot erase who reviewed a version and a review cannot rewrite what the checks found. Rewording or
-- submitting a draft also needs the author role to still be held.
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
