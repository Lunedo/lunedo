INSERT INTO "service_account_responsibles" ("service_account_id", "account_id") SELECT "account_id", "responsible_account_id" FROM "service_accounts" WHERE "responsible_account_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "service_accounts" DROP CONSTRAINT "service_accounts_responsible_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "service_accounts" DROP COLUMN "responsible_account_id";