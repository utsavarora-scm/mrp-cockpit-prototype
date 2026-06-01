# Next Prototype Template

A frontend-only **Next.js + shadcn/ui** template for building clickable
prototypes fast. Pure frontend with realistic mock data — no backend to set up,
no database, no auth servers. Made to be driven by **designers and coders
alike**.

## Two ways to use it

### 🎨 If you're a designer (no coding needed)

Just open this project in Claude Code and **describe what you want to build** in
plain language — or type `/prototype` to start.

> "I want a dashboard for a coffee shop owner showing today's sales and recent
> orders."

Claude builds it for you and hands you a clickable link. It only ever asks you
**design** questions (layout, colors, wording, content) — never anything
technical — and shows you the running screen, never code. See
`.claude/skills/prototype/`.

### 👩‍💻 If you're a coder

It's a standard Turborepo monorepo.

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

- `apps/web` — the Next.js App Router app (your prototype lives here).
- `packages/ui` — the shared **shadcn/ui** component library (50 components,
  Tailwind v4, oklch design tokens, light/dark).
- `packages/typescript-config`, `packages/eslint-config` — shared configs.

## What's inside

- **Next.js (App Router) + React + TypeScript**, Turbopack dev server.
- **shadcn/ui** ("new-york") via the shared `@repo/ui` package.
- **Tailwind CSS v4** with oklch design tokens and built-in light/dark mode.
- **Mock data layer** (`apps/web/lib/mock-data/`) with a fake-latency helper, so
  prototypes feel like real apps with loading/empty states — no backend.
- **TanStack Query**, **react-hook-form + zod**, **sonner** toasts,
  **lucide-react** icons, **next-themes** — all pre-wired.
- Prettier, ESLint, commitlint, and Husky pre-commit hooks.

## Conventions

Everything the prototype is built to follow lives in
`.claude/skills/prototype/conventions.md` — the single source of truth for where
screens, components, and mock data go.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the dev server on `:3000` |
| `pnpm build` | Production build |
| `pnpm lint` | Lint all packages |
| `pnpm typecheck` | Type-check all packages |
| `pnpm format:fix` | Format with Prettier |
