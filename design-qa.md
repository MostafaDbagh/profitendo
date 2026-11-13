# Home page design QA — 13 November 2026

final result: passed

## Visual truth and evidence

- Selected option: third displayed image, `/Users/mostafa/.codex/generated_images/01a1d06c-920b-7f62-adc5-662c8b28935f/exec-c149bf8e-ea09-4aed-9bcb-bf1b0d5d5d37.png`.
- Reference pixels: 1487 × 1058. Implementation CSS viewport and pixels: 1487 × 1058, device scale 1. No density normalization needed.
- Signed-out Arabic home, light theme, top of page. Source and final implementation opened together in the same comparison input.
- Implementation: `tmp/home-redesign/final-ar.png`, `final-en.png`. Full-page and responsive captures: `tmp/home-redesign/{ar,en}-{320,390,768,1024,1487}.png`.
- Before: `tmp/home-redesign/before.png` and `hero-before.png`.
- Hero/report and navigation details are readable at native size in the paired full-viewport input; separate region crops were unnecessary.

## Comparison history and fixes

1. Initial implementation: feature/nav typography smaller than target (P2); annual plan button/badge contrast overridden (P1); overly broad accounting selector added a line below the heading (P2).
2. Increased hero/nav/feature type, narrowed accounting and pricing selectors, restored white annual CTA/badge text and badge positioning. Recaptured at identical viewport and compared with selected reference. No actionable P0/P1/P2 differences remain.

## Required fidelity surfaces

- Typography: retained actual Cairo Arabic / Outfit English, with large right-aligned heading, readable supporting copy and quieter financial labels. Existing longer feature titles are preserved rather than copying the shortened generated text.
- Layout: matching white/mint split, report at the inside bottom edge, open feature grid with fine dividers. Mobile stacks copy and report, uses accessible menu, and has no horizontal overflow.
- Tokens: white, pale mint, slate text, emerald actions; no glow. Buttons 10px, report/plans 16px. Green action text contrast corrected.
- Assets: original Lucide upward-chart brand glyph and existing icon family, also used for enlarged brand motif. Crisp vector icons; no custom-drawn or rasterized UI. Solid mint intentionally replaces generated image texture.
- Content: existing marketing copy and sections preserved. Illustrative report is explicitly marked sample data, uses SYP and November 2026; COGS replaces the mock's purchases label for correct profit arithmetic. No customer data.

## Functional verification

Chrome via user-authorized Playwright fallback; in-app browser unavailable.
Arabic/English at 320, 390, 768, 1024 and 1487px: no overflow, FAQ expand/collapse, mobile menu. Existing public route navigation, signup/login and features anchor passed. Language toggle and keyboard activation of menu/FAQ passed with reduced motion enabled. No browser page errors. Frontend production build passed.

Fixed existing conversion issues: public routes now reachable in B2B mode, and auth recognizes `?mode=register` while preserving priority of secret fragment actions. No accounts created, messages sent or business records changed.

## Follow-up polish and limits

- Generated mock contains shorter labels and a slightly different decorative chart stroke; actual brand glyph and original content take precedence.
- Below-fold sections extend the selected style; they were not included in the generated reference.
- This is home-page UI verification, not a repeat of backend/auth security testing. External email/WhatsApp destinations were not activated.

## Section-by-section refinement, 13 November 2026

The user requested a second pass to remove generic, repeated layouts. This pass
uses the already approved light design rather than introducing another theme.
Current-run before/after evidence: `tmp/marketing-polish/home-before.png` and
`home-after.png`; focused evidence: `ai-after.png`, `report-after.png`.
Full detail-page captures: `tmp/home-redesign/{features,pricing,about}-{ar,en}-*.png`.

| Section | Finding and implementation | Result |
|---|---|---|
| Navigation | Active route and mobile controls already clear; retained | Passed |
| Hero | Selected split composition and sample report establish identity; retained | Passed |
| Modules | Open rows clearly scan; retained existing content and grid | Passed |
| Accounting | Copy and ledger-like list explain automatic posting; retained | Passed |
| AI | Large mint box repeated the hero treatment; replaced with open two-column explanation and numbered capability list, removed robot emoji | Passed |
| KPI preview | Eight identical decorative charts communicated no data; replaced with labeled sample ledger and working month/week controls | Passed |
| Audience | Excessive height for five short labels; condensed to a quiet strip | Passed |
| Setup steps | Generic equal cards; changed to sequential numbered rows beside the heading/CTA | Passed |
| Pricing | Cards support comparison and preserve renewal details and 14-day trial; retained | Passed |
| Security | Oversized icon grid; replaced with compact aligned list beside heading | Passed |
| FAQ | Full-width rows repeated section pattern; split heading and questions, retained keyboard controls and added answer relationships | Passed |
| Support | Two more cards added repetition; replaced with clear contact rows beside the introduction | Passed |
| Final CTA | Another centered hero; condensed to horizontal action band, stacked on mobile | Passed |
| Footer | Compact brand/contact/legal treatment remains appropriate; retained | Passed |
| About introduction | Existing two-column story provides appropriate hierarchy; retained | Passed |

Validation: 34 page/language/viewport combinations across home and detail pages,
no horizontal overflow or page errors; menu, FAQ, signup/login, public navigation
and anchors passed. Report period switches tested by mouse and keyboard. Build
compiled successfully. Report data is explicitly illustrative; stock/cash are
point-in-time balances and do not change with the sample sales period.

Limits: this is a visual and functional UI review, not a full screen-reader or
WCAG certification, financial audit, or verification of marketing feature claims.
No external messages sent. No changes to backend or business data.

final result: passed
