-- Self-service sign-up: someone creates their own account and a new school in one step and becomes its headteacher.
-- No verification step by design (pilot decision). The function is the only unauthenticated write path; it can only create a new
-- school with a new headteacher and never attaches to an existing school or account.
CREATE FUNCTION self_register_school(p_school_name text,p_head_name text,p_head_login text,p_head_hash text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE new_school uuid := gen_random_uuid(); new_user uuid := gen_random_uuid(); new_membership uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.schools(id,name) VALUES (new_school,p_school_name);
  INSERT INTO public.users(id,display_name,synthetic_login,password_hash,must_change_password) VALUES (new_user,p_head_name,lower(p_head_login),p_head_hash,false);
  INSERT INTO public.memberships(id,school_id,user_id,role) VALUES (new_membership,new_school,new_user,'headteacher');
  INSERT INTO public.audit_events(id,school_id,actor_membership_id,action,target_id,metadata)
    VALUES (gen_random_uuid(),new_school,new_membership,'school.self_registered',new_school,'{}');
  RETURN new_user;
END $$;
REVOKE ALL ON FUNCTION self_register_school(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION self_register_school(text,text,text,text) TO school_app;
