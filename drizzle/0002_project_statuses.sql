CREATE TYPE "public"."status_stage" AS ENUM('backlog', 'planned', 'in_progress', 'done');--> statement-breakpoint
CREATE TABLE "project_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"stage" "status_stage" NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "project_statuses_project_name" UNIQUE("project_id","name")
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "status_id" uuid;--> statement-breakpoint
ALTER TABLE "project_statuses" ADD CONSTRAINT "project_statuses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_status_id_project_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."project_statuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Data migration: every existing project gets the default workflow, and each ticket
-- is mapped from the old fixed status to the matching project status.
INSERT INTO "project_statuses" ("project_id", "name", "stage", "position")
SELECT p."id", s."name", s."stage"::"status_stage", s."position"
FROM "projects" p
CROSS JOIN (VALUES ('Backlog', 'backlog', 0), ('Planned', 'planned', 1), ('In Development', 'in_progress', 2), ('Released', 'done', 3)) AS s("name", "stage", "position");--> statement-breakpoint
UPDATE "tickets" t SET "status_id" = ps."id"
FROM "project_statuses" ps
WHERE ps."project_id" = t."project_id"
  AND ps."stage" = (CASE t."status" WHEN 'backlog' THEN 'backlog' WHEN 'planned' THEN 'planned' WHEN 'in_development' THEN 'in_progress' ELSE 'done' END)::"status_stage";
