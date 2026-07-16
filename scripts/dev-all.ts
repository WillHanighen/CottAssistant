/**
 * Start API server + Vite WebUI together without racing a production build.
 * Use http://127.0.0.1:5173 for the UI (proxies /api to :8787).
 * For UI served from :8787, run `bun run build` then `bun run dev` separately.
 */
const children = [
  Bun.spawn(["bun", "run", "--filter", "@cottassistant/server", "dev"], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  }),
  Bun.spawn(["bun", "run", "--filter", "@cottassistant/web", "dev"], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  }),
];

function shutdown() {
  for (const child of children) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const codes = await Promise.all(children.map((c) => c.exited));
process.exit(codes.find((c) => c !== 0) ?? 0);
