# Design system

**Status:** In Progress  
**Source:** Existing Urban Tanker tokens plus the locally installed UI/UX Pro Max guidance. Its Copilot prompt and design-system guidance were read on 2026-11-18. The bundled search requires Python 3, which is not available here; no system software was installed. Use the skill's documented Quick Reference rather than presenting an unrun design search as evidence.

## Product and interface direction

Design for a water, sanitation, and site-logistics booking platform used by customers, vendors/drivers, dispatchers, and administrators. Keep the established Urban Tanker identity and operational clarity; do not replace the current SCSS, React, or Flutter component systems with new dependencies. Public pages should prioritize service discovery and a clear booking action. Operational screens should prioritize readable status, location, ownership, filters, and safe actions over decoration.

## Existing visual tokens

Values below are read from `src/theme/colors.scss`, `src/theme/variables.scss`, and `src/theme/typography.scss`; they are the current brand foundation, not a claim that every screen already consumes semantic tokens consistently.

| Role | Existing value |
| --- | --- |
| Ink / primary text | `#10343a` |
| Muted text | `#567073` |
| Primary aqua | `#007c91` |
| Dark aqua / link | `#005c6c` |
| Paper / page surface | `#f5fbfc` |
| White / card surface | `#ffffff` |
| Divider | `#dce9e8` |
| Mint / positive accent | `#c7eadb` |
| Yellow / warning accent | `#f8ca63` |
| Coral / destructive accent | `#d96250` |
| Body type | Manrope, system sans-serif fallback |
| Display type | Playfair Display with Georgia fallback |
| Tabular / code type | DM Mono with Consolas fallback |
| Standard radius / large radius | `16px` / `24px` |
| Standard shadow | `0 18px 45px rgba(15, 61, 68, .12)` |

## Token and layout rules

- Preserve brand values; route new styles through the existing theme variables and semantic CSS variables instead of duplicating raw colors.
- Use a consistent 4/8px spacing rhythm, with 16/24/32/48px for increasing section hierarchy. Keep 16px minimum input text on narrow screens to avoid mobile browser zoom.
- Use a restrained elevation hierarchy, clear borders, generous section spacing on marketing pages, and denser but scan-friendly data layouts in workspaces.
- Keep operational tables filterable, sortable, paginated/virtualized when needed, and usable on small screens without hiding critical status or actions.
- Retain existing responsive foundations and meaningful focus indicators. Prefer semantic HTML, accessible names, keyboard operation, associated labels, and announced validation/error states.
- Use stable interaction bounds, restrained state transitions, and correct existing Lucide/brand assets. Avoid gratuitous animation, layout-shifting hover effects, fake metrics, and decorative-only dashboard charts.
- For native Flutter, retain the established Material 3/FlexColorScheme design system, honor safe areas and touch targets, support text scaling, and keep loading/empty/error/retry states visible.

## Applied patterns by workflow

| Workflow | Pattern |
| --- | --- |
| Public home/service discovery | Responsive hero with optimized responsive image, concise benefit statement, primary booking CTA, secondary service/enquiry CTA, service cards, process and trust information. Avoid duplicating an existing functional landing page until a concrete gap is verified. |
| Booking | Step-based form, service-specific line items, saved-address selection, inline field errors, explicit quote breakdown, persistent retry/error feedback, and accessible review/confirmation. |
| Customer tracking | Status timeline with completed/active/pending distinction, last-update freshness, map only when coordinates are available, and honest unavailable/offline states. |
| Vendor/dispatch/admin operations | Role-scoped queues, status filters and search, contextual detail, capacity/assignment validation, confirmation for consequential actions, and empty/loading/error states. |
| Financial reports | Clearly label revenue, expense, profit, currency and period; show actual source data and filtered state; make export actions report their completion/failure. |

## Accessibility and responsive acceptance

- Maintain visible `:focus-visible` outlines and keyboard access for navigation, actions, dialogs and data controls.
- Pair status colors with text/icons; use sufficient text and non-text contrast; provide alt text for informative imagery and empty alt text only for decorative imagery.
- Associate inputs with labels and error descriptions. Move focus to actionable error summaries when appropriate and preserve entered values after recoverable failures.
- Reflow layouts at narrow widths, preserve usable touch targets, avoid horizontal page overflow, and test at 320px, 390px, tablet, and desktop widths.
- Test browser zoom/text scaling and the native mobile text-scale/safe-area behavior.

## Adoption and verification

The public home header now uses the existing mobile gutters without inheriting desktop spacing, and its brand/actions compact together at narrow widths. A browser check verified no horizontal document overflow at 320, 390, 400, 401, 414, 760, 761, and 1280px; the primary hero booking CTA remained visible at each width. No new dependency or visual redesign was introduced.

Stage 2 should continue by reviewing one representative operational flow and validating text scaling, keyboard focus, contrast, and touch targets. Track visual/accessibility checks in `TESTING_REPORT.md`. Track visual/accessibility checks in `TESTING_REPORT.md`.
