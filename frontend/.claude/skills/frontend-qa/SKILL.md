---
name: frontend-qa
description: Verify the DOCMIND AI frontend end to end: PDF/DOCX upload, chat, sources and citations with PDF page navigation, responsive layout, loading/empty/error states, RU/KZ/EN localization, console errors, and production build. Use before declaring a feature done, after UI changes, or when asked to test or QA the app.
---

# Frontend QA — DOCMIND AI

Act as a meticulous QA engineer. Your job is to find out what actually works, not to confirm that it should work.

## Core honesty rules (non-negotiable)

1. **Never claim something works unless you actually tested it** in this session. Use the vocabulary below consistently in your report:
   - **PASS**: you performed the check and observed the expected result (say how).
   - **FAIL**: you performed the check and it did not behave as expected (include evidence).
   - **BLOCKED**: you could not perform the check (backend not running, no test file, no browser tool, missing credentials). Say why.
   - **NOT APPLICABLE**: the feature does not exist in the code (e.g., Kazakh locale not implemented).
   - **NOT TESTED**: you did not look at it. Do not hide these.
2. Reading code is not testing. Code review may support a hypothesis but is reported as "code review only".
3. Attach evidence: exact command output, console messages, HTTP status codes, screenshot descriptions, viewport sizes, file names used.
4. Do not fix-and-claim in one step. If you fix something, re-run the failing check and report the new result.
5. If a check passes only partially, report the partial result, not a rounded-up PASS.

## Step 0: Discover and prepare

1. Read `package.json` to find scripts (`dev`, `build`, `lint`, `test`, `typecheck`, `preview`), the framework, and the test tools.
2. Find how the frontend reaches the backend (env vars, proxy config, base URL) and what the backend exposes. Do not guess endpoints; use the real ones from code/docs.
3. Start the backend and frontend if the repo provides a way (README, scripts, docker-compose). If the backend cannot be started, mark backend-dependent checks as BLOCKED, or test against a mock only if clearly labelled as a mock result, which is not proof of real integration.
4. Prepare test files (create them in a scratch directory, not in the project):
   - A small valid text-based PDF (multi-page, ≥ 5 pages with distinguishable content per page).
   - A valid DOCX with headings and a table.
   - Edge cases: scanned/image-only PDF, password-protected PDF, 0-byte file, corrupted file renamed `.pdf`, `.txt`/`.png`/`.exe` (unsupported), oversized file (above the documented limit), file with a long name and Cyrillic/Kazakh characters.
5. Use a real browser for UI checks when tooling is available (Playwright, browser MCP, or manual dev server + devtools). If no browser is available, say all UI checks are NOT TESTED or code-review only.

## Test plan

### A. Document upload (PDF and DOCX)
- Upload via file picker and via drag-and-drop (both).
- Valid PDF and valid DOCX: progress shown, success state, document appears in the list with correct name/size/type, processing/indexing status resolves to ready.
- Invalid cases: unsupported type, empty file, corrupted file, oversized file, password-protected, scanned PDF without text, duplicate upload, very long/Unicode file name. Each should produce a specific, understandable error and leave the UI usable.
- Multiple files at once, cancelling mid-upload, uploading while offline (DevTools offline), backend 500 and timeout.
- Confirm network requests: method, URL, payload field name, status code match the backend contract.
- After refresh: does the document persist as expected (if designed to)?

### B. Chat
- Send a question with Enter and with the send button; Shift+Enter inserts a newline; empty/whitespace-only input is blocked.
- Message appears immediately; loading/streaming indicator shows; the answer renders fully (markdown: lists, code, tables, links) without layout break.
- Stop/cancel generation (if present), retry after error, long answers, long unbroken strings, very long question, rapid repeated sends, sending during an in-flight response.
- Scroll behavior: auto-scroll only when at the bottom; "jump to latest" if present.
- Chat without any uploaded document: appropriate empty/guidance state, no crash.
- Questions with answers present in the doc, and questions with answers absent from it: the UI handles "not found" answers sensibly.
- Conversation persistence/history after refresh and when switching documents (if designed).
- Network failure and 4xx/5xx mid-stream: visible error, input preserved, retry possible.

### C. Sources, citations, page navigation
- Each answer that should cite sources displays them (document name, page number, snippet/quote).
- **Verify correctness, not just presence**: for at least 3 questions, open the cited page in the PDF and confirm the quoted text is really on that page and the page number is right (watch for off-by-one errors between 0- and 1-based indexing).
- Clicking a citation opens/scrolls the viewer to the correct page; the viewer highlights or otherwise indicates the passage if designed to.
- Multiple citations in one answer, citations from several documents, and the same page cited twice.
- DOCX sources: how are they shown (no pages)? Verify graceful behavior.
- Viewer controls: next/prev page, page input, zoom, scroll sync, loading state for large PDFs, error for unreadable PDFs.
- Keyboard accessibility of citation chips and viewer controls.

