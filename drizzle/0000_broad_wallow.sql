CREATE TABLE "allocation_balances" (
	"allocation_id" text NOT NULL,
	"timestamp" bigint NOT NULL,
	"granularity" text NOT NULL,
	"balance_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocation_balances_allocation_id_granularity_timestamp_pk" PRIMARY KEY("allocation_id","granularity","timestamp")
);
--> statement-breakpoint
CREATE TABLE "star_financials" (
	"timestamp" bigint NOT NULL,
	"granularity" text NOT NULL,
	"financials_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "star_financials_granularity_timestamp_pk" PRIMARY KEY("granularity","timestamp")
);
--> statement-breakpoint
CREATE TABLE "token_prices" (
	"timestamp" bigint NOT NULL,
	"granularity" text NOT NULL,
	"prices" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "token_prices_granularity_timestamp_pk" PRIMARY KEY("granularity","timestamp")
);
--> statement-breakpoint
CREATE INDEX "idx_allocation_balances_timestamp" ON "allocation_balances" USING btree ("timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_allocation_balances_allocation_granularity" ON "allocation_balances" USING btree ("allocation_id","granularity","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_star_financials_timestamp" ON "star_financials" USING btree ("timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_token_prices_timestamp" ON "token_prices" USING btree ("timestamp" DESC NULLS LAST);