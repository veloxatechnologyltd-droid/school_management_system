-- Supports the (school_id, note_id) foreign key on note withdrawals, as every foreign key has an index.
CREATE INDEX learner_note_withdrawals_note ON learner_note_withdrawals(school_id,note_id);
