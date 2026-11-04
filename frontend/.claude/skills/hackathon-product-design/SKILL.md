---
name: hackathon-product-design
description: Product, UX, and frontend strategy for DOCMIND AI at the AIChatBots hackathon. Use when designing or changing user flows and screens around evidence-first document Q&A (upload, indexing, questions, citations, PDF page navigation, document comparison), when deciding what to build or show in the demo, or when judging a feature against the hackathon scoring criteria.
---

# Hackathon Product Design — DOCMIND AI

Think as three people at once: a Senior Product Designer (workflows, clarity), a Senior Frontend Engineer (buildable, maintainable, accessible), and a Hackathon Product Strategist (what the jury scores and what a 2–3 minute demo can prove).

DOCMIND AI is **not a generic AI chat**. It is an evidence-first document assistant: the user uploads PDF/DOCX files, asks questions, gets answers grounded in the documents, inspects the exact supporting quotes, and jumps to the original page. Every design decision should make that evidence loop faster and more trustworthy.

This skill decides **what to build and how it should behave**. For visual execution, tokens, and states use `frontend-design`; for code structure and API integration use `react-architecture`; for motion use `motion-interactions`; for review use `ui-ux-audit`; for verification use `frontend-qa`.

## Hackathon scoring: use it to prioritize

| Criterion | Points | What it means for the product |
|---|---|---|
| Originality, uniqueness, application area | 40 | The evidence-first workflow and document comparison / contradiction detection. The value must be visible on first look, not buried in a menu. |
| Document processing quality and answer accuracy | 30 | Correct extraction, correct page numbers, answers that stay within the documents, honest "not found" behavior. This is mostly backend, but the UI must expose it faithfully. |
| Functional capabilities | 15 | Upload, multi-document, sources, PDF viewer, comparison, languages (RU/KZ/EN), scans if the backend supports them. Everything shown must really work. |
| Presentation quality | 15 | A clear 15-second story, a polished UI, and a smooth live demo. |

Rule of thumb: when time is short, a smaller feature that works end to end and is verifiable beats a larger feature that is half-working. Never trade honesty for polish.

## Before you change anything

1. Inspect the existing project: frontend stack, existing pages and components, the styling approach, i18n setup, and the backend (code or API docs). Summarize what exists in a few sentences before proposing work.
2. Identify which parts of the flow already work (upload, chat, citations, viewer, comparison) and which are missing. Improve the weakest link of the evidence loop first.
3. Find out what the backend **actually returns**: document status and stages, page counts, language, whether OCR was used, source objects (document, page, quote), streaming format, comparison results, any evaluation metrics. Design only for fields that exist.
4. Reuse existing components and patterns. Do not rewrite working functionality without a stated reason.

## 1. Product differentiation

- Design around real document workflows, not around a chat box with a sidebar. Examples: "Does this contract say X, and where?", "What changed between version 1 and version 2?", "Do these two documents contradict each other?", "Find the clause about Y and show it to me".
- The main screen is a **workspace** of documents + conversation + evidence, not a dashboard of decorative cards. No fake stat tiles, no generic "AI assistant" hero copy.
- Make the unique value understandable immediately: the empty state, the product tagline, and the first screenshot should show the loop "ask → answer with quotes → open the page". Use concrete microcopy ("Ask anything. Every answer shows where it came from.").
- Treat document comparison and contradiction detection as the headline differentiator **when the backend supports it**. If it does not exist yet, do not show a disabled fake; either hide it or show an honest "coming soon" only if the team wants that, and say which backend work is needed.

## 2. Evidence-first UX

These rules are mandatory for every answer view.

1. **Sources are first-class.** Each answer lists its sources directly under the text, not behind a tiny icon. Each source shows: document name, page number, and the exact supporting quote (truncated with "show more", never altered).
2. **Inline markers map to sources.** If the answer text contains citation markers (`[1]`), hovering or focusing one highlights the matching source card, and clicking opens the viewer. Only render markers the backend actually returned.
3. **Open at the cited page.** Clicking a source opens the original document in the viewer on that exact page and highlights the quote where the text layer allows it. If the quote cannot be located on the page, still open the page and say "Exact passage could not be highlighted" instead of silently failing.
4. **Distinguish AI text from document evidence.**
   - AI-generated explanation: normal prose on the app background, labelled as the assistant's answer.
   - Original document evidence: quoted blocks with a distinct treatment (left accent border in `--accent-2`, card surface, monospace or serif-leaning quote styling, document + page header). Quotes are never styled like assistant prose, and assistant prose is never placed inside a quote block.
