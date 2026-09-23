// mcp-toolbox — serveur MCP (Cloudflare Worker) : boite a outils extensible
// Uniquement des outils bases sur des appels API (pas d'execution shell : impossible en Worker).

const MAX_OUT = 50000;
function clip(s) {
  s = String(s ?? "");
  return s.length > MAX_OUT ? s.slice(0, MAX_OUT) + "\n...[tronque]" : s;
}

function ghHeaders(env) {
  if (!env.GITHUB_TOKEN) throw new Error("Secret manquant : GITHUB_TOKEN");
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "mcp-toolbox"
  };
}

function cfHeaders(env) {
  if (!env.CLOUDFLARE_API_TOKEN) throw new Error("Secret manquant : CLOUDFLARE_API_TOKEN");
  return { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" };
}

// ---- github_fetch_code ----
async function githubFetchCode(env, a) {
  if (!a || !a.owner || !a.repo || !a.path) return { isError: true, text: "owner, repo et path sont requis." };
  const url = `https://api.github.com/repos/${a.owner}/${a.repo}/contents/${encodeURIComponent(a.path)}${a.ref ? `?ref=${a.ref}` : ""}`;
  const res = await fetch(url, { headers: { ...ghHeaders(env), Accept: "application/vnd.github.raw" } });
  const text = await res.text();
  if (!res.ok) return { isError: true, text: `Erreur GitHub ${res.status}: ${clip(text)}` };
  return { text: clip(text) };
}

// ---- github_push_file ----
async function githubPushFile(env, a) {
  if (!a || !a.owner || !a.repo || !a.path || a.content === undefined) {
    return { isError: true, text: "owner, repo, path et content sont requis." };
  }
  const headers = ghHeaders(env);
  const base = `https://api.github.com/repos/${a.owner}/${a.repo}/contents/${encodeURIComponent(a.path)}`;
  let sha;
  const getRes = await fetch(`${base}${a.branch ? `?ref=${a.branch}` : ""}`, { headers });
  if (getRes.ok) sha = (await getRes.json()).sha;
  const body = {
    message: a.message || `Update ${a.path}`,
    content: btoa(unescape(encodeURIComponent(a.content))),
    ...(sha ? { sha } : {}),
    ...(a.branch ? { branch: a.branch } : {})
  };
  const putRes = await fetch(base, { method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await putRes.json().catch(() => ({}));
  if (!putRes.ok) return { isError: true, text: `Erreur GitHub ${putRes.status}: ${clip(JSON.stringify(data))}` };
  return { text: `Fichier ${a.path} pousse sur ${a.owner}/${a.repo} (commit ${data.commit?.sha?.slice(0, 7) || "?"}).` };
}

// ---- github_create_repo ----
async function githubCreateRepo(env, a) {
  if (!a || !a.name) return { isError: true, text: "name est requis." };
  const res = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: { ...ghHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ name: a.name, private: a.private !== false, description: a.description || "" })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { isError: true, text: `Erreur GitHub ${res.status}: ${clip(JSON.stringify(data))}` };
  return { text: `Depot cree : ${data.html_url}` };
}

// ---- github_create_pr ----
async function githubCreatePr(env, a) {
  if (!a || !a.owner || !a.repo || !a.head || !a.base || !a.title) {
    return { isError: true, text: "owner, repo, head, base et title sont requis." };
  }
  const res = await fetch(`https://api.github.com/repos/${a.owner}/${a.repo}/pulls`, {
    method: "POST",
    headers: { ...ghHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ title: a.title, head: a.head, base: a.base, body: a.body || "" })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { isError: true, text: `Erreur GitHub ${res.status}: ${clip(JSON.stringify(data))}` };
  return { text: `Pull request creee : ${data.html_url}` };
}

// ---- github_deploy_worker ----
async function githubDeployWorker(env, a) {
  if (!a || !a.owner || !a.repo || !a.path || !a.scriptName || !env.CLOUDFLARE_ACCOUNT_ID) {
    return { isError: true, text: "owner, repo, path, scriptName sont requis (et CLOUDFLARE_ACCOUNT_ID doit etre configure)." };
  }
  const fetched = await githubFetchCode(env, a);
  if (fetched.isError) return fetched;
  const code = fetched.text;

  const metadata = { main_module: "index.js", compatibility_date: "2025-01-01" };
  const boundary = `----MCPBoundary${Date.now()}`;
  const parts = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="metadata"',
    "Content-Type: application/json",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Disposition: form-data; name="index.js"; filename="index.js"',
    "Content-Type: application/javascript+module",
    "",
    code,
    `--${boundary}--`,
    ""
  ];
  const body = parts.join("\r\n");

  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${a.scriptName}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return { isError: true, text: `Erreur deploiement: ${clip(JSON.stringify(data))}` };
  return { text: `Worker '${a.scriptName}' deploye depuis ${a.owner}/${a.repo}/${a.path} (${code.length} octets).` };
}

// ---- cloudflare_set_secret ----
async function cloudflareSetSecret(env, a) {
  if (!a || !a.scriptName || !a.secretName || a.secretValue === undefined || !env.CLOUDFLARE_ACCOUNT_ID) {
    return { isError: true, text: "scriptName, secretName, secretValue sont requis." };
  }
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${a.scriptName}/secrets`, {
    method: "PUT",
    headers: cfHeaders(env),
    body: JSON.stringify({ name: a.secretName, text: a.secretValue, type: "secret_text" })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return { isError: true, text: `Erreur: ${clip(JSON.stringify(data))}` };
  return { text: `Secret '${a.secretName}' pose sur le Worker '${a.scriptName}'.` };
}

// ---- check_status ----
async function checkStatus(env, a) {
  if (!a || !a.url) return { isError: true, text: "url est requis." };
  const started = Date.now();
  try {
    const res = await fetch(a.url, { method: a.method || "GET" });
    const ms = Date.now() - started;
    return { text: `${a.url} -> HTTP ${res.status} en ${ms}ms.` };
  } catch (e) {
    return { isError: true, text: `${a.url} injoignable: ${e.message || e}` };
  }
}

const TOOLS = [
  {
    name: "github_fetch_code",
    description: "Recupere le contenu exact d'un fichier depuis un depot GitHub (format brut, pas de decodage manuel).",
    inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, path: { type: "string" }, ref: { type: "string", description: "Branche ou commit (optionnel)." } }, required: ["owner", "repo", "path"] },
    run: githubFetchCode
  },
  {
    name: "github_push_file",
    description: "Cree ou met a jour un fichier dans un depot GitHub (commit direct).",
    inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, path: { type: "string" }, content: { type: "string" }, message: { type: "string" }, branch: { type: "string" } }, required: ["owner", "repo", "path", "content"] },
    run: githubPushFile
  },
  {
    name: "github_create_repo",
    description: "Cree un nouveau depot GitHub.",
    inputSchema: { type: "object", properties: { name: { type: "string" }, private: { type: "boolean" }, description: { type: "string" } }, required: ["name"] },
    run: githubCreateRepo
  },
  {
    name: "github_create_pr",
    description: "Cree une pull request sur un depot GitHub.",
    inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, head: { type: "string" }, base: { type: "string" }, title: { type: "string" }, body: { type: "string" } }, required: ["owner", "repo", "head", "base", "title"] },
    run: githubCreatePr
  },
  {
    name: "github_deploy_worker",
    description: "Recupere un fichier depuis GitHub et le deploie directement comme Cloudflare Worker, en une seule etape.",
    inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, path: { type: "string" }, ref: { type: "string" }, scriptName: { type: "string" } }, required: ["owner", "repo", "path", "scriptName"] },
    run: githubDeployWorker
  },
  {
    name: "cloudflare_set_secret",
    description: "Pose une variable d'environnement chiffree (secret) sur un Cloudflare Worker.",
    inputSchema: { type: "object", properties: { scriptName: { type: "string" }, secretName: { type: "string" }, secretValue: { type: "string" } }, required: ["scriptName", "secretName", "secretValue"] },
    run: cloudflareSetSecret
  },
  {
    name: "check_status",
    description: "Verifie qu'une URL/service repond (health check).",
    inputSchema: { type: "object", properties: { url: { type: "string" }, method: { type: "string" } }, required: ["url"] },
    run: checkStatus
  }
];

function jsonRpcResult(id, result) { return { jsonrpc: "2.0", id, result }; }
function jsonRpcError(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }

function checkAuth(request, env) {
  if (!env.MCP_AUTH_TOKEN) return true;
  return (request.headers.get("Authorization") || "") === `Bearer ${env.MCP_AUTH_TOKEN}`;
}

async function callTool(env, name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { content: [{ type: "text", text: `Outil inconnu: ${name}` }], isError: true };
  try {
    const r = await tool.run(env, args || {});
    return { content: [{ type: "text", text: r.text }], isError: !!r.isError };
  } catch (e) {
    return { content: [{ type: "text", text: `Erreur: ${e.message || e}` }], isError: true };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response("mcp-toolbox: OK. Endpoint MCP : POST /mcp", { status: 200 });
    }
    if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });
    if (!checkAuth(request, env)) return new Response("Unauthorized", { status: 401 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

    let body;
    try { body = await request.json(); } catch {
      return Response.json(jsonRpcError(null, -32700, "Parse error"), { status: 400 });
    }
    const { id, method, params } = body;

    if (method === "initialize") {
      return Response.json(jsonRpcResult(id, {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "mcp-toolbox", version: "1.0.0" }
      }));
    }
    if (method === "notifications/initialized") return new Response(null, { status: 202 });
    if (method === "tools/list") return Response.json(jsonRpcResult(id, { tools: TOOLS.map(({ run, ...t }) => t) }));
    if (method === "tools/call") {
      const { name, arguments: args } = params || {};
      const result = await callTool(env, name, args);
      return Response.json(jsonRpcResult(id, result));
    }
    return Response.json(jsonRpcError(id, -32601, `Methode inconnue: ${method}`));
  }
};
