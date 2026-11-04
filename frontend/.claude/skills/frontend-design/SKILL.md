---
name: frontend-design
description: Design and build premium dark SaaS interfaces for DOCMIND AI (Linear / Notion / Perplexity / Raycast inspired). Use when creating or restyling pages, layouts, components, design tokens, typography, or visual polish, including loading, empty, error, and responsive states.
---

# Frontend Design — DOCMIND AI

Act as a Senior Product Designer and Senior Frontend Engineer at once. Every screen must look like it was designed by a human who cares about details, not generated from a template.

## Before you start

1. Read the existing code first: the styling approach (Tailwind, CSS modules, CSS-in-JS, plain CSS), the component library, existing tokens, and the current layout. Extend what exists; do not introduce a second styling system.
2. Identify the screen's single primary job (upload a document, ask a question, verify a source). Design the hierarchy around that job.
3. Reuse existing components before creating new ones.

## Brand and visual direction

Premium dark SaaS: calm, dense-but-breathable, precise. Reference feel: Linear (crisp borders, restraint), Notion (document-first content), Perplexity (answers with sources), Raycast (fast, keyboard-friendly, subtle glow).

### Design tokens (define once, use everywhere)

Expose these as CSS variables (or the Tailwind theme) and never hard-code hex values in components.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#090B10` | App background |
| `--sidebar` | `#0D1017` | Sidebar, secondary panels |
| `--card` | `#121722` | Cards, inputs, message surfaces |
| `--border` | `#242B38` | All dividers and outlines |
| `--accent` | `#8B7CFF` | Primary actions, active state, focus |
| `--accent-2` | `#55C8E8` | Secondary accent: links, citations, info |
| `--text` | `#F4F5FA` | Primary text |
| `--text-muted` | `#939BAA` | Secondary text, labels, placeholders |

Derive the rest from these instead of inventing new colors:
- Hover surface: card lightened ~3–4% or `rgba(255,255,255,0.03)` overlay.
- Accent tint (selected rows, badges): accent at 10–16% alpha; accent border at 30–40% alpha.
- Semantic colors (success / warning / danger): muted, desaturated, used only for status. Never use them as decoration.
- Use at most one accent per view region. `--accent-2` supports; it does not compete with `--accent`.

### Typography

- Font: **Inter** or **Geist** (check which is already installed; prefer Inter if neither is). Enable `font-feature-settings: "cv11", "ss01"` for Inter where available; use `font-variant-numeric: tabular-nums` for page numbers, counts, and file sizes.
- Scale (px / line-height): 12/16 caption, 13/20 UI small, 14/22 body default, 16/24 lead, 20/28 section title, 24/32 page title, 32/40 hero (rare).
- Weights: 400 body, 500 UI labels and buttons, 600 headings. Avoid 700+.
- Slightly negative letter-spacing (`-0.01em`) on headings 20px and up. Never uppercase long text; uppercase micro-labels only with `+0.04em` tracking at 11–12px.
- Line length for reading content (answers, documents): 60–75 characters.

### Spacing, radius, elevation

- 4px base grid. Use only: 4, 8, 12, 16, 20, 24, 32, 48, 64.
- Radius: 12px for controls, chips, inputs, small cards; 16px for large cards, modals, panels. Pills (`9999px`) only for tags and status badges. Be consistent within a nesting level (inner radius = outer radius − padding).
- Borders do the structural work: 1px solid `--border`. Prefer borders over heavy shadows on dark backgrounds.
- Shadows are subtle and only for floating layers (popovers, modals, command menus): large blur, low-opacity black, plus a 1px inner highlight (`inset 0 1px 0 rgba(255,255,255,0.04)`).
- Glows: a single soft accent glow (blur 24–40px, ≤ 20% alpha) allowed on the primary CTA focus or hero element. Never multiple glows per screen.

## Layout principles

- App shell: fixed sidebar (≈ 256px, collapsible to ≈ 64px icon rail) + main area + optional contextual right panel (document viewer / sources).
- The document and the conversation are the product. Chrome (toolbars, headers) stays quiet: muted text, small icons (16–18px, 1.5px stroke, one icon set only, such as Lucide).
- Establish hierarchy with size, weight, color value, and spacing, in that order. Do not rely on boxes inside boxes.
- Limit simultaneous visual weights: one filled primary button per view; everything else is ghost or outline.
- Align to a consistent content width and left edge. Check optical alignment of icons against text.

## Avoid the "AI-generated dashboard" look

