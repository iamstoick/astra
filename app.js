"use strict";
/* Astra: fleet dashboard for Argus servers. No dependencies, no build step.
 * Tolerates older Argus servers: every field added after v0.1 is optional. */
const $ = (id) => document.getElementById(id);
const REFRESH_MS = 15000;
const STALE_MS = 24 * 3600 * 1000;
const STORE_KEY = "astraConnections";
let timer = null;

function newId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
  return "c" + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36);
}

function loadConnections() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list.filter((c) => c && typeof c.baseUrl === "string");
    }
  } catch (e) { /* fall through to legacy */ }
  // Migrate the original single-connection keys.
  const url = localStorage.getItem("astraUrl") || "";
  const token = localStorage.getItem("astraToken") || "";
  localStorage.removeItem("astraUrl");
  localStorage.removeItem("astraToken");
  return [{ id: newId(), baseUrl: url, token }];
}

const state = {
  connections: loadConnections(),
  results: {}, // id -> { ok, projects, health, error }
};

function persist() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state.connections));
}

function setStatus(text, cls) {
  const el = $("status");
  el.textContent = text;
  el.className = cls || "";
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function normalizedBase(conn) {
  return conn.baseUrl.replace(/\/+$/, "");
}

/** Parse Argus UTC "YYYY-MM-DD HH:MM:SS" or ISO strings; null when unparseable. */
function parseTime(raw) {
  if (typeof raw !== "string" || raw === "") return null;
  const iso = raw.indexOf("T") >= 0 ? raw : raw.replace(" ", "T") + "Z";
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function relativeTime(ms) {
  if (ms == null) return "never";
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return min + "m ago";
  const h = Math.floor(min / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  if (d < 30) return d + "d ago";
  return new Date(ms).toLocaleDateString();
}

function isStale(ms) {
  return ms != null && Date.now() - ms > STALE_MS;
}

async function fetchJson(conn, path) {
  const headers = {};
  if (conn.token) headers["Authorization"] = "Bearer " + conn.token;
  let res;
  try {
    res = await fetch(normalizedBase(conn) + path, { headers });
  } catch (e) {
    throw new Error("unreachable (" + (e instanceof Error ? e.message : e) + ")");
  }
  if (res.status === 404) return { notFound: true };
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("rejected: missing or invalid token");
  if (!res.ok) throw new Error(body.error || ("HTTP " + res.status));
  return { data: body };
}

async function pollConnection(conn) {
  if (!conn.baseUrl) return { ok: false, error: "no URL configured" };
  try {
    const projectsRes = await fetchJson(conn, "/api/projects");
    if (projectsRes.notFound || !projectsRes.data || !Array.isArray(projectsRes.data.projects)) {
      return { ok: false, error: "unexpected response (is this an Argus server?)" };
    }
    let health = null;
    try {
      const healthRes = await fetchJson(conn, "/api/health");
      if (!healthRes.notFound && healthRes.data) health = healthRes.data;
    } catch (e) { /* health is best-effort on old servers */ }
    return { ok: true, projects: projectsRes.data.projects, health };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function renderServers() {
  const wrap = $("servers");
  wrap.innerHTML = "";
  for (const conn of state.connections) {
    const row = document.createElement("div");
    row.className = "conn";
    const result = state.results[conn.id];
    const dot = !result ? "" : result.ok
      ? '<span class="dot ok" title="connected"></span>'
      : '<span class="dot bad" title="' + esc(result.error || "error") + '"></span>';
    row.innerHTML =
      dot +
      '<input type="text" class="url" size="32" placeholder="http://127.0.0.1:3000" autocomplete="off" spellcheck="false" value="' + esc(conn.baseUrl) + '">' +
      '<input type="password" class="tok" size="16" placeholder="bearer token" autocomplete="off" value="' + esc(conn.token) + '">' +
      '<button class="rm">Remove</button>';
    row.querySelector(".url").addEventListener("input", (e) => { conn.baseUrl = e.target.value.trim(); persist(); });
    row.querySelector(".tok").addEventListener("input", (e) => { conn.token = e.target.value.trim(); persist(); });
    row.querySelector(".rm").addEventListener("click", () => {
      state.connections = state.connections.filter((c) => c.id !== conn.id);
      delete state.results[conn.id];
      if (state.connections.length === 0) state.connections.push({ id: newId(), baseUrl: "", token: "" });
      persist();
      renderServers();
      render();
    });
    wrap.appendChild(row);
  }
}

function compLine(obj) {
  if (!obj || typeof obj !== "object") return null;
  const entries = Object.entries(obj).filter(([, v]) => typeof v === "number");
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries.map(([k, v]) => esc(k) + " " + v).join(" · ");
}

function grammarBadge(health) {
  if (!health || !health.grammars) return "";
  const g = health.grammars;
  const loaded = Array.isArray(g.loaded) ? g.loaded.length : 0;
  const missing = g.unavailable && typeof g.unavailable === "object" ? Object.keys(g.unavailable) : [];
  if (missing.length === 0) return '<span class="badge ok">' + loaded + "/8 grammars</span>";
  return '<span class="badge warn" title="' + esc(missing.join(", ")) + '">' + loaded + "/8 grammars · " + missing.length + " missing</span>";
}

function freshness(p) {
  const ms = parseTime(p.lastSyncAt);
  if (ms == null && p.lastSyncAt != null) return ""; // unknown format: say nothing
  if (ms == null) return '<div class="fresh">synced: never</div>';
  const stale = isStale(ms);
  return '<div class="fresh">synced: ' + esc(relativeTime(ms)) +
    (stale ? ' <span class="badge warn">stale</span>' : "") + "</div>";
}

function render() {
  const results = state.connections.map((c) => ({ conn: c, res: state.results[c.id] }));
  const up = results.filter((r) => r.res && r.res.ok);
  const projects = up.flatMap((r) => r.res.projects.map((p) => ({ server: r.conn, project: p })));

  $("serverCount").textContent = up.length + "/" + state.connections.filter((c) => c.baseUrl).length;
  $("projectCount").textContent = String(projects.length);
  $("totalSymbols").textContent = String(projects.reduce((n, p) => n + (p.project.symbols || 0), 0));
  $("totalFiles").textContent = String(projects.reduce((n, p) => n + (p.project.files || 0), 0));

  const fleet = $("fleet");
  fleet.innerHTML = "";
  for (const { conn, res } of results) {
    if (!conn.baseUrl) continue;
    const section = document.createElement("div");
    section.className = "server";
    const base = normalizedBase(conn);
    if (!res) {
      section.innerHTML = '<h2 class="srv">' + esc(base) + ' <span class="badge">not polled</span></h2>';
    } else if (!res.ok) {
      section.innerHTML = '<h2 class="srv">' + esc(base) + ' <span class="badge bad">down</span></h2>' +
        '<p class="srverr">' + esc(res.error || "error") + "</p>";
    } else {
      const h = res.health || {};
      const uptime = h.startedAt && parseTime(h.startedAt) != null
        ? " · up " + esc(relativeTime(parseTime(h.startedAt))) : "";
      section.innerHTML =
        '<h2 class="srv">' + esc(base) + " " + grammarBadge(res.health) +
        ' <span class="srvmeta">' + esc(h.version ? "v" + h.version : "") + esc(uptime) + "</span>" +
        ' <a class="adminlink" href="' + esc(base) + '/" target="_blank" rel="noopener">Open Argus admin</a></h2>' +
        '<div class="cards"></div>';
      const cards = section.querySelector(".cards");
      const ctx = { base, token: conn.token };
      for (const p of res.projects) {
        cards.appendChild(projectCard(p, ctx));
      }
      if (res.projects.length === 0) {
        const empty = document.createElement("p");
        empty.className = "srverr";
        empty.textContent = "No projects configured on this server.";
        section.appendChild(empty);
      }
    }
    fleet.appendChild(section);
  }
  const failed = results.filter((r) => r.conn.baseUrl && r.res && !r.res.ok);
  if (failed.length > 0) {
    setStatus("Connected to " + up.length + " server(s); " + failed.length + " failing.", "err");
  } else if (up.length > 0) {
    setStatus("All " + up.length + " server(s) responding. Updated just now.", "ok");
  }
}

function projectCard(p, ctx) {
  const sync = p.lastSync || {};
  const failed = Array.isArray(sync.failed) ? sync.failed : [];
  const card = document.createElement("div");
  card.className = "card";
  const langs = compLine(p.byExtension);
  const kinds = compLine(p.byKind);
  card.innerHTML =
    "<h3>" + esc(p.name) + '<span class="mode">' + esc(p.watching ? "watching" : "static") + "</span></h3>" +
    '<p class="root">' + esc(p.root || "") + "</p>" +
    '<div class="nums">' +
    num(p.files, "files") + num(p.symbols, "symbols") + num(p.relationships, "relationships") +
    '<div class="n"><div class="v' + (failed.length > 0 ? " bad" : "") + '">' + failed.length + '</div><div class="k">failed</div></div>' +
    "</div>" +
    freshness(p) +
    (langs ? '<div class="comp">languages: ' + langs + "</div>" : "") +
    (kinds ? '<div class="comp">symbols: ' + kinds + "</div>" : "") +
    '<p class="sync">last sync: ' + esc(describeSync(sync)) + "</p>" +
    (failed.length > 0
      ? '<ul class="failed-list">' + failed.slice(0, 10).map((f) => "<li>" + esc(f) + "</li>").join("") +
        (failed.length > 10 ? "<li>…+" + (failed.length - 10) + " more</li>" : "") + "</ul>"
      : "");
  card.appendChild(healthSection("duplicates", "Duplicates", ctx, p.name));
  card.appendChild(healthSection("dead-code", "Dead code", ctx, p.name));
  return card;
}

function healthSection(kind, label, ctx, project) {
  const el = document.createElement("details");
  el.className = "health";
  const summary = document.createElement("summary");
  summary.textContent = label;
  const body = document.createElement("p");
  body.className = "sync";
  body.textContent = "Loading…";
  el.appendChild(summary);
  el.appendChild(body);
  let loaded = false;
  el.addEventListener("toggle", () => {
    if (!el.open || loaded) return;
    loaded = true;
    loadHealthSection(el, summary, body, kind, label, ctx, project);
  });
  return el;
}

async function loadHealthSection(el, summary, body, kind, label, ctx, project) {
  try {
    const headers = {};
    if (ctx.token) headers["Authorization"] = "Bearer " + ctx.token;
    const res = await fetch(
      ctx.base + "/api/projects/" + encodeURIComponent(project) + "/" + kind + "?limit=50",
      { headers },
    );
    if (res.status === 404) {
      summary.textContent = label + " (requires newer Argus)";
      body.textContent = "This server does not provide this analysis.";
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
    if (kind === "duplicates") renderDuplicates(el, summary, body, label, data);
    else renderDead(el, summary, body, label, data);
  } catch (e) {
    body.textContent = "Failed to load: " + (e instanceof Error ? e.message : e);
  }
}

function renderDuplicates(el, summary, body, label, data) {
  const groups = Array.isArray(data.groups) ? data.groups : [];
  summary.textContent = label + " (" + groups.length + (data.truncated ? "+" : "") + ")";
  if (groups.length === 0) {
    body.textContent = "No likely duplicates found.";
    return;
  }
  body.remove();
  const list = document.createElement("div");
  for (const g of groups) {
    const members = Array.isArray(g.symbols) ? g.symbols : [];
    const div = document.createElement("div");
    div.className = "dupgroup";
    div.innerHTML = "<strong>" + esc(g.key || "?") + "</strong> (" + members.length + ")" +
      "<ul>" + members.map((s) =>
        "<li><code>" + esc(s.name) + "</code> <span class=\"kind\">" + esc(s.kind) + "</span> " +
        '<span class="mono">' + esc(s.path) + ":" + esc(s.start_line) + "</span></li>",
      ).join("") + "</ul>";
    list.appendChild(div);
  }
  if (data.truncated) {
    const more = document.createElement("p");
    more.className = "sync";
    more.textContent = "Showing first 50 groups.";
    list.appendChild(more);
  }
  el.appendChild(list);
}

function renderDead(el, summary, body, label, data) {
  const symbols = Array.isArray(data.symbols) ? data.symbols : [];
  summary.textContent = label + " (" + symbols.length + (data.truncated ? "+" : "") + ")";
  if (symbols.length === 0) {
    body.textContent = "No dead code found among unexported symbols.";
    return;
  }
  body.remove();
  const list = document.createElement("ul");
  list.className = "health-list";
  for (const s of symbols) {
    const li = document.createElement("li");
    li.innerHTML = "<code>" + esc(s.name) + "</code> <span class=\"kind\">" + esc(s.kind) + "</span> " +
      '<span class="mono">' + esc(s.path) + ":" + esc(s.start_line) + "</span>";
    list.appendChild(li);
  }
  el.appendChild(list);
  if (data.truncated) {
    const more = document.createElement("p");
    more.className = "sync";
    more.textContent = "Showing first 50 symbols.";
    el.appendChild(more);
  }
}

function num(v, k) {
  return '<div class="n"><div class="v">' + esc(v == null ? "–" : v) + '</div><div class="k">' + esc(k) + "</div></div>";
}

function describeSync(sync) {
  if (sync.scanned == null) return "never";
  return (
    sync.scanned + " scanned · " + sync.updated + " updated · " +
    sync.removed + " removed · " + sync.skipped + " unchanged"
  );
}

async function refreshAll(silent) {
  const active = state.connections.filter((c) => c.baseUrl);
  if (active.length === 0) {
    setStatus("Add an Argus server URL first.");
    return;
  }
  if (!silent) setStatus("Polling " + active.length + " server(s)…");
  const settled = await Promise.all(active.map((c) => pollConnection(c)));
  active.forEach((c, i) => { state.results[c.id] = settled[i]; });
  $("dashboard").classList.remove("hidden");
  renderServers();
  render();
}

function restartAuto() {
  if (timer) clearInterval(timer);
  timer = null;
  if ($("auto").checked && state.connections.some((c) => c.baseUrl)) {
    timer = setInterval(() => refreshAll(true), REFRESH_MS);
  }
}

$("addServer").addEventListener("click", () => {
  state.connections.push({ id: newId(), baseUrl: "", token: "" });
  persist();
  renderServers();
});
$("connectAll").addEventListener("click", () => { refreshAll(false).then(restartAuto); });
$("refreshAll").addEventListener("click", () => refreshAll(false));
$("auto").addEventListener("change", restartAuto);

renderServers();
if (state.connections.some((c) => c.baseUrl)) refreshAll(false).then(restartAuto);
