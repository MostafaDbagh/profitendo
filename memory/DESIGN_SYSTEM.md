# Existing design system: preservation baseline

Recorded: 2026-11-11. User explicitly requested deep exploration and persistent
memory so subsequent work does not break the existing design system.

## Evidence and limits

This is a source-code inspection, not a live-browser visual/accessibility audit.
No application styles or UI behavior were changed during this review. Capture
real baseline screenshots before implementing changes; do not claim visual QA
has passed based only on these source findings.

Primary references:
- `frontend/src/index.css`: semantic color variables, fonts, base styles.
- `frontend/tailwind.config.js`: token mappings, radius overrides, animation.
- `frontend/components.json`: shadcn new-york, CSS variables, Lucide, JSX.
- `frontend/src/components/Layout.jsx`: authenticated shell and navigation.
- `frontend/src/pages/Products.jsx`, `Inventory.jsx`, `Dashboard.jsx`: listings,
  cards, status badges, loading and empty states.
- `frontend/src/pages/PurchaseNew.jsx`: document-entry layout and totals.
- `frontend/src/components/ProductAutocomplete.jsx`: shared search/input style.
- `frontend/src/components/auth/AuthCard.jsx`: authentication styling.
- `frontend/src/components/ui/{button,input,card,dialog}.jsx`: local primitives.
- `frontend/src/context/LanguageContext.jsx`, `i18n.js`, `lib/locale.js`:
  direction, translation and regional preferences.
- `frontend/src/App.js`: toast integration and routes.
- `frontend/public/index.html`: Cairo/Outfit loading and emerald theme color.
- `frontend/src/components/landing/chrome.jsx`: separate public dark shell.

## 1. Separate visual contexts

The operational application is light: slate-50 canvas, white panels, slate text,
emerald primary actions. Its style should govern new warehouse/shop services.

The public landing chrome is dark slate with emerald branding. Subscription
design guidance also contains dark slate/amber styling. Preserve each route's
actual treatment; do not spread either dark theme into operational screens.

`design_guidelines.json` is not a canonical global specification: its own
instructions mention independently encapsulating the dark theme from the light
app shell, pricing cards and annual-plan badges. Its Tajawal-first typography,
amber CTA and prohibition on native selects/date inputs do not describe the
current operational app (which uses Cairo/Outfit and native controls).

## 2. Actual foundational tokens

Semantic CSS variables in `index.css` (HSL values):

| Token | Value | Meaning |
|---|---|---|
| background | 210 40% 98% | Light slate canvas |
| foreground | 222 47% 11% | Dark primary text |
| card / popover | 0 0% 100% | White surfaces |
| primary / ring | 160 84% 39% | Emerald accent/focus |
| primary-foreground | 0 0% 100% | White action text |
| secondary / muted | 210 40% 96% | Soft neutral fill |
| muted-foreground | 215 16% 47% | Secondary text |
| accent | 160 84% 96% | Pale emerald fill |
| accent-foreground | 160 84% 25% | Dark emerald text |
| destructive | 0 84% 60% | Red destructive state |
| border / input | 214 32% 91% | Light neutral borders |
| radius | 0.75rem | Shared radius base |

Chart tokens: emerald, red, slate, amber and sky. Operational code also uses
explicit Tailwind slate/emerald classes extensively. Preserve their rendered
appearance when extracting shared tokens; avoid a broad token migration now.

Tailwind overrides `rounded-lg` to 12px, `rounded-md` to 10px, `rounded-sm` to
8px via the radius variable. `rounded-xl` is also normally 12px and
`rounded-2xl` 16px. Do not assume default Tailwind lg/md/sm radii when porting.

## 3. Typography, icons and numeric presentation

- Arabic body: Cairo; English body: Outfit. Loaded weights 400-800.
- Page titles: `text-2xl md:text-3xl font-bold text-slate-900`.
- Helper text: `text-sm text-slate-500`; labels generally text-sm medium,
  slate-700; metadata commonly text-xs.
- KPI values: text-2xl bold; document total: text-xl extra-bold emerald-600.
- `.tabular` enables tabular numerals for quantities, amounts and identifiers.
- Use existing money/date formatting and regional number preferences rather
  than adding independent formatting logic per service.
- Lucide is the operational icon family: usually 16px controls, 20px navigation
  and status icons; decorative icon tiles 36-56px depending on context.
- Keep existing branding. The separate Jawla marketing preference is not a
  request to rebrand this ProfitLens application.

## 4. Application shell and spacing

- Light canvas, white desktop sidebar; sidebar `w-72`, sticky full height,
  independently scrollable, visible from `md` (768px).
- Main content `max-w-7xl`, full width, centered within the remaining column.
- Main gutters `px-4 md:px-8`, vertical padding `py-6 md:py-8`.
- Sticky white/translucent header with light border; sidebar border uses `end`.
- Mobile drawer uses an overlay, independent scrolling and body scroll lock
  with scroll position restoration. Preserve those behaviors.
- Navigation uses icon + translated label, rounded-xl, active emerald-50 fill,
  emerald-700 text and emerald-100 border; permissions control visibility.
- Pages typically `space-y-6`; toolbar wraps with gap-3. Forms/cards generally
  p-5 or p-6. Preserve this density rather than introducing oversized panels.

## 5. Components and interaction patterns

There are TWO implementation layers: local shadcn/Radix primitives and custom
Tailwind-styled native elements. Installed primitives are not proof that all
pages use them. Match the closest existing operational screen.

- Primary page action: emerald-500 -> emerald-600 hover, white text,
  rounded-lg, text-sm semibold, px-5 py-2.5, icon + label.
- Secondary action: white/transparent, slate border/text or emerald outline.
- Native shared input style in ProductAutocomplete: full width, px-3 py-2.5,
  rounded-lg, slate-200 border, white fill, text-sm and emerald focus ring.
- Auth/search inputs use logical start icon position and ps-10/pe-4 padding.
- shadcn Input is h-9/rounded-md; shadcn Button is also h-9 by default.
  Replacing custom controls blindly would change sizing and appearance.
- Cards: white, slate-200 border, rounded-xl, subtle shadow-sm. Auth card uses
  rounded-2xl and p-8. Larger shadows are mostly reserved for overlays.
- Tables: white rounded-xl bordered container with overflow-x-auto; text-sm,
  muted headers, logical alignment, subtle row dividers. Inventory tables have
  min-width 680px, px-5 and py-3/3.5 cells. Keep horizontal scroll contained.
- Status badges: small bold text, pill shape, pale fill plus border; emerald
  healthy, amber warning and red problem. Include text, not color alone.
- Document forms: white sections, 1 column -> 2 at sm; line items reflow to
  compact grids on mobile and aligned columns at md. Totals use a separate
  panel with emerald emphasis. Preserve draft status and disabled saving state.
- ProductAutocomplete: name/SKU search, arrows/Enter/Escape, selected item,
  outside click handling, bounded scroll menu, optional add-product flow.
  Barcode behavior should extend this vocabulary without changing its styling.
- Toasts: Sonner, top-center, rich colors. DraftStatus combines icon and text
  for saving/saved/error (slate/emerald/amber).
- Dialogs: local Radix wrapper, z-50 overlay/content, max-w-lg default, p-6,
  animation and accessible title primitives. Preserve caller size overrides.
- Existing loading uses emerald spinners; empty states use centered icons and
  translated copy. Do not mix in a new loading/empty-state aesthetic per service.

## 6. Language, responsive behavior and motion

LanguageProvider defaults to Arabic, persists `profitlens_lang`, sets html lang
and dir, and supplies t(). English fallback exists for missing translations.
Use logical utilities (`start/end`, `ps/pe`, `ms/me`, `text-start/end`,
`border-e`) and mirror directional arrows where appropriate. Keep machine
identifiers/email inputs legible in LTR within Arabic layouts.

Use existing breakpoints (sm 640, md 768, lg 1024) and check at 320/390, 768,
1024 and 1440px. Preserve table overflow, form reflow, drawer behavior and
long Arabic labels. Check both language directions in every new service.

`App.css` defines fade-up: 12px translation, opacity, 0.5s. Common interactions
use color transitions around 150-200ms; some dashboard cards also lift slightly.
Retain the restrained motion; consider reduced-motion support when touching it.

## 7. Existing inconsistencies: inspect, do not blindly propagate

- Dark guidance conflicts with light app implementation; scope by route.
- Custom controls and shadcn controls have different heights/radii/shadows.
- Global focus-visible rules remove native outlines; verify replacement rings
  on every keyboard control, especially icon-only buttons.
- Some labels lack explicit input association; some icon buttons lack names.
- Dashboard clickable StatCard uses role=button without visible keyboard
  handling in the reviewed component. Accessibility needs runtime verification.
- Dialog wrapper has physical `right-4`, `sm:text-left` and English 'Close';
  test and address deliberately for Arabic, without redesigning the dialog.
- Some existing code uses transition-all although scoped JSON discourages it.
- Light-only root semantic tokens exist; darkMode configuration alone does not
  prove a complete app-wide dark theme is implemented.

These are source-level findings, not a completed contrast, keyboard or browser
audit. Preserve intended appearance, not accidental defects.

## 8. Migration and future-service guardrails

