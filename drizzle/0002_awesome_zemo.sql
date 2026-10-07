ALTER TABLE "activities" ADD COLUMN "rpe_score" integer;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "perceived_difficulty" text;--> statement-breakpoint
ALTER TABLE "planned_workouts" ADD COLUMN "rpe_score" integer;--> statement-breakpoint
ALTER TABLE "planned_workouts" ADD COLUMN "perceived_difficulty" text;--> statement-breakpoint
ALTER TABLE "user_goals" ADD COLUMN "health_constraints" jsonb DEFAULT '[]'::jsonb;