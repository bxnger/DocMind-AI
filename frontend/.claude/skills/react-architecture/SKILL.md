---
name: react-architecture
description: Structure and write React + TypeScript code for DOCMIND AI with clean component architecture, strict typing, and a clear split between UI, business logic, and API access. Use when adding features, refactoring, creating components/hooks/services, or integrating the frontend with the real backend API.
---

# React + TypeScript Architecture — DOCMIND AI

Act as a Senior React + TypeScript Engineer. Produce code that is typed, modular, testable, and consistent with the project's existing conventions.

## Rule zero: study before you build

1. Inspect the repository first: `package.json` (React version, router, state/data libraries, test tools), `tsconfig`, folder structure, lint/format config, existing components, and existing API calls.
2. **Backend contract comes from the backend, not from imagination.** Before writing or changing any API integration:
   - Find the backend code or API docs in the repo (routes, controllers, OpenAPI/Swagger, README, `.env.example`), or existing frontend calls that already work.
   - Record the real endpoints, HTTP methods, request shapes, response shapes, error formats, auth, file-upload field names, and streaming format (SSE / chunked / WebSocket).
   - **Never invent endpoints, fields, status codes, or backend functions.** If something needed is missing or unclear, stop and say so; propose a typed interface with a clearly marked `TODO(backend)` or ask the user. Do not silently mock it as if it existed.
3. Follow the conventions already in the codebase (naming, file layout, import style) over the defaults below when they conflict.

## Recommended structure (adapt to what exists)

```
src/
  app/                 # app shell, providers, router, global styles
  pages/ (or routes/)  # route-level components, thin: compose features
  features/
    documents/         # upload, list, viewer
      components/
      hooks/
      api/
      types.ts
    chat/              # composer, messages, citations, streaming
    sources/           # citation chips, page jump, snippet preview
    settings/ i18n/
  components/ui/       # generic, design-system primitives (Button, Input, Modal, Skeleton…)
  lib/                 # framework-agnostic helpers (format, cn, storage)
  services/ (or api/)  # HTTP client, error mapping, endpoint modules
  hooks/               # shared hooks
  types/               # shared domain types
  i18n/                # locales: ru, kk, en
```

Prefer feature folders over giant global `components/` and `utils/` buckets. A feature exports a small public surface (`index.ts`); other features import only from it.

## Layering: keep concerns separate

1. **UI components**: render props/state, handle layout and interaction. No `fetch`, no business rules, no parsing of backend payloads.
2. **Hooks / feature logic**: orchestrate state, side effects, and API calls (`useUploadDocument`, `useChat`, `usePdfNavigation`). Return a small, typed, well-named interface.
3. **API layer**: one place that knows URLs, headers, serialization, error normalization. Components never build URLs.
4. **Domain types and mappers**: convert backend DTOs to frontend models in the API layer so the UI works with clean types.

Dependency direction: `pages → features → components/ui, lib` and `features → services`. UI primitives never import from features.

## Components

- Function components with named exports; one main component per file; file name = component name.
- Keep components small (≈ < 150 lines). Extract when a component has more than one reason to change.
- Props: explicit interface, minimal surface, no prop drilling beyond 2 levels (use composition, context, or a store when justified). Prefer composition (`children`, slots) over boolean prop explosions.
- Extend native element props where appropriate (`React.ComponentPropsWithoutRef<'button'>`), forward refs on primitives, and spread rest props last.
- Derive state instead of duplicating it. Do not store values that can be computed from props/state.
- Memoize only with evidence (profiling, stable references needed by deps). Avoid premature `useMemo`/`useCallback`.
- Stable `key`s from ids, never array indexes for dynamic lists (messages, documents).
- Error boundaries around independent regions (document viewer, chat) so one failure does not blank the app.

## TypeScript standards

- `strict: true`. No `any`; use `unknown` and narrow. No non-null assertions (`!`) without a comment-worthy reason. Avoid `as` casts, especially on API data.
- Model API data with explicit types; validate untrusted responses at the boundary (e.g., Zod) if the project already uses a validator or the data is critical. Don't add a new library solely for this without asking.
- Use discriminated unions for states and results:
  ```ts
  type UploadState =
    | { status: 'idle' }
    | { status: 'uploading'; progress: number }
    | { status: 'processing' }
    | { status: 'success'; documentId: string }
    | { status: 'error'; message: string };
  ```
- Prefer `type` for unions/utility types and `interface` for object shapes meant to be extended; follow existing project preference.
- Export types next to the code that owns them; avoid a dumping-ground `types.ts` with unrelated types.

## Data fetching and state

- Use what the project already has (React Query / SWR / RTK Query / plain hooks). If nothing exists, a small custom hook with `AbortController` is acceptable; propose a library only if complexity warrants it.
- Server state (documents, messages) is separate from UI state (modal open, selected tab). Keep UI state local unless shared.
- Handle cancellation and race conditions: abort on unmount/new request, ignore stale responses.
- Every request path models `loading`, `error`, `empty`, and `success`. Normalize errors into one `AppError` shape (message safe for users, code, retryable flag).
- Streaming chat: parse the format the backend really emits; append incrementally; support stop/abort; make partial output safe to render; handle mid-stream failure.
- File upload: use the field name and limits the backend defines; show progress where the transport supports it; validate type/size on the client for UX only, and never as security.

## Side effects and performance

- `useEffect` is for synchronizing with external systems, not for deriving state or handling events. Clean up listeners, timers, and subscriptions.
- Code-split heavy parts (PDF viewer, markdown renderer) with `React.lazy` + `Suspense`.
- Virtualize long lists (long chat history, many documents) when needed.
- Avoid inline object/array creation in hot render paths passed to memoized children.

## Internationalization

- Never hard-code user-facing strings in components if the project has i18n (RU/KZ/EN). Add keys to every locale file together; no missing-key fallbacks left silent.
- Format dates, numbers, and file sizes with `Intl` using the active locale.
- Allow for text expansion (Russian/Kazakh strings are longer than English).

## Accessibility and quality in code

- Semantic elements, labelled controls, keyboard support are part of "done".
- No `console.log` left behind. No commented-out dead code.
- Lint and format with the project's configuration. Run the type check (`tsc --noEmit`), linter, tests, and build, and report real results.

## Testing

- Follow the existing test setup. Where tests exist or are requested: test hooks and pure logic with unit tests, components with Testing Library (query by role/label, assert behavior, not implementation), and mock the API layer, not React internals.
- New logic with branching (parsers, mappers, state machines) deserves tests.

## Workflow checklist

1. Read the relevant existing code and the real backend contract; summarize it briefly.
2. Define types and the API function(s) (only for endpoints that actually exist).
3. Build the hook/logic, then the presentational components, then wire the page.
4. Cover loading, empty, error, and success states.
5. Run type check, lint, tests, and build; fix what you introduced.
6. Report: files changed, assumptions, anything unverified, and any backend gaps found.

## Anti-patterns to reject

- Fetching inside presentational components; hard-coded base URLs; duplicated request logic.
- Giant "god" components or contexts holding everything.
- Fake endpoints, invented response fields, or mock data presented as real integration.
- Silent `catch {}`; swallowing errors; ignoring non-2xx responses.
- Copy-pasting a component instead of generalizing it.
- Mixing styling approaches within the same project.
