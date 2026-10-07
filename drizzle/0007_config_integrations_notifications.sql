CREATE TYPE "public"."github_activity_kind" AS ENUM('commit', 'pull_request', 'branch');--> statement-breakpoint
CREATE TYPE "public"."integration_kind" AS ENUM('jira', 'github');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('sent', 'failed', 'skipped');--> statement-breakpoint
ALTER TYPE "public"."rework_state" ADD VALUE 'follow_up' BEFORE 'declined';--> statement-breakpoint
CREATE TABLE "github_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"ticket_id" uuid,
	"kind" "github_activity_kind" NOT NULL,
	"repo" text NOT NULL,
	"ref" text NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"url" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_activity_ref" UNIQUE("project_id","kind","repo","ref")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"status" "notification_status" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "integration_kind" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb NOT NULL,
	"secret" text,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_integrations_project_kind" UNIQUE("project_id","kind")
);
--> statement-breakpoint
CREATE TABLE "workspace_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"match_threshold" real DEFAULT 0.6 NOT NULL,
	"customer_notify" jsonb NOT NULL,
	"default_notify_email" boolean DEFAULT true NOT NULL,
	"default_notify_in_app" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "owner_pm_id" uuid;--> statement-breakpoint
ALTER TABLE "needs" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD COLUMN "published_by" uuid;--> statement-breakpoint
ALTER TABLE "ticket_validations" ADD COLUMN "follow_up_ticket_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "external_key" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "external_url" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "external_status" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "external_assignee" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_in_app" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "github_activity" ADD CONSTRAINT "github_activity_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_activity" ADD CONSTRAINT "github_activity_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_integrations" ADD CONSTRAINT "project_integrations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_pm_id_users_id_fk" FOREIGN KEY ("owner_pm_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "needs" ADD CONSTRAINT "needs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_validations" ADD CONSTRAINT "ticket_validations_follow_up_ticket_id_tickets_id_fk" FOREIGN KEY ("follow_up_ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "workspace_settings" ("id", "customer_notify") VALUES (1, '{"planned":true,"in_development":true,"ready_for_review":true,"released":true,"rework_decision":true}') ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "ticket_events" SET "published_at" = "created_at" WHERE "visibility" = 'customer';
