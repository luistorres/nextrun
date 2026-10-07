ALTER TABLE "adaptations" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
UPDATE "adaptations" AS a
SET "superseded_at" = now()
WHERE a."accepted" IS NULL
  AND EXISTS (
    SELECT 1 FROM "adaptations" AS b
    WHERE b."plan_id" = a."plan_id"
      AND b."accepted" IS NULL
      AND b."created_at" > a."created_at"
  );
