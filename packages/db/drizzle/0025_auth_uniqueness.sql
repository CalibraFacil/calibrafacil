DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "account"
    GROUP BY "provider_id", "account_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create account_provider_account_uidx: duplicate account(provider_id, account_id) rows exist';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "member"
    GROUP BY "organization_id", "user_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create member_organization_user_uidx: duplicate member(organization_id, user_id) rows exist';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "account_provider_account_uidx"
  ON "account" USING btree ("provider_id", "account_id");

CREATE UNIQUE INDEX IF NOT EXISTS "member_organization_user_uidx"
  ON "member" USING btree ("organization_id", "user_id");
