# Conventions — the silent decisions

This file is **for you (the model), not the designer**. It is every technical decision you must make _without asking_,
so the conversation stays in design language. It is also the contract the `next-prototype-template` itself is built to
satisfy — so these paths and patterns exist in any clone of the template.

When a technical question arises, the answer is here. If it's genuinely not here, pick the simplest option consistent
with what _is_ here, do it, and move on — never escalate a technical decision to the designer.

## Stack (fixed — never ask, never mention)

- **Framework:** Next.js (App Router) + React + TypeScript.
- **Styling:** Tailwind CSS v4 with the shared design tokens (oklch CSS variables). No inline hex colors, no one-off CSS
  that bypasses tokens.
- **Components:** shadcn/ui ("new-york" style) from the shared `@repo/ui` package. Add new shadcn components into
  `@repo/ui`, import via `@repo/ui/components/<name>`.
- **Icons:** `lucide-react`.
- **Forms:** `react-hook-form` + `zod`.
- **Toasts:** `sonner`.
- **Theme:** `next-themes` (light/dark/system). A theme toggle is available.
- **Tooling:** pnpm + Turborepo. Dev server runs on port **3000**.
- **No backend.** Prototypes are pure frontend + mock data (per template charter). Never add a server, real DB, or auth
  provider unless explicitly asked.

## Where things go (App Router)

- **Screens/pages:** `apps/web/app/<route>/page.tsx`. One folder per screen, kebab-case route names. Group related
  authed screens under a route group if it helps, but keep it simple.
- **Reusable UI pieces specific to this app:** `apps/web/components/<area>/` (PascalCase component files).
- **Shared design-system components:** `@repo/ui` (the shadcn library). Reach for an existing shadcn component before
  building anything custom.
- **Layouts / nav / providers:** `apps/web/app/layout.tsx` and `apps/web/app/providers.tsx`.

## Mock data (the "backend" for prototypes)

- Put typed mock data in `apps/web/lib/mock-data/<domain>.ts` (e.g. `orders.ts`, `customers.ts`). Export typed
  arrays/objects.
- Make it **realistic**: believable names, prices, dates, statuses, avatars (use a placeholder avatar service or
  initials). Never `lorem ipsum` unless the designer asks for placeholder text.
- Simulate real app feel: small fake latency on "loading" states, optimistic updates, empty/loading/error states where
  they add realism.
- Persist user interactions in-session with React state; use a small `localStorage` helper only when the designer
  expects data to "stick" between refreshes. Never claim data is permanently saved.

## State & interactivity

- Local React state by default. Lift state to a layout/provider only when multiple screens must share it.
- Keep it client-simple: prototypes favor obvious, reactive behavior over architectural purity. Don't introduce heavy
  state libraries.
- Forms validate with zod and show friendly inline messages, never raw errors.

## Look & feel defaults (Heizen house style — when the designer hasn't specified)

Heizen prototypes follow a **light, uniform, mostly mono + single-accent** look. Default to this unless the designer
asks for something different:

- **Light theme by default** (the app boots in light mode; the dark toggle still works). Don't default to a dark or
  high-contrast look.
- **Mostly one color.** The base is a neutral grayscale. There is exactly **one accent — teal (hue ~195)** — used for
  primary actions, focus rings, active nav, and charts. Treat the palette as neutral + teal (bi-color). Don't scatter
  multiple bright hues.
- **Charts use the single-hue teal ramp** (`--chart-1..5` are all teal shades), not five different colors.
- **Semantic color is minimal**: teal for positive/primary, the muted `--destructive` red only for genuine
  errors/negatives. No extra greens/blues.
- Clean, modern, generous whitespace. Always use the design **tokens** (`--primary`, `--muted`, `--foreground`, etc.) —
  never raw hex or off-palette Tailwind colors like `emerald-600`.
- Responsive (mobile → desktop) by default. Rounded corners per token radius, subtle borders over heavy shadows. Don't
  invent a new visual language.

If a designer wants a different mood (bold, dark, warm, a different accent), that is a _design_ choice you can
offer/honor — change the accent in `packages/ui/src/styles/globals.css` rather than sprinkling one-off colors.

## Naming & code quality (invisible to the designer, real for coders)

- Components PascalCase; files/folders kebab-case (except component files).
- Functional components only; typed props.
- Reuse shadcn + tokens; keep accessibility (labels, focus, alt text, contrast).
- Match the surrounding code's style and import ordering.

## Decisions you make WITHOUT asking

Port, framework options, file structure, component vs. page split, which shadcn component to use, how to shape mock
data, how to handle a build/type error, naming, responsiveness, dark mode, animation choices, library versions, how to
run/preview the app. **All of these are yours. None of them reach the designer.**

## Decisions you DO surface (as design questions only)

Layout arrangement, color mood/theme, tone & wording of copy, which screens to include, what sample content should feel
like, how an interaction should behave from the user's point of view, branding/logo. Ask these visually
(`AskUserQuestion` with ASCII-mockup previews) and sparingly.
