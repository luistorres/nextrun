CREATE TABLE "account" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "account_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"emailVerified" timestamp,
	"image" text,
	"password_hash" text,
	"onboarding_completed" boolean DEFAULT false NOT NULL,
	"subscription_status" text DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verificationToken" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verificationToken_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "garmin_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"garmin_user_id" text,
	"access_token" text NOT NULL,
	"access_token_secret" text,
	"refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"backfill_status" text DEFAULT 'pending' NOT NULL,
	"backfill_requested_at" timestamp with time zone,
	"backfill_completed_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	CONSTRAINT "garmin_connections_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "garmin_connections_garmin_user_id_unique" UNIQUE("garmin_user_id")
);
--> statement-breakpoint
CREATE TABLE "daily_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"calendar_date" date NOT NULL,
	"steps" integer,
	"distance_meters" numeric,
	"active_seconds" integer,
	"resting_heart_rate" integer,
	"min_heart_rate" integer,
	"max_heart_rate" integer,
	"average_stress_level" integer,
	"body_battery_start" integer,
	"body_battery_end" integer,
	"vo2_max" numeric,
	"respiration_avg" numeric,
	"raw_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "hrv_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"calendar_date" date NOT NULL,
	"hrv_weekly_avg" numeric,
	"hrv_last_night" numeric,
	"hrv_status" text,
	"raw_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "sleep_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"calendar_date" date NOT NULL,
	"total_sleep_seconds" integer,
	"deep_sleep_seconds" integer,
	"light_sleep_seconds" integer,
	"rem_sleep_seconds" integer,
	"awake_seconds" integer,
	"sleep_score" integer,
	"start_time" timestamp with time zone,
	"end_time" timestamp with time zone,
	"raw_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "stress_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"calendar_date" date NOT NULL,
	"stress_values" jsonb,
	"avg_stress" integer,
	"max_stress" integer,
	"rest_stress_duration_seconds" integer,
	"activity_stress_duration_seconds" integer,
	"high_stress_duration_seconds" integer,
	"raw_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"garmin_activity_id" text,
	"activity_type" text NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"duration_seconds" integer NOT NULL,
	"distance_meters" numeric,
	"avg_heart_rate" integer,
	"max_heart_rate" integer,
	"avg_pace_seconds_per_km" numeric,
	"elevation_gain_meters" numeric,
	"calories" integer,
	"training_effect_aerobic" numeric,
	"training_effect_anaerobic" numeric,
	"vo2_max_activity" numeric,
	"was_planned" boolean DEFAULT false NOT NULL,
	"planned_workout_id" uuid,
	"fit_file_path" text,
	"raw_json" jsonb,
	CONSTRAINT "activities_garmin_activity_id_unique" UNIQUE("garmin_activity_id")
);
--> statement-breakpoint
CREATE TABLE "adaptations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"old_plan_version" integer NOT NULL,
	"new_plan_version" integer NOT NULL,
	"trigger_type" text NOT NULL,
	"changes" jsonb NOT NULL,
	"explanation" text NOT NULL,
	"metrics_snapshot" jsonb,
	"accepted" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planned_workouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"scheduled_date" date NOT NULL,
	"day_of_week" text NOT NULL,
	"workout_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"target_distance_meters" integer,
	"target_duration_seconds" integer,
	"target_pace_min_per_km" numeric,
	"target_heart_rate_zone" integer,
	"workout_steps" jsonb,
	"garmin_workout_id" text,
	"sync_status" text DEFAULT 'pending' NOT NULL,
	"completion_status" text DEFAULT 'pending' NOT NULL,
	"completed_activity_id" uuid,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"goal_id" uuid NOT NULL,
	"plan_version" integer DEFAULT 1 NOT NULL,
	"phase" text NOT NULL,
	"current_week" integer NOT NULL,
	"total_weeks" integer NOT NULL,
	"weekly_mileage_target_km" numeric NOT NULL,
	"generated_by" text NOT NULL,
	"generation_context" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"goal_type" text NOT NULL,
	"race_name" text,
	"race_date" date,
	"target_distance_meters" integer NOT NULL,
	"target_time_seconds" integer,
	"training_days_per_week" integer NOT NULL,
	"preferred_training_days" jsonb NOT NULL,
	"preferred_long_run_day" text NOT NULL,
	"constraints" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garmin_connections" ADD CONSTRAINT "garmin_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_summaries" ADD CONSTRAINT "daily_summaries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrv_records" ADD CONSTRAINT "hrv_records_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sleep_records" ADD CONSTRAINT "sleep_records_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stress_records" ADD CONSTRAINT "stress_records_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adaptations" ADD CONSTRAINT "adaptations_plan_id_training_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."training_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_workouts" ADD CONSTRAINT "planned_workouts_plan_id_training_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."training_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_goal_id_user_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."user_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_goals" ADD CONSTRAINT "user_goals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "garmin_connections_user_id_idx" ON "garmin_connections" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "garmin_connections_garmin_user_id_idx" ON "garmin_connections" USING btree ("garmin_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_summaries_user_date_idx" ON "daily_summaries" USING btree ("user_id","calendar_date");--> statement-breakpoint
CREATE UNIQUE INDEX "hrv_records_user_date_idx" ON "hrv_records" USING btree ("user_id","calendar_date");--> statement-breakpoint
CREATE UNIQUE INDEX "sleep_records_user_date_idx" ON "sleep_records" USING btree ("user_id","calendar_date");--> statement-breakpoint
CREATE UNIQUE INDEX "stress_records_user_date_idx" ON "stress_records" USING btree ("user_id","calendar_date");--> statement-breakpoint
CREATE INDEX "activities_user_start_time_idx" ON "activities" USING btree ("user_id","start_time");--> statement-breakpoint
CREATE UNIQUE INDEX "activities_garmin_activity_id_idx" ON "activities" USING btree ("garmin_activity_id");--> statement-breakpoint
CREATE INDEX "planned_workouts_plan_date_idx" ON "planned_workouts" USING btree ("plan_id","scheduled_date");