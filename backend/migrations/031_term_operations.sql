-- Gaps found by running a KG–JHS school through a full term (Term 3, 2025/26):
-- school details printed on report cards, learner sex for registers and census returns, fee items for one class,
-- reasoned per-learner fee adjustments (discounts and extra charges such as balances brought forward), and the
-- conduct/interest/remarks section of the Ghanaian terminal report.

-- School details shown on report cards and receipts.
ALTER TABLE schools
  ADD COLUMN address text CHECK(address IS NULL OR length(btrim(address)) BETWEEN 3 AND 200),
  ADD COLUMN phone text CHECK(phone IS NULL OR length(btrim(phone)) BETWEEN 7 AND 40),
  ADD COLUMN motto text CHECK(motto IS NULL OR length(btrim(motto)) BETWEEN 2 AND 120);

-- Learner sex (as on the birth certificate) for class lists and GES census returns. Optional for existing records.
ALTER TABLE learners ADD COLUMN sex text CHECK(sex IS NULL OR sex IN ('female','male'));
ALTER TABLE admissions ADD COLUMN sex text CHECK(sex IS NULL OR sex IN ('female','male'));
GRANT UPDATE(sex) ON learners TO school_app;

-- A fee item may apply to one class (for example a BECE mock fee for JHS 3 only) instead of a whole level.
ALTER TABLE fee_items ADD COLUMN class_id uuid, ADD CONSTRAINT fee_items_class_fk FOREIGN KEY(school_id,class_id) REFERENCES class_sections(school_id,id),
  ADD CONSTRAINT fee_items_one_target CHECK(class_id IS NULL OR level IS NULL);

-- Per-learner adjustments to a term invoice. Discounts (scholarship, staff ward, sibling) are the headteacher's decision;
-- charges (balance brought forward from earlier records, a lost textbook) may be recorded by the accountant. Append-only.
CREATE TABLE invoice_adjustments (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, invoice_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('discount','charge')), label text NOT NULL CHECK(length(btrim(label)) BETWEEN 2 AND 80),
  amount_pesewas bigint NOT NULL CHECK(amount_pesewas BETWEEN 1 AND 100000000000), reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500),
  recorded_by uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), UNIQUE(school_id,id),
  FOREIGN KEY(school_id,invoice_id) REFERENCES invoices(school_id,id), FOREIGN KEY(school_id,recorded_by) REFERENCES memberships(school_id,id)
);
CREATE INDEX invoice_adjustments_invoice ON invoice_adjustments(school_id,invoice_id);
CREATE INDEX invoice_adjustments_recorded_by ON invoice_adjustments(school_id,recorded_by);
CREATE TRIGGER invoice_adjustments_append_only BEFORE UPDATE OR DELETE ON invoice_adjustments FOR EACH ROW EXECUTE FUNCTION forbid_history_change();

-- Terminal report remarks: the class teacher's conduct/attitude/interest/remark and the headteacher's remark.
-- Each save is a new row (latest per learner and author wins); locked with the scores once the report is published.
CREATE TABLE terminal_report_remarks (
  id uuid PRIMARY KEY, school_id uuid NOT NULL, term_id uuid NOT NULL, class_id uuid NOT NULL, learner_id uuid NOT NULL,
  author text NOT NULL CHECK(author IN ('class_teacher','headteacher')),
  conduct text CHECK(conduct IS NULL OR length(btrim(conduct)) BETWEEN 2 AND 120),
  attitude text CHECK(attitude IS NULL OR length(btrim(attitude)) BETWEEN 2 AND 120),
  interest text CHECK(interest IS NULL OR length(btrim(interest)) BETWEEN 2 AND 120),
  remark text CHECK(remark IS NULL OR length(btrim(remark)) BETWEEN 2 AND 300),
  recorded_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(school_id,id),
  CHECK(author='class_teacher' OR (conduct IS NULL AND attitude IS NULL AND interest IS NULL)),
  FOREIGN KEY(school_id,term_id) REFERENCES terms(school_id,id), FOREIGN KEY(school_id,class_id) REFERENCES class_sections(school_id,id),
  FOREIGN KEY(school_id,learner_id) REFERENCES learners(school_id,id), FOREIGN KEY(school_id,recorded_by) REFERENCES memberships(school_id,id)
);
CREATE INDEX terminal_report_remarks_lookup ON terminal_report_remarks(school_id,term_id,class_id,learner_id,author,created_at DESC);
CREATE INDEX terminal_report_remarks_learner ON terminal_report_remarks(school_id,learner_id);
CREATE INDEX terminal_report_remarks_class ON terminal_report_remarks(school_id,class_id);
CREATE INDEX terminal_report_remarks_recorded_by ON terminal_report_remarks(school_id,recorded_by);
CREATE INDEX fee_items_class ON fee_items(school_id,class_id);
CREATE TRIGGER terminal_report_remarks_append_only BEFORE UPDATE OR DELETE ON terminal_report_remarks FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
CREATE TRIGGER terminal_report_remarks_locked BEFORE INSERT ON terminal_report_remarks FOR EACH ROW EXECUTE FUNCTION block_scores_after_publication();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoice_adjustments','terminal_report_remarks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format($p$CREATE POLICY %I ON %I USING(school_id::text=current_setting('app.school_id',true)) WITH CHECK(school_id::text=current_setting('app.school_id',true))$p$,t||'_school_context',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT ON invoice_adjustments,terminal_report_remarks TO school_app;
