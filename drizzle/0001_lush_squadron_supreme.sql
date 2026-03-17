CREATE TABLE "block_analitica_snapshots" (
	"timestamp" bigint PRIMARY KEY NOT NULL,
	"response_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validation_reports" (
	"timestamp" bigint PRIMARY KEY NOT NULL,
	"report_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_block_analitica_timestamp" ON "block_analitica_snapshots" USING btree ("timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_validation_reports_timestamp" ON "validation_reports" USING btree ("timestamp" DESC NULLS LAST);