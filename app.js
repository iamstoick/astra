"use strict";
/* Astra: dashboard for one Argus server. No dependencies, no build step. */
const $ = (id) => document.getElementById(id);
const REFRESH_MS = 15000;
let timer = null;

const state = {
  baseUrl: localStorage.getItem("astraUrl") || "",
  token: localStorage.getItem("astraToken") || "",
  projects: [],
};

$("url").value = state.baseUrl;
$("token").value = state.token;

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

function normalizedBase() {
  return state.baseUrl.replace(/\/+$/, "");
}

async function fetchProjects() {
  const headers = {};
  if (state.token) headers["Authorization"] = "Bearer " + state.token;
  let res;
  try {
    res = await fetch(normalizedBase() + "/api/projects", { headers });
  } catch (e) {
    throw new Error("unreachable (" + (e instanceof Error ? e.message : e) + ")");
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("rejected: missing or invalid token");
  if (!res.ok) throw new Error(body.error || ("HTTP " + res.status));
  if (!Array.isArray(body.projects)) throw new Error("unexpected response shape");
  return body.projects;
}

function render() {
  const projects = state.projects;
  $("projectCount").textContent = String(projects.length);
  $("totalSymbols").textContent = String(projects.reduce((n, p) => n + (p.symbols || 0), 0));
  $("totalFiles").textContent = String(projects.reduce((n, p) => n + (p.files || 0), 0));
  $("serverLabel").textContent = normalizedBase();

  const wrap = $("projects");
  wrap.innerHTML = "";
  for (const p of projects) {
    const sync = p.lastSync || {};
    const failed = Array.isArray(sync.failed) ? sync.failed : [];
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML =
      "<h2>" + esc(p.name) + '<span class="mode">' + esc(p.watching ? "watching" : "static") + "</span></h2>" +
      '<p class="root">' + esc(p.root || "") + "</p>" +
      '<div class="nums">' +
      num(p.files, "files") + num(p.symbols, "symbols") + num(p.relationships, "relationships") +
      '<div class="n"><div class="v' + (failed.length > 0 ? " bad" : "") + '">' + failed.length + '</div><div class="k">failed</div></div>' +
      "</div>" +
      '<p class="sync">last sync: ' + esc(describeSync(sync)) + "</p>" +
      (failed.length > 0
        ? '<ul class="failed-list">' + failed.slice(0, 10).map((f) => "<li>" + esc(f) + "</li>").join("") +
          (failed.length > 10 ? "<li>…+" + (failed.length - 10) + " more</li>" : "") + "</ul>"
        : "");
    wrap.appendChild(card);
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

async function refresh() {
  try {
    state.projects = await fetchProjects();
    render();
    const n = state.projects.length;
    setStatus("Connected: " + n + (n === 1 ? " project." : " projects.") + " Updated just now.", "ok");
  } catch (e) {
    setStatus("Error: " + (e instanceof Error ? e.message : e), "err");
  }
}

function restartAuto() {
  if (timer) clearInterval(timer);
  timer = null;
  if ($("auto").checked) timer = setInterval(refresh, REFRESH_MS);
}

async function connect() {
  state.baseUrl = $("url").value.trim();
  state.token = $("token").value.trim();
  localStorage.setItem("astraUrl", state.baseUrl);
  localStorage.setItem("astraToken", state.token);
  if (!state.baseUrl) {
    setStatus("Enter an Argus server URL first.", "err");
    return;
  }
  $("dashboard").classList.remove("hidden");
  setStatus("Connecting…");
  await refresh();
  restartAuto();
}

$("connect").addEventListener("click", connect);
$("refresh").addEventListener("click", refresh);
$("auto").addEventListener("change", restartAuto);
$("url").addEventListener("keydown", (e) => { if (e.key === "Enter") connect(); });
$("token").addEventListener("keydown", (e) => { if (e.key === "Enter") connect(); });
if (state.baseUrl) connect();
