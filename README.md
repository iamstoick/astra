# Astra — Argus Dashboard

Astra is a standalone web dashboard for [Argus](git@github.com:iamstoick/argus.git),
the codebase dictionary & evolution MCP server. Point it at any Argus server in
`serve` mode and it shows:

- How many projects are connected
- Per-project statistics: files, symbols, relationships, watcher mode, last-sync
  detail (scanned / updated / removed / unchanged / failed)

No build step, no dependencies — three static files.

## Run

Serve the directory with anything static, then open it in a browser:

```bash
cd astra
python3 -m http.server 8080
# open http://127.0.0.1:8080
```

Enter the Argus base URL (e.g. `http://127.0.0.1:3000`) and its bearer token.
The connection is remembered in `localStorage`; stats auto-refresh every 15s.

## Argus requirements

- Argus running in `serve` mode with HTTP enabled (this is the default for
  `argus serve`), reachable from your browser
- A bearer token if the server sets one (`ARGUS_TOKEN` / `--token`)
- An Argus build that answers CORS preflights (a small pending change in the
  argus working tree — push it and redeploy before connecting Astra)

## Notes

- One Argus server per dashboard view. To watch several servers, open one tab
  per server (each tab keeps its own connection).
- The token is stored only in your browser's `localStorage`, never sent
  anywhere except the configured Argus server.
