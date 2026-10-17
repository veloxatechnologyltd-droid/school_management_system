-- School crest printed on receipts and report cards and shown beside the school name.
-- Stored as a small image data URL (the browser shrinks it before upload), so no file store is needed.
ALTER TABLE schools ADD COLUMN logo text CHECK(logo IS NULL OR (logo ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' AND length(logo) <= 98000));

-- The name of the person who took the money, printed on the receipt as it was when the payment was recorded.
-- Payments recorded before this change have no name.
ALTER TABLE payments ADD COLUMN recorded_by_name text CHECK(recorded_by_name IS NULL OR length(btrim(recorded_by_name)) BETWEEN 1 AND 120);
