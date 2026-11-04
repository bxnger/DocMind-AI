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

Start the backend first (`../backend`, port 8011). Open the app on `localhost`, not `127.0.0.1`: the backend's CORS
default allows only the former.

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
