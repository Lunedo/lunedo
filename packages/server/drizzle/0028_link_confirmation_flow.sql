ALTER TYPE "public"."provider_flow_purpose" ADD VALUE 'linkConfirmation';--> statement-breakpoint
ALTER TABLE "provider_flows" ADD COLUMN "challenge_id" uuid;