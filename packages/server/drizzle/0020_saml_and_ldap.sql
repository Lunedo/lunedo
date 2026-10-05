ALTER TYPE "public"."identity_credential_kind" ADD VALUE 'samlSigning';--> statement-breakpoint
ALTER TYPE "public"."identity_credential_kind" ADD VALUE 'bindPassword';--> statement-breakpoint
ALTER TYPE "public"."identity_provider_preset" ADD VALUE 'adfs';--> statement-breakpoint
ALTER TYPE "public"."identity_provider_preset" ADD VALUE 'activeDirectory';--> statement-breakpoint
ALTER TYPE "public"."identity_provider_type" ADD VALUE 'saml';--> statement-breakpoint
ALTER TYPE "public"."identity_provider_type" ADD VALUE 'ldap';--> statement-breakpoint
CREATE TABLE "identity_provider_ca_certificates" (
	"provider_id" uuid PRIMARY KEY NOT NULL,
	"certificates" text NOT NULL,
	"fingerprint" text NOT NULL,
	"subject" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saml_assertions" (
	"provider_id" uuid NOT NULL,
	"assertion_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "saml_assertions_provider_id_assertion_id_pk" PRIMARY KEY("provider_id","assertion_id")
);
--> statement-breakpoint
CREATE TABLE "saml_metadata" (
	"provider_id" uuid PRIMARY KEY NOT NULL,
	"xml" text NOT NULL,
	"entity_id" text NOT NULL,
	"sso_url" text NOT NULL,
	"certificates" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"refresh_failed_at" timestamp with time zone,
	"refresh_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_flows" ALTER COLUMN "nonce" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_flows" ALTER COLUMN "code_verifier" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_flows" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "provider_flows" ADD COLUMN "saml_response" text;--> statement-breakpoint
ALTER TABLE "identity_provider_ca_certificates" ADD CONSTRAINT "identity_provider_ca_certificates_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saml_assertions" ADD CONSTRAINT "saml_assertions_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saml_metadata" ADD CONSTRAINT "saml_metadata_provider_id_identity_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."identity_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saml_assertions_expires_at_index" ON "saml_assertions" USING btree ("expires_at");