Do not ship any of the following:
- Purple-to-blue gradient everywhere, gradient text on every heading, glassmorphism on every card.
- Rows of identical stat cards with big numbers and meaningless sparklines.
- Emoji as icons, mixed icon sets, decorative blobs/orbs, stock sparkle ("✨") icons for AI features.
- Generic copy such as "Unlock the power of AI". Write specific, calm, useful microcopy ("Drop a PDF or DOCX to begin").
- Uniform card grids with equal weight on everything. Vary density and emphasis according to importance.
- Over-rounded, over-padded, over-shadowed components.

## Component standards

- **Buttons**: heights 32 / 36 / 40px; primary = accent fill with `--text` or near-black text (check contrast), secondary = card fill + border, ghost = transparent. Include hover, active (slight darken, no scale > 0.98), focus-visible (2px accent ring with 2px offset), disabled (40–50% opacity, `cursor: not-allowed`), and loading (spinner replaces icon, width preserved).
- **Inputs / chat composer**: card surface, border, 12–16px radius, accent border + soft ring on focus, auto-growing textarea, visible send button state (disabled when empty), keyboard hint (Enter to send, Shift+Enter for newline).
- **Cards**: border + card surface; hover raises border color slightly, not the whole card. Clickable cards are real `<button>`/`<a>` elements.
- **Sidebar items**: 36px height, icon + label, muted by default, active = accent tint background + text color `--text`, with an optional 2px accent indicator.
- **Chat messages**: user messages compact and right-aligned or clearly distinguished; assistant answers full-width readable prose with inline citation chips (`[1]`, page badge) in `--accent-2`. Code and tables inside answers get card styling and horizontal scroll.
- **Citations / sources**: chip shows document name + page (`p. 12`), tabular numbers, hover preview of the quoted snippet, click opens the document at that page.
- **Modals / drawers**: 16px radius, backdrop `rgba(0,0,0,0.6)` with optional blur, focus trap, Escape closes, focus returns to trigger.
- **Toasts**: bottom-right, short, with action when recoverable; auto-dismiss only for non-errors.

## Required states (never skip)

Every data-driven view must implement all of these, visually designed, not left as defaults:

1. **Loading**: skeletons that match the final layout (not a lone spinner). Streaming chat shows a typing/streaming indicator and keeps the layout stable. Uploads show a progress bar with file name, size, and cancel.
2. **Empty**: one-line explanation, one clear primary action, subtle illustration or icon (no clip-art). Example: empty library → "No documents yet" + "Upload document".
3. **Error**: say what happened and what to do next, offer Retry, keep user input intact. Distinguish network failure, unsupported file type, file too large, parse failure, and server error with specific messages.
4. **Success / partial**: confirmation for uploads, indexing-in-progress badge, "processing" states that do not block other work.
5. **Disabled / permission-limited** states where relevant.

## Responsive design

- Mobile-first breakpoints (adapt to existing ones): 360, 640, 768, 1024, 1280, 1536.
- ≥ 1024px: sidebar + main (+ document panel). 768–1023px: collapsed icon sidebar, document panel as overlay. < 768px: sidebar becomes an off-canvas drawer; document viewer opens full-screen; composer pinned to the bottom with safe-area padding (`env(safe-area-inset-bottom)`).
- Touch targets ≥ 44×44px on touch devices. No hover-only functionality.
- No horizontal page scroll at 360px. Test long file names (truncate with ellipsis + `title`), long words, and long tables.
- Use `min-h-dvh`/`100dvh` rather than `100vh` for full-height mobile layouts.

## Accessibility baseline (design-time)

- Text contrast ≥ 4.5:1 (`--text-muted` #939BAA on #090B10 passes; verify it on `--card` and tinted backgrounds). Non-text UI ≥ 3:1.
- Visible `:focus-visible` on every interactive element. Never `outline: none` without a replacement.
- Color is never the only signal (pair with icon/text).
- Semantic HTML and labels; icon-only buttons need `aria-label`.

## Workflow

1. Inspect existing code and tokens; report what you found in one or two sentences.
2. Define or reconcile tokens first, then components, then screens.
3. Implement all required states and the responsive behavior in the same pass.
4. Verify visually when possible (run the dev server, view at 360 / 768 / 1280 widths). If you could not view it, say so.
5. Summarize what changed, which tokens or components were added, and any trade-offs.

## Guardrails

- Do not invent backend features or data in the UI. Use realistic placeholder content only when clearly marked as mock and only if no real data source exists.
- Do not add dependencies without a reason; prefer what the project already uses.
- Do not rewrite unrelated code while restyling.
