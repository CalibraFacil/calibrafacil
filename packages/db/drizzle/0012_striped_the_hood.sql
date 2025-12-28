-- Add lab_organization_id column to customer table
-- This tracks which LAB organization manages this customer

-- Step 1: Add column as nullable first
ALTER TABLE "customer" ADD COLUMN "lab_organization_id" text;

-- Step 2: For existing customers, set lab_organization_id to the first LAB org found
-- This is a one-time fix; in production you'd need to manually set this
UPDATE "customer" 
SET "lab_organization_id" = (
  SELECT "id" FROM "organization" WHERE "type" = 'LAB' LIMIT 1
)
WHERE "lab_organization_id" IS NULL;

-- Step 3: Make the column NOT NULL
ALTER TABLE "customer" ALTER COLUMN "lab_organization_id" SET NOT NULL;

-- Step 4: Add foreign key constraint
ALTER TABLE "customer" ADD CONSTRAINT "customer_lab_organization_id_organization_id_fk" 
FOREIGN KEY ("lab_organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;

-- Step 5: Add index for performance
CREATE INDEX "customer_lab_org_id_idx" ON "customer" USING btree ("lab_organization_id");
