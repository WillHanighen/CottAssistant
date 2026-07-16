# CottAssistant — agent notes

This monorepo is a **Bun** personal assistant (Discord + localhost WebUI + voice). Prefer Bun for install, run, and tests.

- Server / core / daemon: Bun (`bun:sqlite`, `Bun.serve`, workspace scripts).
- WebUI: existing **SvelteKit + Vite** app in `apps/web` — do not rewrite it as Bun HTML imports.
- Docs: `docs/`. Personality / standing LLM instructions: `SYSTEM.md`.
- Sensitive tools and Discord allowlist: see `docs/tools.md` and `packages/shared` policy.

---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild` **for Bun-native apps** (this repo’s WebUI uses Vite/SvelteKit build instead)
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile when practical
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

For more Bun API docs, see `node_modules/bun-types/docs/**.mdx` when present.
