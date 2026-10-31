-- Align existing customer names with the capitalization used for new records.
-- PostgreSQL initcap/lower handle Cyrillic and Tajik letters in the database locale.
UPDATE "Customer"
SET "firstName" = initcap(lower(btrim(regexp_replace("firstName", '[[:space:]]+', ' ', 'g')))),
    "lastName" = CASE WHEN "lastName" IS NULL THEN NULL ELSE initcap(lower(btrim(regexp_replace("lastName", '[[:space:]]+', ' ', 'g')))) END
WHERE "firstName" IS DISTINCT FROM initcap(lower(btrim(regexp_replace("firstName", '[[:space:]]+', ' ', 'g'))))
   OR "lastName" IS DISTINCT FROM CASE WHEN "lastName" IS NULL THEN NULL ELSE initcap(lower(btrim(regexp_replace("lastName", '[[:space:]]+', ' ', 'g')))) END;
