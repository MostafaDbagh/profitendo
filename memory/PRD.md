# ProfitLens — PRD


## Launch Video Production (2026-11-02) — iteration 44
- Produced "الرقم الذي لا تعرفه / The Number You Don't Know" 30s launch video: 1080x1920 9:16, 30fps H.264+AAC, 3.6MB, faststart. 7 scenes: hook (sale chips) → question (blurred emerald $1,398) → chaos (drifting blurred cards) → FOCUS RING reveal over real dashboard → product proof (KPIs / profit-by-product chart / AI assistant panels in 3D tilt) → AI+pricing → logo+tagline+profitendo.com+CTA. Arabic headlines (Cairo) + English subtitles
- Zero AI-generation credits: deterministic HTML/CSS/JS animation (/app/video/anim.html, window.renderFrame(t) manual keyframes), 900 frames captured via pip-installed playwright+chromium (/pw-browsers), audio synthesized with ffmpeg lavfi (cha-ching, 55Hz pulse, riser, whoosh+click at 12.15s, A-major pad, UI ticks, logo thump+shimmer), encoded via imageio-ffmpeg binary
- Real UI assets captured @2x from a seeded demo tenant (متجر الأناقة: sales $3,090 / COGS $1,692 / net $1,398 / margin 45.2%, AI assistant live Q&A) in /app/video/assets/
- Deliverables: /app/frontend/public/profitlens-launch-9x16.mp4 (preview-served) + /app/video/profitlens-launch-9x16.mp4; sources kept (anim.html, record.py, make_audio.py, capture.py) for future iterations. No app code touched


## Homepage SEO Title/Description Update (2026-11-02) — iteration 43
- Homepage ONLY: title → "ProfitLens | Accounting Software for Retail Stores"; meta description → "Manage sales, purchases, inventory, and expenses in one place with ProfitLens. Track your profits and financial reports easily. Start for free."
- Files: public/index.html (static title + description — crawler fallback) + i18n.js seoHomeTitle/seoHomeDesc (AR+EN both set to the exact English strings per user spec, so rendered DOM matches). Other pages/OG tags/design untouched; verified in preview (homepage exact strings rendered, /features /pricing /about titles unchanged). NOT published


