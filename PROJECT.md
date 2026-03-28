# CARTED

**Smart shopping list powered by your Amazon purchase history**

## What
A shared shopping list tool for Kevin and Meg. Type "I need Deodorant" and it auto-suggests items you've previously ordered on Amazon, complete with links and price history.

## Why
Tired of forgetting what you ordered last time or not knowing the exact product URL. CARTED scrapes Amazon order confirmation emails to build a searchable purchase database, making it easy to re-order items.

## Tech Stack
- **Framework**: Next.js 16 (App Router) + TypeScript + React 19 + Tailwind CSS v4
- **Auth**: NextAuth.js v5 (beta) with Google OAuth (gmail.readonly scope)
- **Database**: Turso (cloud SQLite) with raw libsql queries
- **Hosting**: Vercel → `carted.megandkev.co`
- **Email**: Gmail REST API (no SDK)

## Key Features
- Amazon order email scraping (from:auto-confirm@amazon.com, subject:Ordered)
- 10-year initial scan + daily 6am Pacific cron for new orders
- Manual 30-day sync button
- Shopping list with search/autocomplete from order history
- Price history tracking with visual chart
- Auto-complete shopping items when matching orders arrive
- Pair code system for shared access (Kevin + Meg)
- Amazon deep links (opens Amazon app on iOS)

## GitHub
https://github.com/2kbach/CARTED

## Deployment
- **Primary**: carted.megandkev.co (Vercel)
- **Vercel Project**: carted

## Changelog
- ✅ **2026-03-26 v1.0.0** — Initial build: Next.js project, auth, Turso DB, Gmail scraper, Amazon email parser, shopping list API, search/suggest, dashboard UI, product detail modal, price history, auto-complete, cron setup, pair code system, deployed to Vercel.
- ✅ **2026-03-26 v1.0.0** — DNS + OAuth redirect configured for carted.megandkev.co.
- ❌ **2026-03-26 v1.0.0** — Parser failed to extract items from Amazon emails — only looked at HTML for product links, but modern Amazon emails use plain text format.
- ✅ **2026-03-26 v1.0.1** — Fixed parser to read plain text body (`* Item Name / Quantity: N / X.XX USD` format). Falls back to HTML links, then subject line. Scan now working — items scraping correctly.
- ✅ **2026-03-27 v1.0.1** — Full scan (394 emails, 669 items) and auto-suggest confirmed working. Search/autocomplete returns matching Amazon order history items.
- ✅ **2026-03-27 v1.0.3** — Fixed multi-order email parsing. Amazon batches multiple orders in one email — parser now splits by "Order #" sections so items map to correct orders. Broadened Gmail query to catch older subject formats ("Your Amazon.com order #...").
- ✅ **2026-03-27 v1.0.5** — Added CARTED app icon as favicon and Apple touch icon.
- ✅ **2026-03-27 v1.0.6** — Replaced red external link icon with "View on Amazon" text link on the avatar/name row.
- ✅ **2026-03-27 v1.0.9** — Added delete completed items with native browser confirm dialog. "Delete all" button only shows when completed section is expanded.
- ✅ **2026-03-27 v1.1.2** — Fixed old-format email parser (pre-2024) pulling recommendation widget items instead of actual order items. Subject-line extraction now prioritized over HTML fallback. "Search on Amazon" link added to item cards without product URLs.
- ✅ **2026-03-27 v1.2.0** — Phase 2 shipped: Amazon product suggestions via Canopy API. Typing items not in order history shows rich product cards with images, prices, and ratings. Selecting adds to shopping list with affiliate-tagged URL.

## Case Study

> **2026-03-26** — CARTED started as a simple idea: "I need to remember to buy XYZ." The insight was that Amazon order confirmation emails contain a goldmine of structured data — item names, prices, quantities, product URLs. Instead of building yet another generic shopping list, we built one that knows your entire Amazon purchase history.
>
> Chose Next.js + Turso + Vercel (same stack as SCHEDULED) for fast iteration. Reused the Google OAuth app and Gmail API patterns from SCHEDULED, but simplified significantly — no AI classification needed since Amazon order emails have a consistent format. Used regex/DOM parsing instead of Claude API calls, making the initial 10-year scan free and fast.
>
> The email parser uses three strategies in priority order: (1) product link extraction from `<a href>` tags, (2) structured data fields, (3) subject line parsing. This handles both HTML-rich and plain-text order confirmations.
>
> Key UX decision: the search input does double duty — it searches previous orders for autocomplete suggestions, and if nothing matches, the typed text becomes a new shopping list item. This means the most common flow (re-ordering something) is faster than adding something new.

## Feature Parking Lot
- ~~**2026-03-27** — Be able to delete completed items *(submitted via PARKED)*~~ ✅ shipped v1.0.9
- ~~**2026-03-26** — Phase 2: Amazon product suggestions for items not in order history *(planned)*~~ ✅ shipped v1.2.0 (via Canopy API — PA-API requires 3 qualifying sales)
- **2026-03-26** — Purchase analytics dashboard (spending by category, monthly totals) *(suggested by Claude)*
- **2026-03-26** — Shared list notifications (push/SMS when partner adds an item) *(suggested by Claude)*
- **2026-03-26** — Recurring items detection ("you buy this every 3 months") *(suggested by Claude)*
