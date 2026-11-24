# Application page layout

Use `PageContainer` once for the route or workspace viewport. Each screen renders a
`PageLayout` inside it. Keep application chrome, navigation, and access checks at
the route level.

- `PageLayout.jsx` supplies the page stack, title-only `PageHeader`, configured
  `PageActions`, and the focusable, scroll-contained `TableRegion`.
- `PageToolbar.jsx` supplies search, inline filters, advanced filters, and optional
  import and export slots. The search control can be a server search, a local
  filter, or a product autocomplete. The toolbar does not own their state.
- `PageResults.jsx` supplies loading, empty, and retryable feedback, plus the
  pager and result count.
- `tokens.js` applies the semantic theme, control sizing, focus treatment, and
  panel styles. The shared `--page-*` dimensions live in `src/index.css` alongside
  the existing colors and radius. Cairo and Outfit are inherited from the locale.

## Configure a screen

Give `PageLayout` a localized `title`. Use `heading="h1"` on standalone routes
and the default `h2` in the workspace. Supply action objects with a stable
`id`, localized `label`, and `onClick`. Set `variant` to `primary` on the main
action. Compute `visible`, `disabled`, `loading`, and `pressed` in the page.
Use `accessory` for existing links or custom controls that need their own markup.

Place a `PageToolbar` in `toolbar` when the page owns its controls. Use
`primaryFilters` for selectors that remain visible and `filters` for advanced
options. A barcode scanner can share the toolbar slot as a separate control.
For a listing that already uses `business-v2/UI.Table`, supply the table's
`searchContent`, `primaryFilters`, `filters`, `importAction`, or `searchActions`
as appropriate. Its default search and export cover the current page. When
required, pass the existing server export through `searchActions` to retain its
scope. Use `filters={null}` to omit advanced filters.

Render the table, form, chart, or other body as children. Use `status` for
request feedback and `pagination` when the page has a pager. Leave unused slots
unset. Data fetching, filtering and sort rules, permissions, scan handlers,
pagination state, and download/upload logic belong to the screen.

## Layout coverage

| Surface | Layout |
| --- | --- |
| Business workspace and platform console | Shared route container, tab headers and actions. Existing sidebars and access checks. |
| Catalogue, sales, returns, purchases, inventory, suppliers, transfers, counts, damage, audit and administrative lists | Shared list layout. Existing server and current-page queries, filters, tables and paging. |
| Dashboard, reports, treasury, expenses, accounts, settings, guidance, locations, opening stock, and support | Shared page layout with content slots for metrics, forms and workflow controls. |
| Purchase, sale, adjustment, transfer and catalogue workflows | Shared headers and controls around editors and details. Dialogs, steps, and records keep their domain structure. |
| Billing recovery, contact, authentication, legacy app routes, setup and onboarding | Shared page or form layout. Existing routing and form behaviors. |
| Marketing, the promotional subscription experience, and printed receipts | Dedicated presentation as specified by the project's design instructions. |