## SEO Implementation (2026-11-02) — iteration 42
- NEW public/robots.txt (Allow all, Disallow /api/, Sitemap ref) — serves text/plain 200. NEW public/sitemap.xml — 4 URLs (/, /features, /pricing, /about on profitendo.com) — serves application/xml 200. Both fix the SPA-fallback-masking issue (dev server requires restart to serve new public/ files)
- NEW components/Seo.jsx: zero-dep per-route title + meta description + og:url + canonical (https://profitendo.com) + optional noindex; cleanup restores default on unmount
- NEW pages: FeaturesPage (/features = Modules+Accounting+AI+KPIs+CTA), PricingPage (/pricing = Pricing+FAQ+CTA), AboutPage (/about = mission copy+Audience+HowItWorks+Security+Support+CTA), NotFound (dark 404, noindex, back-home). Landing nav gained المميزات/الأسعار/من نحن links
- App.js: catch-all * now → NotFound (was redirect to /) — eliminates soft-404 indexing; true HTTP 404 remains platform/ingress-level (documented limitation). Auth page noindexed per user choice. Landing keeps logged-in → /dashboard redirect; marketing pages viewable by all
- i18n: 18 new seo*/notFound/about/lpNav keys AR/EN
- Verified E2E: both files served with correct content-types; unique titles+canonicals per page; /auth + /404 carry noindex,nofollow; home has none; logged-in redirect intact; unknown app paths → 404 page. NOT published


## Dashboard Product Profitability Fix (2026-10-23) — iteration 41
- ROOT CAUSE: per-product profit/margin came from compute_metrics(product master data): revenue = selling_price × quantity_sold counter (ignores line discounts & returns), cost = product_cost master field (often 0/stale → zero or 100%-margin garbage). Posted sale lines already carry per-line `cogs` (WAC at sale time) and net `total`; returns carry per-line refund + unit_cost reversal
- FIX (server.py dashboard() only, +~45 lines): aggregate confirmed sale lines per product (Σ items.total revenue, Σ items.cogs, lines vs lines_with_cost), aggregate return lines (refund Σ items.total, cogs_rev Σ unit_cost×qty — no double count), merge: net_revenue = rev − refund, net_cogs = cogs − cogs_rev, profit/margin (zero-revenue guard), override products[] fields for the dashboard response. Products with ANY sold line lacking positive recorded cost → cost_available=False, net_profit/profit_margin = null (never misleading zero). Unsold products untouched. Business KPI pipelines (total_sales/total_product_costs) unchanged. Costing method: existing per-line weighted-average cost snapshot
- Frontend: Dashboard ProductMiniList shows amber "التكلفة غير متوفرة" badge when value null; bar chart filters null-profit products; buildInsights skips null margins. New i18n key costUnavailable AR/EN
- Tests: test_iter35_product_profitability.py — known scenario (A: master cost 0, WAC 60, sell 2@300, return 1 → profit exactly 90.00 / margin 60.0 / revenue 150; B: 0-cost sale → cost_available False, nulls). E2E screenshot: all 4 sections (chart, most profitable, lowest margin, smart insights) consistent. Full suite 250 passed + 1 unrelated kiosk timing flake (passes standalone). NOT published


## Invoice Autosave / Drafts (2026-10-23) — iteration 40
- NEW backend drafts.py: PUT/GET/DELETE /api/drafts/{kind} (kinds: sale, purchase, sale_return, purchase_return) — upsert per (business_id, user_id, kind), unique index; per-user isolation; 401 unauth, 404 unknown kind
- IDEMPOTENCY: optional client_ref (max 64) on SaleInput/PurchaseInput/ReturnInput/PRInput; unique partial index (business_id + client_ref, only string refs — sparse FAILED because nulls are indexed) on sales/purchases/returns/purchase_returns; create endpoints return the existing doc on duplicate ref → retries never duplicate invoices, stock movements, or GL entries. GL double-posting already guarded by ledger partial unique index
- NEW frontend lib/draft.js useInvoiceDraft hook: 800ms debounced autosave, status machine (saving/saved/error), restore-on-mount (server first, localStorage fallback), offline → localStorage copy + error status + auto-retry on reconnect, clearDraft() on successful submit. components/DraftStatus.jsx indicator (تم الحفظ تلقائياً / جارٍ الحفظ / فشل الحفظ)
- Integrated (create mode only — edit mode untouched; drafts never touch stock/GL since they're just payloads): SaleNew (total-first form: total must be entered, unit_price derives), PurchaseNew (combobox picker), ReturnNew, PurchaseReturnModal (skipped when preselect passed). Each form carries a per-session crypto.randomUUID client_ref sent on submit
- Tests: test_iter34_drafts.py (6 pass — draft CRUD/upsert/isolation/401/404, idempotent retries for all 4 doc types incl. stock-once + GL-once assertions). Full suite 249 passed / 22 skipped. E2E: sale + purchase save→reload→restore→submit→cleared→empty; offline→error+local copy→reconnect→saved→cleared
- NOT published (per user instruction: no deploy without approval)


## AI Assistant Partner Purchase-Share Fix (2026-09-20) — iteration 39
- ROOT CAUSE: `_partners_section()` in backend/assistant.py was the AI's only partner data source and projected only {name, role, balance} — ownership_percentage was never sent, `role` doesn't exist on partner docs (always null), and `balance` isn't a stored field (always 0 — it's computed from partner_transactions in partners.py). No purchase totals, contributions, or allocations were provided, so the LLM could only hallucinate or wrongly claim data missing
- FIX (assistant.py only, ~60 lines): _partners_section now computes per partner — ownership_percentage, shared_purchases_total/count (aggregate over NON-cancelled purchases only, no double-count), allocated_share = pct/100 × total (round 2), paid_contributions (sum of contribution txns; withdrawals deliberately NOT payments), remaining_owed = allocated − paid (negative = overpaid credit, signed + explained), computed balance; missing pct → null + explicit missing_data flag; method_note documents the formula for the LLM. SYSTEM_PROMPT rule 9 added: answer from these fields, never from chat history; state missing pct honestly
- Tests: test_iter33_assistant_partners.py — live E2E via /api/assistant/chat on a fresh tenant with the exact scenario: purchases 200.00+171.90 (+cancelled 999.00 excluded), partners 50/50, A contributed 100 (+30 withdrawal ignored), B overpaid 200 → reply verified to contain 371.90, 185.95, 85.95, 14.05 and never claims data missing. 2/2 pass; full suite 242 passed + 1 unrelated flaky PIN-timing test (passes standalone)
- NOT published


## Danger Zone — Delete All Company Data (2026-09-20) — iteration 38
- NEW backend reset.py: DELETE /api/business/data — strict OWNER-only (403 otherwise, 401 anon), server-validated confirmation phrase "DELETE ALL DATA" (400 otherwise). Wipes 14 business-scoped collections (sales, returns, purchases, purchase_returns, expenses, inventory_movements, cash_closings, withdrawals, partners, partner_transactions, products, journal_entries, accounts, assistant_messages) + invoice counters (prefixed {bid}:) + zeroes cash_opening, then re-seeds default chart via accounts.seed_accounts(bid) and resets all business users' onboarding to in_progress (fresh-instance behavior). KEEPS: business, users/credentials, subscriptions, subscription_payments, webhook_events, audit_logs (reset action audit-logged as business.data_reset), sessions. NO opening balances or fake GL created post-reset
- NOTE: preview MongoDB is STANDALONE (no multi-doc transactions possible) — wipe is ordered + idempotent/retryable instead of BEGIN/COMMIT
- Frontend: components/settings/DangerZone.jsx — rose danger card (owner-only render) → 2-step modal: step 1 warning + exact-phrase input (continue disabled until match), step 2 final confirm click; success → toast + /dashboard. 14 i18n keys AR/EN
- Tests: test_iter32_danger_zone.py (5 tests on FRESH disposable tenant: employee 403, anon 401, wrong phrase 400 + no wipe, full wipe verification incl. re-seeded system CoA + kept records + audit, post-reset fresh state: zero KPIs, balanced TB, SAL-0001 numbering restart, immediate re-transaction works, backup intact)
- INCIDENT (resolved): during verification the endpoint was curl-tested against shared tenant test.seller, wiping its accumulated data. Full suite re-run: 240 passed / 1 failed — the only failure was iter31's own onboarding test assuming tenant data; hardened it to self-seed. Suite green (241 passed incl. rerun). LESSON: never execute destructive endpoints against shared fixtures — always disposable tenants
- E2E verified: card owner-only, phrase gate, 2-step modal, success → empty dashboard + onboarding resume banner. NOT published


## Support Email Update (2026-09-20) — iteration 37
- lensprofit@gmail.com → profitlens.team@gmail.com (text + mailto) in: landing conversion.jsx support card, chrome.jsx footer, Subscription.jsx contact card, backend/.env EMAIL_REPLY_TO (Resend reply-to; backend restarted). WhatsApp wa.me/963985566918 untouched. Verified in preview: all mailtos + visible text updated, no layout changes. NOT published


## PWA Icon = Header Logo Match (2026-09-20) — iteration 36
- Icons now rendered PROGRAMMATICALLY from the exact in-app header source of truth: lucide trending-up v0.516.0 node paths (M16 7h6v6 + M22 7l-8.5 8.5-5-5L2 17, stroke 2, round caps/joins) at 50% tile size (w-5 in w-10), solid #10B981 (bg-emerald-500), 30% corner radius (rounded-xl on 40px). Supersampled 4096 → LANCZOS downscale = crisp at all sizes
- Assets: icon-192/512 (squircle + transparent corners), icon-maskable-512 (full-bleed, symbol inside safe zone), apple-touch-icon 180 (full-bleed no-alpha), favicon.ico 16/32/48. Same file paths → manifest.json untouched. SW VERSION v2→v3 for icon cache bust
- Verified: header logo screenshot == generated assets (visual match), all 5 assets 200, manifest defs intact, SW v3 live. NOT published


## PWA Icon Replacement (2026-09-20) — iteration 35
- New brand icon (squircle, dark teal→emerald→blue gradient, pale-mint 3-bar + growth-arrow symbol, glossy depth, no text) generated and processed into all platform assets: icons/icon-192.png + icon-512.png (squircle, transparent corners, purpose any), icon-maskable-512.png (full-bleed programmatic gradient bg — symbol extracted & pasted at 56% safe-zone, fixes double-symbol artifact from naive crop), apple-touch-icon.png (180px full-bleed — iOS no-alpha), favicon.ico (multi-res 16/32/48 with alpha)
- index.html: added favicon.ico link (sizes=any) alongside existing PNG/apple refs; manifest.json paths unchanged (no broken refs). service-worker.js VERSION v1→v2 (cache-version bump so clients purge stale v1 icons — versioning constant only, no SW logic change). GOTCHA: craco dev server caches index.html template — frontend restart required for head changes to serve
- Verified: all 5 assets 200 w/ correct content-types, manifest icon defs intact, head refs live in DOM, SW active, landing renders. NOT published


## PWA Layer (2026-09-20) — iteration 34
- manifest.json: ProfitLens/ProfitLens, Arabic desc, lang ar + dir rtl, standalone (+display_override), start_url/scope "/", bg #0F172A, theme #10B981; icons icon-192/icon-512/icon-maskable-512 + apple-touch-icon (generated brand arrow on #0F172A, maskable safe-zone 55%)
- service-worker.js (CACHE VERSION profitlens-shell/static-v1, old caches purged on activate): /api/* is NETWORK-ONLY (never cached — financial/auth/payment data safe); navigations network-first with /index.html shell fallback; cache-first ONLY for content-hashed build assets + /icons + manifest; SKIP_WAITING message channel
- index.html: manifest link, theme-color, apple-mobile-web-app metas, icon links. index.js + lib/pwa.js: SW registration with updatefound → UpdateBanner (emerald top bar, user-triggered refresh, controllerchange reload guard — never auto-reloads, sessions/forms safe)
- PwaManager.jsx (mounted at App root): OfflineBanner (amber, لا يوجد اتصال بالإنترنت, global), UpdateBanner, InstallPrompt (beforeinstallprompt deferred, 4s delayed floating card, 14-day dismissal memory, never obscures CTAs) + iOS Safari modal with Share→Add-to-Home-Screen steps (no fake native API claims)
- OFFLINE TRANSACTION BLOCKING: useOnlineStatus() hook; sale-submit-btn / purchase-submit-btn / expense-save-btn disabled when offline (no duplicate/corrupt GL possible)
- 14 pwa* i18n keys AR/EN. No backend/business-logic changes; landing page SEO/routes untouched
- E2E verified: manifest fields+icons 200, SW registered/active + api bypass, offline banner show/hide + submit disable/enable, login/dashboard/ledger/sales/purchases/expenses intact, mobile 390px no overflow, install card correctly hidden on desktop-without-prompt. NOT published


## Landing Pricing Badge Update (2026-09-20) — iteration 33
- Pricing section: removed "الأكثر اختياراً" badge from Monthly $29 plan; Annual plan ($99 first year / $299 renewal) now carries "الأكثر توفيراً" badge (EN: "Best value") and holds the emerald highlight border/shadow/elevation; badge is data-driven per plan (badge field, testid {plan}-badge)
- i18n: lpMostPopular replaced by lpBestValue (AR/EN)
- Re-verified E2E: all 12 sections present, all 5 CTAs → /auth?mode=register, WhatsApp/mailto links, mobile 390px no overflow, EN toggle. NOT published


## Public Landing Page (2026-09-20) — iteration 32
- NEW /app/frontend/src/pages/Landing.jsx + components/landing/{chrome,marketing,conversion}.jsx — public marketing page at root "/", dark slate-950 SaaS theme, emerald/teal accents, RTL Arabic primary + EN toggle (lp-lang-toggle), ~110 lp* i18n keys AR/EN
- Sections: Hero (اعرف ربحك الحقيقي. + CTAs + no-card trust tag), 6 Modules cards, Operational→Accounting integration (4 points), AI/Premium section (🤖 + 6 capabilities), KPI visibility grid (abstract bars, NO fake numbers), Target audience chips, 3-step How-it-works, Pricing (Free / Premium $29/mo / Annual $99 first year, $299 renewal — matches subscriptions.py PLANS), Security (5 items), FAQ accordion (7 Q&As), Support (wa.me/963985566918 + mailto:lensprofit@gmail.com), Final CTA + footer
- ROUTING CHANGE: "/" is now public Landing (logged-in users auto-redirect to /dashboard); Dashboard moved to /dashboard; ALL internal redirects updated (RequirePerm, Layout nav, Auth login success + guard + ?mode=register query support, Onboarding continue-later/finish/guards, Subscription/ProductForm guards). Wildcard → landing
- SEO: index.html — Arabic meta description, OpenGraph (og:title/description/type/locale ar+en), Twitter card. Zero external images (pure CSS/lucide) → fast load, no CLS
- No backend changes; accounting/GL/PayPal/auth/subscription logic untouched. All CTAs link to real /auth?mode=register (register form auto-opens) and /auth
- E2E verified: public render all 12 sections, CTA hrefs, FAQ accordion, WhatsApp/email links, logged-in redirect /→/dashboard, sidebar nav, EN LTR switch, mobile 390px no overflow. NOT published


## First-Time Onboarding Wizard (2026-09-20) — iteration 31
- NEW backend onboarding.py (/api/onboarding): GET (lazy-creates user.onboarding doc {step,status,skipped_steps}; EXISTING-USER GUARD: any operational data → status auto_bypassed, required=false), PUT (step 0-5, status in_progress/skipped/completed, skip_step against SKIPPABLE_STEPS; audits completed/skipped), POST /restart (guided tour). Checklist auto-detected from REAL data: business=setup_completed, products=count>0 (archived excluded), opening=cash_opening, first_transaction=sales+purchases+expenses>0. Zero mock numbers
- business.py: new optional business_type field (retail/ecommerce/services/food/wholesale/other, validated) on BusinessUpdate + biz_public — no duplicate records
- Frontend: NEW /onboarding full-screen DARK wizard (slate-950, emerald accents, glass card, RTL + in-wizard lang toggle ob-lang-toggle). Steps: Welcome (أهلاً بك في ProfitLens 👋 / ابدأ الإعداد / تخطي الآن) → Business (name/type/country/currency via PUT /api/business) → Products (add first / import Excel-CSV / skip) → Opening (explanation, no auto GL, deep-link /settings?onboarding=1) → First Action (sale/purchase/expense/skip) → Complete (ممتاز! 🎉 + interactive 4-item checklist with مكتمل/تم تخطيه/غير مكتمل). Components in components/onboarding/steps.jsx; ~40 i18n keys AR/EN
- Flow wiring: Setup.jsx → /onboarding on completion; Setup completed-guard now routes to /onboarding (which bounces to / when not required). RACE FIX: load() one-shot via loadedRef — BusinessStep's checkAuth() was retriggering load and clobbering local step with stale server state. Continue-later → dashboard dark resume banner (dashboard-onboarding-banner, progress bar, both empty and populated dashboard states); deep links /products/new|/sales/new|/purchases/new|/expenses?new=1 with ?onboarding=1 return to wizard after save; /products?import=1 auto-opens ImportModal. Settings: جولة تعريفية link (restart → wizard) + business_type select + cash_opening input added to BusinessSection (backend already supported cash_opening)
- Testing: 6 new tests (test_iter31_onboarding.py — anon 401, auto-bypass guard, restart/tour, full lifecycle persistence, invalid step/status/skip rejected, business_type validation); FULL SUITE 237 passed / 21 skipped. E2E Playwright: register→setup→wizard all 6 steps, deep-link product save→return to wizard→checklist مكتمل, continue-later→banner→resume at persisted step, refresh persistence, mobile 390px, EN toggle LTR, existing-user bypass + tour link. NOT published


## Comprehensive Suite Re-Verification (2026-09-19, read-only)
- User re-issued the iter26-29 suite request (Sales import/export, Purchase Returns, KPI drill-downs, Sales-vs-COGS fix, Products export/bulk-delete, full GL integration). ALL items already implemented; zero code changes needed
- Evidence: 33 targeted tests passed (test_iter26_gl 14 + test_iter29_suite_updates 10 + test_iter28_product_import 9); live checks — trial balance ΣD=ΣC=144,145 balanced, 5 drilldown metrics 200, sales export 200 (21.5KB), products export 200 (5.3KB); UI wiring grep-verified (exportSales/importSales buttons, qa-purchase-return → /purchases?return=1, DrilldownModal on all KPI cards, select-all + bulk-delete with archive guard)
- NOT published


## Owner JSON Backup Export (2026-09-19) — iteration 30
- NEW backend backup.py: GET /api/backup/export — OWNER-only full JSON snapshot streamed as attachment (profitlens-backup-{biz}-{date}.json). Payload: meta (app/format_version/exported_at/business_id) + data {business, users, products, sales, purchases, purchase_returns, returns, expenses, inventory_movements, cash_closings, withdrawals, partners, partner_transactions, accounts, journal_entries, audit_logs} — all strictly business_id-scoped, _id stripped
- SECURITY: user docs exclude password_hash/reset_token_hash/reset_token_expires; business excludes pin_hash; internal collections never exported (sessions, login_attempts, reset_requests, webhook_events, subscription_payments, assistant_messages, counters). Every export audit-logged (backup.exported)
- Frontend: Settings page "النسخ الاحتياطي" card (owner-only render, settings-backup / backup-download-btn) — emerald download button via <a href download> (cookie auth), i18n backupSection/backupDesc/backupDownload AR/EN
- Testing: 6 new tests (test_iter30_backup.py — attachment headers, structure+scoping+DB count parity, secret exclusion incl. $2b$ scan, audit log, employee 403, anon 401); FULL SUITE 231 passed / 21 skipped serial. UI screenshot-verified AR RTL. Restore (upload) NOT included — P2 backlog. NOT published

## Comprehensive Suite Updates (2026-09-17) — iteration 29 (6 workstreams)
- SALES EXPORT/IMPORT: GET /api/sales/export.xlsx (Arabic headers, finance-gated COGS/profit cols); sales_import.py template/preview/commit — rows grouped by invoice ref into multi-item sales, Arabic payment-method mapping (آجل→credit...), commit calls create_sale_record (refactored from create_sale — REAL pipeline: stock, weighted-avg COGS snapshot, inventory movements, GL). Rollback = cancel created invoices on failure. Dup detection via import_ref
- PURCHASE RETURNS: purchase_returns.py (PR- numbers) — return to supplier at ORIGINAL purchase-line unit_cost (never current price), stock decrement + PURCHASE_RETURN movements, returned_qty tracked on purchase items, GL Dr Cash/AP·Cr Inventory linked to original purchase in narration, cancel = restock + reversal. UI: PurchaseReturnModal + per-row button + dashboard quick action qa-purchase-return (/purchases?return=1 auto-opens)
- KPI AUDIT FIX: dashboard total_sales := Σ confirmed invoice totals (posted), total_product_costs := Σ sale.cogs − Σ returns.cogs_reversed (posted records, never current price), net_profit/margin formulas consistent w/ zero-guard; inventory_value = qty × recorded cost. NEW GET /api/dashboard/drilldown?metric= (11 metrics, finance-gated). All 9 dashboard stat cards clickable → DrilldownModal with source tables / formula summaries
- PRODUCTS: GET /api/products/export.xlsx (import-template-compatible), POST /api/products/bulk-delete — history check (sales/purchases/returns) → archive (archived=True, hidden from list) instead of delete + Arabic notice; checkboxes + select-all + bulk bar UI
- Route-order lesson: /api/products/export.xlsx must be registered BEFORE api_router's /products/{product_id} (404 "Product not found" otherwise)
- Testing: 10 new tests (test_iter29_suite_updates.py) + full suite 225 passed / 21 skipped (backend_test demo + test_modes KPI expectations updated to posted-invoice contract); testing_agent iteration_25 (95% — found i18n {{}} vs {} interpolation bug in bulkDeleteSummary → fixed + self-verified). NOT published

## Password-Reset Email Non-Delivery — Diagnostic (2026-09-17, read-only)
- Evidence chain: backend sends all return HTTP 202 + message id (backend logs + live instrumented send replicating exact payload). Proxy validates recipients pre-send (malformed → 422 "undeliverable_recipient... For testing, send to delivered@resend.dev" = proves Resend underneath AND that recipient rejection would surface at request time). Real recipient (rabeealsofrage@gmail.com) was ACCEPTED (202), so NOT sandbox-blocked. No status/logs endpoints exist on the proxy (4 probes → 404). delivered@resend.dev sink also 202.
- CONCLUSION: pipeline works end-to-end; non-delivery is downstream — most probable Gmail spam/junk classification (new shared sender, Arabic RTL + link email). NOT a code/config bug.
- Pending user verification: check Gmail Spam/All Mail for "ProfitLens". Production-grade fix if spam persists: verified custom sending domain (SPF/DKIM) via Emergent support or own Resend account key.
- Constraint kept: no keys exposed/logged; no code changed.

## Bulk Product Import (2026-09-17) — iteration 29
- NEW backend imports.py (/api/products/import): GET /template (openpyxl-generated Arabic .xlsx sample, RTL sheet), POST /preview (parse + auto column-mapping via AR/EN aliases + per-row status new/update/duplicate/invalid with reasons, summary counts — zero writes), POST /commit (compensating rollback: inserted IDs deleted + updated originals restored on any failure; single-node Mongo has no multi-doc transactions)
- Security: extension whitelist (.xlsx/.csv only, .xlsm/.xlsb/.xls rejected), PK magic-byte check, 5MB cap, 2000-row cap, openpyxl read_only+data_only (formulas NEVER evaluated, macros never executed), string sanitization (control chars stripped, length caps, spreadsheet-injection ' prefix on leading = + - @), unit standardization to SPEC_UNITS (قطعة→piece, كيلو→kilogram...)
- GL GUARD verified by test: initial quantity sets stock_qty directly with opening_stock_imported flag; ZERO journal entries from imports; update strategy never touches stock_qty
- Frontend: Products page "استيراد المنتجات" button → components/products/ImportModal.jsx (dark glass Dialog: file pick + template download → auto-mapped column mapping selects → strategy radios (skip/update) → live preview table with status badges + summary → commit → result breakdown). ~35 i18n keys AR/EN
- Testing: 9 tests (test_iter28_product_import.py) — template, statuses/reasons, AR auto-mapping, unit mapping, update strategy, csv, formula non-evaluation, .xlsm rejection, 401 unauth, in-process rollback (fresh Motor client per loop — lesson: xdist workers share core.db's event loop across modules). FULL SUITE 214 passed / 22 skipped. E2E UI verified (upload→preview→commit→product in list). NOT published

## Auth Recovery Pages — Brand Palette Alignment (2026-09-17) — iteration 28b
- ForgotPassword.jsx/ResetPassword.jsx recolored to app tokens: emerald-500/600 primary buttons+links+logo tile (was amber), bg-slate-900 canvas, glassmorphic cards (bg-slate-800/80 backdrop-blur border-slate-700/50), focus rings emerald, headers text-slate-100 / body text-slate-400. Layout/RTL/typography/validation/icons untouched; zero backend changes. Verified desktop + 390px mobile screenshots; 0 amber classes remain. NOT published

## Forgot/Reset Password Flow (2026-09-17) — iteration 28
- NEW backend password_reset.py (router /api/auth): POST /forgot-password (generic RESET_EMAIL_GENERIC response always — zero enumeration; token = secrets.token_urlsafe(32), stored ONLY as SHA-256 reset_token_hash + reset_token_expires 30min on user doc; email via Emergent-managed Resend proxy with playbook guardrail gate _assert_safe_email on every send; Arabic RTL dark email template + EN footer; link = APP_URL/reset-password?token=raw) and POST /reset-password (hash-match, RESET_LINK_INVALID vs RESET_LINK_EXPIRED, bcrypt rehash, immediate token $unset)
- Rate limiting: 5/hour per email + 30/hour per real client IP (X-Forwarded-For aware — CRITICAL: request.client.host is the SHARED ingress proxy IP, alternates 10.208.147.130/133; naive per-IP limiting is diluted/broken behind this ingress). reset_requests collection + TTL index (created_at, 3600s)
- Env: EMERGENT_EMAIL_KEY + EMAIL_FROM_NAME=ProfitLens + EMAIL_REPLY_TO=lensprofit@gmail.com added to backend/.env (key never in code/logs/frontend)
- Frontend: forgot link under password on login (visible after failed login too); NEW dark pages /forgot-password (request → generic sent state) and /reset-password (token from query; mismatch/short validation; invalid/expired state with request-new-link; success → auto-redirect to /auth). Shared AuthShell (dark slate-950/amber). 15 new i18n keys AR/EN. Existing login/Google/kiosk untouched
- Testing: 7 new tests (test_iter27_password_reset.py) — enumeration parity, hashed-only storage, rate limit 429 on 6th, full reset flow (login w/ new pass, reuse rejected, expired rejected), owner password restored after. FULL SUITE 205 passed / 22 skipped. Emails verified sending (proxy 202 Accepted). UI verified (login link, sent state, validation). NOT published

## Ledger & Financial Statements Page (2026-09-16) — iteration 27 (GL UI)
- NEW page /ledger "القيود والقوائم المالية" (nav item navLedger, BookMarked icon, perm accounts.view, route RequirePerm). 4 tabs via shadcn Tabs in components/ledger/: JournalTab (search + type filter + expandable rows showing balanced line breakdown ΣD=ΣC badge), TrialBalanceTab (grouped by account group, code/name/debit/credit/net columns, bottom totals row + متوازن badge), IncomeStatementTab (server-side from/to date range → new optional from_date/to_date params on GET /api/ledger/income-statement), BalanceSheetTab (current vs non-current assets by code, liabilities, equity + current-period earnings, equation validity banner)
- All data strictly from /api/ledger/* GL APIs — zero frontend-computed balances. System account names localized via acct_{code}; GL-created expense category accounts got acct_6810..6890 AR/EN keys; narrations switched to Arabic (فاتورة مبيعات / قيد عكسي — ...)
- Fixed pre-existing missing i18n key colDate (also repairs Subscription payment-history header)
- Testing: backend 198 passed / 22 skipped (incl. new date-range test); browser-verified all 4 tabs AR/RTL, search+filter, expandable journal lines, trial balance "متوازن", balance sheet equation banner. NOT published

## General Ledger Integration (2026-09-16) — iteration 26/27 (GL engine)
- NEW ledger.py: double-entry engine — post_source (balanced validation, idempotent via partial unique index uniq_active_source_entry on (business, source_type, source_id) where kind=posted & is_reversed=False), reverse_source (immutable swap-legs reversals), per-doc posters (sale/purchase/expense/return), ensure_backfilled (idempotent historical posting, backfilled=True), GL-derived statements: GET /api/ledger/journal | /trial-balance | /income-statement | /balance-sheet + POST /api/ledger/backfill (accounts.manage). Auto-heal: statement GETs run ensure_backfilled. Posting failures are non-fatal (logged) and healed by backfill
- Account mapping: cash→1100, card/transfer/other→1200, credit→AR 1300 (sales) / AP 2100 (purchases+expenses); Inventory 1400, Revenue 4100, COGS 5100, Purchase Shipping 5200; expense categories map to subgroup accounts (rent/salaries/advertising→marketing/transportation) or auto-created system accounts 6810+ (meta.expense_category)
- Posting rules: Sale Dr Cash/AR·Cr Revenue + Dr COGS·Cr Inventory; Purchase Dr Inventory+Shipping·Cr Cash/AP; Expense Dr category·Cr Cash/Bank; Return = sale reversal (inventory legs only when restock). Edit = reversal + new entry; Cancel/Delete = reversal. Net-per-source always equals latest doc state
- Credit support added: sales payment_method gains "credit" (pmCredit=آجل); purchases gain NEW payment_method field (default cash) + form select. SaleNew option + PurchaseNew select (minimal dropdown additions, user-approved)
- Testing: 13 new tests (test_iter26_gl.py) — all required scenarios PASS incl. edit/delete reversal netting, backfill idempotency (2nd run = 0), trial-balance equilibrium, balanced balance sheet. iter19 account-count test updated (template=32 codes<6800; GL category accounts 6810+ excluded). FULL SUITE 197 passed / 22 skipped. Frontend compiles; forms verified (credit option both). NOT published
- NOTE: expense delete now fetches doc before deleting (needed for reversal); statements are GL-only as required — existing operational /api/reports/* untouched

## Support Channels in Help Card (2026-09-16) — iteration 27
- Subscription help card "تواصل معنا" now has two real contact buttons (dark theme preserved): WhatsApp (teal, https://wa.me/963985566918, displays 00963985566918, target=_blank rel=noopener) + Email (amber, mailto:lensprofit@gmail.com). Side-by-side desktop (sm:flex-row), stacked full-width mobile. New i18n keys whatsappSupport/emailSupport (AR/EN); testids help-whatsapp-btn/help-email-btn; placeholder toast CTA removed. No subscription/PayPal/pricing logic touched. Verified via screenshot (hrefs + mobile stacking + RTL). NOT published.

## PayPal Button "Regression" — Runtime Config Trace (2026-09-16) — iteration 26
- FOLLOW-UP (same day): user added the 3 keys to "Preview environment configuration" and reported PASS with buttons rendering. Independent re-verification of THIS preview pod: backend/.env still lacks the 3 keys (mtime unchanged), backend process has no PAYPAL env, /api/subscription still paypal_ready=false, screenshot confirms fallbacks still render on product-profit-3.preview.emergentagent.com. CONCLUSION: user's PASS was observed on the DEPLOYED production app (config verified earlier via deployer agent) — the keys were added to the deployment/production secrets scope, which does not propagate into this preview pod. Preview-only gap remains: add the 3 keys to the PREVIEW env scope (or backend/.env) if preview parity is wanted; production is DONE

- User reported buttons regressed after latest changes (monthly "غير معدة", yearly "قريباً"). FULL TRACE performed, no logic touched:
  1. Production secrets store (deployer agent, deployment a610e987/run ce1a4690, redeploy success 12:39Z): ALL 6 backend keys present+non-empty (CLIENT_ID, CLIENT_SECRET, PLAN_MONTHLY, PLAN_YEARLY, MODE, WEBHOOK_ID), PAYPAL_MODE=live confirmed, farm injects them as backend env vars → PRODUCTION paypal_ready=TRUE, yearly available=TRUE → both buttons render on the deployed URL. REACT_APP_PAYPAL_PLAN_YEARLY absent — harmless (plan IDs are backend-driven since iter22)
  2. PREVIEW pod: backend process (pid via supervisor) has ZERO PAYPAL env injected; supervisor conf env line has only APP_URL/INTEGRATION_PROXY_URL; backend/.env has CLIENT_ID(new BAAhfN.., matches frontend ✓)+PLAN_MONTHLY ✓ but CLIENT_SECRET/PLAN_YEARLY/WEBHOOK_ID EMPTY; frontend/.env synced 13:13 with new REACT_APP_PAYPAL_CLIENT_ID ✓ (verified baked in served bundle)
  3. Recovery attempt: pre-fork tool-output artifact (09-15 11:51) shows those 3 keys were ALREADY EMPTY then → values never existed in any pod .env; they live ONLY in the production secrets store, which Emergent does NOT inject into preview
- CONCLUSION: not a code regression — preview environment lacks 3 values; production verified correctly configured. Root fix = user adds PAYPAL_CLIENT_SECRET + PAYPAL_PLAN_YEARLY + PAYPAL_WEBHOOK_ID to preview env (backend/.env). Agent cannot and must not fabricate them

## Trial Upgrades / Sidebar Scroll / Sales Total Field (2026-09-16) — iteration 25
- TRIAL→PAID: no trial gate ever existed in code — plan cards + PayPal checkout render during trial (iter23) and /activate proceeds straight to server-side PayPal verification for trial businesses. PROVEN by new test_iter25_trial_upgrade.py (trial status + plans available; activate with fake ID → provider 4xx/5xx, never a trial block, no fake premium/state written). CAVEAT (external, not code): PayPal plan P-0JU68267C6913291PNKHP5LI has a 30-day trial configured in the PAYPAL DASHBOARD — immediate first CHARGE requires the user to edit the plan in PayPal; app code cannot and must not alter plan IDs
- SIDEBAR: desktop aside (Layout.jsx) gained max-h-screen overflow-y-auto overscroll-contain + data-testid=desktop-sidebar; QA-verified independent scrolling at 1366x500 with zero scroll-chaining to main; mobile drawer implementation untouched and re-verified
- SALES TOTAL FIELD: column 110→200px, input text-base font-bold py-3 + spinner arrows removed ([appearance:textfield] + webkit spin-button none) + col-span-2 on mobile (own row), currency select w-62px. QA found residual clipping after first pass (spinner reserved space) → fixed; re-verified 123456789.99 fits at 1920/390 (scrollWidth==clientWidth). Calculation bindings untouched (QA: qty500/total750→unit 1.5, discount 50→grand 700)
- Testing: full backend suite 184 passed / 22 skipped; testing_agent iteration_24 (sidebar PASS, trial UI PASS, total field found clipping → fixed → self-verified PASS both viewports)
- KNOWN MINOR (out of scope, observed): readonly derived unit-price field (110px col) visually clips extreme values like 123456789.99 (value intact, scrollable)

## Payment Button Availability — Root-Cause Resolution (2026-09-16) — iteration 24
- ROOT CAUSE (proven, not assumed): preview backend process env contains ZERO PAYPAL_* vars (checked /proc/<pid>/environ); no secrets mounts (/run,/etc,/var); backend/.env (mtime 09-15) never received the user's Emergent Secrets — those live in the production secret store bound to a NOT-YET-EXISTING v3 deployment (deployer agent confirmed earlier) and are never injected into preview. So paypal_configured()=False and yearly available=False in preview were CORRECT outputs, not a code bug
- Code flow verified clean end-to-end: env → core.py load_dotenv(override=False, injected prod secrets win) → subscriptions.py module constants → GET /api/subscription plans payload (available + plan_id per plan) → Subscription.jsx dynamic rendering. NO hardcoded "Coming Soon"/"Not Configured" flags exist — both labels are dynamic fallbacks only (grep-verified single conditional render site each)
- REAL FIX APPLIED: backend/.env PAYPAL_MODE sandbox→live — removes the production trap where repo .env would silently force sandbox endpoints against the user's LIVE injected credentials (preview behavior unchanged: without the secret, config still evaluates not-configured). Backend restarted, healthy
- NEW PROOF TESTS: test_iter24_paypal_config_flow.py (5 tests, dummy values, module reload): all-4-vars+MODE=live → configured True, both plans AVAILABLE, api-m.paypal.com base; sandbox/unset mode → sandbox base; missing secret → not configured; missing yearly plan → monthly-only. Full suite 182 passed / 22 skipped
- WHAT THE USER MUST KNOW: real PayPal buttons appear automatically wherever the 4 values exist. To see them in PREVIEW, add PAYPAL_CLIENT_SECRET + PAYPAL_PLAN_YEARLY (+ PAYPAL_WEBHOOK_ID) to /app/backend/.env (Re-publish → Secrets covers PRODUCTION at deploy). Nothing else to change in code

## Subscription Page Dark UI/UX Redesign (2026-09-16) — iteration 23 (UI)
- Subscription.jsx fully rewritten to a DARK SaaS theme (slate-950 canvas, amber #F59E0B + teal #0D9488 accents, glow borders, rounded-2xl contained panel with negative-margin breakout — dark scoped to /subscription ONLY per user decision; rest of app stays light)
- New sections: Hero (badge ارتقِ بأعمالك 🚀 / title اختر الباقة المناسبة لك / subtitle), dual pricing cards (monthly $29 + مرونة كاملة desc; annual $99 with $299 strikethrough + badges الأكثر توفيراً / وفر حتى 67% + first-year-then-$299 label), مقارنة الباقات comparison table (6 rows: AI, smart recommendations, profit analytics, profit reports, price, savings), 4-item trust bar (Secure PayPal/Cancel anytime/Premium support/Quick setup), help card محتاج مساعدة؟ with تواصل معنا CTA → info toast (no real link, user decision)
- Backend PayPal logic untouched; all lifecycle states, masking, SUBSCRIPTION_NOT_LINKED, unverified handling preserved; switch note AR copy updated to يرجى إلغاء الخطة الحالية أولاً قبل الاشتراك بخطة أخرى.
- ~30 new i18n keys AR/EN; design blueprint in /app/design_guidelines.json (design_agent); hero texture via low-opacity masked Unsplash layer
- Testing: testing_agent iteration_23 — 100% across trial/active-monthly/cancel-scheduled/unverified states, Arabic RTL, mobile 390px + tablet 768px, full-PayPal-ID-never-in-DOM check, light-shell regression. Zero issues. App NOT published.

## Subscription UI & State Handling Resolution (2026-09-16) — iteration 23
- get_status hardening (user-approved): paid status WITHOUT paypal_subscription_id → new "unverified" state, assistant_access=false (Premium blocked server-side; underlying data untouched). Owner's legacy unverified state now correctly shows Unverified with no Premium access
- Status payload: billing_interval (month/year), auto_renew (On = active & not cancel-scheduled), next_renewal_date, MASKED paypal_subscription_id (I-XXX***89 — full ID no longer leaks to employees via /status); _parse() hardened for naive BSON datetimes (was a latent 500)
- Cancel/reactivate: subscription-state check now runs BEFORE provider-config check → unlinked subscription returns 400 SUBSCRIPTION_NOT_LINKED (clear message) instead of misleading "Payment provider is not configured"; PayPal suspend/activate flow unchanged (no local toggles without backend confirmation)
- Subscription.jsx: plan cards ALWAYS visible in every state; Current Plan badge (current-plan-monthly/yearly) on active plan; alternative plan keeps explicit PayPal button + switch note (no auto-switch); 8-tile metadata grid (plan/status/start/period/next renewal/interval/payment status/auto-renew/masked ID); new Unverified UI (red note + resubscribe cards); 13 new i18n keys AR/EN
- Testing: 8 new backend tests (test_iter23_verified_state.py) + full suite 177 passed / 22 skipped; testing_agent iteration_22 UI E2E 100% across trial/active-monthly/cancel-scheduled/unverified + Arabic RTL + full-ID-never-in-DOM check; latent _parse bug found by QA → fixed + regression test. App NOT published.

## PayPal LIVE Verification & Production Readiness (2026-09-16) — iteration 22
- Scope: verify + fix code-level bugs only; no real charges, no subscription modifications, no credential exposure; app NOT published
- FIXED (code): yearly plan was hardcoded "Coming soon" despite LIVE yearly plan ID — GET /api/subscription now exposes public plan_id per plan (safe: plan IDs are sent to PayPal from the browser anyway); PayPalSubscribeButton takes a planId prop (no longer env-bound, REACT_APP_PAYPAL_PLAN_* refs removed); Subscription.jsx renders real PayPal buttons for any plan where paypal_ready && plans.{plan}.available, else fallback note/"Coming soon"
- NEW TESTS: test_iter22_webhook_handler.py (7 tests, in-process route calls with signature check mocked — verifies ACTIVATED/PAYMENT.FAILED/CANCELLED/SUSPENDED/SALE.COMPLETED handling, cancel-keeps-access, own-suspend no-downgrade, period extension, idempotent redelivery = no duplicate payment rows, unknown-subscription ack) on throwaway business biz_webhook_test (deleted after); full suite 169 passed / 22 skipped serial
- FINDING (reported, NOT modified per instructions): real owner business biz_1de55c51e602 (ربيع السفرجي) holds a LEGACY UNVERIFIED premium state — assistant_subscription status=active, plan=yearly, NO paypal_subscription_id, NO period_end (pre-rebuild placeholder activation) → currently bypasses PayPal verification. Needs user decision: downgrade to trial/free or re-activate via live PayPal
- FINDING (external, unverifiable from preview): production secret store could not be audited — deployer agent reports no resolvable v3 deployment (app never deployed). PAYPAL_MODE=live + PAYPAL_CLIENT_SECRET + PAYPAL_WEBHOOK_ID + PAYPAL_PLAN_YEARLY must be verified present in Re-publish → Secrets at deploy time; PayPal dashboard webhook must point to {PROD_URL}/api/subscription/webhook with events BILLING.SUBSCRIPTION.ACTIVATED/CANCELLED/SUSPENDED/PAYMENT.FAILED + PAYMENT.SALE.COMPLETED
- Verified: premium gating is server-side only (assistant.py + reports.py call get_status()); activate requires server-side PayPal GET + plan_id match; secrets never leave backend; UI states (trial/plans/not-configured note) render correctly; core regression green across accounts/sales/purchases/inventory/expenses/reports/auth

## Subscription System — Production Rebuild (2026-09-15) — iteration 21
- SECURITY: /api/subscription/activate now REQUIRES paypal_subscription_id and verifies it server-side (PayPal OAuth token cache → GET /v1/billing/subscriptions/{id}; must be ACTIVE + plan_id match) — placeholder/free activation path REMOVED; provider unconfigured → 503 with zero state mutation; pending/approved-but-not-active → pending_payment (no access until webhook/verify confirms ACTIVE)
- States: free / trial / active / pending_payment / past_due / cancellation_scheduled / expired — computed read-only from business.assistant_subscription (period start/end, cancel_at_period_end, cancelled_at); past cycle end → expired (access off, data untouched)
- Cancel = PayPal POST /suspend (stops billing, resumable) + cancel_at_period_end; Reactivate = POST /activate before period end; both owner-only + provider-configured guard
- Webhook /api/subscription/webhook: PAYPAL_WEBHOOK_ID signature verification (verify-webhook-signature), idempotency via webhook_events (_id=event_id), handles ACTIVATED/CANCELLED/SUSPENDED/PAYMENT.FAILED/PAYMENT.SALE.COMPLETED (renewal extends period + payment log)
- Transaction log: subscription_payments (reference_id, status, plan, amount, currency, billing_period, period dates, source, event id); owner-only GET /payments
- PLANS schema flexible: monthly $29/30d live; yearly $299/$99-launch reserved (frontend card "Coming soon" until PAYPAL_PLAN_YEARLY set)
- backend/.env keys added (values empty = user-set): PAYPAL_CLIENT_ID (copied), PAYPAL_CLIENT_SECRET, PAYPAL_PLAN_MONTHLY (copied), PAYPAL_PLAN_YEARLY, PAYPAL_MODE=sandbox, PAYPAL_WEBHOOK_ID; backend restarted
- UI: Subscription.jsx rewritten (status badge ×7 states, plan/price/period/payment cards, cancel AlertDialog with exact end date + no-data-loss copy, reactivate, pending card w/ refresh, payment history table); AssistantHeader badge keys off assistant_access; 30+ new i18n keys AR/EN; payment status labels normalized lowercase
- Tests: iter14 + iter17 rewritten for secure model + new test_iter21_subscription_security.py (13/13); full suite 149 passed / 22 skipped; 2 LOW cosmetic issues fixed after QA
- USER ACTION REQUIRED for live payments: set PAYPAL_CLIENT_SECRET (+ PAYPAL_PLAN_YEARLY when ready) in preview /app/backend/.env and production via Re-publish → Secrets; register webhook URL {APP_URL}/api/subscription/webhook in PayPal dashboard (events: BILLING.SUBSCRIPTION.*, PAYMENT.SALE.COMPLETED) and set PAYPAL_WEBHOOK_ID


## Code Quality Pass (2026-09-14, review fixes) — iteration 20
- Hook deps: all 25 eslint-disable suppressions removed; load() → useCallback with real deps (Partners uses selectedRef), edit-load effects have one-shot loadedRef guards + full deps; AuthContext/AuthCallback/ProductForm/Products warnings resolved; webpack compiles with ZERO warnings
- Stable keys: invoice line rows use crypto.randomUUID() rowId (SaleNew/PurchaseNew/ReturnNew; verified value stability on middle-row removal); AI messages carry ids; recharts Cells key by name; insights key composite (title+idx — duplicate-title collision fix)
- Inline props hoisted: Dashboard chart margin/tick/tooltip/radius consts, ProductDetails tooltip/legend styles, ProductForm mode-toggle options via useMemo
- Component splits: Accounts → components/accounts/{AccountRow,AccountGroupCard,AccountFormModal}; AiAssistant → components/assistant/{AssistantHeader(+Locked),MessageList,ChatComposer}; Auth (327→107 lines) → components/auth/{AuthBranding,AuthCard}; Dashboard → components/dashboard/{ChartsSection,InsightsPanel}; ProductDetails → components/products/BreakdownCard; ProductForm → components/products/CalcPanel; Settings → components/settings/BusinessSection
- Python refactors (behavior-identical, 141 tests green twice): purchases.py helpers (_fetch_products batched $in — kills N+1, _build_lines, _record_movement, _receipt_avg, _edited_avg_cost, _apply_item_edit); assistant.py build_context → 7 section builders, fetch_requested → 6 typed fetchers; core.py compute_metrics → _opt_unit/_age_days; business.py _validate_business_updates (table-driven); accounts.py _system_updates/_custom_updates
- FALSE POSITIVES (no fix, documented): #1 token-in-localStorage — AuthContext stores only a "1" boolean flag (AUTHED_KEY), real auth is httpOnly cookie JWT; #6 `is` comparisons in tests — all are correct `is True/False/None` singleton checks
- TEST HYPOGENE ROOT CAUSE FIXED: flaky test_kiosk_flow::test_excludes_inactive was caused by 570+ stale inactive test employees on the shared tenant exceeding /api/team to_list(500) truncation; purged junk users (role != OWNER) — suite now stable (2 back-to-back full runs green)
- Testing (iteration_20): backend 141/22 twice, frontend E2E all flows; InsightsPanel key warning fixed after report


## Deployment Health Check (2026-09-09)
- deployment_agent static scan: **DEPLOYABLE (warn)** — zero blockers: env files OK, CORS allows production origin, auth redirects use window.location.origin, supervisor config valid, no hardcoded secrets/URLs, compilation passed
- WARN-level perf notes (NOT blockers, backlog): N+1 product fetches in sales/purchases create+update (batch with $in), dashboard unbounded fetches (to_list 10k) → projections/aggregation, compute_cash_balance to_list(100k)×4 → $group aggregation pipelines

## Original Problem Statement
Build a professional bilingual (Arabic-first RTL / English) SaaS MVP called ProfitLens that helps small business owners and e-commerce sellers calculate true profit per product. Core: secure auth, private per-user product data, dashboard with financial KPIs + top/low-margin/high-volume-low-profit lists + charts + rule-based insights, product CRUD with search/filter/sort, live profit calculation, price simulator, demo data, Reports/Settings navigation. No AI, no payments, no WhatsApp in MVP. Main value prop: "Know your real profit" / "اعرف ربحك الحقيقي".

## User Personas
- Small e-commerce seller (Arabic or English speaking) tracking per-product profitability.
- Business owner wanting instant profit visibility without spreadsheets.

## User Choices
- Auth: BOTH email/password (JWT) and Emergent-managed Google OAuth
- Currency: USD
- Charts: richer (bar + donut)
- Design: Emerald/green accents, light & airy minimal

## Architecture
- **Backend** (`/app/backend/server.py`): FastAPI + Motor (MongoDB). JWT access token (7-day httpOnly cookie `access_token` + Bearer fallback), bcrypt hashing, email-based login lockout (5 attempts / 15 min), Google OAuth session exchange via httpx. Products scoped by `user_id`. Endpoints: `/api/auth/*` (register, login, logout, me, google/session, language), `/api/products` CRUD, `/api/dashboard`, `/api/demo/seed`, `/api/demo/clear`.
- **Frontend** (`/app/frontend/src`): React 19 + Tailwind + shadcn/ui + Recharts + Sonner. `LanguageContext` (AR default, RTL toggle, persisted), `AuthContext`, Layout with flipping sidebar, pages: Auth, AuthCallback, Dashboard, Products, ProductForm, ProductDetails, Reports, Settings.
- **Data**: users (user_id, name, email, password_hash, language, created_at), products (product_id, user_id, name, sku, 7 cost/price fields, quantity_sold, is_demo, timestamps), login_attempts, user_sessions.
- Admin seeded: rabeealsofrage@gmail.com (credentials in /app/memory/test_credentials.md).

## Implemented (2026-08-22)
- Full auth: register/login/logout/me, Google OAuth (Emergent), language preference sync
- Dashboard: 5 KPI cards, profit-by-product bar chart, revenue-split donut, top-5 profitable, 5 lowest margin, high-volume-low-profit, translated rule-based insights (negative/low/strong/volume), demo banner
- Products: table with search, 4 filters, 5 sorts, demo badges, delete dialog
- Product form: live calculation panel (unit cost/profit/margin/total) with aria-live
- Product details: 8 stat cards, cost breakdown donut + list, price simulator (new profit/margin/diff)
- Demo data: 8 realistic products (mixed margins incl. one loss-maker), seed/clear
- Reports (summary table + totals, coming-soon note) and Settings (account, language, demo data)
- Testing: 13/13 backend pytest passed; Playwright e2e critical flows passed (iteration_1). Post-test hardening applied: email-only rate limit with non-refreshing lockout, httpx async OAuth call, CORS origins cleanup, recharts minHeight, auth-page language switcher testid.

## Implemented (2026-08-22, upgrade)
- Flexible cost modes: shipping/advertising/payment fee/other costs accept "per unit" or "total for period" (per-unit = total ÷ qty); discount accepts fixed per-unit or percentage of selling price (validated 0-100)
- Product form redesigned: required (name/price/cost/qty) vs optional cost cards with mode toggles, Arabic labels + examples; live calc respects modes
- Product details: full per-unit cost breakdown (required vs optional sections), mode notes ("total ÷ qty", "% of price"), totals + margin rows; zero costs shown muted
- Backend: ProductInput mode fields + validators, compute_metrics with opt_unit normalization + breakdown payload, divide-by-zero guards; dashboard aggregates use normalized values
- Legacy data untouched: missing mode fields default to "unit"; admin demo totals unchanged (29260 / 10823.5 / 6986.5 / 23.88)
- Testing: 12/12 new mode tests + 13/13 regression tests pass; spec examples EX1/EX2/EX3 verified exactly (iteration_2)

## Implemented (2026-08-22, date tracking)
- Products auto-store created_at (never user-editable) and updated_at (bumped on every edit)
- Optional launch_date (تاريخ بدء البيع / Sales Start Date) via date picker in product form; empty → null, details show "غير محدد"
- Product age computed server-side (age_days, clamped ≥0) and displayed localized (Arabic pluralization + English) only when launch_date exists
- Product details: dates card (date added / sales start / last updated / age) with localized formatting
- launch_date validated (YYYY-MM-DD, 422 on invalid); demo/legacy products default to null
- Testing: 12/12 new date tests + all prior suites = 36 pass (iteration_3); profit math and dashboard regression confirmed

## Implemented (2026-08-23, multi-user business SaaS)
- Business entity per user (name, currency USD/EUR/GBP/SAR/AED/EGP/SYP, timezone, allow_negative_stock, cash_opening); /setup onboarding page for new accounts; safe migration for existing users/products (all preserved, demo data intact)
- RBAC: OWNER/MANAGER/EMPLOYEE/ACCOUNTANT with 26 permission keys, role defaults + per-user overrides, backend-enforced via require_perm + field-level stripping (costs/profits/salaries hidden server-side from non-finance users)
- Audit log for all mutations + logins (owner-visible /audit)
- Products: + stock_qty, minimum_stock_level (low-stock warnings)
- Inventory: movement ledger (PURCHASE/SALE/RETURN/ADJUSTMENT/DAMAGE/MANUAL_CORRECTION), stock adjust, negative-stock guard
- Purchases: invoices, weighted average cost (verified 10@12+20@15=$14), stock increase
- Sales: numbered invoices, COGS at WAC snapshot, profit, cancel reverses stock
- Returns: sale-linked, reasons, restock toggle, financial reversal
- Expenses: 10 categories, CRUD
- Cash register: opening + cash sales − refunds − expenses − withdrawals = expected; daily closing with actual/difference; withdrawals module
- Employees page: create login accounts, salaries (owner-only), permission editor
- Partners: ownership %, transactions (allocation/withdrawal/contribution), balances
- Dashboard: quick actions row, business stat cards (inventory value, cash, low stock, returns), permission-aware rendering
- Reports: sales/purchases/inventory/returns/expenses/profit/cash with 7 date-range presets
- Testing: 52 backend tests pass (16 new in test_saas.py) + Playwright e2e (employee filtered nav/UI, setup flow, mobile) — iteration_4

## Bug Fix (2026-08-23, Google OAuth)
- Fixed: OAuth callback bounced users to login. session_id now accepted from both URL fragment and query string (App.js, AuthCallback.jsx, AuthContext.jsx)
- Backend exchange now sets both `access_token` (JWT) and `session_token` (Emergent) httpOnly cookies; get_current_user resolves JWT cookie → session_token cookie (expiry-checked) → Bearer (JWT or session_token); logout clears both + deletes session doc
- user_sessions: datetime expires_at + TTL index
- Testing: 64/64 backend (12 new in test_auth_session.py) + Playwright fragment/query/mobile callback variants all land on dashboard (iteration_5)

## Implemented (2026-08-23, Phase 1 security & permissions)
- Granular 39-key permission catalog ({module}.{action}); role defaults + per-user overrides; legacy keys auto-migrate (startup + at PUT /team permissions)
- Identity: sidebar shows greeting "مرحباً {name} 👋" + business name; role never displayed as identity
- Owner PIN (bcrypt, 4-8 digits): gates partners, cash summary/closings, profit & cash reports, salary edits (403 PIN_REQUIRED → 30-min pin_token via verify); PIN set/clear in Settings
- Inactivity auto-lock (5/10/15/30 min, owner-configured): LockScreen overlay, unlock via password or PIN (/api/auth/unlock), session preserved
- New endpoints: sale edit, purchase edit/cancel (stock reversal + guard), return edit/cancel, status disable for users
- Granular UI gating: nav/quick actions/dashboard cards/tables all follow effective perms; direct URL access redirects
- Audit: product.cost_changed, purchase.cancelled, return.cancelled, sale.updated, employee.salary_changed, pin.updated; read-only (no edit/delete endpoints)
- Testing: 74/74 backend (10 new in test_phase1_security.py) + Playwright Phase 1 flows (greeting, PIN gates, employee restrictions, direct-URL blocks) — iteration_6

## Implemented (2026-08-23, kiosk user-selection flow)
- "Who is using the system?" (من يستخدم النظام؟) gate after every login: names-only member cards (GET /api/auth/kiosk/users — no roles/emails/perms), credential screen per user (password or owner PIN)
- POST /api/auth/switch-user switches session identity (JWT cookie re-issued for target, audited user.switch); topbar "تبديل المستخدم" returns to selection without logout
- Employee email now optional (placeholder @noemail.profitlens.local, hidden in UI); username/code globally unique, auto-generated from name if omitted; POST /api/auth/kiosk-login (username+password, no prior session, brute-force lockout 5/15min keyed by username)
- Auth page: "دخول برمز الموظف" kiosk mode; single-member businesses auto-advance to credential step
- Testing: 87/87 + 1 skip (13 new in test_kiosk_flow.py) + Playwright full flow owner+employee+mobile (iteration_7)


## Bug Fix (2026-08-23, first-time password setup)
- Fixed: kiosk login asked password-less users (Google OAuth accounts) for a password that never existed. UserSelect.jsx now renders a dedicated setup step (kiosk-setup-screen): new + confirm password inputs, auto-login via set-password response cookie; {name} interpolated in description
- Owner PIN gate (user decision): POST /api/auth/set-password now requires a valid owner PIN when the business has pin_hash (401 without/wrong PIN); businesses without PIN allow direct setup; 400 on second attempt; audited user.password_set
- Kiosk routing: password-less user + no business PIN → setup screen directly; password-less + PIN enabled → credential screen in PIN mode with "Create a new password" link (kiosk-setup-link) to setup; PIN/password mode-switch hidden for password-less users
- i18n: setupPasswordLink, setupOwnerPin added (AR/EN)
- Testing: 7/7 new backend tests (test_set_password_flow.py) + Playwright Flow A (no PIN) & Flow B (PIN=4242) both pass; regression on kiosk password/PIN flows clean; state restored — iteration_8
## Backlog

## Bug Fix (2026-08-23, kiosk password-less routing hardening)
- Root cause of user report: test user TEST_NoPw_9cc900 actually HAD a password_hash (set during earlier manual setup testing) → kiosk correctly showed password screen. DB/API state verified; password stripped to restore intended password-less state
- Hardening per user spec: UserSelect.jsx pick() now routes has_password=false → setup screen DIRECTLY, always (never the credential/password screen, regardless of business PIN); dead kiosk-setup-link removed
- Owner PIN input still shown inside the setup screen when business PIN is enabled (earlier user decision); businesses without PIN get password-only setup
- Testing: 20/20 kiosk+set-password backend tests pass (one stale whitelist test updated to allow has_password field); Playwright verified direct-to-setup routing, mismatch toast, auto-login with EMPLOYEE role sidebar filtering, PIN-regression path — iteration_9. State restored (test user password-less+active, PIN cleared)
- P1: Time-based profit trends chart, CSV export in Reports
- P1: Password reset (forgot-password flow)
- P2: Pagination on products list

## Production Cleanup & Login Flow Finalization (2026-08-23, iteration 10)
- Data cleanup: ALL test/demo/temporary users removed from owner's business (biz_1de55c51e602) — only real owner ربيع السفرجي (rabeealsofrage@gmail.com) remains; orphan sessions cleaned
- First-time password setup no longer requires owner PIN (user decision, reversed): set-password works for any authenticated kiosk session targeting a password-less same-business user; 400 if already set; setup screen = new + confirm password only
- Employee creation is OWNER-only (403 for non-owners, even with users.manage override); email AND password now optional — username auto-generated from name, password-less employees self-setup at kiosk
- Employees.jsx: password field optional with hint (passwordOptionalHint AR/EN)
- Unchanged: RBAC catalog, owner-always-full-permissions, audit log, inactivity lock, owner PIN gating for sensitive data, Google OAuth, kiosk names-only payload
- Testing: 93/93 backend (stale PIN-gate tests updated to new spec; new test_iter10_employee_rules.py) + Playwright owner kiosk flow — iteration_10
- P2: Split server.py into routers as it grows

## Owner First-Launch Setup & Kiosk Removal (2026-08-23, iteration 11)
- Owner password REMOVED entirely (user decision): owner is password-less; seed_admin fixed to never re-apply the .env password to an existing account (was force-resetting on every startup)
- First launch: GET /api/auth/setup-state (public) → setup_required=true → /auth shows owner setup screen (username + password + confirm ONLY; no email/PIN/old password/kiosk) → POST /api/auth/owner-setup sets both, logs in, audits; 400 once completed
- Login afterwards: /api/auth/login accepts username OR email in one field (lockout keyed by entered identifier)
- "Who is using the system?" screen REMOVED from post-login flow (user decision): Layout gate removed, login → dashboard directly; topbar switch-user button now logs out to /auth; backend kiosk endpoints remain live
- Employee first-time setup preserved without kiosk: kiosk-login → 403 PASSWORD_SETUP_REQUIRED → Auth page kiosk-setup sub-mode → POST /api/auth/kiosk-set-password (public, only while target has no password)
- Testing: 109/109 backend (new test_iter11_owner_setup.py, 16 tests; conftest.py manages transient owner password for legacy tests) + Playwright first-launch/setup/login flows — iteration_11. Final DB state: owner password-less, setup_required=true, only owner in business
- P2: Multi-currency support
- P3: AI insights, subscriptions/payments, WhatsApp integration (explicitly deferred by user)

## Bug Fix (2026-08-23, dashboard quick-action buttons)
- "إضافة منتج" and "إضافة شراء" dashboard buttons bounced back to dashboard: App.js route guards still used legacy permission keys (products.manage / purchases.manage) that no longer exist in the granular permission catalog, so RequirePerm redirected to /
- Fixed guards to granular keys: /products/new → products.create, /purchases/new → purchases.create; same stale guard fixed on /products/:id/edit (products.edit) and /returns/new (returns.create)
- Verified via Playwright with the test.seller account (real owner's credentials untouched): both buttons open their forms. No other changes


## Feature (2026-08-23, Reports custom date range)
- Reports page: "تاريخ مخصص" range option now shows labeled "من تاريخ" / "إلى تاريخ" date inputs + "عرض التقرير" apply button; report loads ONLY on click (previously auto-fired per keystroke with half-filled ranges); swapped dates auto-corrected; missing dates show a toast
- All preset ranges (اليوم / آخر 7 أيام / آخر 30 يوم / هذا الشهر / الشهر الماضي / هذه السنة) unchanged; backend date_from/date_to params reused as-is
- i18n: rangeCustom/fromLabel/toLabel updated, viewReport + selectBothDates added (AR/EN)
- Verified via Playwright (test.seller account): custom bar renders, apply loads report, presets unaffected

## Feature (2026-08-23, sale item unit type + manual total)
- Sale item row (SaleNew.jsx): required "وحدة القياس" dropdown (غرام/كيلوغرام/ملليلتر/قطعة, default قطعة); "الإجمالي" is now an editable manual input — never auto-computed/overwritten from qty × price; discount still deducted from the manual total and grand total recalculates (subtotal − discount)
- Backend sales.py: SaleItem gains unit_type (validated enum) + optional total; create_sale uses the manual line total when provided (discount capped at it), falls back to price×qty when omitted; stock/COGS/inventory-movement logic untouched
- Verified: curl (manual 37.5−5=32.5 honored vs auto 45; fallback 2×50−10=90; invalid unit 422; stock decrement) + Playwright UI (manual 42.50 preserved at qty 5×price 100; grand total $40.00 after $2.50 discount) + full pytest suite 109 passed serial (-n 0; xdist parallel mode has a PRE-EXISTING race on the shared owner-password conftest fixture — run serially)
## Next Tasks

## Adjustment (2026-08-23, sale unit price derivation)
- SaleNew.jsx: Unit Price is now auto-derived (Unit Price = Total ÷ Quantity), recalculated whenever Quantity or Total changes; field is read-only display. Total stays manually editable and is never overwritten. Discount/final total logic unchanged
- Verified via Playwright with the user's exact examples: qty 500 + total 500 → price 1; total 750 → price 1.5; qty 250 → price 3 with total untouched; discount 50 → grand total 700

## Feature (2026-08-23, per-sale currency selector)
- SaleNew.jsx: "العملة" dropdown next to الإجمالي النهائي with SYP/USD/EGP/EUR/AED (code + localized name via curXXX i18n keys); defaults to the business base_currency; sent with the sale payload
- Backend sales.py: SaleInput.currency validated against core CURRENCIES (400 on invalid); stored per sale record; defaults to business base_currency when omitted; no conversion/exchange-rate logic
- Verified: curl (SYP stored; omitted → USD default; XYZ → 400; sales cancelled after) + Playwright (selector renders with 5 Arabic-labeled options, unit price derivation 750/500=1.5 intact) + full suite 109 passed serial

## Adjustment + Harness Fix (2026-08-24)
- Currency selector moved inside the sale item row directly next to Total (Total: [amount] [SYP ▼], compact codes); removed from the bottom summary; per-sale storage unchanged
- TEST HARNESS FIX: tests/conftest.py contained a destructive session fixture that stripped the REAL owner's password+username on every test run (it wiped the user's personally-set credentials). Fixture removed; all legacy test files repointed to the disposable tenant test.seller@profitlens.app / TestSeller123!; test_iter11_owner_setup.py quarantined (skip — its endpoints are hardwired to the production owner); test_kiosk_flow.py employee cleanup switched from non-existent DELETE /api/team/{id} (405) to PUT status=inactive
- Owner account state: username restored (rabeealsofrag), password-less → user must re-run the one-time setup screen to choose a new password; ALL business data intact
- Verified: full suite 92 passed / 23 skipped serially with owner untouched; Playwright confirmed row-level currency selector, summary removal, unit price derivation (750/500=1.5)
1. User review of the MVP

## Adjustment (2026-08-24, sale summary currency display)
- SaleNew.jsx summary (Subtotal/Discount/Final Total) now renders in the selected sale currency via local fmtSaleMoney(): USD $ / EUR € prefixed; EGP جنيه مصري, SYP ل.س, AED د.إ (AR) or code (EN) suffixed — updates live when the row currency changes
- Display-only change; calculations, backend, and all other features untouched
- Verified via Playwright: USD $750.00/$50.00/$700.00, EGP → جنيه مصري on all three, SYP → ل.س on all three; values and unit-price derivation unchanged
2. Decide P1 items (trends, CSV export, password reset)

## Feature (2026-08-24, AI Financial Assistant)
- New backend module assistant.py: POST /api/assistant/chat (SSE streaming via emergentintegrations LlmChat, OpenAI gpt-5.4, EMERGENT_LLM_KEY in backend/.env) + GET /api/assistant/history; multi-turn sessions persisted in assistant_messages collection (per user + session_id)
- Real-data grounding: build_context() computes server-side aggregates per business — sales (today/7d/30d/6-month monthly, top products), purchases, expenses by category, returns, inventory + low-stock alerts, partners, team salaries — each section included ONLY if the user's effective_permissions allow it; profit/COGS/margin only with products.costs + finance.profit (+finance.margin)
- Multi-currency safety: all money grouped by sale currency (fallback base_currency); system prompt forbids cross-currency sums/conversions and invented numbers
- Frontend: AiAssistant.jsx on the Dashboard (streaming chat via fetch+ReadableStream, markdown tables via react-markdown+remark-gfm, 6 quick-action chips: ملخص اليوم/تقرير المبيعات/الأرباح/المصروفات/المخزون/التقرير الشامل, new-chat reset, localStorage session)
- Verified: exact real numbers cited (SYP 200/80/120/60%, USD 75/40/35/46.7% in one table, currencies never mixed); employee role politely refused profit data with zero leakage; Arabic RTL UI on dashboard; full suite 92 passed serial

## Enhancement (2026-08-24, assistant record-level data access)
- assistant.py now grounds answers in ACTUAL records, not just aggregates: recent_sales (30, full line items/qty/unit_type/price/discount/total/currency), customers summary, recent_purchases (30, with supplier + supplier invoice_number), suppliers summary, recent_expenses (30), recent_returns (30) — all permission-gated like before
- On-demand retrieval (fetch_requested): detects document numbers (S-0001/P-0001/R-0001 + supplier invoice numbers), ISO dates (that day's sales/purchases/expenses/returns), and product/customer/supplier names in the question → fetches exact DB records into requested_records; strictly read-only (find queries only)
- Fixed returns aggregation to use return_date field (was silently empty)
- Verified: invoice S-0007 retrieved exactly (customer شركة الأمل, 2×100, discount 10, total 290 SYP); nonexistent S-9999 → "does not exist" + lists available invoices; date query → exact day records; suite 92 passed serial

## Bug Fix (2026-08-24, Google OAuth login)
- Root cause: with the owner intentionally password-less (setup_required=true), /auth forced owner-setup mode which hid the Google button and all mode-switch links — Google login was unreachable (employees couldn't reach username login either). Auth.jsx: owner-setup mode now includes a Google button (google-login-btn-setup) + "have account? login" link (setup-to-login-link)
- Secondary bug found by testing agent: logout immediately after OAuth landing failed — Layout's `effectiveUser = user || location.state?.user` kept the stale navigate-state user after setUser(false). Fixed: Layout handleLogout navigates to /auth with state:null after logout; AuthContext.logout also clears history state
- Verified by testing agent (iteration_12): callback → dashboard for BOTH hash and query session_id variants (route-intercepted exchange with real session), session persists across reload, invalid session → 401 → /auth, no duplicate users (existing-user branch is update-only), suite 92 passed serial. Logout fix self-verified via same interception method (login→dashboard, reload persists, logout→/auth, login again→dashboard)

## Bug Fix (2026-08-25, session persistence)
- Root cause: AuthContext.checkAuth treated ANY /auth/me failure (transient network/5xx/backend hot-reload restart) as logged-out → Layout guard bounced valid sessions to /auth. Backend session machinery was healthy (7-day JWT + session_token, no 401 interceptor, lock disabled)
- Fix (AuthContext.jsx only): 401/403 → immediate logout (unchanged); any other failure → up to 3 retries with 800/1600/2400ms backoff while checked stays false (guard shows spinner, never premature redirect); then gives up cleanly (no infinite loop)
- Verified by testing agent (iteration_13): baseline navigation/reload persistence, abort-then-recover and 500-then-recover land on dashboard without /auth flash, no-cookie & garbage-cookie → single /me call → /auth, retry cap confirmed, login/logout regression, suite 92 passed serial. Owner account untouched/password-less throughout

## Deployment Health Check (2026-08-25): PASS

## Feature (2026-08-25, AI Assistant subscription system)
- Backend subscriptions.py: business-level 30-day free trial starting on FIRST activation (first status/chat call writes businesses.assistant_trial_started_at); GET /api/subscription/status (all users, inherits business state), GET /api/subscription (owner-only), POST /api/subscription/activate (owner-only placeholder, audited). Assistant chat+history return 403 ASSISTANT_SUBSCRIPTION_EXPIRED when expired — ONLY the assistant locks, rest of app unaffected
- Frontend: widget header badge (trial days / active / expired), locked panel (owner → upgrade link; employee → "contact owner"), /subscription page (status card, trial end date, days remaining, progress bar, features, upgrade button placeholder), owner-only nav link "الاشتراك" (Crown)
- Testing (iteration_14): 92 regression + 7 new subscription tests pass; Playwright verified full lifecycle incl. employee redirect + hidden nav + contact-owner text. Fixed a cosmetic 403-toast flash (Subscription.jsx now guards load by role). Test business subscription state reset

## Update (2026-08-25, Premium tier gating)
- Premium features now require trial/active subscription: AI assistant (already), profit report (backend 403 SUBSCRIPTION_REQUIRED in reports.py — profit analysis covers most-profitable/lowest-margin/high-low-profit), Dashboard analytics block (profit-by-product chart, cost split, top-profitable/lowest-margin mini-lists, smart insights) → PremiumLock upgrade prompt when expired
- Free forever: sales, purchases, inventory, expenses/customers/suppliers, basic reports (sales/purchases/inventory/returns/expenses/cash)
- Plans: Monthly $9.99, Yearly $99 (best-value badge) — activate placeholder accepts plan + price; Subscription page shows free/premium feature split, plan cards, active plan card; PremiumBadge (crown "مميز") on insights title + profit report tab
- components/PremiumLock.jsx: shared lock prompt (owner → upgrade link, employee → contact owner)
- User asked to SKIP final full test — self-verified only: curl lifecycle (trial→SUBSCRIPTION_REQUIRED on profit while sales report free→yearly activate $99→active) + screenshots of all UI states (trial/active/expired dashboard, reports lock, plans). Full regression deferred to final test round

## UI Update (2026-08-25, uniform Premium badges)
- Subtle crown "مميز" PremiumBadge now on: AI assistant header, profit-by-product chart, cost-split chart, all three mini-lists (top profitable / lowest margin / high-volume-low-margin), insights section header + micro crown on each insight card; profit report tab already crowned
- Free sections (low-stock list, stats, basic reports) remain unbadged; zero logic changes

## Bug Fix (2026-08-25, expired-session → re-login stall) — iteration 15
- Root cause (verified, not assumed): (a) axios had NO timeout — a hung /api/auth/login (backend cold start after preview idle) left the login button spinning forever = "login hangs"; (b) checkAuth retries totaled only ~4.8s, far shorter than a pod cold start, then falsely marked the user logged out → bounce to /auth
- Minimal fix: api.js axios timeout 30000; AuthContext checkAuth retries non-auth failures 5× (1/2/4/8/15s ≈ 30s window) with checked=false (guard keeps spinner, no premature redirect); genuine 401/403 → logout + one-time sessionExpired toast gated by localStorage pl_was_authed flag (set on any successful auth, cleared on logout — fresh login-page visits show NO toast)
- Testing agent iteration_15: 10/10 acceptance flows pass incl. CORE re-login-after-expiration 3/3 (+garbage-cookie variant), expiry toast deterministic, no toast on fresh visit, 35s hang → error toast at ~32s (no infinite spinner), cold-start aborts recovered, Google + employee kiosk login intact. Suite: 100 passed serial after fixing 2 pre-existing test-hygiene bugs (test_iter14 activate body + self-aging; test_kiosk_flow SingleMember self-cleanup)
- No business logic, subscriptions, premium gating, or auth architecture changes
- Verified via Playwright DOM checks + screenshot (trial state). Final full regression still deferred per user
- Deployment agent: no blockers — env-based config only (no hardcoded secrets/URLs in source), CORS OK, supervisor ports valid (8001/3000), idempotent admin seed, TTL index safe, requirements.txt/package.json consistent, compilation passed. App is deployment-ready.

## UI Refinement (2026-08-25, AI assistant header)
- Header restructured: title + small crown (ai-crown) + unified compact pill (ai-subscription-badge: "مميز · تجربة مجانية · متبقٍ {days} يوم" / "مميز · اشتراك نشط" / "انتهت التجربة") grouped on the title side; "محادثة جديدة" is a dedicated bordered button on the opposite end; flex-wrap + min-w-0 + whitespace-nowrap pill prevent mobile overlap
- New i18n: subPillTrial, subPillActive (AR/EN); PremiumBadge no longer used inside AiAssistant (still used on dashboard analytics)
- Verified via Playwright desktop + 390px mobile screenshots; zero logic changes. Final regression still deferred per user

## Pricing Update (2026-08-26)
- New Premium pricing: Monthly $29, Annual standard $299/yr, Launch offer $99 first year (renews at $299). Backend subscriptions.py: PLAN_PRICES {monthly:29, yearly:299} + YEARLY_LAUNCH_PRICE 99; activate stores price + renewal_price (yearly only); status exposes renewal_price
- Subscription page: monthly card $29; yearly card $99 with $299 strikethrough + launch-offer note (launchOfferNote) + renewal note on active card (renewalNote); best-value badge now "save 72%"; zero $9.99 references remain (grep-verified); trial logic/gating unchanged
- Verified: curl activate monthly→$29, yearly→$99+renewal $299; screenshot of pricing page; full regression still deferred per user

## Bug Fix (2026-08-26, mobile drawer scroll lock) — iteration 16
- Layout.jsx only: iOS-safe body scroll lock while the mobile drawer is open (position:fixed + top:-scrollYpx + overflow:hidden, cleanup restores exact scrollY) + drawer panel overflow-y-auto/overscroll-contain/touchAction:pan-y for independent menu scrolling
- Testing agent iteration_16: all 6 acceptance criteria pass (backdrop wheel can't move page, drawer scrolls independently, exact position restore, 3× open/close repeatability, drawer bottom reachable at 450px height, nav-from-drawer unlocks, desktop 1920px unaffected), backend suite 100/100 serial

## Integration (2026-08-26, PayPal monthly subscription) — iteration 17
- Monthly plan card on /subscription now renders a live PayPal Subscribe button (@paypal/react-paypal-js, vault+intent=subscription, user's live client-id + plan P-0JU68267C6913291PNKHP5LI = $29/mo with 30-day trial configured in PayPal); onApprove → subscriptionID → POST /api/subscription/activate {plan, paypal_subscription_id} (stored on business + returned by status). Yearly keeps placeholder button (no PayPal plan provided)
- PayPalSubscribeButton.jsx; env keys REACT_APP_PAYPAL_CLIENT_ID/REACT_APP_PAYPAL_PLAN_MONTHLY in frontend/.env
- Server-side verification of PayPal subscriptions NOT implemented (needs PayPal app secret — not provided; optional hardening for later)
- Testing agent iteration_17: 5/5 new backend tests + 105/105 regression; desktop+mobile render, checkout popup launches, employee 403s, final state clean

## Architecture Correction (2026-08-30, catalog-only products, Option A)
- Products are now pure catalog/master data: ProductInput no longer accepts quantity_sold; selling_price strictly Optional (null preserved); new optional currency field (validated against CURRENCIES, no forced default); product_doc/update normalize currency; creation/edit never touches inventory (stock_qty always 0 at creation)
- Transaction-driven quantity_sold: already wired in sales.py (+qty on sale, −qty on cancel) and returns.py (−qty on return, +qty on return cancel) — total/period cost modes now use ACTUAL sold quantity as denominator (Option A chosen by user); products with zero sales get 0 allocation from period costs
- ProductForm.jsx: Sold Quantity field removed from create/edit; selling price optional badge; currency select (form-currency-select, "بدون تحديد" default); Products.jsx table shows "—" for unset price
- Backward compat: existing products keep their stored quantity_sold; all read paths null-safe
- Verified: curl (null price, SYP currency, 422 invalid currency, quantity_sold payload ignored, edit doesn't touch stock, purchase +10 → sale −3 = 7) + form screenshot + full suite 105/105 serial after updating 8 stale tests to seed quantity_sold via Mongo (simulating completed transactions)
- Testing note: while locked, window.scrollY reads 0 (position:fixed) — assert body.style.top instead

## Feature (2026-08-30, Purchases product autocomplete)
- PurchaseNew.jsx: product <select> replaced with ProductAutocomplete (local component) — focus opens the full list, first-character filtering, keyboard nav (arrows/Enter/Escape), outside-click/touch close, no-match empty state; selection maps to existing product_id only (editing the text unmaps it → no duplicates/ghost items) and auto-fills unit cost from the product record's product_cost when available
- RTL/mobile: absolute dropdown with max-h-56 + overscroll-contain + touchAction pan-y; works in the 2-col mobile grid
- Verified via Playwright: focus-list (7 products), EX→3 / EX1→1 filtering, EX1 select → unit cost 40 auto-filled, full purchase submitted ($200) and cancelled after; mobile dropdown OK. Purchase totals/inventory logic untouched
- PENDING (user input needed): annual PayPal Plan ID — yearly card keeps placeholder until REACT_APP_PAYPAL_PLAN_YEARLY value is provided

## Bug Fix (2026-08-30, dashboard 500 KeyError quantity_sold)
- Root cause: catalog-only products created after the architecture correction have NO quantity_sold key (compute_metrics reads it via .get but never writes it into the output), while /api/dashboard still used hard p["quantity_sold"] accesses (4 spots: total_product_costs, total_additional_costs, avg_qty, volume_low_margin) → KeyError → 500 → "Something went wrong" in Preview for any business with such products
- Fix (server.py dashboard only): all four accesses now use (p.get("quantity_sold", 0) or 0); no schema/logic/UI changes. assistant.py:301 verified safe (sets the key explicitly upstream)
- Verified: curl dashboard 200 with a quantity_sold-less product present (real data intact); full pytest suite 112 passed / 22 skipped serial; Playwright login→dashboard loads completely with real KPIs ($4,500 / $2,220 / 49.3%), no error UI; test product cleaned up

## Feature (2026-09-09, country detection & localization)
- Supported currencies extended to 16 (added JOD/IQD/LBP/KWD/QAR/BHD/OMR/YER/TRY to SYP/USD/SAR/AED/EGP/EUR/GBP); backend CURRENCIES + COUNTRY_CODES (16 incl. XX International) + DATE_FORMATS + NUMBER_FORMATS in core.py
- Business doc gains country / date_format (dmy|mdy|ymd) / number_format (western|european|arabic); setup + update endpoints validate them; biz_public + public_user expose them
- New frontend lib/lib/locale.js: COUNTRIES (16 with AR/EN names, currency, timezones), detectCountry() (browser timezone → navigator.language → SY fallback), CURRENCY_OPTIONS/CURRENCY_LABELS (AR labels for all 16), setRegionalPrefs/getRegionalPrefs module cache (synced by AuthContext from user.business)
- Setup wizard: country select auto-prefilled from detection (green hint "detected: X"), currency auto-follows country (still changeable), browser timezone prefilled, date/number format selects. Settings business card: country + 16-currency dropdown + date/number format + protection note ("changing country/currency never converts recorded amounts")
- Display formatting: fmtMoney honors number_format via Intl (en-US/de-DE/ar-EG incl. Arabic-Indic digits); fmtDateTime honors date_format (numeric + localized time). Currency/country changes are label/display-only — verified dashboard total_sales unchanged (4500) after JOD switch
- Verified: curl (JO/JOD/european persist; bad country/currency/format → 400; JOD product accepted); Playwright (Settings selects, SA→SAR auto-sync, european grouping "4.500,00 SAR" on dashboard); regression 141 passed / 22 skipped. Test tenant restored to USD/dmy/western + PIN 4321

## Feature (2026-09-07, Chart of Accounts module) — iteration 19
- New module /app/backend/accounts.py (prefix /api/accounts): account model {code, name, group (assets/liabilities/equity/revenue/cost_of_sales/expenses), subgroup, parent_id, normal_balance (debit/credit, auto from group), is_active, is_system}; idempotent seeding of the full predefined hierarchy (32 system accounts, codes 1000-6700) on first GET per business
- Custom accounts anywhere (max depth 3: group → subgroup → custom); validations: unique code, same-group parent, active parent, cycle + self-parent guard, subgroup-per-group; system accounts editable only for is_active; DELETE blocked for system accounts / accounts with children / accounts linked in journal_entries (deactivate-only path)
- RBAC: new perms accounts.view + accounts.manage (OWNER+ACCOUNTANT manage; MANAGER view; EMPLOYEE none)
- Frontend /accounts (nav "دليل الحسابات", BookOpen): 6 group cards, indented tree, nature + status badges, search (keeps ancestors of matches), create/edit modal (system accounts show note + status-only), deactivate/activate power toggle, delete with confirm + localized Arabic error mapping (errAcct*); system account names i18n'd via acct_{code} keys
- Testing (iteration_19): 20/20 new backend tests (test_iter19_accounts.py) + full regression 141 passed / 22 skipped; Playwright UI verified; 1 HIGH search bug found & fixed (non-root matches now include ancestors — verified: '1100'→2 rows, 'Bank'→4, 'Marketing'→2)
- Test tenant state: 32 system + 0 custom accounts; PIN 4321 re-enabled after suite

## UI Fix (2026-09-06, Purchases items column layout)
- Purchases table Items column: replaced single joined text-block with a compact vertical stacked list — one row per product: name (truncate) + "× qty" + spec unit label (Kilogram/Liter/etc. when the product has spec_unit, AR/EN via specUnitLabel); cell data-testid purchase-items-{purchase_id}
- Display-only change; products fetched once per load to map product_id → spec_unit (no backend/schema/calculation changes)
- Verified in Preview with a 3-item invoice (P-0022): 3 stacked rows, units shown for 2 items, omitted where not set

## Feature (2026-09-06, quick Add-Product from Purchase search)
- PurchaseNew autocomplete no-results state now shows an "إضافة منتج / Add Product" button (purchase-add-product-{i}) inside the dropdown
- Clicking navigates to /products/new with the search text prefilled as the product name + a snapshot of the current purchase form (supplier/invoice/date/notes/additional costs/items + edit PIN); ProductForm returns to the purchase screen (new or /purchases/:id/edit) after save, the form state is restored, and the newly created product appears in the autocomplete (unit cost auto-fills from product_cost)
- Scope: purchase screen only; no logic/calculation/layout changes elsewhere
- Verified in Preview end-to-end: no-results button → prefilled product form → save → return with supplier restored → product selectable (cost 7.5 auto-filled)

## Bug Fixes (2026-08-30, cost field step + invoice-edit gate hardening)
- Cost validation: HTML step="0.01" on cost inputs caused the browser "nearest valid values are 1.82 and 1.83" error for values like 1.827. Fixed step="any" on ProductForm product cost (form-product-cost-input) and PurchaseNew unit cost (purchase-item-cost-{i}); min="0" + required kept; backend already accepted any float ≥0 (verified 1.827 stored exactly)
- Edit gate enforcement: the real owner's business had NO PIN configured, and the old gate silently allowed edits when pin_hash was absent. Now require_edit_pin (core.py) always verifies: business PIN if set → else the account password (pin field carries either) → else 400 PIN_SETUP_REQUIRED. public_user exposes has_password; EditPinModal has 3 modes (pin via /auth/pin/verify, password via /auth/unlock, setup → "configure PIN/password in Settings first" + goToSettings link); list pages ALWAYS open the modal (no more direct-nav bypass when PIN unset); edit-page guards require the verified secret regardless of pin_enabled
- New i18n: editPasswordDesc/wrongPasswordMsg/editNoAuthSetup/goToSettings (AR+EN); stale test_phase1_security sale-edit test updated to the new gate (401 without credentials, 200 with account password)
- Verified: curl (no-cred 401 / wrong 401 / password-fallback 200 / PIN restore), Playwright (cost 1.827 valid; edit blocked until verify in both PIN and password modes; edit page prefills after correct PIN); full suite 121 passed / 22 skipped serial. NOTE: test_set_password_flow.py::_ensure_no_pin clears the shared tenant PIN during full-suite runs — re-set 4321 afterwards (done; pin_enabled=true)

## Feature (2026-08-30, PIN-protected invoice editing) — iteration 18 (2nd)
- Edit (تعديل) Pencil button on every confirmed row of Sales/Purchases/Returns tables (gated by sales.edit/purchases.edit/returns.edit perms; hidden on cancelled docs)
- EditPinModal.jsx: owner-PIN popup per edit (NO token caching — every edit re-verifies via POST /api/auth/pin/verify), shows invoice number, inline Arabic error رمز PIN غير صحيح on wrong PIN; verified PIN passed via router location.state (never persisted) to the edit page
- Edit pages reuse the New-invoice layouts at /sales/:id/edit, /purchases/:id/edit, /returns/:id/edit (RequirePerm *.edit); direct-URL access without PIN state redirects back to the list; PUT re-verifies PIN server-side (401 → toast + back); return edit keeps original-sale link locked (disabled select)
- Backend: require_edit_pin() in core.py (no pin_hash → allowed, else 401 INVALID_PIN before any mutation). update_sale: reverses old item stock then applies new (negative-stock guard), rebuilds lines/subtotal/discount/total/COGS/profit, ADJUSTMENT movements. update_purchase: reverse-at-recorded-cost then WAC re-apply (consumed-stock edge: pure new-line cost), total = subtotal + additional_costs. update_return: restock-aware stock delta, quantity_sold clamped ≥0, qty ≤ original sale line, refund/cogs_reversed rebuilt
- Testing (iteration_18): 9/9 new backend tests (test_iter18_edit_pin.py) + full regression 121 passed / 22 skipped; Playwright E2E: modal open, exact Arabic wrong-PIN error, prefilled forms, direct-URL redirects, PIN required per edit, cancelled rows hide edit. PIN 4321 kept enabled on test tenant (in test_credentials.md)

## Feature (2026-08-30, product Quantity/Spec field) — iteration 18
- Products gain informational-only spec fields: spec_quantity (Optional float ≥0) + spec_unit (fixed list of 10 — piece/gram/kilogram/liter/milliliter/meter/centimeter/box/set/other — OR free-text custom ≤30 chars, trimmed, empty→null); validated in ProductInput (422 on negative qty / >30-char unit)
- CRITICAL invariant honored: spec NEVER touches inventory — creation keeps stock_qty=0, edits don't modify stock; stock changes only via Purchase/Sale/Return transactions. Selling price stays optional, currency selectable, NO Sold Quantity field reintroduced
- ProductForm.jsx: spec quantity input + unit dropdown (form-spec-quantity-input / form-spec-unit-select / form-spec-unit-custom-input), optional badge + "does not affect inventory" hint; edit round-trips custom units via __custom sentinel
- i18n.js: fSpec/fSpecQty/fSpecUnit/fSpecNone/fSpecCustom/fSpecCustomPh/specHint (AR+EN), unitLiter/Meter/Centimeter/Box/Set/Other keys; exports SPEC_UNITS + specUnitLabel() + specLabel(p,t) helpers
- Display: Products.jsx table (spec-cell-{id} under name), SaleNew.jsx product <option> ("Name · 500 ملليلتر (stock)"), PurchaseNew.jsx autocomplete options
- Testing (iteration_18): 7/7 new backend tests (test_spec_feature.py) + full E2E (AR/EN unit lists, custom round-trip, pickers, stock invariant, no-spec-optional) all pass; regression 105 passed / 22 skipped serial. Known dev-only note: editor x-ve instrumentation can inject <span> into <option> (console warning only, non-functional)
## 2026-06 Launch video — Arabic voice-over version (DONE)
- Added professional male Arabic voice-over to the existing 30s launch video WITHOUT touching visuals (video stream copied 1:1, -c:v copy).
- New deliverable: /app/frontend/public/profitlens-launch-9x16-voiceover.mp4 (30.0s, 1080x1920, H.264 copy + AAC 169kbps). Original profitlens-launch-9x16.mp4 left untouched. NOT published anywhere — file only sits in public/ for preview/review.
- Voice: ElevenLabs multilingual-v2 via fal.ai queue (Emergent Universal Key, EMERGENT_LLM_KEY), voice "Daniel", language_code=ar, stability 0.6, similarity 0.8, style 0.3, speed 0.95. 6 line-clips generated individually (/app/video/gen_voiceover.py, /app/video/vo/l1..l6.mp3).
- Script (as given, Levantine-flavored MSA): L1 0.6s كل يوم بتشوف مبيعاتك عم تزيد… | L2 3.45s بس بتعرف قديش عم يضل بجيبك فعلاً؟ | L3 7.0s بين فواتير ومصاريف ومخزون… الربح الحقيقي ممكن يضيع منك. | L4 13.1s مع ProfitLens، كل شي بيصير واضح. | L5 16.6s اعرف ربحك الحقيقي… وخلّي قراراتك أذكى. | L6 25.6s ProfitLens… Know Your Real Profit. — timed to the 7-scene storyboard with a pause before the reveal line.
- Mix: ffmpeg filter_complex — VO clips delayed + amix, music ducked to 45% during narration windows with 0.25s/0.3s ramps, alimiter 0.95; /app/video/mix_voiceover.py.
- User choice: review a preview first before publishing. Audio preview snippets for listening: /app/video/preview/a1..a5.mp3; frame stills verified video intact.

## 2026-06 Targeted feature updates (iteration 36)
1. **Sales form searchable product selector** — new shared `ProductAutocomplete.jsx` component (typeahead, filters by name/SKU, keyboard nav, never auto-creates products; optional onAdd prop). Applied to SaleNew (replaced plain select) and PurchaseNew (replaced inline component, behavior unchanged, SKU added to match text).
2. **Sales form layout** — line-total grid column widened 200px→240px, currency select slimmed to w-[70px].
3. **Purchases Excel export/import** — backend `purchases_import.py`: GET /api/purchases/export.xlsx (template-compatible), GET /api/purchases/import/template, POST /api/purchases/import/preview + /import/commit. Rows group by invoice_ref into multi-item purchases; each goes through real create_purchase pipeline (stock + weighted-avg cost + GL). Dupes (existing import_ref) skipped; existing purchases never modified; import_ref recorded on created docs. Frontend `ImportPurchasesModal.jsx` mirrors sales import wizard (mapping, preview with per-row status/reasons, commit, result summary). Purchases.jsx gained Export + Import buttons.
4. **Excel backup** — new GET /api/backup/export.xlsx (OWNER): styled workbook, sheets = Info, Products, Purchases, Purchase Items, Sales, Sale Items, Expenses, Customers, Suppliers, Inventory, Accounting Records, Purchase Returns, Returns, Cash Closings, Withdrawals, Partners, Partner Transactions, Accounts. Record IDs preserved; bold-styled headers + column widths. JSON export unchanged. Settings page now has both buttons.
5. **Clickable low-stock** — Inventory low-stock banner opens a modal listing only below-minimum products (name, stock, min, shortage, link to product details). List derives from live /api/inventory data.

**Tests**: `backend/tests/test_iter36_purchases_import_backup.py` (7 tests: template, export, preview/commit, duplicate skip, no-modification of existing records, xlsx workbook sheets, JSON backup intact) — all pass; iter30 backup (6) + iter28 product import + iter34 drafts (26 total) pass. Frontend files babel-compile clean. NOT deployed — pending user review.

## 2026-06 Diagnostic: "preview unchanged" investigation (NO code change made)
- Root cause: stale SERVICE WORKER cache in the user's browser, NOT a build/deploy issue. The preview dev-server bundle already contained all new features (verified: `export-purchases-btn`, `import-purchases-btn` on /purchases; typeahead `sale-item-product-0` on /sales/new render correctly in a fresh browser context). Frontend webpack compiled successfully; backend on latest code.
- Contributing factor: `public/service-worker.js` `VERSION = "v3"` never changed since PWA was added, so an old SW stays active for returning visitors and serves cached `/` + `/static/js/bundle.js` (network-first only when the SW actually updates, which requires a byte-change of service-worker.js). PwaManager shows an update banner only when a NEW SW is waiting.
- Minimum fix: bump `VERSION` (e.g. "v4") in `public/service-worker.js` so browsers fetch the new SW → new SW fetches fresh bundle. Recommended hardening: make the dev-server SW lifecycle update-proof (auto SKIP_WAITING in preview) or bump VERSION on every release. NOT applied yet — awaiting user confirmation.
- If issue was on PRODUCTION (profitendo.com): the same SW-staleness applies after the deploy; a redeploy + SW version bump resolves it. Use deployer tool for production-side verification if needed.

## 2026-06 Sales form Total/Currency layout fix
- `SaleNew.jsx`: currency select now `!w-12 min-w-0 px-0 pe-4 text-xs` (48px), Total flex-1 input takes freed space (~228px mobile / ~186px desktop). Verified in 390px mobile + 1920px desktop previews (currency 48px, total 228/186px, layout balanced, RTL intact).
- Service worker VERSION bumped v3→v4 to invalidate stale browser caches (the "preview unchanged" issue). One-line change, no feature code touched.

## 2026-06 Sales form desktop product-field width fix
- `SaleNew.jsx` desktop grid changed from `[1fr_80px_120px_110px_100px_240px_40px]` to `[minmax(280px,1.8fr)_80px_110px_100px_90px_240px_40px]`: product column min 280px (flex-grows), unit-price 120→110px, discount 110→100px, total stays 240px (input ~186px + 48px currency).
- Verified at 1920px: product field 280px + autocomplete dropdown opens; currency 48px; total 186px. Mobile (grid-cols-2) unchanged.

## 2026-06 Sales form product-row responsive redesign (desktop + mobile)
- `SaleNew.jsx` row grid: mobile `grid-cols-2` (product full-width 282px, then Qty/Unit, UnitPrice/Discount, Total+currency 2-col); md (768-1279px) 3-col fluid `[minmax(0,2.4fr)_repeat(2,1fr)]` two rows; xl (≥1280px) single row `[minmax(240px,2.4fr)_72px_120px_112px_112px_216px_40px]` — product 240px, Qty 72, Unit 120, UnitPrice 112, Discount 112, Total cell 216 (162 input + 48 currency), trash 40. Currency pill moved after Total input in DOM so Total reads first in RTL. Mobile scrollWidth == innerWidth (no overflow).
- `ProductAutocomplete.jsx`: input `min-w-0 w-full max-w-full`; dropdown now `w-72 max-w-[80vw]` anchored start (prevents fr-track collapse in RTL grids).
- Verified at 1920px desktop + 390px mobile via Playwright. Awaiting user approval before deploy.

## 2026-06 Sales form Total-cell alignment fix (root cause)
- Root cause of "Total looks detached": the Total input used py-3 while the currency select used py-2.5 and the Unit select had native 70px height — mismatched control heights inside an items-end grid made Total's label sit higher than siblings.
- Fix in `SaleNew.jsx`: Total+currency is now ONE unified bordered cell (`flex h-[42px] rounded-lg border`, currency as a left `border-e` segmented pill, total `flex-1`), so it reads as a single integrated control matching the 42px height of every other input. Unit select pinned to `h-[42px]`. Result: all cells 62px, inputs 40-42px, aligned in one row (desktop) and clean stacked (mobile, no overflow).
- Verified at 1920px desktop + 390px mobile. Amount 1250.75 fully visible. No logic changed.

## 2026-06 Sales form: Total on dedicated row below (desktop)
- `SaleNew.jsx` xl grid now 6 columns `[minmax(240px,2.4fr)_72px_120px_112px_112px_40px]` = Product/Qty/Unit/UnitPrice/Discount/Delete. The Total cell moved AFTER the delete wrapper with `xl:col-span-6 xl:max-w-md`: a prominent full-width second row (h-46, text-lg font-extrabold emerald-700, currency segmented pill w-14). Mobile/tablet grids unchanged (Total stays in the md 3-col flow / mobile 2-col flow).
- Verified 1920px (first row one line + Total row below), 1366px (same), 390px mobile (stacked, no overflow, total y=796 below qty y=599). RTL/autocomplete/calculations untouched.

## 2026-06 Purchases: create-product-from-purchase auto-select workflow
- `PurchaseNew.jsx`: `handleAddProduct` now curried per row (`handleAddProduct(i)`) and records `addProductRow` in the `resume` state. On return, if `location.state.newProductId` is present, it re-fetches `/products`, auto-selects the new product in the initiating row (`addProductRow`), pre-fills `unit_cost` from `product_cost` only if the row's cost is still empty, and toasts the product name. Full purchase state (supplier/invoice/date/notes/additionalCosts/paymentMethod/items) already survived via `resume`.
- `ProductForm.jsx`: on save, captures `data.product_id` and passes it back as `newProductId` alongside `resume`; the back button now returns to `returnTo` with `resume` preserved (cancel no longer discards the purchase form).
- Tested end-to-end in browser: type missing product in row0 → Add Product → prefilled name → save (cost 42.5) → auto-return → row0 auto-selected with name+ID, cost 42.5, qty 7, supplier/invoice preserved, line total $297.50. Cancel path preserves state too. No duplicate products/rows; calculations/inventory logic unchanged.

## 2026-06 Partners page: paid-in capital + profit-share % + total capital + validation
- Backend `partners.py`: `PartnerInput` + `paid_in_capital` (float ≥0) & `capital_currency`; create stores them; NEW `PUT /api/partners/{id}` updates name/ownership/paid_in_capital/currency/notes/status (does NOT touch transactions or balance). Paid-in capital is a passive display field — not income/profit/balance, independent of `ownership_percentage` (profit-share) which the AI assistant continues to use unchanged.
- Frontend `Partners.jsx`: top banner = Total company capital card + profit-share total card (amber warning "must equal 100%" when total ≠ 100%). Partner cards now show profit-share badge, paid-in capital (with currency), balance, and an Edit pencil (manage perm). Add + Edit dialogs include name, profit-share %, paid-in capital + currency selector, notes.
- i18n keys added (ar/en): paidCapitalLabel, totalCapitalLabel, profitShareTotalLabel, pctWarning, capitalEditNote, partnerUpdated; ownershipLabel re-labeled to profit-share.
- Tested: create with capital, edit persists (7500 SAR / 65%), total capital $10,000, 100% → clean card, 85% → amber warning, mobile 390px no overflow, balances unchanged ($0.00), data persists across refetch. Test partners cleaned up.

## 2026-06 Scroll-to-top on route change (fixes create-from-purchase scroll position)
- `App.js`: added a `ScrollToTop` component inside `AppRouter` that calls `window.scrollTo(0,0)` on every pathname change. React Router does not reset scroll on programmatic `navigate()` by default, so pages (like the Product Form reached from a scrolled Purchases form) previously opened mid-page. Now every navigation lands at the top. Verified: scrollY=0 after navigating to /products/new and via the create-from-purchase flow (prefilled name intact).
