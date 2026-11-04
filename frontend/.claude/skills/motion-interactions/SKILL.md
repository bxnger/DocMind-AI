---
name: motion-interactions
description: Add refined micro-animations and smooth transitions to DOCMIND AI (buttons, cards, sidebar, modals, document upload, chat) with accessibility and performance in mind. Use when adding or tuning motion, hover/press feedback, page or panel transitions, loading and streaming indicators, and prefers-reduced-motion support.
---

# Motion & Interactions — DOCMIND AI

Motion should make the interface feel fast, responsive, and understandable, never decorative or slow. The style is quiet and precise, like Linear or Raycast: short durations, small distances, no bounce for utility UI.

## Before you start

1. Check how the project already animates: CSS transitions, Tailwind utilities, Framer Motion / Motion, or another library. Use the existing approach. Prefer plain CSS for simple state changes; add a library only if the project already has one or the interaction truly needs it (layout animations, exit animations, gestures).
2. Check for existing tokens for duration/easing; reuse and extend them.
3. Do not alter business logic or markup semantics just to animate.

## Motion tokens

Define once (CSS variables or theme) and reuse:

```css
:root {
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);      /* entrances, most UI */
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);  /* position/size changes */
  --ease-in: cubic-bezier(0.4, 0, 1, 1);          /* exits */
  --dur-instant: 80ms;   /* press feedback */
  --dur-fast: 140ms;     /* hover, color, small state */
  --dur-base: 200ms;     /* menus, tooltips, popovers */
  --dur-slow: 320ms;     /* modals, drawers, panels */
}
```

Rules of thumb:
- Hover/press feedback: 80–140ms. Popovers/menus: 120–200ms. Modals/drawers/sidebars: 200–320ms. Nothing in core UI over 400ms.
- Exits are faster than entrances (~70% of the entrance time).
- Animate small distances: 4–12px translate, scale 0.96–1.0. No large sweeping motions.
- Use ease-out for things entering, ease-in for leaving, ease-in-out for moving between positions. Avoid `linear` except for progress and spinners.
- Avoid spring/bounce on utility UI. A very subtle spring is acceptable for delightful moments (e.g., successful upload check).

## Performance rules

- Animate only `transform` and `opacity` (compositor-friendly). Avoid animating `width`, `height`, `top/left`, `margin`, `box-shadow` blur, or `filter` on large areas. For expand/collapse use `grid-template-rows: 0fr → 1fr` or library layout animation; for shadows, cross-fade a pseudo-element's opacity.
- Never use `transition: all`. List exact properties.
- Use `will-change` sparingly, only right before/during a known animation, and remove afterward. Do not apply it globally.
- Keep animated elements small and isolated; avoid animating large blurred (`backdrop-filter`) surfaces.
- No layout shift: reserve space for skeletons, streaming text, and progress bars.
- Do not run continuous animations when the tab is hidden or the element is off-screen. Stop infinite loops once the state they represent ends.
- Long lists: do not animate every item on every re-render. Stagger only the first screenful (max ~8 items, 20–30ms step) and only on initial mount.

## Accessibility: `prefers-reduced-motion` (required)

Every animation must be covered.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Better than a blanket kill-switch: keep non-motion feedback (opacity/color fades, state changes) and remove movement (translate, scale, parallax, auto-scrolling, looping spinners replaced by static or pulsing-opacity indicators). With Framer Motion use `useReducedMotion()` or `MotionConfig reducedMotion="user"`.

Other rules:
- No flashing content (> 3 flashes per second).
- Auto-playing or infinite motion must be stoppable or minimal; never essential to understanding.
- Motion never replaces text/ARIA status: loading states still expose `aria-busy`, `role="status"`, or `role="progressbar"`.
- Do not trap focus or delay interactivity until an animation finishes; elements are usable as they appear.

## Patterns by component

### Buttons
- Hover: background/border color shift over `--dur-fast`. Press: `transform: scale(0.98)` over `--dur-instant`. Release returns with `--ease-out`.
- Primary CTA may have a very soft accent glow on hover (opacity transition of a pseudo-element).
- Loading: replace the icon with a small spinner, keep width fixed, set `aria-busy`/disable repeat clicks.
- Focus-visible ring appears instantly (no delay).

