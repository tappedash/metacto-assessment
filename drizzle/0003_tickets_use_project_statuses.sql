ALTER TABLE "tickets" ALTER COLUMN "status_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" DROP COLUMN "status";--> statement-breakpoint
DROP TYPE "public"."ticket_status";