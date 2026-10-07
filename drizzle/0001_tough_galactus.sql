CREATE TABLE "athlete_response_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"hrv_recovery_after_intervals" numeric,
	"hrv_recovery_after_long_runs" numeric,
	"response_type" text DEFAULT 'unknown',
	"optimal_hard_days" jsonb,
	"pace_hr_decoupling_rate" numeric,
	"data_points" jsonb,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "athlete_response_patterns" ADD CONSTRAINT "athlete_response_patterns_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;