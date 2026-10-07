ALTER TABLE "training_plans" ADD COLUMN "review_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "unreviewed_activity_id" uuid;