1. Backend replacement/TypeScript adoption must not reset CSS, fonts or tokens.
2. Keep Layout, translations, local primitives, shared forms and test IDs where
   compatible. Adapt API contracts at the data layer before rewriting views.
3. Build receiving from PurchaseNew; stock views from Inventory; catalogue from
   Products; permissions/settings from existing employee/settings conventions.
4. Add location selection within existing header/form patterns; role-specific
   navigation uses the same shell. New role screens share the same visual family.
5. Avoid adding a competing component kit or blanket restyling components.
6. For each UI change, capture baseline and after screenshots in AR/EN on mobile
   and desktop. Check normal, empty, loading, error, disabled, dropdown, dialog,
   validation and draft states relevant to that change.
7. Verify keyboard navigation, focus, accessible labels, viewport overflow,
   totals readability and scanning focus behavior. Financial confirmation must
   reflect a successful server response, not optimistic stock success.
8. Any broad visual redesign requires an explicit user request.

## Next verification work

Before the first frontend implementation, run the existing app with authorized
test access and capture representative Dashboard, Products, Inventory,
PurchaseNew, Auth and dialog states. Supplement this source baseline with the
screenshots. No live credentials, demo data or screenshots were fabricated in
this review.


## Service 2 visual verification (2026-11-11)

Added opt-in /auth-v2. Reused AuthBranding and MobileLogo, Cairo/Outfit,
slate-50/white/emerald palette, rounded-2xl auth card, existing control spacing
and Lucide input icons. Legacy /auth is unchanged. Screenshots in
`tmp/auth-design/` include controlled legacy login baselines and new AR/EN
login at desktop/mobile sizes, masked MFA setup and account-security views.
Browser checks verified no horizontal overflow at 320/390/1440px and correct
RTL/LTR document direction. Reviewed screenshots preserve the visual family.
This verification covers authentication only, not a full operational-app audit.

## Input placeholder preference (2026-11-11)

User requests polished, useful input placeholders. Keep visible labels; use
short field-specific examples or instructions in Arabic and English, readable
slate placeholder text, and appropriate email/code direction. Authentication
v2 now applies these conventions, including distinct current/new password
and authenticator setup hints. Carry this convention into new service forms.

## Service 3 visual verification (2026-11-11)

Business settings/team/roles/invitations/activity use the existing slate-50
canvas, white panels, emerald accents, Cairo/Outfit, logical RTL spacing, w-72
desktop navigation and established table/form density. The optional workspace
is separate from the legacy auth-bound Layout while API migration continues.
Captured legacy team baseline and real new-API screenshots in
`tmp/business-design/`; checked AR/EN at 320/390/768/1440px, modal focus return
and page overflow. Table content scrolls within its panel on narrow screens.
The existing Dialog component now accepts a translated close label (default
remains English) and uses logical end positioning. New dialogs use explicit
start alignment, constrained mobile width/height and localized close controls.

## Service 4 visual verification (2026-11-11)

/platform-v2 reuses the Service 3 light operational workspace, w-72 desktop
navigation, white slate-bordered tables, semantic form labels, emerald controls
and existing shared dialog. Platform changes show explicit impact text and a
required short reason with a localized example. Captured and inspected desktop
business list, Arabic mobile list and confirmation dialog in tmp/platform-design.
Browser checks cover AR/EN 320/390/768/1440px, page overflow and Escape focus
return. Wide tables scroll inside their panel; customer routes remain unchanged.

## Billing foundation UI verification (2026-11-11)

The new business subscription tab is an administrative usage/trial view within
the existing light workspace. The legacy dark Subscription.jsx pricing treatment
is unchanged. Super Admin plan creation reuses shared fields, modal, tables and
Arabic/English controls. Trial activation has explicit no-payment confirmation;
paid checkout is absent. Useful localized placeholders are present throughout.
Screenshots in tmp/billing-design cover desktop active trial and Arabic mobile
expired trial/plan form. Browser checks cover 320/390/768/1440px and dialog focus.

## Receipt history verification (2026-11-11)

Added a receipt table inside the existing light business subscription pane, with
localized empty/error/retry states, date/money formatting, masked LTR references
and existing pagination. Inspected desktop empty state and Arabic mobile history
in tmp/receipt-design. Browser checks cover 320/390/768/1440px in both languages.
The used/maximum team ratio is isolated in an LTR span to prevent Arabic visual
reversal while preserving RTL alignment. No new palette or layout system added.


## Cancellation and locations verification (2026-11-11)

Used existing business/admin typography, palette, fields, dialogs and tables.
Billing recovery is reachable separately from operational business context so a
suspended owner can cancel. Before screenshots: tmp/cancellation-design/before-*.
After screenshots cover AR/EN 320/390/768/1440px cancellation states and dialogs;
reviewed Arabic 390px confirmation and desktop confirmed state. Browser tests
check modal focus restoration, pending/confirmed states and error recovery.

Warehouse/shop management reuses the business shell and shared Field/Select,
Modal/Table/Pager components with localized examples. No new UI kit or theme.
Screenshots: tmp/location-design. Reviewed desktop list and Arabic mobile form.
Adjusted the location table to a 680px minimum width (matching the inventory
pattern) so narrow screens scroll inside the table instead of compressing rows.


## Catalogue UI verification (2026-11-11)

Product catalogue reuses the business shell, shared labeled Field/Select,
Modal/Table/Pager and existing emerald/slate styles. Preserved separate legacy
Products screen. Captured workspace before screenshots with the existing baseline
script, then catalogue screenshots in tmp/catalogue-design. Inspected desktop
list and Arabic 390px form. Dialogs scroll within 90vh; tables scroll internally
with the existing 680px minimum. Browser flows exercise real API writes, cost
redaction, barcode Enter focus and 320/390/768/1440px in both languages.


## Excel import UI verification (2026-11-11)

Reused shared light Modal/Table/Pager/Feedback and emerald actions. Bilingual
upload guidance, row/field errors, exact price preview and explicit confirmation.
Baseline snapshots: tmp/import-design/before-*. After: tmp/import-design/new-*.
Inspected desktop errors and Arabic mobile preview. Found and corrected a grid
minimum-width issue so the wide preview table scrolls inside its own panel rather
than stretching the dialog. Browser tests now assert dialog horizontal overflow
as well as page overflow at 320/390/768/1440px in both languages.


## Services 8–10 design preservation

Baseline: tmp/operations-design/before-en-1440.png and before-ar-390.png,
captured from the existing catalogue before these UI additions.
Reused Field, Select, Table, Pager, Modal, Feedback and shared button/panel classes.
New screens use the established slate/white/emerald treatment with Cairo/Outfit.
Receiving uses a prominent labelled barcode input, product rows with quantity/cost
fields, explicit draft/review/confirm stages and a confirmation dialog. Supplier
and location selectors search and paginate in keyboard-accessible dialogs.
Costs are absent from staff views. Totals group quantities by base unit.
Arabic/English widths 320/390/768/1024/1440 checked; horizontal table scrolling
stays inside panels. Screenshot evidence: tmp/operations-design/new-*.
Final screenshot review widened the receiving barcode field to a full mobile row
and fixed single-scan quantity focus after React renders the new line. Repeated
scans preserve barcode focus. Final AR/EN 320/390/1440 checks and screenshots passed.


## Service 11 design preservation

Before: tmp/transfer-design/before-en-1440.png and before-ar-390.png captured
from current receiving/stock screens. New transfer UI reuses the business shell,
Field, RecordPicker, Table, Pager, Feedback, Modal and button/panel styles.
No new UI kit or theme. Route references are concise human-readable TR/date codes.
Drafts and physical posting actions remain separate, with explicit review dialogs.
Source/destination labels are explicit in Arabic; quantities remain LTR and tables
scroll within their panels. Return/loss history is shown as permanent dated events.
Screenshots: tmp/transfer-design/new-*; AR/EN list/editor/history at
320/390/768/1024/1440, with arrival forms/review dialogs at 320/390/1440.
Final review confirmed contained horizontal scrolling, readable mobile dialogs,
and focus restoration after Escape. Explicit From/To labels avoid ambiguous RTL
arrows; event forms say “Record arrival” until the server confirms the operation.


## Service 12 design verification — 2026-11-11

Sales/POS extends business-v2 with the existing fields, searchable picker, panels,
status-filtered table, feedback and dialogs. Preserved slate/white/emerald,
Outfit/Cairo, logical RTL spacing and shared focus behavior. Barcode input spans
its own row on narrow phones so examples remain readable. Receipts use a separate
print view with navigation/actions hidden in print media. Before/after evidence
is in tmp/sales-design; browser checks cover Arabic/English at 320, 390, 768, 1024
and 1440 pixels, checkout errors, manual card entry and cancel-dialog focus.


## Services 13–17 design verification — 2026-11-11

New sections reuse the existing business-v2 shell, shared fields, selectors,
record pickers, tables, panels, feedback and focus-managed dialogs. Bilingual
returns/condition entry, physical counts, payment review, cash closing, report
filters/exports and opening-stock preview preserve existing colors/fonts and RTL.
Useful quantity, reason, payment reference and CSV examples are included.
Count approval shows expected, counted and discrepancy quantities together.
Baseline evidence is copied from the preceding POS implementation; before/after
captures live in tmp/completion-design. Real browser workflows check all five
AR/EN widths, with Arabic form/review dialogs at 320/390/1440, internal table
scrolling and Escape focus restoration. No theme change or new UI kit.


