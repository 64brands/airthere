-- Standard 2000px derivatives use images.web_key for the private R2 path.
-- web_status distinguishes pending / ready / failed without extra tables.

ALTER TABLE images ADD COLUMN web_status TEXT;
