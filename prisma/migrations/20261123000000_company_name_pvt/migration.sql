-- Rename the company to its registered name, only if it still has the original default.
UPDATE "Setting" SET "value" = 'Islamabad Health Zone Pvt.' WHERE "key" = 'company_name' AND "value" = 'Islamabad Health Zone';
