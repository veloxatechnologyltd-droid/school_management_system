-- Fee reminders: a notice addressed to the families who still owe on a term's bills (found running the trial school:
-- at the fees deadline schools message only the families with balances, not everyone).
ALTER TABLE notices DROP CONSTRAINT notices_audience_check;
ALTER TABLE notices ADD CONSTRAINT notices_audience_check CHECK(audience IN ('school','class','owing'));
ALTER TABLE notices ADD COLUMN term_id uuid, ADD CONSTRAINT notices_term_fk FOREIGN KEY(school_id,term_id) REFERENCES terms(school_id,id),
  ADD CONSTRAINT notices_owing_term CHECK((audience='owing')=(term_id IS NOT NULL));
CREATE INDEX notices_term ON notices(school_id,term_id);

-- Guardians with a verified contact right on a learner whose bill for the term is not fully paid
-- (fee items plus charges, minus discounts, minus payments that were not reversed).
CREATE FUNCTION notice_recipients_owing(p_term uuid) RETURNS TABLE(guardian_membership_id uuid,phone text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE school uuid := public.staff_require_head();
BEGIN
  RETURN QUERY SELECT DISTINCT ON (g.guardian_membership_id) g.guardian_membership_id,u.phone
  FROM public.invoices i
  JOIN public.guardian_links g ON g.school_id=i.school_id AND g.learner_id=i.learner_id AND g.contact AND g.verified_at IS NOT NULL AND g.revoked_at IS NULL
  JOIN public.memberships m ON m.school_id=g.school_id AND m.id=g.guardian_membership_id AND m.revoked_at IS NULL AND m.role='guardian'
  JOIN public.users u ON u.id=m.user_id
  WHERE i.school_id=school AND i.term_id=p_term
    AND i.total_pesewas
      + coalesce((SELECT sum(CASE a.kind WHEN 'charge' THEN a.amount_pesewas ELSE -a.amount_pesewas END) FROM public.invoice_adjustments a WHERE a.school_id=i.school_id AND a.invoice_id=i.id),0)
      - coalesce((SELECT sum(p.amount_pesewas) FROM public.payments p WHERE p.school_id=i.school_id AND p.invoice_id=i.id
          AND NOT EXISTS (SELECT 1 FROM public.payment_reversals r WHERE r.school_id=p.school_id AND r.payment_id=p.id)),0) > 0
  ORDER BY g.guardian_membership_id;
END $$;
REVOKE ALL ON FUNCTION notice_recipients_owing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notice_recipients_owing(uuid) TO school_app;
