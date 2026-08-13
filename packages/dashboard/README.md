# Dashboard — the flag-admin UI

A React 19 single-page app for managing flags: list, detail (toggle, rollout,
rules, overrides), preview, and audit. It never talks to the management API
directly — every request goes through `packages/bff`, which is also where
this README's login and safety notes live.

## Quick path

```bash
pnpm build   # builds this package's dist/ alongside the rest of the workspace
```

There is no `pnpm dev` script yet, and this package neither proxies API
requests in a dev server nor serves its own built assets — both are BFF
concerns still open for Phase 5's deployment work. Every `apiFetch` call
(`src/api/client.ts`) uses a same-origin relative path (`/api/...`,
`/login`, `/logout`), so this UI only works when served from the same
origin as `packages/bff` — either behind one reverse proxy, or once the BFF
gains its own static-file serving. Building and manually copying `dist/`
behind such a proxy is the only supported path today; that gap is recorded
here rather than silently assumed away.

## Screens

| Screen      | Route             | Purpose                                                               |
| ----------- | ----------------- | --------------------------------------------------------------------- |
| Flag list   | `/`               | Every flag, per-environment state, last-modified, 24h evaluations     |
| Flag detail | `/flags/:flagKey` | Toggle, rollout, ordered rules, overrides — per environment           |
| Preview     | `/preview`        | `POST /evaluate/preview` — value + reason for a hypothetical unit     |
| Audit       | `/audit`          | Before/after diff per change, actor labelled honestly as a system key |

## One mutation pattern, one confirmation table

Every write goes through `useVersionedMutation` (`src/api/mutations/`), which
reads `If-Match` from the query cache **at mutation time**, never from a
prop captured at render — the fix for "two operators, one submits a stale
version": a `412` always surfaces `expectedVersion`/`actualVersion` and is
never auto-retried or silently overwritten.

Confirmation friction is tiered, not per-screen:

| Environment | Action                      | Confirmation                          |
| ----------- | --------------------------- | ------------------------------------- |
| production  | toggle `enabled`            | type the exact flag key               |
| production  | rollout / rules / overrides | modal showing flag, env, target state |
| development | anything                    | none                                  |

## Accessibility

Every interactive control must be keyboard-reachable, keyboard-operable,
have a real programmatically-associated label, and show a visible focus
indicator. The first three are proven by automated tests
(`src/__tests__/a11y-crosscutting.test.tsx` for cross-cutting focus order,
landmarks, and live regions; each screen's own test file for its labels and
keyboard activation).

**Visible focus is not, and cannot be, an automated assertion.** jsdom has no
concept of paint or CSS rendering, so no test in this repo can prove a focus
ring is actually visible on screen — only that focus _moved_ to the right
element. That is a CSS-token decision plus a human check, tracked here:

- [ ] Every focusable element has a visible `:focus-visible` outline with
      sufficient contrast against its background (no `outline: none` without
      a replacement indicator)
- [ ] The focus indicator is visible on every interactive element type used
      in this app: links, buttons, checkboxes (`role="switch"`), range
      inputs, text inputs, selects, and textareas
- [ ] Focus is visible inside both dialogs (`ConfirmDialog`,
      `TypeToConfirmDialog`) and on the underlying page once a dialog closes
      and returns focus to its trigger

## Checklist

- [ ] Served from the same origin as `packages/bff` (see "Quick path" above)
- [ ] The manual visible-focus checklist above has been walked at least once
      after any change to global CSS or a shared atom component
- [ ] `pnpm test:coverage` passes the `packages/dashboard/src/**` threshold
      (root `vitest.config.ts`) before merging a change to this package

## Next step

See `packages/bff/README.md` for the login flow, the single-instance
constraint, and `READ_ONLY_MODE` — all of which this UI depends on but does
not itself enforce.
