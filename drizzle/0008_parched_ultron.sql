CREATE TABLE IF NOT EXISTS "garmin_file_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"summary_id" text NOT NULL,
	"garmin_activity_id" text,
	"file_type" text NOT NULL,
	"callback_url" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"stored_path" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"downloaded_at" timestamp with time zone,
	"expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "garmin_file_events" ADD CONSTRAINT "garmin_file_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "garmin_file_events_user_summary_idx" ON "garmin_file_events" USING btree ("user_id","summary_id");