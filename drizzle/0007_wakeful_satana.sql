CREATE TABLE IF NOT EXISTS "shoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"model" text,
	"category" text NOT NULL,
	"starting_km" numeric DEFAULT '0' NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "shoe_id" uuid;--> statement-breakpoint
ALTER TABLE "shoes" ADD CONSTRAINT "shoes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shoes_user_id_idx" ON "shoes" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_shoe_id_shoes_id_fk" FOREIGN KEY ("shoe_id") REFERENCES "public"."shoes"("id") ON DELETE set null ON UPDATE no action;