## Catalogue completion and cutover — 12 November 2026

Used the frontend-ui-engineering skill with this existing baseline. Preserved the
slate/white/emerald palette, fonts, shared Field/Modal/Table primitives and RTL.
Added bilingual reference, pack-retirement and image controls with useful examples;
localized the image picker button after screenshot review. Custom unit codes remain
legible in historical documents. Baseline screenshots: tmp/catalogue-design.
New verification artifacts: tmp/catalogue-release-design. No app-wide redesign.

### Authentication refinement — 2026-11-12

Preserve the existing auth split branding/card layout. MFA enrollment now adds
an on-device QR image (white quiet zone, black modules) and manual-key fallback.
Keep OTP as a separate six-digit numeric-keyboard field; recovery codes have an
explicit alternate mode. Signup/reset include matching-password confirmation.
Use translated AR/EN labels, example placeholders and local mock-mode notice.
Checked QR setup in both languages at 320/390/768/1024/1440px, with no horizontal
overflow. Before references: `tmp/auth-design`; current screenshots:
`tmp/auth-mock-design`, `tmp/auth-real-design` (local ignored test artifacts).

### Super Admin commercial controls and Contact Us — 2026-11-12

Reused the platform shell and Field/Select/Table/Pager/Modal/Feedback controls.
Added bilingual approval decisions, revenue/subscriber tables, customer paid
requests and public/private support conversations. Useful examples in every
free-text form; no new theme. Tables have a 680px minimum and scroll within
panels. Before/after evidence: `tmp/admin-services-design`; browser checks cover
AR/EN at 320/390/768/1024/1440px. Private visitor links use a labeled read-only
field; messages preserve line breaks without rendering HTML.

Subscriber billing checklist refinement retains the platform table/shell and
adds owner, renewal, payment state and last payment columns with contained
horizontal scrolling. Draft editing reuses PlanForm and the existing modal;
audit details use translated field labels and readable before/after values.
Extended browser coverage includes plan editing and billing history at all five
AR/EN widths; screenshots remain in `tmp/admin-services-design`.

### Owner landing correction — 2026-11-12

User explicitly requested dashboard entry after owner login, with account
security inside the dashboard rather than an auth card. Authentication now
redirects after required MFA/recovery acknowledgement. Added a default business
dashboard with real monthly report metrics and permission-scoped quick actions.
Security reuses the operational panels/fields/buttons as an inline sidebar tab;
team invitations remain in the team area. No security modal or split auth shell
is shown after successful login. Both customer/platform dashboards expose the
Security tab. Existing signed-out/reset/invitation/MFA flows remain separate.

User-provided screenshot is the before reference. New screenshots:
`tmp/dashboard-design` (actual staging owner) and `tmp/auth-mock-design`
(AR/EN dashboard/security at five widths). Mock and real auth browser flows,
password confirmation/change, session logout and staging metrics were verified.

### Personal dashboard tabs — 2026-11-12