### D. Loading, empty, and error states
Verify each exists and looks intentional on every data-driven view (document list, viewer, chat, history, settings):
- Loading: skeletons/spinners that match the layout; no layout jump when data arrives.
- Empty: helpful text and a primary action.
- Error: specific message, retry action, no raw stack traces; app remains usable.
- Simulate with DevTools (offline, throttling, blocked request, forced 500) or by stopping the backend.

### E. Responsive design
Test at least at **360×800, 390×844, 768×1024, 1024×768, 1280×800, 1920×1080**, portrait and landscape for tablet/phone where relevant:
- No horizontal page scroll; no clipped or overlapping elements; text readable.
- Sidebar behaves per breakpoint (drawer on mobile); document viewer usable on mobile; composer remains visible with the on-screen keyboard area considered.
- Touch targets adequate; no hover-only functionality.
- Long names, long words, tables, and code blocks do not break layout.
- Browser zoom 200% still usable.

### F. Localization (RU / KZ / EN), only if implemented
- First confirm which languages exist in code. If a language is missing, mark NOT APPLICABLE and say so.
- Switch each language: every visible string translates (nav, buttons, placeholders, empty/error states, toasts, aria-labels, dates, file sizes). Look for raw keys (e.g., `chat.send`), mixed languages, and missing-key warnings in the console.
- Language choice persists after reload; `<html lang>` updates.
- Layout holds with longer RU/KZ strings (no overflow/truncation of critical text).
- Kazakh-specific letters (ә, ғ, қ, ң, ө, ұ, ү, һ, і) render properly in the font and in PDF/DOCX text, chat input, and answers.
- The assistant's answer language behavior matches the design (if the UI defines it).

### G. Console, network, and runtime health
- Open the console with "Preserve log" during all flows above. Record errors and warnings (React key warnings, hydration issues, failed requests, CORS, unhandled promise rejections, deprecated API notices, missing translations, 404s for assets).
- Zero uncaught errors is the target. Distinguish app errors from browser-extension noise.
- Check the Network panel for failed requests, repeated polling, duplicate requests, oversized payloads, and secrets or tokens exposed in URLs.

### H. Static checks and production build
Run and report real output (summarized, with the exit code):
1. Type check (e.g., `npx tsc --noEmit` or the project's script).
2. Lint (`npm run lint`).
3. Unit/component tests (`npm test`), noting which suites exist and which were skipped.
4. Production build (`npm run build`): must exit 0; note warnings (large chunks, unresolved imports).
5. Preview the production build (`npm run preview` or equivalent) and repeat a smoke test: load, upload, chat, citation jump, console clean. Production-only bugs (env vars, base paths, minification issues) are common.

### I. Accessibility smoke test
- Tab through the whole flow: visible focus, logical order, no traps; modals close with Escape and return focus.
- Icon-only buttons have accessible names; form fields have labels; status messages are announced (`aria-live`).
- Run an automated checker if available (axe, Lighthouse) and report its results; automated tools catch only part of the issues, so say so.
- Reduced motion: emulate `prefers-reduced-motion: reduce` and confirm movement stops.

## Reporting format

Deliver a structured report:

1. **Environment**: OS, browser/tool used, Node version, commands run, whether backend was running, commit/state of the code.
2. **Results matrix**:

| Area | Check | Result (PASS/FAIL/BLOCKED/N/A/NOT TESTED) | Evidence / notes |
|---|---|---|---|

3. **Defects**: for each FAIL: ID, severity (Blocker/Major/Minor), steps to reproduce, expected vs. actual, evidence (console output, request/response, viewport), suspected cause with file reference when known.
4. **Build & checks**: exact commands and outcomes.
5. **Not verified**: a short, honest list of everything skipped or blocked, and what is needed to test it.
6. **Verdict**: "Ready", "Ready with known issues", or "Not ready", with the reasoning tied to the evidence. Never say "everything works" unless every relevant area is PASS with evidence.

## When fixing defects

- Only fix when asked or clearly implied. Keep fixes small and targeted.
- After each fix, re-run the failed check and the related regression checks, then update the report with the new results.
- If a bug is a backend problem (wrong page numbers in the API response, missing field), report it as a backend defect with request/response evidence rather than masking it in the UI.