5. **Say when the documents do not support an answer.** If the backend returns no sources or an explicit "not found" signal, show a clear state: "The selected documents don't contain enough information to answer this." Offer next actions (rephrase, select more documents, upload another file). Do not show filler sources.
6. **Never invent evidence.** No fabricated citations, page numbers, quotes, confidence scores, relevance percentages, or "verified" badges. Show a `score`, `confidence`, or similar only if the backend returns it, and label it as what it is (for example, "retrieval score"), without implying correctness.
7. **Make verification cheap.** From an answer, the user should reach the original passage in one click, and be able to return to the conversation in one click (keep the chat visible next to the viewer on wide screens; use a drawer/overlay with a clear back action on narrow screens).
8. **Handle partial and degraded cases honestly**: answer without sources, a source whose page is unknown (for example, DOCX without pages), a document still indexing, OCR-derived text that may be imperfect (show a subtle "scanned text" indicator only if the backend reports `ocr` usage).

## 3. Workflow design

Optimize the full journey and count the clicks: **upload → processing → document selection → question → answer → evidence verification**.

- **Upload**: drag-and-drop anywhere on the workspace plus a visible button. Multiple files supported if the backend accepts them. Validate type and size client-side for convenience only and show the backend's error codes accurately.
- **Processing**: show the real stage (extracting, OCR, indexing) only if the backend reports stages; otherwise a neutral "Processing…" with elapsed state. The user can browse other documents or start typing while indexing continues. Ask is disabled for a document only until it is ready, with a reason shown.
- **Document selection**: the active context is always visible (chips showing which documents the next question will search). Default to the most recently uploaded ready document; allow multi-select when multi-document Q&A is supported.
- **Question**: composer is focused after upload completes; suggested starter prompts must be generic and honest ("Summarize this document", "List key obligations and deadlines") and never claim knowledge of the content unless generated from real data.
- **Answer**: streaming with a stable layout; sources appear when the backend sends them; allow stop and retry.
- **Verification**: one click to the cited page; keyboard navigation between sources; copy quote with citation text (document, page).
- **Comparison (if supported)**: pick two documents (default from the current selection), start, show real progress, then present differences grouped by type (changed, added, removed, potential contradiction). Each difference shows the explanation and both quotes with document name and page; clicking opens both documents side by side at those pages. Label contradictions as "potential" unless the backend states otherwise. Allow filtering by type and marking items as reviewed locally.
- **Multi-document**: always show which document each source came from; color or label per document is allowed if it stays consistent and meets contrast and non-color-only rules.
- States: provide loading, indexing, success, empty, and error for every step (see `frontend-design`). Errors name the cause (unsupported type, too large, password-protected, no extractable text, server unavailable) and offer the next action. Keep the user's typed question when an error occurs.
- Minimize clicks: no confirmation dialogs for non-destructive actions; confirm deletes; remember the last selected documents within the session.

## 4. Hackathon demonstration

- The 15-second test: someone who opens the app should grasp "upload documents, ask, get answers with proof, open the source" without reading help text. Check the empty state and the first answer against that test.
- Design for a 2–3 minute live demo with a script the product itself supports:
  1. Upload a real PDF (and a DOCX if supported); show real processing.
  2. Ask a question; show the answer with quotes and page numbers.
  3. Click a source; show the original PDF page with the highlighted passage.
  4. Ask something the documents do not contain; show the honest "not supported" state.
  5. Show the differentiator: compare two documents and open a flagged difference on both sides (if supported).
  6. Switch language (RU/KZ/EN) if implemented; mention scanned-document handling only if actually demonstrated.
- Make key functionality discoverable: the comparison entry point, the source viewer, and the language switch are visible in the main UI, not hidden in menus.
- Demo resilience: sample documents should be real files the team supplies (never fabricated content passed off as results). Provide a clear recovery path if the backend is slow (progress, cancel, retry). Do not rely on hover-only or hidden interactions for demo-critical actions.
- Never use fake functionality, hard-coded answers, canned citations, simulated progress that does not reflect the backend, or mock results displayed as real. If a mock is needed for development, label it and remove it before the demo; report it.

## 5. Measurable quality

