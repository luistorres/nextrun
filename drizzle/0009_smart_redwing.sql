CREATE TABLE "activity_laps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"lap_index" integer NOT NULL,
	"start_time_in_seconds" integer,
	"total_distance_meters" numeric,
	"total_timer_time_seconds" numeric,
	"avg_speed_mps" numeric,
	"avg_heart_rate" integer,
	"max_heart_rate" integer,
	"avg_run_cadence" numeric,
	"avg_pace_seconds_per_km" numeric,
	"total_ascent_meters" numeric
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "avg_ground_contact_time_ms" numeric;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "avg_vertical_oscillation_mm" numeric;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "avg_vertical_ratio_pct" numeric;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "avg_stride_length_m" numeric;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "lactate_threshold_heart_rate" integer;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "lactate_threshold_pace_mps" numeric;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "fit_decoded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activity_laps" ADD CONSTRAINT "activity_laps_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_laps_activity_lap_idx" ON "activity_laps" USING btree ("activity_id","lap_index");