### Cards
- Hover: border color moves toward `--accent` at low alpha, optional `translateY(-1px)`; no large lifts or shadow growth.
- Entrance on first load: fade + 8px translateY, staggered at most for the first few items.
- Selected state: animate border/background tint, not size.

### Sidebar
- Collapse/expand: width transition 200–240ms with `--ease-in-out` (or transform-based drawer on mobile); labels fade out slightly before the width shrinks to avoid text wrapping.
- Active item indicator slides or fades between items (opacity/transform), not by re-laying out.
- Mobile drawer: translateX with backdrop fade; closes on swipe/Escape/backdrop click.
- Hover reveals secondary actions (rename/delete) via opacity, not layout change.

### Modals, popovers, menus, tooltips
- Modal: backdrop fades in (`--dur-base`), panel fades + scale from 0.97 and translateY 8px (`--dur-slow`, ease-out). Exit is faster. Transform origin near the trigger for popovers.
- Tooltips: 400–600ms hover delay on first show, near-instant when moving between neighbors; 120ms fade.
- Focus is moved into the modal and restored to the trigger on close, independent of animation timing.
- Unmount only after the exit animation completes (e.g., `AnimatePresence`, `transitionend`, or `data-state` attributes with CSS).

### Document upload
- Drag-over: dropzone border and background tint transition to accent; subtle scale ≤ 1.01. Reverts on leave/drop.
- File added: item enters with fade + slight slide; progress bar animates width via `transform: scaleX()` with `transform-origin: left`, smoothing with a short linear/ease-out transition.
- Processing/indexing: calm indeterminate indicator (shimmer or pulsing opacity), plus text status ("Extracting text…", "Indexing…") reflecting real backend state, not fake steps.
- Success: brief check icon draw/fade (≤ 300ms) and status color transition. Error: small horizontal shake (≤ 2 cycles, ±4px) only if reduced-motion is off; always show text.
- Removal: collapse + fade out of the row.

### Chat
- New message: fade + 6–8px rise over `--dur-base`. Do not animate historical messages on load.
- Streaming: append text without per-character animation that causes reflow; a blinking caret or subtle pulsing dot at the end is enough. Keep scroll anchored to the bottom only if the user is already at the bottom; show a "Jump to latest" button otherwise.
- Typing/thinking indicator: three dots with staggered opacity pulse (not bounce), or a shimmer line; `role="status"` with accessible text.
- Citation chips: hover lift of border/background; snippet popover per tooltip rules. Clicking a citation scrolls/jumps in the viewer; animate the page change with a quick crossfade (no long scroll animation), and briefly highlight the cited passage (accent background fading out over ~1.2s).
- Composer: height auto-grows with transition on `height` limited to the textarea only, or without transition if it causes jank; send button state change via opacity/color.

### Page and panel transitions
- Route changes: short fade (≤ 150ms), no sliding full pages. Document panel open/close: translateX with `--dur-slow`.
- Skeletons: shimmer gradient at ~1.4s, low contrast, disabled or static under reduced motion.

## Implementation guidance

- Prefer CSS `@starting-style`/`data-state` attributes or Tailwind `transition-*` for simple cases; use Motion (Framer) for exit animations and layout transitions if installed.
- Keep animation code colocated with the component; share variants/tokens via a small `motion` module.
- Never block rendering or event handlers on animation promises.
- Use `IntersectionObserver` for scroll-in effects only where they add meaning; avoid scroll-jacking and parallax in an app UI.

## Review checklist (run before finishing)

- [ ] Only `transform`/`opacity` animated for movement; no `transition: all`.
- [ ] Durations and easings come from tokens; nothing over ~400ms in core flows.
- [ ] `prefers-reduced-motion` handled for every new animation, verified by emulating the setting.
- [ ] No layout shift (check CLS-prone areas: chat, upload list, skeletons).
- [ ] Focus management and ARIA unaffected by animations.
- [ ] Runs smoothly on a throttled CPU (DevTools 4x slowdown) with no visible jank.
- [ ] Animation count is restrained: if everything moves, nothing stands out. Remove any motion that doesn't communicate state, hierarchy, or feedback.

When reporting, state what you animated, what you deliberately left static, and what you actually tested (e.g., reduced-motion emulation, performance panel). Do not claim smoothness you did not measure or observe.