- Leave room in the UI for real evaluation and retrieval data **if the backend supplies it**: retrieved passages with scores, number of sources used, which pages and documents were covered, answer latency, tokens, indexing time, OCR usage.
- Present such data as a secondary, collapsible "Details" or "How this answer was built" panel that supports the presentation story. It must never push the evidence off the main view.
- Source coverage visualization (for example, which pages of a document supported the answer) is allowed only from real source data. Follow the `dataviz` skill for any chart if one is available, and keep it accessible.
- Never fabricate accuracy percentages, benchmarks, "98% accurate" claims, uptime, or speed statistics, in the UI, in demo copy, or in presentation text. If an evaluation has not been run, say nothing or say it was not measured. If the team runs a real evaluation, report its method and sample size next to the number.

## 6. Frontend engineering rules

- Follow the existing architecture and conventions; add features inside the matching feature folder (`documents`, `chat`, `sources`, `compare`) with typed props, hooks for logic, and the API layer for requests. See `react-architecture`.
- Reuse components (buttons, chips, cards, modals, skeletons). Create a new shared component only when at least two places need it.
- Modular components under ~150 lines; presentation separated from data and logic.
- Responsive: workspace is three panes on wide screens (documents, conversation, viewer), two on tablet, one at a time on mobile with clear navigation between them. Composer and sources remain reachable on 360px.
- Accessibility: keyboard access to sources, viewer controls, and comparison items; focus management when opening and closing the viewer; `aria-live` for streaming/status; visible focus; contrast per tokens; reduced-motion respected.
- Dependencies: no new library unless the feature cannot reasonably be built without it. PDF viewing, markdown rendering, and i18n are expected dependencies; avoid UI kits and heavy animation libraries when the project does not already use them.
- Avoid overengineering: no abstractions for hypothetical features, no global state library unless shared state requires it.

## 7. Design quality

- Keep the DOCMIND AI visual identity: premium dark SaaS (`#090B10` background, `#0D1017` sidebar, `#121722` cards, `#242B38` borders, `#8B7CFF` accent, `#55C8E8` secondary accent, `#F4F5FA` text, `#939BAA` secondary text; 12–16px radii; Inter or Geist). Defer the details to `frontend-design`.
- Hierarchy: the conversation and its evidence are primary; chrome is quiet. One filled primary action per view.
- Clarity over decoration: no gradients as decoration, glows, or illustrations that do not carry information. Microinteractions serve feedback (source hover linking to the marker, viewer opening, highlight fade, upload progress), applied per `motion-interactions`.
- Typography for evidence: quotes use a slightly different style from prose (for example, smaller size, accent border, document and page in tabular numbers) so the two are never confused.

## 8. Implementation rules

1. Inspect before changing. Report current state briefly.
2. Do not rewrite working functionality without a reason you can state.
3. **Never invent backend endpoints, fields, statuses, or data.** Use the real contract. If a design needs data the backend does not provide, list it under "Requires backend support" with the exact fields needed, and build the frontend only up to what is real (or behind a clearly labelled TODO).
4. Keep a running list of frontend features that depend on backend support. Typical examples:
   - Page numbers and quotes in sources (needs page-aware chunks).
   - Highlighting a passage (needs the quote text; position data is optional).
   - DOCX page navigation (needs DOCX-to-PDF conversion or paragraph anchors).
   - Indexing stages, OCR flag, language detection.
   - "Not found" signal distinct from an empty answer.
   - Document comparison results with quotes and pages for both sides.
   - Retrieval scores and evaluation metrics.
5. Use the other skills for the work they cover, and run `frontend-qa` before claiming anything works.

## Feature evaluation checklist

Before building or approving a feature, answer:

- Which scoring criterion does it move (originality, accuracy, functionality, presentation), and how?
- Does it strengthen the evidence loop or the comparison workflow, or is it generic AI decoration?
- Is every piece of data it displays real and available from the backend?
- Can it be demonstrated live in under 30 seconds, with real files?
- What happens when it fails (no sources, slow backend, bad file)?
- What is the smallest version that works end to end?

If a feature fails these questions, cut it or shrink it.

## Output expectations

When you finish a task using this skill, report:

1. What you inspected and what already existed.
2. What you changed, per file, and which existing components you reused.
3. Which evidence-first rules the change satisfies, and which are blocked by missing backend support (with exact fields needed).
4. How the change helps the demo and which scoring criterion it serves.
5. What you verified (and how) and what you did not verify. Do not claim a feature works if you did not run it.
