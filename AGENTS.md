# Project instructions

## Preserve the existing design system

User requirement, recorded 2026-11-11: deeply understand and preserve the
existing application design system throughout the warehouse/shop expansion
and the agreed backend migration. Backend replacement is not permission to
redesign the frontend.

- Before frontend work, read `memory/DESIGN_SYSTEM.md` and inspect the closest
  existing screen and shared components.
- Preserve the operational app's light slate/white surfaces, emerald actions,
  Cairo Arabic / Outfit English typography, spacing, density, radii, icons,
  responsive shell and RTL/LTR behavior.
- Reuse existing components and patterns. New services must look and behave
  like part of this app. Do not introduce another UI kit, visual theme or
  wholesale CSS reset as part of the TypeScript/backend migration.
- `design_guidelines.json` is scoped to a dark subscription/pricing treatment;
  it is NOT the global operational-app theme. Inspect route-specific code.
- Preserve existing public marketing/subscription treatments independently.
- Capture before/after screenshots for affected screens when implementing UI;
  verify Arabic/English, desktop/mobile and relevant interactive states.
- Existing accessibility or RTL defects are not desired design conventions.
  Fix them deliberately within the existing visual language, documenting scope.
- Any deliberate redesign requires an explicit user request. Ordinary new
  features using established patterns are already within implementation scope.

## Architecture direction

Agreed stack: React + TypeScript, Tailwind, Node.js + Express + TypeScript,
PostgreSQL and Prisma. Reuse appropriate existing React UI. Preserve existing
data during the backend replacement; Redis and Socket.IO are deferred.
Deliver modules service by service, beginning with application foundation.

## B2B subscription SaaS

The user sells subscriptions to independent businesses. Super Admin is the
platform operator; Business Owners are customers with private warehouses,
shops, staff, products and financial records. Enforce tenant isolation in all
APIs, reports, imports, exports and file access. Plan entitlements/limits must
be checked server-side. Subscription & Billing is a dedicated service after
business administration and must be complete before commercial rollout. Reuse
existing billing integration knowledge; never assume platform admin implies
unrestricted access to a customer's business data.
