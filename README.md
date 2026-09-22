# Astra — Argus Dashboard

Astra is a standalone web dashboard for [Argus](git@github.com:iamstoick/argus.git),
the codebase dictionary & evolution MCP server. Connect it to one or more Argus
servers in `serve` mode and it shows:

- Fleet totals: servers up, projects connected, files/symbols indexed
- Per-project statistics: files, symbols, relationships, watcher mode, last-sync
  detail (scanned / updated / removed / unchanged / failed)
- Index freshness per project ("synced 5m ago", with a stale badge past 24h)
- Composition: file counts by language, symbol counts by kind
- Server health: Argus version, uptime, tree-sitter grammar status
- Code health per project: expandable duplicate-group and dead-code reports

No build step, no dependencies — three static files.

## Run

Serve the directory with anything static, then open it in a browser:

```bash
cd astra
python3 -m http.server 8080
# open http://127.0.0.1:8080
```

## Run with Docker (default port 5555)

```bash
cd astra
docker build -t astra .
docker run --rm -p 5555:5555 astra
# open http://127.0.0.1:5555 in your browser
```

The container listens on 5555 by default. To use another container-side port:

```bash
docker run --rm -p 8080:8080 -e ASTRA_PORT=8080 astra
```

Add each Argus server's base URL (e.g. `http://127.0.0.1:3000`) and its bearer
token, then press Connect all. Connections are remembered in `localStorage`;
stats auto-refresh every 15s. Each server section links to that server's own
Argus admin page for symbol search and drill-down.

## Argus requirements

- Argus running in `serve` mode with HTTP enabled (this is the default for
  `argus serve`), reachable from your browser
- A bearer token if the server sets one (`ARGUS_TOKEN` / `--token`)
- An Argus build that answers CORS preflights

## Notes

- Freshness, composition, and health rows need a recent Argus; against older
  servers Astra degrades gracefully (those rows show "–"/"unknown" instead).
- Tokens are stored only in your browser's `localStorage`, never sent
  anywhere except the configured Argus servers.
