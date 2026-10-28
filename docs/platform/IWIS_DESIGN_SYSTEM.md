# IWIS admin design system

How the admin looks and behaves, in one place, so a new page or a new person does not have to guess. The live
examples are in `/admin/style-guide`. Everything here lives in `src/layouts/AdminLayout.astro` (tokens and shared classes)
and `src/components/`.

## 1. Rules of thumb

1. Use a shared piece before writing a new one. If you need something twice, make it a shared piece.
2. Brand colour is the site's violet (`brand-*`, Tailwind's violet scale). Pastels carry meaning (blue info, green done, orange needs a look, rose failed); never use one only for decoration.
3. Every control is at least 44 px tall on a phone (`min-h-11`).
4. Never colour alone: status always has a word, errors say what to do.
5. Anything risky asks first (section 5). Anything empty explains itself (section 4).
6. 0 axe violations (WCAG 2 A and AA) on desktop and phone before a page ships.

## 2. Tokens (CSS variables in `AdminLayout`)

| Token | Value | Use |
|---|---|---|
| `--brand-950` / `--brand-900` / `--brand-700` | #2e1065 / #4c1d95 / #6d28d9 | headings, sidebar, links and buttons |
| `--brand-300` | #a78bfa | borders and focus rings on dark only, never text |
| `--bg` / `--surface` | #f7f5ff / #ffffff | page background / cards |
| `--text` / `--text-muted` | #1e1b2e / #64748b | body text / secondary text (stone-500 is raised to 5.3:1 for AA) |
| `--info-*`, `--success-*`, `--warn-*`, `--danger-*` | each has `-bg` (pill and border fill), `-soft` (quiet tile or notice background) and `-ink` (dark text): blue #dbeafe/#eff6ff/#1e3a8a, green #d1fae5/#ecfdf5/#065f46, orange #ffedd5/#fff7ed/#9a3412, rose #ffe4e6/#fff1f2/#9f1239 | the four pastel meanings. Ink on its fills is 6.4:1 or better; body text on the soft fills is 16:1 |
| `--radius-sm` / `-md` / `-lg` | 6 / 10 / 16 px | corners |
| `--motion` | 180 ms | transitions (switched off for people who ask for reduced motion) |

## 3. Shared classes and components

| Piece | Where | Use |
|---|---|---|
| `.btn-primary` | AdminLayout | the one main action on a page (violet pill) |
| `.btn-secondary` | AdminLayout | other actions |
| `.btn-danger` | AdminLayout | destructive actions (red) |
| `.badge-*` | AdminLayout | status colours; use through `StatusBadge` |
| `.tint-info/-success/-warn/-danger` | AdminLayout | quiet pastel tile. A "needs you" tile takes its tint only while its count is above zero; at zero it stays white. Do not put `bg-white` on the same element |
| `.notice` + `.notice-info/-success/-warn/-danger` | AdminLayout | one notice style for every message banner (use on a `<p>` with `role="alert"` or `"status"`); replaces ad-hoc amber and red boxes |
| `PageHeader` | `components/PageHeader.astro` | title, count in brackets, optional intro and main action. Pass `class="mb-2"` when a section follows immediately |
| `StatusBadge` | `components/StatusBadge.astro` | `tone`: `ok` green (live, sent, approved), `info` blue (scheduled), `warn` orange (needs a look, pending, sending), `danger` red (failed, stuck, cancelled), `muted` grey (draft, off, hidden) |
| `EmptyState` | `components/EmptyState.astro` | what is missing, why that is fine, the one next step |
| `PhoneInput` | `components/PhoneInput.tsx` | pass `tone="admin"` inside the admin |
| `OfferForm` | `components/OfferForm.astro` | admin-only form, already in admin colours |

Page-wide defaults (card edge and shadow, h1 colour, form-field borders and focus ring, 16 px text in fields on phones)
are plain rules at the bottom of the AdminLayout style block; pages do not repeat them.

## 4. Lists

Title row (`PageHeader` with count and main action), then either cards on a phone and a table on desktop (Tours) or
cards throughout (Offers, Campaigns). Status is a `StatusBadge`. An empty list shows `EmptyState`. A failing section
shows a flagged note, never a false zero.

## 5. Risky buttons

One dialog for all of them (in `AdminLayout`). Put these on the button (or its form):

- `data-confirm="What will happen."` opens the dialog before the form is sent.
- `data-confirm-type="DELETE"` also makes the person type that word (use it when the action cannot be undone).
- `data-confirm-label="Delete post"` names the red button.

Cancel and Esc change nothing and return the cursor to the button. Erasing a person, deleting a WhatsApp chat and removing a
team member keep their own typed-word field because the server checks that word.

## 5b. Confirmation after a save

A handler that finished an action calls `setFlash(Astro.cookies, 'saved')` (keys in `src/lib/flash.ts`) just before it redirects; the layout shows that fixed message once as a live region ("Saved", "Message sent"), hides it after about 5 seconds, and a refresh does not show it again. Only set it when the action really succeeded; an error keeps using the page's own error message. Add a new message to `FLASH_MESSAGES` rather than passing free text. Pages that already show their own in-page result (Hotels, Custom trips, Team, WhatsApp auto-reply settings, Knowledge) keep it and do not also set a flash.

## 6. Keyboard and screen readers

Skip link to main content; visible focus ring everywhere (white inside the sidebar); the phone menu, the bell panel and the
confirm dialog trap and return focus; `/` jumps to search; the bell count is announced through a live region. The
person-led pass is `docs/platform/IWIS_QA_CHECKLIST.md` section 3f.

## 7. Adding a page

1. `AdminLayout` with a `title`; `PageHeader`; content; `EmptyState` for nothing to show.
2. Check authorisation the way the route-inventory test expects (`isAdminAuthenticated` and, for owner-only, `OWNER_ONLY_PAGES`).
3. Risky buttons use `data-confirm`. Independent database reads go through `Promise.all`.
4. Run `npx astro check`, `npm run build`, `sh scripts/contacts-test/run.sh`, and axe on desktop and phone.
