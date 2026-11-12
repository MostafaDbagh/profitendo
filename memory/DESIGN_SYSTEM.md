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
