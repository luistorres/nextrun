ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "avg_run_cadence" numeric;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "max_run_cadence" numeric;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "activity_training_load" numeric;--> statement-breakpoint
ALTER TABLE "adaptations" ADD COLUMN IF NOT EXISTS "user_context" text;--> statement-breakpoint
-- Backfill from stored raw payloads where the fields survived ingestion.
-- (Older rows were validated with a stripping schema, so most predate the
-- fields — new webhook deliveries and Garmin backfill requests fill the rest.)
UPDATE "activities" SET
  "avg_run_cadence" = NULLIF(raw_json->>'averageRunCadenceInStepsPerMinute', '')::numeric,
  "max_run_cadence" = NULLIF(raw_json->>'maxRunCadenceInStepsPerMinute', '')::numeric,
  "activity_training_load" = NULLIF(raw_json->>'activityTrainingLoad', '')::numeric
WHERE raw_json IS NOT NULL
  AND (raw_json ? 'averageRunCadenceInStepsPerMinute' OR raw_json ? 'activityTrainingLoad');
