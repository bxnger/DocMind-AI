# DOCMIND AI — frontend

AI-powered document intelligence workspace, built for the Innovation AI Hackathon 2026 (AIChatBots track).
Upload a PDF or DOCX, ask about it, and check every result against the original page.


## Run

Needs Node 22 or newer. The whole project and the backend setup are described in the repository's root README.

```bash
cp .env.example .env      # VITE_API_BASE_URL=http://127.0.0.1:8011
npm install
npm run dev               # http://localhost:5173
```

Start the backend first (`../backend`, port 8011, from a version with guest sessions). Open the app on `localhost`, not `127.0.0.1`: the backend's CORS
default allows only the former.

## Sessions

The API needs a guest session. `src/api/session.ts` creates one on the first protected request and keeps it in `localStorage`, so a reload continues the same guest. `src/api/client.ts` adds `Authorization: Bearer` to every protected request, including SSE; uploads and PDF.js send the same header. The token never goes into a URL or a log.

When the server answers 401, the session is replaced, everything of the old guest is cleared from this browser (`src/services/userData.ts`) and the app is rebuilt from nothing. Only a GET is repeated by itself: a question, upload or delete waits for the user. Theme, language and mode stay.

## Evidence Jump

Every source of an AI answer is interactive: the `[n]` marker, the source card, and the Evidence Inspector over the document.

- Clicking a source scrolls the PDF smoothly to the page and highlights the quote from the backend's `highlights`
  (fractions 0..1 of the page), with a short arrival ring. Reduced motion makes the jump instant.
- Without coordinates it only highlights text it really finds in the page's text layer, and says so. If the quote isn't there,
  it opens the page and highlights nothing. The inspector always states which of these happened.
- Several sources: tabs, previous/next with wrap-around, arrow keys, Esc to close. Hovering a marker shows a preview.
- DOCX sources show their section and quote, never a page number, and nothing is jumped to.
- Logic lives in `src/features/evidence/` and `src/features/viewer/lib/locate.ts` and is covered by unit tests.

## Knowledge Map

The Map view in the workspace is an interactive graph of a document's repeated terms, built in the browser from its real text (`src/features/knowledgeMap/`). There is no map API on the backend. It is word statistics, not AI, and says so: a link means two terms share passages, the document's own node links to the largest topic of each group, and every fragment is verbatim and opens through Evidence Jump. A DOCX works too, from `/text`, with sections instead of pages.

The layout is computed once and never moves by itself. Dragging places a node and pins it, and only its direct neighbours make a little room. There is zoom, pan, fit, reset, a minimap, search, and a choice of 15, 30 or all topics, up to 50. On a focused topic, arrow keys move it and P pins it. It is drawn with plain SVG: a graph library would add weight and fight the round nodes, for no gain at this size.

## Compare documents

`/compare` shows the backend's sentence diff (`POST /comparisons`) of two ready documents. The API gives a page and a quote for each change, without coordinates, so a change is marked only where its quote is really found on the page or in the text.

- **Side by side:** the real PDFs in the app's viewer, or a DOCX in its text reader, with the change list beside them. Choosing a change moves both documents to it. A side without the change says so.
- **Unified diff:** the unchanged text of both documents, from `/text`, with each change in its place. Unchanged text can be hidden, and a change that can't be placed is listed apart, not put at a guessed spot.
- Filters by type, previous and next, arrow keys and J/K, swapping the documents without reloading them.
- Scroll lock keeps the same share of each PDF. It is approximate and says so; a DOCX has no pages to align, so it isn't offered there.
- A phone shows one thing at a time: changes, A, B or diff.

## User modes

General, Student, Teacher, Legal and Business change which suggested actions appear above the chat input. The mode is a
display preference kept in this browser (`docmind.userMode`). It isn't sent to the backend and doesn't change the model.
An action only fills the input for review: sending stays the user's step. Prompts live in the locale files.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port 5173 |
| `npm run build` | Type check and production build |
| `npm run preview` | Serves the production build on port 5173 |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest) |
| `npm run generate:sample` | Rebuilds the sample PDF in `public/demo/` |

## What is real and what is demo

Contract: [`../backend/docs/api-contract.md`](../backend/docs/api-contract.md).

| Area | Source |
|---|---|
| Documents, processing stages, conversations, SSE answers, sources, highlights, comparison | **Real backend** |
| "AI" mode in the assistant | Claude through the backend. Needs `ANTHROPIC_API_KEY` on the backend |
| "Demo" mode in the assistant, and the sample document | **Not AI**. Keyword search over the PDF's text, in the browser (`src/services/chat/demo/`), labelled in the UI, kept in a separate conversation |
| Comparison | Sentence diff on the backend, labelled "no AI" in the UI |
| PDF preview while `processing` | Copy of the file in this browser (IndexedDB), labelled "Browser copy" |

Both assistant modes implement `ChatAdapter` (`src/services/chat/types.ts`); `useAssistant` chooses between them.

## Structure

```
src/
  app/          App root: providers and routes
  pages/        Route-level screens
  components/   ui/ primitives, layout/ shell
  features/     documents, upload, viewer, chat, sources, workspace, command, settings, system
  services/     chat adapters, browser file store, recents, sample document
  api/          HTTP client, error normalisation, endpoint modules
  hooks/  lib/  types/  styles/  i18n/
```

- Design tokens are in `src/styles/index.css`.
- UI strings are in `src/i18n/locales/` (`en`, `ru`, `kk`). A unit test fails if a key or placeholder is missing.
