---
name: ui-ux-audit
description: Audit the DOCMIND AI interface as a Senior UX/UI Designer. Use when asked to review, critique, or improve screens for visual hierarchy, navigation, usability, accessibility, responsiveness, consistency, and user flows, and to fix the issues found.
---

# UI/UX Audit — DOCMIND AI

Act as a Senior UX/UI Designer with strong front-end skills. Find real problems, rank them, propose concrete fixes, and apply the fixes when safe. Be specific; vague advice such as "improve spacing" is not an acceptable finding.

## Scope and inputs

1. Determine what to audit: a given screen/component, a flow (upload → ask → verify source), or the whole app.
2. Read the relevant source code (components, styles, tokens, routes). If the app can be run, run it and inspect it in a browser at 360, 768, and 1280px widths. State clearly which findings come from the running UI and which from code reading only.
3. Reference the project's design system (see the `frontend-design` skill: premium dark SaaS, tokens `#090B10 / #0D1017 / #121722 / #242B38 / #8B7CFF / #55C8E8 / #F4F5FA / #939BAA`, 12–16px radii, Inter or Geist).

## Audit checklist

### 1. Visual hierarchy
- Is the primary action obvious within 2 seconds? Is there exactly one dominant call to action per view?
- Do size, weight, and color value establish a clear reading order? Are headings, labels, and body text distinguishable?
- Is there visual noise: too many borders, badges, icons, accent colors, or competing emphasis?
- Is information density appropriate (not cramped, not wasteful)?

### 2. Navigation and information architecture
- Can users always tell where they are (active state, page title, breadcrumbs when nested)?
- Is the sidebar organized by user goals? Are labels plain and consistent?
- Are destructive or rare actions separated from frequent ones?
- Can the user get back, cancel, and recover from mistakes (undo, confirm for delete)?
- Are keyboard shortcuts and a command palette discoverable, if present?

### 3. Usability and user flows
Walk the core scenarios and note friction, dead ends, and unnecessary steps:
- First visit with no documents (onboarding, empty state).
- Upload PDF/DOCX: drag-and-drop and file picker, progress, success, invalid type, oversized file, corrupted file, duplicate upload, cancelling.
- Wait for processing/indexing: can the user do something meanwhile? Is the status honest?
- Ask a question: composer behavior, send/stop, streaming, long answers, retry, regenerate, copy.
- Verify an answer: citations visible, quote snippet readable, click jumps to the right page, page number visible, way back to the chat.
- Switch documents or conversations, rename, delete, search history.
- Change language (RU/KZ/EN if present): do labels overflow? Are all strings translated?
- Error recovery: network loss, backend 4xx/5xx, timeouts.

### 4. Feedback and states
- Every action gives feedback within 100 ms (pressed state), and longer waits show progress.
- Loading, empty, error, success, and disabled states exist and are well designed for each data view.
- Error messages are specific, human, and actionable; they never expose raw stack traces or codes alone.

### 5. Accessibility (WCAG 2.2 AA target)
- Contrast: text ≥ 4.5:1, large text and UI components ≥ 3:1. Check muted text on card and tinted surfaces.
- Keyboard: every control reachable and operable; logical tab order; visible focus; no focus traps except in modals (with Escape and focus return).
- Semantics: landmarks (`header`, `nav`, `main`), headings in order, `button` vs `a` used correctly, form fields labeled, icon-only buttons have `aria-label`.
- Dynamic content: chat updates and toasts use `aria-live` (polite for answers/status, assertive only for errors); upload progress exposes `role="progressbar"` with values.
- Touch targets ≥ 24×24 CSS px at minimum (aim for 44×44 on touch).
- Motion: respects `prefers-reduced-motion`. No content conveyed by color alone. Text can zoom to 200% without loss.
- Language attribute set on `<html>` and updated when the UI language changes.

### 6. Responsive design
- No horizontal scroll at 360px; layout adapts at each breakpoint; sidebar and document viewer behave sensibly on small screens.
- Composer stays reachable with the on-screen keyboard; safe-area insets respected.
- Long file names, long words, URLs, tables, and code blocks do not break layout.
- Images/PDF viewer scale correctly; zoom and page navigation usable by touch.

### 7. Visual consistency
- Colors come from tokens; no stray hex values or near-duplicate grays.
- Spacing on the 4px grid; consistent radii (12 for controls, 16 for large containers); consistent border color and weight.
- One icon set, consistent size and stroke. One font family, defined type scale.
- Same component looks and behaves the same everywhere (buttons, inputs, chips, modals).
- Copy tone and capitalization consistent.

### 8. Overload and clutter
- Too many actions visible at once, redundant labels, nested cards, excessive badges or gradients.
- Features that compete with the main job (documents + chat + sources).
- "AI dashboard" clichés: decorative gradients, meaningless stat cards, sparkle icons, generic marketing copy.

## Severity scale

- **Blocker**: prevents completing a core task or breaks accessibility fundamentally (cannot upload, cannot reach a control by keyboard, unreadable text).
- **Major**: significant friction or inconsistency a typical user will hit.
- **Minor**: polish issue with limited impact.
- **Idea**: optional enhancement.

## Output format

Produce a report in this structure:

1. **Summary**: 3–5 sentences: overall impression, biggest risks, what already works well.
2. **Findings table**, sorted by severity:

| # | Severity | Area | Location (file:line or screen) | Problem | Recommended fix |
|---|---|---|---|---|---|

3. **Top 5 priorities** with expected impact.
4. **Fixes applied** (if you made changes): list files and what changed.
5. **Not verified**: anything you could not check (e.g., no browser, no backend running, no screen reader test).

Every finding must cite evidence (a file and line, a screen, a measured contrast ratio, a viewport width). Give exact values in fixes (e.g., "increase `--text-muted` usage on `--card` from 3.9:1 to ≥ 4.5:1 by using #A3AABA").

## Fixing issues

- If the user asked to "audit" only, report and propose; ask before large changes.
- If the user asked to "improve" or "fix", apply low-risk fixes directly: token misuse, missing focus styles, missing labels, spacing, contrast, missing states, responsive breakage.
- Keep fixes minimal and in the project's existing styling approach. Do not refactor unrelated code.
- After fixing, re-check the affected screens and, when possible, run the type check, linter, and build. Report their real results.
- Do not claim an issue is resolved without re-verifying it.
