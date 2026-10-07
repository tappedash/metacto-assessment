CREATE TYPE "public"."comment_visibility" AS ENUM('internal', 'customer');--> statement-breakpoint
CREATE TYPE "public"."public_ticket_status" AS ENUM('planned', 'in_development', 'ready_for_review', 'released');--> statement-breakpoint
CREATE TYPE "public"."rework_state" AS ENUM('open', 'reopened', 'declined');--> statement-breakpoint
CREATE TYPE "public"."ticket_event_kind" AS ENUM('status', 'comment', 'validation');--> statement-breakpoint
CREATE TYPE "public"."validation_verdict" AS ENUM('looks_good', 'rework');--> statement-breakpoint
CREATE TABLE "ticket_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"kind" "ticket_event_kind" NOT NULL,
	"visibility" "comment_visibility" DEFAULT 'internal' NOT NULL,
	"author_id" uuid,
	"body" text,
	"from_status" text,
	"to_status" text,
	"public_status" "public_ticket_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_validations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"verdict" "validation_verdict" NOT NULL,
	"description" text,
	"ai_context" jsonb,
	"state" "rework_state",
	"resolution_note" text,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "validation_id" uuid;--> statement-breakpoint
ALTER TABLE "project_statuses" ADD COLUMN "public_status" "public_ticket_status";--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_validations" ADD CONSTRAINT "ticket_validations_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_validations" ADD CONSTRAINT "ticket_validations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_validations" ADD CONSTRAINT "ticket_validations_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_validation_id_ticket_validations_id_fk" FOREIGN KEY ("validation_id") REFERENCES "public"."ticket_validations"("id") ON DELETE set null ON UPDATE no action;