Added a bilingual preference panel above Business settings using existing white
panels, emerald native checkboxes, shared feedback/buttons and responsive grids.
Preferences are stored per membership (user + business), not as permissions or
business-wide feature switches. Dashboard, Security and Settings stay visible;
other permitted tabs and dashboard shortcuts follow the saved choices.
Before evidence: tmp/owner-tabs-audit/*-settings.png. After evidence:
tmp/tab-preferences-design (AR/EN at 320/390/768/1024/1440px). Browser verification
covered saving, reload persistence, hidden links, essential tabs and restoration
of the staging owner's original choices. Backend tests cover tenant/user isolation.

Dashboard tab ordering now uses one numbered vertical list (1, 2, 3…) with
localized, keyboard-accessible up/down buttons. The stored order is per
membership; visibility and permission filtering remain independent. Essential
tabs can move but cannot be hidden. Unknown/new tabs append in default order.
Verification artifacts: tmp/tab-order-design, both languages at five widths.

User refinement: Security and Settings are pinned as the last two navigation
items, in that order, and their top-header duplicates are removed for active
business workspaces. Their customization rows remain visible with disabled move
controls and a bilingual “Pinned to bottom” hint. Other tabs remain reorderable.

Owner navigation simplification: after Reports, use Products, Sales, Purchases,
Inventory, Returns, Expenses, Treasury (المنتجات، المبيعات، المشتريات، المخزون،
المرتجعات، المصروفات، الخزينة). Match existing Lucide outline icons. Expenses
uses the payments permission and an expense-only server-filtered list and form;
Treasury retains payment history and cash closing. Saved orders are adjusted by
an additive migration while remaining customizable. Security/Settings stay last.
Verified exact Arabic labels/order and expense form in staging Chrome; financial
integration suite: 23 passed. Screenshots: tmp/tab-order-design/simple-nav-*.

Account security now includes optional MFA for subscribers/owners, per user
request. Super Admin MFA remains mandatory. Existing enrolled accounts stay
enrolled. Inline panels reuse shared fields/buttons and show QR/manual secret,
six ASCII digit verification and one-time recovery codes. Disable requires the
current password and authenticator code; rotates the session, clears recovery
codes and revokes other sessions. Browser verification used a disposable staging
owner (cleaned up), covering enable/QR/recovery/disable and AR/EN desktop/mobile;
artifacts tmp/mfa-settings-design. Auth integration tests: 19 passed.

Product insights: product rows now show completed-invoice frequency, gross base
units sold, and available stock after reservations. Low stock gets a red-tinted
cell plus a text warning, minimum and affected active locations. Product filters
include top ten by invoice count and low stock; product CSV exports all matching
rows (bounded at 10,000 products). Statistics respect business/location access
and sales/stock permissions. Counts are all-time, before returns, labeled in UI.
Shared tables now provide bilingual current-page search, column/value filters
and filtered page CSV export (scope explicitly labeled). Existing server filters
remain available. CSV neutralizes formula prefixes and excludes action columns.
Verified isolated integration tests (32), staging product warnings/filters/CSV,
shared-table search/filter/CSV, AR/EN desktop/mobile. Screenshots in
 tmp/mfa-settings-design/products-*.png. Existing design tokens/components retained.

Permission configuration now uses the existing Edit access modal. All assignable
business capabilities are returned by the API and grouped by section in bilingual
collapsible panels, with role-default / allow / deny selectors. Added independent
product and supplier create/edit permissions, retaining existing role defaults.
The owner can delegate team permission administration; delegates cannot modify
the owner, themselves, peer administrators or grant authority beyond their own.
Changes retain revision checks, audit before/after and session revocation.
Verified 178 integration tests, separate product create/edit endpoint tests, and
staging modal save/persistence at AR/EN desktop/mobile with disposable accounts.
Screenshots: tmp/mfa-settings-design/permissions-*.png.

Product table quantity clarification: units sold and actual on-hand stock now sit
immediately beside the product name. Available stock is secondary when reserved
quantities differ. Quantities omit unnecessary decimal zeros; low-stock warnings,
location permissions and all-results CSV remain intact. Verified 24 integration
tests, typecheck/build, staging reserved-stock scenario (3 on hand / 2 available),
AR/EN desktop/mobile and seeded rice (12 sold / 0 stock).

Sales receipt refinement: completed receipts use full content width instead of an
empty checkout column. Print and close actions share the header. Receipt metadata
uses a responsive three-column row, restrained item typography, aligned amounts,
and a compact emerald total. Draft checkout retains its two-column layout.
Verified frontend build, AR/EN at 320/390/768/1024/1440px, no page overflow/errors,
and printable receipt navigation. Evidence: tmp/tab-order-design/receipt-refined-*.

Tab scroll follow-up: reset immediately on selection and when async workspace
content mounts; briefly suppress browser scroll anchoring while content sizes
settle. Stop stabilization on wheel/touch/pointer/keyboard input to preserve
intentional scrolling. Supplier regression checks include repeated selections,
AR/EN desktop/mobile, delayed supplier responses and nested scroll containers.

Tab selection now uses native smooth scrolling, with instant movement when the
OS prefers reduced motion. Initial workspace mounting stays instant; selection
starts scrolling after React commits, avoiding duplicate animation starts.

Dashboard layout organization (user-requested, content/header scope only): moved
business selection into the top bar, removed the duplicated large dashboard
banner, and retained one content heading with business context. Monthly metrics
use balanced spacing and tabular numbers; quick actions share a compact row.
Navigation markup, labels, ordering and icons remain unchanged. Existing
slate/white/emerald and Cairo/Outfit styling retained. AR/EN viewport checks and
screenshots: tmp/tab-order-design/layout-*.

Header refinement: business name is a compact emerald pill selector on the left,
with an accessible label instead of a separate visible field label. Header stays
one row on mobile; long names truncate. Language action and business switching
remain available. AR/EN mobile/tablet/desktop overflow checks and build passed.

User clarified the chip request targets the dashboard content heading: dashboard
title at right and business-name emerald pill at left in one row, replacing the
three stacked title/name/description lines. Verified AR/EN responsive layouts.

## Arabic placeholder direction (2026-11-12)

Shared Field detects Arabic placeholder text. While empty, the input displays
that placeholder RTL and right-aligned, even if its value uses `dir="ltr"`.
Typing restores the input's declared direction (email/password/code remain LTR).
Clearing the input restores RTL placeholder display. Latin examples retain their
normal direction. Verified in invitation forms in AR/EN at mobile/desktop widths.

## Arabic dialog actions (2026-11-12)

Business Team, Add member, Add role and invitation-revocation dialogs keep their
primary action on the right and Cancel immediately to its left in Arabic, aligned
to the right edge. Use `rtl:flex-row-reverse` on the existing `justify-end` action
row (secondary then primary in DOM); English retains its established placement.
Verified button bounds on mobile/desktop and AR/EN screenshots.

## Business billing refresh (2026-11-12)

User-requested restyle of `business?tab=billing`: current plan/status and expiry
lead the page, followed by staff/location usage bars, paid plan cards, receipts
and renewal controls. Preserve operational white/slate surfaces, emerald actions,
existing typography and responsive RTL layout. Empty receipts omit table search
and pagination until payments exist. Billing behavior and approval requirements
remain unchanged. Before/after captures: `tmp/billing-restyle-before` and
`tmp/team-billing-e2e`. Browser integration verified trial activation, invitation
acceptance, capacity limits, paid approval requests, MFA setup guidance, and
active/expired Arabic/English views at 390/1440 pixels; no real mail or payments.

## Configurable sales tax (2026-11-12)

Business Settings adds a percentage field using the existing Field component,
white panel and emerald save action, with Arabic/English helper text. Zero
means disabled. Sales receipts show the saved tax rate and amount between the
discount and paid total. Existing shell and layouts are preserved. Captured
baseline and updated settings/receipts at 320/390/768/1024/1440px in both languages:
`tmp/tax-design`. Browser checks verify persistence, invalid-rate blocking and
no overflow/page errors. Backend coverage verifies permissions, snapshots,
partial returns and profit exclusion; migration is required before deployment.

## Password visibility (2026-11-12)

Shared auth-v2 Field now provides a Lucide eye/eye-off button for password inputs.
Passwords start masked; each field toggles independently. The trailing control
has localized accessible labels, keyboard focus, and type="button" to avoid form
submission. Reserve space on the actual trailing side in Arabic, including inputs
with explicit LTR value direction. Existing input styling is retained. Login
before/after screenshots and AR/EN desktop/mobile checks: `tmp/password-toggle`.

Email icon spacing follow-up: shared Field reserves physical left/right padding
based on the form language, independently of an input's text direction. This
prevents LTR email values in Arabic forms from overlapping the right-hand icon.
Verified empty placeholders and populated values in AR/EN at 390/1440px with
40px icon clearance; captures in `tmp/email-spacing`. Frontend build passed.

## Auth connection recovery (2026-11-12)

AuthV2 retains its existing forms, branding and RTL layout. Failed initial API
checks now show a localized connection/timeout/response error and an explicit
retry button; forms wait for successful configuration. Requests time out after
30 seconds and recover their enabled state. Password fields remount masked when
switching auth modes. Verified real-token and local-code journeys, AR/EN at five
widths, plus offline/retry desktop/mobile screenshots in `tmp/auth-resilience`.

## Transfer-loss reporting correction (2026-11-12)

Reports include recorded transfer-loss cost in the existing metric-card grid.
Dashboard/report profit displays localized “Unavailable” with an explanation when
historical transfer losses lack a saved cost; unknown values are never formatted
as zero. Retained white/slate/emerald styling and existing typography/spacing.
Baseline report captures: `tmp/operations-audit-before`. Known and historical
states verified in AR/EN at five widths: `tmp/transfer-loss-report`.

### Local UI verification, 2026-11-12

- Preserve the shared table toolbar's readable search width: `TableTools` uses a 12rem minimum (capped at container width) and flex wrapping. At 768px the sidebar leaves a narrow content area; allowing search to shrink to zero produces an unusable input and stacked label text.
- Import-preview cancellation must remain available offline once no mutation is pending. Dismiss locally and attempt server discard best-effort; uncommitted previews expire server-side. Keep the existing modal busy guard during active requests.
- Before/after evidence: `tmp/ui-coverage/` and `tmp/recovery-ui/`; Arabic/English phone/tablet/desktop checks preserve current colors, type, icons and RTL behavior.

### Closing reports controls, 2026-11-12

The report-delivery controls live in a collapsible white panel within the existing reports page. Reuse the shared emerald `Switch`, checked report options, `Select`, feedback and modal components. The switch is direction-isolated to keep its thumb inside the track in RTL; report content retains its selected delivery language in both app and email. Keep gross and estimated net profit labels distinct. SMTP-unconfigured status is visible and must not be presented as successful email delivery. Screenshots: `tmp/closing-reports-ui/`.


### Payment reversal controls, 2026-11-12

Treasury/Expenses retain the existing table and shared Modal/Field/Feedback controls. Added status and action columns, a reason/confirmation dialog, and linked original/reversal details. Emerald action styling, slate history panels and bilingual labels match existing screens. Mixed-direction actor names, timestamps and IDs use `bdi`. Mobile tables scroll inside the existing table container; dialogs tested at 320–1440px in Arabic/English with keyboard focus restoration. Screenshots: `tmp/payment-reversals-ui/`.


### Owner contact verification, 13 November 2026

AuthV2 reuses its current emerald/slate brand split, Field/Submit/OtpField, fonts and RTL/LTR behavior for the required Syrian-phone step. Email verification reuses the existing code-entry screen with real generated codes. Owner MFA stays optional; the phone hint states that distinction. Real browser flow captured both languages at 320/390/768/1024/1440, invalid number/code feedback, reload/direct-route gating and successful entry. Before/after screenshots: `tmp/login-check/onboarding-before.png`, `onboarding-after.png`; responsive evidence: `tmp/contact-onboarding-ui/`.

### Authentication branding copy, 13 November 2026

Removed the decorative 100% net-profit and AR/EN statistics at the user's request. The shared authentication brand panel now uses dedicated bilingual overview copy: “صورة أوضح لأداء أعمالك” with a short sales/expenses/profit description. Kept existing emerald panel, logo, fonts and responsive visibility. Checked Arabic/English at 390/1024/1440px; screenshots: `tmp/login-check/branding-*`.

### Authentication logo navigation, 13 November 2026

Desktop and mobile authentication logos are keyboard-accessible React Router links to `/`, preserving their appearance and adding visible focus rings. B2B-primary mode now renders the existing public Landing page at `/` instead of redirecting that path to the workspace. Verified both logo clicks at 1440px and 390px against local staging.

### Public home redesign, 13 November 2026

User selected Product Design option 3: light white/mint split hero, emerald actions,
Cairo/Outfit, enlarged existing chart mark and an explicitly labeled sample financial
report. Home-only `.home-page` styling refines shared sections into open ruled rows,
light pricing and FAQ treatments. Other marketing and operational routes retain
their themes. Existing copy/sections, SEO and test IDs preserved. Mobile home adds
a keyboard-accessible menu; existing public routes are exposed in B2B mode.
Start-free links now initialize AuthV2 registration from the mode query parameter.
Verified AR/EN at 320/390/768/1024/1487px, language/keyboard/menu/FAQ/link interactions,
no overflow or page errors, and production build. Evidence: tmp/home-redesign;
selected design and comparison details: design-qa.md.

### Public detail pages, 13 November 2026

Features, Pricing and About now share the approved light home design via
MarketingLayout: white/mint surfaces, emerald actions, active route navigation
and mobile menu. Shared Modules/Pricing support a page-level h1; About uses a
responsive two-column introduction with existing copy. Home uses the same shell.
Verified AR/EN at 320/390/768/1440 on all three routes (24 combinations), active
navigation, mobile menu, FAQ, 14-day trial label, signup links and no overflow or
page errors. Production build passed. Screenshots: tmp/home-redesign.

### Public section refinement, 13 November 2026

User requested less generic public pages. Retain the approved split hero and
pricing comparison; use purposeful variation across supporting sections: open AI
capability index, interactive explicitly labeled sample report (month/week),
compact audience/security strips, sequential setup rows, split FAQ/support, and
horizontal final CTA. Removed decorative repeated KPI charts and robot emoji.
All public routes inherit the shared treatment. AR/EN responsive checks and build
passed; before/after evidence in tmp/marketing-polish and review in design-qa.md.

### Registration phone field, 13 November 2026

Matched Jawlaha Register.tsx's separate +963 prefix and national-number field.
PhoneInput is shared by owner registration and phone verification, with LTR
number/prefix layout inside either language. Accepts Arabic/Persian digits and
local/international pasted Syrian mobile formats. Registration contact is stored
encrypted in pending_phone (additive migration), never marked verified or reserved
until OTP confirmation; returned only in the owner's phone-verification stage,
then cleared after confirmation. Existing MFA policy unchanged. Verified UI at
AR/EN 320/390/1440, validation/submitted payload, 25 auth/contact integration tests,
typechecks and frontend build. No real SMS/email sent. Screenshots: tmp/marketing-polish/phone-*.

### Trial expiry dashboard access, 13 November 2026

Expired trials retain authenticated dashboard/report reads and owner billing access.
The workspace adds a compact amber expiry notice using existing buttons and spacing,
with owner renewal navigation or staff guidance. Subscription remains a visible,
fixed owner tab even when older preferences hid it. Notice refreshes on navigation,
window focus and once per minute, with a timer at the period boundary; paid status
refreshes on focus/interval in the billing screen. Backend context exposes only
subscription status, activity, period end and whether it is paid, after tenant
permission checks. Billing distinguishes expired paid periods from expired trials.
UI evidence: tmp/trial-expiry, Arabic/English 320/390/768/1440, real isolated login,
existing dashboard, renewal link, live expiry and simulated confirmed renewal.
Provider verification and entitlement restoration are covered with a fake provider
in billing/paypal integration tests; no real payment is made by these checks.

### Public feature highlights, 13 November 2026

Home and Features now lead the existing module list with two open, ruled highlights:
customizable per-user dashboard tabs and daily/closing reports. Arabic and English
copy distinguishes manual requests from automatic delivery after closing, labels
net profit as estimated, and qualifies email delivery by service activation. Both
features also appear in the pricing lists. Existing marketing typography, emerald
accents and responsive layout retained; before/after captures at 390/1440 in both
languages: tmp/feature-highlights. Browser layout checks and production build passed.

### Public SEO and share previews — 13 November 2026

Public marketing keeps its existing design. Arabic remains on /, /features,
/pricing and /about; English has stable /en equivalents. Marketing navigation
and language links preserve the page and locale. Operational language preferences
remain local to the existing app. Native FAQ details/summary keeps exactly six
answers available without JavaScript, retaining current spacing and colors.
Standalone feature/pricing card headings follow their page H1 correctly.

The branded 1200×630 Open Graph PNG uses the existing emerald mark, Cairo/Outfit,
white/mint surfaces and truthful 14-day trial copy: public/social/profitlens-og.png.
Evidence: tmp/seo-content, tmp/seo, frontend/scripts/check-metadata.mjs. Metadata
and JSON-LD describe current functionality; no invented reviews or rich-result
eligibility claims. Public rendering and crawl controls are separate from private
business screens and do not grant access to any customer data.

### International phone entry — 13 November 2026

User superseded the country-selector request with free-form international entry.
Shared registration/verification PhoneInput now accepts the complete number starting
with + and a country code; removed the fixed +963 badge and Syrian-only labels.
Retains current field styling and LTR number direction within Arabic/English forms.
Spaces/separators, Arabic/Persian digits and 00 prefixes normalize consistently.
Server registration, OTP queue and verification preserve the international number;
legacy Syrian local API formats remain compatible. Database migration
20261113170000_international_phone widens the verified-number constraint and was
applied to test and local staging. Format checks do not guarantee country/provider
reachability; actual SMS coverage requires provider configuration.
12 SMS/contact tests, full captured-code onboarding, AR/EN320/390/1440 input checks,
typechecks and frontend production build passed. Captures: tmp/international-phone.

### Onboarding controls (2026-11-13)
Email verification, owner phone verification and welcome emails default off.
Super Admin → Registration settings has three independent persisted switches,
using existing white/slate panels, emerald actions and accessible Switch controls.
Registration goes directly to the workspace when verification is off; no verified
timestamps are fabricated. Disabled welcome messages are blocked at queue and
delivery, including legacy queued payloads. MFA remains optional for all roles.
AR/EN mobile/desktop screenshots and UI checks: `tmp/onboarding-policy/`.

### Super Admin signups and payment activation (2026-11-13)
The Signups & subscriptions screen lists businesses immediately after registration,
including owner names, emails, full phone numbers (with verification state), signup
date, subscription/payment status and server-calculated remaining trial days.
Search covers business name, owner name and email, including disabled owners.
All paid access requires Super Admin confirmation. External payments are recorded
in a separate immutable manual-payment ledger; confirmed PayPal receipts require
per-transaction activation. Retries do not duplicate payment or extend access twice.
Existing PayPal periods without an activation confirmation await admin action;
future receipts also require confirmation. Trials are otherwise unchanged.
AR/EN desktop/mobile and both activation dialogs: `tmp/subscriber-signups/`.

### Subscriber dashboard charts (2026-11-13)
Business dashboard adds a monthly comparison bar chart and a cost-breakdown
donut below the existing KPI cards. Reuses Recharts, existing report-summary
response, currency formatting and white/slate/emerald styling. No extra API or
financial aggregation is introduced. Missing permission fields stay hidden;
negative profit remains negative. Donut percentages are suppressed for negative
costs or unvalued transfer losses, with explicit text and available values.
Zero activity has a neutral empty state. Text legends expose exact values.
Validated real local summary rendering and display-only edge fixtures, AR/EN
at 320/768/1024/1440, keyboard access, no page errors, production build.
Screenshots: `tmp/dashboard-charts/`; baseline: `tmp/login-check/dashboard-before-charts.png`.

### Password guidance (2026-11-13)
New passwords use an 8-character minimum and retain the 128-character maximum
across registration, reset, security and staff setup. Shared new-password fields
show a live estimated strength meter and AR/EN checklist. Eight characters is
required; 12+, letters/numbers and symbols are suggestions. Common/simple patterns
are rated weak. Login and confirmation fields do not duplicate the meter.
Validated 38 auth/business API tests, AR/EN UI at 320/768/1440, visibility toggles,
production build and typecheck. Screenshots: `tmp/password-strength/`.

### Automatic sign-in after email OTP (2026-11-13)
Email-code confirmation now atomically consumes the code, verifies the email,
and creates an HttpOnly session. The frontend immediately uses that session
and opens the business dashboard. No password is retained or resubmitted.
Phone verification, when enabled, and already enrolled MFA remain enforced
before dashboard access. Password-reset codes still use the reset flow.
Real and local-mock OTP endpoints share this behavior. Email/phone verification
remain disabled by default; this applies when Super Admin enables them.

### Reviewed FIFO and daily cashier workflows — 16 November 2026
Business settings now precede personal tab customization. Owner-only inventory
costing review reuses the existing modal, fields, slate panels and emerald actions.
It shows quantities per product/location and editable suggested opening unit costs,
requires explicit confirmation, resets confirmation after edits, and blocks pending
transfers. FIFO is never automatically enabled for existing businesses.
Cashiers without reports.view see a personal daily sales summary, open drafts and
return credits; this is explicitly not a profit report or drawer reconciliation.
Cash closing previews shortage/surplus/balance and requires a variance explanation.
AR/EN mobile/desktop evidence: tmp/fifo-ui and tmp/daily-workflow.

### QA fixes — 16 November 2026
Supplier-return FIFO credit/carrying-value differences now appear as a separate
bilingual report metric and enter estimated net profit (not gross profit).
The existing metric cards and delivered-report layout are reused. Historical
returns without recorded FIFO cost retain their existing reporting treatment.
Saved editable sales drafts now expose current active pack choices; the editor
retains the selected historical pack for display, while repricing validates it.
AR/EN evidence: tmp/accountant-round/supplier-adjustment-* and
 tmp/cashier-round/screenshots/draft-pack-fixed-*.png. Full317-test backend suite,
application/test typechecks and frontend production build passed.

### Local entry recovery — 17 November 2026

Operational entry forms use a shared compact slate notice with explicit saved,
restored, offline and storage/conflict states plus a confirmed discard action.
Existing fields, buttons, tables, RTL and responsive layouts remain unchanged.
Drafts are synchronous browser-local snapshots scoped to business, membership,
permission set, entry type and (for edits) record/revision. Reopen the same entry
form to resume. This is not cross-device sync or an offline application shell.
No password, OTP, payment confirmation or review modal is restored. Backend
validation/authorization remains authoritative. Payment/sales/adjustment retry
keys are checkpointed before requests; drafts clear only after success.

Coverage: products, Excel import contents/previews, pack/category/unit text and pending product images,
suppliers, locations, purchase orders/receiving, sales, transfers and transfer
events, returns/counts/damage, payment/expense entries, cash closing, reversal
reasons, opening-stock CSV, FIFO opening costs, staff creation/editing, roles and
business settings. Security/authentication forms are not persisted. Server-generated reports and confirmation actions are not replayed.

Evidence: `tmp/draft-recovery/` (purchase/product before/after; AR/EN at
320/768/1024/1440, additional entry-form recovery screenshots). Ten-line invoice
recovery after offline edits/reload, failed saves, modal closure, discard,
storage failure, membership scoping and second-tab conflicts tested in browser.
Reusable checks: `src/lib/localDraft.test.jsx` in frontend; from repository root,
`node --env-file=backend-node/.env.staging frontend/scripts/verify-entry-drafts.cjs`
requires local staging on 3200/4200 and installed Chrome. Its product writes are
intercepted; no financial records are posted.

Additional checks: seven shared draft regression tests pass. Separate browser
checks verified payment retry-key preservation with fresh confirmation, retained
Excel bytes/preview IDs, and failed product image recovery. Checkout payment
fields and the Invitations entry form also use scoped drafts; passwords are
excluded. Production frontend build and public prerender complete successfully.

### CSV product imports — 17 November 2026

The existing product import modal now accepts XLSX and UTF-8 comma-separated
CSV, with separate template downloads and the required ordered headers shown
inline. Header mismatch uses the existing red alert, explicitly saying no data
was imported; Arabic copy follows the user's requested wording. Missing,
reordered, duplicate or extra columns are rejected server-side. Same preview,
confirmation, tenant authorization, subscription checks, encrypted preview,
atomic commit and local draft recovery apply to both formats. CSV keeps Arabic,
leading-zero identifiers, quoted commas, escaped quotes and multiline cells.
Limits remain 500 product rows / 1 MB. Product imports do not add stock.

Validation: backend application/test typechecks, 15 CSV/Excel tests, actual local
CSV preview/header errors in AR/EN at 320/1440, frontend build/public prerender.
Screenshots: `tmp/csv-import/`. No products were committed by the browser check;
commit tests use the isolated `qa_deep_test` database and clean up their fixtures.

### Purchase entry guidance — 17 November 2026

Added inline AR/EN instructions beside product selection explaining that the
quantity field appears on each product card after selection/scanning. A compact
slate help panel explains Products → Add product → return to the purchase or
receiving form, and that creating a product does not add stock. Users without
product creation/cost permission are directed to an authorized staff member.
The same guidance appears in the empty product picker. Existing input, draft,
stock and posting behavior is unchanged. Browser checks cover AR/EN 390/1440
and empty-picker states; screenshots: `tmp/purchase-guidance/`.

### Purchase form density and dropdown — 17 November 2026

User requested a tidier purchase/receiving form. The scan mode now uses the
installed Radix Select primitives in a compact 16rem desktop field with a menu
matched to the trigger width, logical RTL spacing, keyboard support and short
AR/EN labels. Barcode entry and mode align in one desktop row and stack on
mobile. Location/supplier picker triggers fill their grid columns with chevrons;
document metadata is grouped, notes are shorter, and totals/save share a footer.
The missing-product help is collapsed by default; a single short quantity hint
remains visible. Empty forms no longer show a redundant zero-value total.
Changes are limited to this editor, its help component and scan-mode control.

Verified AR/EN 390/1440, menu bounds, keyboard selection, empty product picker,
help disclosure and repeated barcode quantity increments; production build.
Latest screenshots: `tmp/purchase-tidy/updated-*` and `populated-ar-*`.

### Per-tab explanations — 17 November 2026

All 21 business workspace tabs now show a compact PageGuide: a short purpose
statement and an AR/EN Read more / Read less button. Expanded content gives
practical starting steps and relevant distinctions (draft vs posted movement,
product vs stock, return credit vs refund, counted total vs adjustment, and
subscription payment vs activation). Long explanations are hidden by default
and reset to collapsed when navigating to another tab. Content is maintained
in `components/business-v2/pageGuides.js`; no API or authorization changes.
Existing slate/white/emerald styling and RTL layout are preserved. The guide
uses an accessible button with aria-expanded/aria-controls and a hidden region.

Browser checks passed for all 21 tabs in both languages, keyboard opening,
closing and overflow at 390/1440. Test-only hidden-tab preferences were overridden
in the browser response; saved business preferences were not modified.
Screenshots: `tmp/page-guides/`; frontend production build/public prerender passed.

### Sales discount percentage — 18 November 2026

The item discount editor now accepts a percentage (0–100, up to four decimal
places) in every currency, with a bilingual helper below the existing Field.
New receipt lines show the saved percentage; aggregate deductions remain money
amounts. The API calculates deductions against the rounded line subtotal before
tax, using existing currency precision, and enforces discount permission/reason.
An additive nullable sale-line rate preserves historical monetary records.
Legacy draft amounts are retained exactly until the rate, quantity or pack changes;
old browser drafts are converted for display without treating their amount as a rate.
Validation: 28 sales/tax tests in an isolated database, two draft compatibility
checks, application/test typechecks, production build/prerender, AR/EN 390/1440
browser checks for limits and request payloads. Browser writes were intercepted.
Evidence: tmp/product-buttons/percentage-*.png.

### Compact invoice layout — 18 November 2026

Receipt-only sales views now use a centered max-w-2xl card instead of stretching
across the workspace. The shared receipt uses compact customer/cashier/date
metadata, a semantic item/quantity/total table and full-width aligned totals.
No-tax rows stay hidden; cancelled documents use an explicit cancellation footer.
Existing slate, white and emerald styling, financial amounts and permissions
are preserved. AR/EN screenshots at 320/768/1024/1440 and the actual cancelled
invoice at 390/1440: tmp/product-buttons/invoice-layout-* and invoice-real-*.
Screen/print checks confirm hidden zero tax, visible nonzero tax and no page overflow.

### Copy product identifiers — 18 November 2026

Shared CopyableCode adds a compact Lucide copy button beside displayed SKUs and
each barcode in catalogue, lookup results, purchases, stock, transfers, FIFO,
adjustments, import previews and product pickers, including legacy product views.
LTR code isolation preserves RTL row alignment and leading zeros. Copy actions
stop row activation, never submit forms, show a check/toast on success and a
clear failure message when clipboard access is denied. Buttons are hidden in
print; identifier text remains available to shared table search/export logic.
Picker copy controls are siblings of selection buttons (no nested buttons).
Verified clipboard content with owner and cashier accounts in AR/EN at 390/1440,
plus success/failure and propagation regression tests and production build.

### Quantity display — 18 November 2026

Displayed non-monetary quantities now use shared string-based formatQuantity:
5.0000 → 5, 2.5000 → 2.5, preserving all nonzero fractional digits without Number
rounding. Applied to inventory, sales/receipts, purchasing, transfers, adjustments,
opening previews, packs, FIFO, reports and legacy quantity views. Editable strings,
stored precision and money formatting are unchanged. Seven precision cases pass;
frontend build and AR/EN inventory browser checks pass.

### Owner also works as cashier — 19 November 2026

Settings → Customize my dashboard tabs now includes an owner-only bilingual
checkbox for using the same account as owner and cashier. Saving pins sales,
products, returns, locations, treasury/cash closing and reports in navigation.
The existing owner permissions already cover cashier actions; role and server
permissions remain intact. The preference is stored per membership, audited,
and rejected for non-owners. Disabling restores saved tab visibility preferences.
Existing white/slate panels, emerald checkbox, RTL and tab ordering are preserved.
An additive membership-column migration is required before deploying the API.
Validation: 27 business integration tests, backend application/test typechecks,
frontend production build/prerender, mocked-API browser checks in AR/EN at
320/390/768/1024/1440, keyboard, save/reload and disable behavior. Screenshots:
`tmp/owner-cashier/` (baseline and updated settings).

Additional owner/cashier verification: 122 distinct integration cases passed
across businesses, sales, completion, locations and billing (121-case run plus
an added security case in a 28-case business rerun). Real database lifecycle:
one owner, no location assignment or new employee, cash sale/change, duplicate
checkout, personal daily totals, return/restocked quantity, cash close and report.
Additional security covers all staff roles, platform-only admin, CSRF, disabled
membership, fresh session persistence and idempotent audit logging. Mocked-API
browser checks cover unsaved state, failed save/retry, pending controls, business
switching, reload, disabling/restoring hidden tabs and non-owner visibility;
no browser page errors. Updated three old sales fixtures to create valid stocked
quotes before simulating stock loss/reservation or empty-shop archiving. All
original rollback/overselling/archive assertions remain. Typechecks pass.
Logs and browser harnesses: `tmp/owner-cashier/`.


## Product import duplicate review (2026-11-22)

Preserved the existing light import modal, typography, emerald actions, logical
RTL alignment and internally scrolling preview table. Added an amber duplicate
review section with translated keep/exclude controls. Disabled generic table
search/export tools only in the import preview so filtering cannot imply that
hidden rows will be excluded from confirmation. Generated replacement SKUs are
visible in the preview. Before screenshots: `tmp/import-review-before`; after:
`tmp/import-review-after`. Real API browser checks passed in AR/EN at
320/390/768/1440px, including page/dialog overflow, invalid input, duplicate
choices, owner imports and accountant-style staff imports. Inspected Arabic
mobile duplicate review and English desktop review screenshots. No global design
or shared component styling changed.


## Import recovery QA (2026-11-22)

Preserved import modal layout while fixing confirmed draft-discard and failed-file-
replacement defects. Confirmed discard clears the server preview before local reset;
failed replacement retains the old preview. Barcode text now stays on one line inside
its scrolling table, improving readability without changing global components.
Captured baseline in `tmp/import-signoff-before`, development checks in
`tmp/import-signoff-after`, and optimized-build checks in
`tmp/import-signoff-production`. Owner/accountant recovery flows, Escape/focus,
busy guards and AR/EN responsive overflow checks passed. Reviewed final desktop
replacement-error and Arabic mobile duplicate-review screenshots.

## Simplified product import (2026-11-23)

User explicitly requested a simpler import experience. The initial modal now has one
file-selection action, one Excel-template link, and collapsed file guidance (including
the optional CSV template). Removed the always-visible draft notice and column list.
File selection reveals the preview action; review shows the product table and confirm.
SKU/barcode metadata remains in row details. Duplicate decisions remain explicit,
with the affected-product list collapsed. Existing light surfaces, emerald actions,
RTL behavior, server validation and recovery safeguards are preserved.
Baseline: user screenshot and prior `tmp/import-signoff-production`. After:
`tmp/import-simple-review` and `tmp/import-simple-production`. Inspected Arabic mobile
empty state; production-build owner/accountant import and recovery flows passed,
including AR/EN at 320/390/768/1440px and no page/dialog overflow.

## Simpler purchasing, forms, checkout and tables (2026-11-23)

User explicitly selected these four simplifications. Preserved the existing slate/
white surfaces, emerald actions, typography, component sizes and RTL behavior.

- Purchasing actions now read “Order from supplier” / “Receive stock”, with a
  short distinction from opening stock. Ordering and receiving keep their existing
  draft, review, permission and stock-confirmation rules.
- Idle draft explanations are hidden; saved drafts use a compact status. Restored
  work, storage conflicts, offline status and discard controls remain available.
  Product, supplier and purchasing forms put essential fields first. Optional
  sections reveal existing values and reopen automatically for browser validation.
- Sales show Add products → Take payment → Receipt. Discounts and customer/notes
  are optional sections. Mobile checkout shows the amount and payment form first;
  stock checks, discount reasons, payment references and retry keys are unchanged.
- Shared table filters and current-page CSV exports live under More options. Main
  server searches replace duplicate table searches on suppliers, locations,
  inventory, transfers and platform lists. Product filters and full-result export
  share More options; purchases/sales/supplier/location server filters use the same
  disclosure. Active filters remain marked, and controls remain mounted through
  loading/errors so users can recover without losing filter/search state.

Validation: 34 frontend tests, 45 purchase/receiving/sales/tax API tests against an
isolated local database, production build and public-page prerender passed. Local
Chrome fixture checks cover AR/EN at 320/390/768/1024/1440px, no runtime errors or
page/dialog overflow, keyboard disclosure, optional-field validation, restored
sale drafts, payment failure/retry, receipt transition, CSV download, filter error
recovery, product save and order/receiving draft payloads. Browser API writes were
intercepted; this is local verification, not a production deployment or live-client
usability signoff. Before/after screenshots and logs: `tmp/simple-flows/`.

## Quantity entry and required markers (2026-11-23)

Audited 15 quantity controls across operational and legacy forms. They now share
select-on-entry behavior: the first typed/pasted value replaces the existing
quantity; focus alone leaves saved values intact, later clicks preserve caret
placement, and clearing stays empty. Extended the helper to handle initial touch
clicks while preserving native number-spinner actions. Applied it to planned
orders, packs, minimum-stock fields, legacy sales/purchases/returns and inventory,
in addition to the existing receiving/sales/transfer/adjustment controls. Fixed
legacy purchase-return empty input being coerced back to zero while editing.

Shared Field/Select and native required labels now use a single red RequiredMark.
Conditional requirements follow their existing validation conditions; optional
fields stay unmarked. Removed duplicate manual product/location markers and old
required badges, added labels to previously unlabeled scanner/password-recovery
inputs, and associated legacy required labels with existing stable input IDs.
Required location choices on sales/receiving/transfers use the same visual cue.
No accounting rules, permissions or server validation were changed.

Validation: source coverage for all 15 quantity controls and 50 native required
controls (the product autocomplete's label lives in its callers), 37 frontend
tests, successful production build/prerender, and local Chrome checks passed.
Browser checks covered AR/EN, mouse/keyboard/touch replacement, decimals, clearing,
pasting, caret editing, unchanged values on focus, and conditional indicators.
Before/after screenshots for ten representative screens at 390/1440px are in
`tmp/input-review/`, alongside the audit and test logs. Screens have no page
horizontal overflow or runtime errors; browser API data was fixture-only.


## Receiving simplification — 23 November 2026

Receiving now presents Enter items → Review → Add stock (or Approval for
staff without confirmation permission). Product selection is the primary input;
barcode scanning and its mode selector live in an optional disclosure. Barcode
validation belongs to its separate scanner form and never blocks receipt review.
The primary editor action saves the draft and opens review; it never posts stock.
The review table shows all lines without search/filter/export controls.

Users with both preparation and confirmation permissions can confirm a reviewed
draft in one explicit final dialog listing supplier, location and quantities.
The backend executes this atomically with the same authorization, subscription,
quantity, order, ledger, replay and audit protections as pending confirmation.
Staff without approval permission see Send for approval; stock stays unchanged.
Pending/completed messages explicitly explain the stock effect. Existing shared
components, emerald actions, required markers and RTL/LTR styles are preserved.

Validation: 48 frontend tests pass, including editor/review behavior in Arabic
and English, separate barcode validation, quantity replacement, permission-based
actions, failed request recovery and repeated clicks. The 19 operations tests
and 21 FIFO/operations-audit tests pass against the isolated test database;
backend typecheck and frontend production build pass.
Live visual verification is incomplete: the browser access host was unavailable,
and native screenshot capture returned a blank image. The old editor was read
through native accessibility, but no valid new before/after screenshots or
desktop/mobile visual sign-off are claimed. Local fixture setup/backups are in
`tmp/receiving-simple/`. No production deployment was performed.

## Settings and permission simplification — 23 November 2026

Business settings now precede FIFO. Existing FIFO review/activation is unchanged
and sits inside a closed Accounting settings disclosure, shown only with the
existing migration.manage permission and omitted from initial setup.

TimezoneField replaces typed IANA identifiers with a labelled city selector and
search dialog. Common regional cities have Arabic/English labels; other zones
use readable city/region names. Choices retain the IANA identifier for the API.
Searching or closing never changes the saved value; selecting changes only the
form until Save. UTC and saved aliases stay available. The browser's supported
zone enumeration provides worldwide choices, with common zones/current value as
an older-browser fallback. Uses the shared Modal, required mark and field styles.

Roles now appear as a compact list with expandable permission details instead of
a wide permission matrix. Custom-role creation starts with the existing role
selector, then name; granular grants are under Customize permissions and grouped
by task. Employee editing shows role/status first, with a visible indication of
custom exceptions and collapsed groups. Closing details never clears overrides;
changing role still resets them as before. Existing grantable-key filtering,
manager grant restrictions, backend authorization and session revocation remain.
The member default-option text is now a single string, avoiding invalid nested
spans from the development instrumentation.

Validation: 64 frontend tests pass, including Arabic/English timezone selection,
settings order, optional FIFO disclosure, existing timezone preservation, UTC and
alias fallback, no write on search, read-only controls, failed-save recovery,
role templates, preserved member overrides and grant restrictions. All 35
business integration tests pass against the dedicated local test database.
Production build/prerender passes. Browser host remained unavailable, so fresh
before/after screenshots and desktop/mobile visual sign-off are outstanding.
Source baselines are in tmp/settings-simple/. No production changes or deployment.

## Plain-language stock costing — 23 November 2026

User explicitly requires language understandable without accounting knowledge.
Client-facing FIFO wording is replaced with “How we calculate your profit” /
“كيف نحسب ربحك”. Explain purchase cost versus selling price with a bottle bought
for 5 and sold for 9 (profit 4 before other expenses), then explain using the
new purchase cost after older stock runs out. Review and activation buttons use
plain action labels. Review instructions explain checking quantities and purchase
bills; prior sales and selling prices remain unchanged. Related report error/help
and audit-event labels also remove FIFO jargon. API identifiers, accounting rules,
permissions and required activation review remain unchanged. Browser visual
verification is still unavailable; source copy and production build were checked.

## Owner dashboard and money follow-up — 23 November 2026

Dashboard now defaults to Today (business timezone), with This month available.
Primary figures are sales, expenses and estimated profit; chart detail is in a
closed disclosure. Locked owner views omit sensitive figures and charts. The
receiving shortcut says Receive goods. Money follow-up links route to supplier
balances and customer refunds with existing permission checks and report PIN gate.
No customer receivables are invented: this backend tracks supplier outstanding /
refund balances and refunds owed to customers, not unpaid customer sales.

Balance/refund reports lead with the remaining amounts and explicit direction
(You owe supplier / Supplier owes you / Still owed to customer). Full invoice and
payment columns remain in expandable details; exports retain the full report.
Date presets are hidden for these current-balance reports. Record payment opens
the existing entry/review flow; Record refund opens customer refund directly,
with its own local draft namespace to avoid restoring supplier payment input.
No backend calculations, write contracts or permissions were changed.

Validation: 73 frontend tests and production build/prerender pass. New checks
cover daily/monthly requests, Arabic/English dashboard, financial lock protection,
permission-filtered links, compact balance details, PIN-blocked report requests,
and correct refund navigation/form default. Browser host remained unavailable;
no new desktop/mobile screenshots or visual sign-off are claimed. Not deployed.

## Plain payment entry — 23 November 2026

Payment entry now asks What happened? with first-person supplier payment/refund,
customer refund, expense and till cash choices in Arabic/English. Expense-only
entry omits the redundant type selector and asks What did you pay for? Required
reason validation stays intact. Cash references are in Optional details; card /
transfer references stay visible and required, retaining their entered value.
Document selection explicitly names supplier receipts or customer returns.
Review/save wording explains that the app records money already paid/received,
not a bank transfer. Existing review, permissions and backend validation remain.
A synchronous posting guard prevents double confirmation clicks. Changing a
linked payment's location clears the old document, balance and suggested amount.
Restored entry types are constrained to the form's available types.

Validation: 77 frontend tests and production build/prerender pass. Added coverage
for AR/EN expense entry, optional versus required references, value preservation,
no write before confirmation, double-click protection and failed-save recovery.
Live visual verification remains outstanding due to unavailable browser access.
No production deployment was performed.

## Shared table and icon polish — 23 November 2026

User expanded frontend-engineering scope from payments to tables/icons generally.
Shared operational tables now use slate header surfaces, stronger column labels,
column scope semantics, aligned cells, tabular numbers, subtle hover/focus-within
row highlighting, and an Inbox empty-state icon with existing text. Horizontal
scroll regions have a labelled keyboard focus target and visible emerald ring.
Button tokens retain established colors/radii with 44px minimum height and
consistent 16px nonshrinking icons. Pager arrows mirror for Arabic. Common add,
edit, search, import, history and staff/location actions have explicit Lucide icons
beside their existing labels. No text labels were replaced with icon-only actions.

Shared table search adds a leading search icon, labelled clear action with focus
return, matching-row count for active local searches/filters, and a column-filter
reset that preserves the search. Export has a download icon and still clearly
states current-page scope. Existing page/server filters and CSV contents remain.
Payment entry uses a bounded 3xl layout, clearer amount typography, full-width
reason, and separated responsive primary-action footer.

Validation: all 78 frontend tests pass, including clear-search/filter/focus
behavior and existing payment/access checks; production build/prerender passes.
Browser host unavailable at task start; no new screenshot-based visual sign-off.
These shared changes cover operational components using business-v2 UI, not every
legacy page or the independently styled public marketing site. Not deployed.

## First-sale setup — 23 November 2026

Replaced the five-step settings/supplier/category checklist with three owner
steps: add shop, add products, first real sale. Buttons open the actual forms via
an action=setup route; the workspace provides Back to setup steps. Setup location
creation fixes kind to SHOP with a separate draft key; general location creation
still allows warehouse/shop selection. Product and sale setup use existing forms
and validation. No records or transactions are auto-created.

The sale step explicitly explains that products alone create no stock and links
to Receive goods (when permitted), where suppliers can be created. Receiving and
stock validation remain required; no sale/stock protections are bypassed.
Progress reads active shops, active products and COMPLETED sales only. Permission
and visible-tab checks gate each read and action. Failed reads stay unknown with
a retry action. Suppliers and categories are no longer required setup milestones.
Help/support is in a disclosure. Initial business settings retain necessary
country/currency/tax/timezone choices while date/number formats are optional.

Validation: 83 frontend tests pass, including AR/EN setup navigation, three-step
progress queries, real-sale completion, stock guidance, retry and staff/hidden-tab
read restrictions. Production build/prerender passes. Browser host unavailable;
fresh desktop/mobile visual screenshots remain outstanding. Not deployed.

## Sale-first customer returns — 23 November 2026

Customer returns now start with the original completed sale; eligible sale
receipts expose Return items directly. The Returns page uses the same flow.
Location comes from the source sale. Users select items, enter blank-by-default
quantities and choose sellable/damaged condition. Exhausted lines are excluded;
positive quantities and remaining limits are checked before submission, with
server checks still authoritative. Review saves a draft and displays the server's
exact credit and per-item stock deltas, retaining cumulative rounding rules.
Approval remains capability-gated; copy distinguishes draft, completed and
cancelled stock effects and explains that actual refunds are recorded separately
in Payments. Duplicate submission/approval clicks are guarded. Failed submission
preserves entry values and the retry key. Supplier returns/counts/damage continue
through their existing editor and extracted shared detail component.

Validation: all 94 frontend tests passed, then an additional approval test passed
with the complete 12-test customer-return file. Production build/prerender passed.
The workflow integration run revealed an outdated catalogue CSV header assertion;
it now checks the existing human-readable Completed invoices header. Browser host
unavailable: desktop/mobile screenshot verification remains outstanding. No deploy.
After correcting that assertion, all 48 workflow integration tests passed against
the isolated local test database, including tenant/location scoping, cumulative
and concurrent returns, fractional money, damaged stock and refund limits.

## Request feedback and recovery — 23 November 2026

Shared useBusinessApi now delegates to a testable request client. Offline requests
fail before transmission; requests taking 5 seconds emit a slow status and time
out after 30 seconds, including response/download body reads. Caller aborts stay
silent. No request is automatically retried or queued. Write connection failures,
timeouts and server failures use SAVE_UNCONFIRMED: check history before submitting
again. Feedback hides its generic retry button for that ambiguous outcome.
401 responses redirect even when the response is HTML. Raw server exceptions and
untranslated errors are replaced by safe bilingual messages; known business-rule
translations remain. CSRF, credentials and caller idempotency keys are preserved.

Business workspace shows offline/slow notices and dismissible confirmations for
completed sales, receipts, payments/refunds/expenses, adjustment drafts and customer
return approval/cancellation. Confirmation scope is the selected business; only
server-confirmed actions generate success. Draft/return copy distinguishes stock
posting from money actually refunded. Shared Feedback uses specific EN/AR errors
for connectivity, validation, permissions and conflicting updates. Customer-return
local validation uses translated codes instead of losing literal text in fallback.
A workspace render error boundary offers reopening/support with an explicit warning
about unsaved entries and checking transaction history. It does not claim recovery
of unsaved state or catch every asynchronous application error.

Validation: 111 frontend tests passed in the full run; all 4 additional status/
recovery UI tests passed separately (115 total). Coverage includes offline no-send,
slow requests, timeouts, caller cancellation, ambiguous writes, HTML errors, 401,
malformed responses, CSRF, concurrent request cleanup, downloads, bilingual copy,
tenant-scoped messages, dismiss/retry behavior and rendering-error recovery.
Existing failed-save tests still verify input preservation. Production build and
prerender passed; diff whitespace check passed. Browser host unavailable, so fresh
Arabic/English desktop/mobile screenshots remain outstanding. No backend or
production deployment changes. Legacy clients outside useBusinessApi are not
claimed to have this transport/status coverage.

## Success toast polish — 23 November 2026

Success confirmations now use the existing Sonner host at top-center instead of
an inline banner. Custom cards preserve white surfaces, emerald checkmark, rounded
xl border, restrained shadow, RTL/LTR content, record reference and a labelled
44px close target. Seven-second duration; no focus stealing. Toasts dismiss on
scope change/unmount and the same success is not replayed when returning to the
business. Offline/slow notices and actionable inline errors remain persistent.
No extra notification library or duplicate host was introduced.
Validation: all five focused status/recovery tests pass (including AR/EN toast
content, dismissal and cross-business cleanup); production build/prerender and
diff check pass. Live visual verification remains unavailable; not deployed.

## Toast lifecycle regression testing — 23 November 2026

Added integration tests mounting the real Sonner Toaster in React StrictMode,
instead of only mocking toast callbacks. Found and fixed confirmations vanishing
on language change and when a pre-existing success encountered StrictMode effect
replay. Active toast IDs now update translated content in place; scope changes
still dismiss without replay. Lifecycle cleanup is separate from content updates.

Validation: full frontend suite passed (122 tests, 23 suites), then two additional
integration cases passed with all eight real-Sonner tests (124 total). Tests cover
AR/EN text and direction, accessible close labels, no input focus stealing,
seven-second expiry, actual dismissal animation, StrictMode replay, translation
updates, business switching, successive confirmations, safe reference escaping,
and keeping only the newest toast. Existing transport/offline/timeout and failed
save preservation tests pass. Browser access host remains unavailable, so this is
DOM/integration coverage, not a mobile/desktop visual sign-off. No deployment.

## Plain-language cash closing — 23 November 2026

End-of-day cash closing now asks for starting cash and counted cash with plain
AR/EN labels. Difference feedback explicitly says cash matches, cash is short,
or there is extra cash, using an absolute amount for short/extra. Count stays
blank until entered. Variance explanation is required only when amounts differ;
otherwise notes are optional. Calculation cards and prior closings/withdrawals
are available in disclosures; history still loads through existing scoped APIs.
Review shows expected, counted and difference with currency, location/date and
reason. The confirmation explicitly warns that closing blocks further cash
transactions for the day. Added a synchronous duplicate-submit guard, date lock
while saving, invalid/negative entry guards and a confirmed-closing success toast.
Existing backend permissions, immutable closing and stale-total checks remain.

Validation: all 130 frontend tests (24 suites) pass, including six new closing
cases covering bilingual wording, match/short/extra, blank inputs, required
reason, read-only review, double clicks, stale totals/input preservation, closed
records and invalid counts. All 48 backend workflow integration tests pass against
the isolated local database, including the receive/transfer/sale/return/reconcile
pilot and cash/refund/closing permission and concurrency protections. Browser
visual verification remains outstanding due to unavailable browser access; no
production deployment. This completes the cash-closing simplification and
automated checks, not a manual owner/cashier browser walkthrough.
