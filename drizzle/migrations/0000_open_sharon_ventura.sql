CREATE TABLE `product_features` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`locale` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`icon_key` text,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_features_product_locale_idx` ON `product_features` (`product_id`,`locale`);--> statement-breakpoint
CREATE TABLE `product_images` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`object_key` text NOT NULL,
	`alt_locale` text NOT NULL,
	`alt_text` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_images_product_idx` ON `product_images` (`product_id`);--> statement-breakpoint
CREATE TABLE `product_translations` (
	`product_id` text NOT NULL,
	`locale` text NOT NULL,
	`name` text NOT NULL,
	`summary` text,
	`description` text,
	`seo_title` text,
	`seo_description` text,
	`seo_keywords` text,
	`og_image_key` text,
	`canonical_override` text,
	PRIMARY KEY(`product_id`, `locale`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `product_use_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`locale` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`scenario_title` text NOT NULL,
	`scenario_slug` text,
	`has_own_page` integer DEFAULT 0 NOT NULL,
	`body` text,
	`spec_highlights` text,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_use_cases_product_locale_idx` ON `product_use_cases` (`product_id`,`locale`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_use_cases_slug_unique` ON `product_use_cases` (`product_id`,`locale`,`scenario_slug`);--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`sku` text NOT NULL,
	`stock` integer DEFAULT 0 NOT NULL,
	`weight_grams` integer,
	`option_values` text NOT NULL,
	`moq` integer DEFAULT 1 NOT NULL,
	`lead_time_days_min` integer,
	`lead_time_days_max` integer,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_sku_unique` ON `product_variants` (`sku`);--> statement-breakpoint
CREATE INDEX `product_variants_product_idx` ON `product_variants` (`product_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`status` text NOT NULL,
	`primary_image_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_slug_unique` ON `products` (`slug`);--> statement-breakpoint
CREATE INDEX `products_status_idx` ON `products` (`status`);--> statement-breakpoint
CREATE TABLE `variant_prices` (
	`variant_id` text NOT NULL,
	`currency` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`source` text NOT NULL,
	`rate_used` real,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`variant_id`, `currency`),
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `exchange_rates` (
	`base_currency` text NOT NULL,
	`quote_currency` text NOT NULL,
	`rate` real NOT NULL,
	`fetched_at` integer NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`base_currency`, `quote_currency`)
);
--> statement-breakpoint
CREATE TABLE `inventory_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`ref_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `inventory_adjustments_variant_idx` ON `inventory_adjustments` (`variant_id`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`sku_snapshot` text NOT NULL,
	`name_snapshot` text NOT NULL,
	`unit_price_minor` integer NOT NULL,
	`quantity` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`order_no` text NOT NULL,
	`customer_id` text,
	`status` text NOT NULL,
	`currency` text NOT NULL,
	`subtotal_minor` integer NOT NULL,
	`shipping_minor` integer DEFAULT 0 NOT NULL,
	`tax_minor` integer DEFAULT 0 NOT NULL,
	`total_minor` integer NOT NULL,
	`stripe_payment_intent_id` text,
	`shipping_address_json` text NOT NULL,
	`locale` text NOT NULL,
	`tracking_no` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_order_no_unique` ON `orders` (`order_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_payment_intent_unique` ON `orders` (`stripe_payment_intent_id`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `orders_customer_idx` ON `orders` (`customer_id`);--> statement-breakpoint
CREATE TABLE `stripe_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`processed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `admin_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_email_unique` ON `admin_users` (`email`);--> statement-breakpoint
CREATE TABLE `customer_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`recipient` text NOT NULL,
	`line1` text NOT NULL,
	`line2` text,
	`city` text NOT NULL,
	`state` text,
	`postal_code` text NOT NULL,
	`country` text NOT NULL,
	`phone` text,
	`is_default` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `customer_addresses_customer_idx` ON `customer_addresses` (`customer_id`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`default_locale` text,
	`default_currency` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_email_unique` ON `customers` (`email`);