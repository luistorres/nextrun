CREATE TABLE IF NOT EXISTS "user_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"units" text DEFAULT 'metric' NOT NULL,
	"pace_display" text DEFAULT 'min_km' NOT NULL,
	"week_start_day" text DEFAULT 'monday' NOT NULL,
	"theme" text DEFAULT 'dark' NOT NULL,
	"email_notifications" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coach_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workout_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"planned_workout_id" uuid,
	"activity_id" uuid,
	"sentiment" text,
	"reason_for_miss" text,
	"contextual_notes" text,
	"pain_areas" jsonb,
	"external_stressors" text[],
	"feedback_type" text DEFAULT 'general' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "adaptations" ADD COLUMN IF NOT EXISTS "updated_workouts" jsonb;--> statement-breakpoint
ALTER TABLE "planned_workouts" ADD COLUMN IF NOT EXISTS "skip_reason" text;--> statement-breakpoint
ALTER TABLE "planned_workouts" ADD COLUMN IF NOT EXISTS "adaptation_id" uuid;--> statement-breakpoint
ALTER TABLE "planned_workouts" ADD COLUMN IF NOT EXISTS "original_workout_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coach_messages" ADD CONSTRAINT "coach_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workout_feedback" ADD CONSTRAINT "workout_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workout_feedback" ADD CONSTRAINT "workout_feedback_planned_workout_id_planned_workouts_id_fk" FOREIGN KEY ("planned_workout_id") REFERENCES "public"."planned_workouts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coach_messages_user_date_idx" ON "coach_messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workout_feedback_user_created_idx" ON "workout_feedback" USING btree ("user_id","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "planned_workouts" ADD CONSTRAINT "planned_workouts_adaptation_id_adaptations_id_fk" FOREIGN KEY ("adaptation_id") REFERENCES "public"."adaptations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
