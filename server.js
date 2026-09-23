// mcp-toolbox — serveur MCP (Render) : boite a outils extensible (GitHub + Cloudflare + health check)
import express from "express";

const PORT = process.env.PORT || 10000;
const MAX_OUT = 50000;
function clip(s) {
  s = String(s ?? "");
  return s.length > MAX_OUT ? s.slice(0, MAX_OUT) + "\n...[tronque]" : s;
}

function ghHeaders() {
  if (!process.env.GITHUB_TOKEN) throw new Error("Secret manquant : GITHUB_TOKEN");
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "mcp-toolbox"
  };
}
function cfHeaders() {
  if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error("Secret manquant : CLOUDFLARE_API_TOKEN");
  return { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" };
}

async function githubFetchCode(a) {
  if (!a || !a.owner || !a.repo || !a.path) return { isError: true, text: "owner, repo et path sont requis." };
  const url = `https://api.github.com/repos/${a.owner}/${a.repo}/contents/${encodeURIComponent(a.path)}${a.ref ? `?ref=${a.ref}` : ""}`;
  const res = await fetch(url, { headers: { ...ghHeaders(), Accept: "application/vnd.github.raw" } });
  const text = await res.text();
  if (!res.ok) return { isError: true, text: `Erreur GitHub ${res.status}: ${clip(text)}` };
  return { text: clip(text) };
}

async function githubPushFile(a) {
  if (!a || !a.owner || !a.repo || !a.path || a.content === undefined) {
    return { isError: true, text: "owner, repo, path et content sont requis." };
  }
  const headers = ghHeaders();
  const base = `https://api.github.com/repos/${a.owner}/${a.repo}/contents/${encodeURIComponent(a.path)}`;
  let sha;
  const getRes = await fetch(`${base}${a.branch ? `?ref=${a.branch}` : ""}`, { headers });
  if (getRes.ok) sha = (await getRes.json()).sha;
  const body = {
    message: a.message || `Update ${a.path}`,
    content: Buffer.from(a.content, "utf-8").toString("base64"),
    ...(sha ? { sha } : {}),
    ...(a.branch ? { branch: a.branch } : {})
  };
  const putRes = await fetch(base, { method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await putRes.json().catch(() => ({}));
  if (!putRes.ok) return { isError: true, text: `Erreur GitHub ${putRes.status}: ${clip(JSON.stringify(data))}` };
  return { text: `Fichier ${a.path} pousse sur ${a.owner}/${a.repo} (commit ${data.commit?.sha?.slice(0, 7) || "?"}).` };
}

async function githubCreateRepo(a) {
  if (!a || !a.name) return { isError: true, text: "name est requis." };
  const res = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: { ...ghHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ name: a.name, private: a.private !== false, description: a.description || "" })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { isError: true, text: `Erreur GitHub ${res.status}: ${clip(JSON.stringify(data))}` };
  return { text: `Depot cree : ${data.html_url}` };
}

async function githubCreatePr(a) {
  if (!a || !a.owner || !a.repo || !a.head || !a.base || !a.title) {
    return { isError: true, text: "owner, repo, head, base et title sont requis." };
  }
  const res = await fetch(`https://api.github.com/repos/${a.owner}/${a.repo}/pulls`, {
    method: "POST",
    headers: { ...ghHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ title: a.title, head: a.head, base: a.base, body: a.body || "" })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { isError: true, text: `Erreur GitHub ${res.status}: ${clip(JSON.stringify(data))}` };
  return { text: `Pull request creee : ${data.html_url}` };
}

async function githubDeployWorker(a) {
  if (!a || !a.owner || !a.repo || !a.path || !a.scriptName || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    return { isError: true, text: "owner, repo, path, scriptName sont requis (et CLOUDFLARE_ACCOUNT_ID doit etre configure)." };
  }
  const fetched = await githubFetchCode(a);
  if (fetched.isError) return fetched;
  const code = fetched.text;
  const metadata = { main_module: "index.js", compatibility_date: "2025-01-01" };
  const boundary = `----MCPBoundary${Date.now()}`;
  const parts = [
    `--${boundary}`, 'Content-Disposition: form-data; name="metadata"', "Content-Type: application/json", "",
    JSON.stringify(metadata),
    `--${boundary}`, 'Content-Disposition: form-data; name="index.js"; filename="index.js"', "Content-Type: application/javascript+module", "",
    code, `--${boundary}--`, ""
  ];
  const body = parts.join("\r\n");
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${a.scriptName}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return { isError: true, text: `Erreur deploiement: ${clip(JSON.stringify(data))}` };
  return { text: `Worker '${a.scriptName}' deploye depuis ${a.owner}/${a.repo}/${a.path} (${code.length} octets).` };
}

async function cloudflareSetSecret(a) {
  if (!a || !a.scriptName || !a.secretName || a.secretValue === undefined || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    return { isError: true, text: "scriptName, secretName, secretValue sont requis." };
  }
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${a.scriptName}/secrets`, {
    method: "PUT", headers: cfHeaders(),
    body: JSON.stringify({ name: a.secretName, text: a.secretValue, type: "secret_text" })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return { isError: true, text: `Erreur: ${clip(JSON.stringify(data))}` };
  return { text: `Secret '${a.secretName}' pose sur le Worker '${a.scriptName}'.` };
}

async function checkStatus(a) {
  if (!a || !a.url) return { isError: true, text: "url est requis." };
  const started = Date.now();
  try {
    const res = await fetch(a.url, { method: a.method || "GET" });
    return { text: `${a.url} -> HTTP ${res.status} en ${Date.now() - started}ms.` };
  } catch (e) {
    return { isError: true, text: `${a.url} injoignable: ${e.message || e}` };
  }
}

const TOOLS = [
  { name: "github_fetch_code", description: "Recupere le contenu exact d'un fichier depuis un depot GitHub (format brut).", inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, path: { type: "string" }, ref: { type: "string" } }, required: ["owner", "repo", "path"] }, run: githubFetchCode },
  { name: "github_push_file", description: "Cree ou met a jour un fichier dans un depot GitHub (commit direct).", inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, path: { type: "string" }, content: { type: "string" }, message: { type: "string" }, branch: { type: "string" } }, required: ["owner", "repo", "path", "content"] }, run: githubPushFile },
  { name: "github_create_repo", description: "Cree un nouveau depot GitHub.", inputSchema: { type: "object", properties: { name: { type: "string" }, private: { type: "boolean" }, description: { type: "string" } }, required: ["name"] }, run: githubCreateRepo },
  { name: "github_create_pr", description: "Cree une pull request sur un depot GitHub.", inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, head: { type: "string" }, base: { type: "string" }, title: { type: "string" }, body: { type: "string" } }, required: ["owner", "repo", "head", "base", "title"] }, run: githubCreatePr },
  { name: "github_deploy_worker", description: "Recupere un fichier GitHub et le deploie comme Cloudflare Worker.", inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, path: { type: "string" }, ref: { type: "string" }, scriptName: { type: "string" } }, required: ["owner", "repo", "path", "scriptName"] }, run: githubDeployWorker },
  { name: "cloudflare_set_secret", description: "Pose un secret sur un Cloudflare Worker.", inputSchema: { type: "object", properties: { scriptName: { type: "string" }, secretName: { type: "string" }, secretValue: { type: "string" } }, required: ["scriptName", "secretName", "secretValue"] }, run: cloudflareSetSecret },
  { name: "check_status", description: "Verifie qu'une URL/service repond (health check).", inputSchema: { type: "object", properties: { url: { type: "string" }, method: { type: "string" } }, required: ["url"] }, run: checkStatus }
];

function jsonRpcResult(id, result) { return { jsonrpc: "2.0", id, result }; }
function jsonRpcError(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }
function checkAuth(req) {
  if (!process.env.MCP_AUTH_TOKEN) return true;
  return (req.headers["authorization"] || "") === `Bearer ${process.env.MCP_AUTH_TOKEN}`;
}
async function callTool(name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { content: [{ type: "text", text: `Outil inconnu: ${name}` }], isError: true };
  try {
    const r = await tool.run(args || {});
    return { content: [{ type: "text", text: r.text }], isError: !!r.isError };
  } catch (e) {
    return { content: [{ type: "text", text: `Erreur: ${e.message || e}` }], isError: true };
  }
}

const app = express();
app.use(express.json({ limit: "10mb" }));
app.get("/", (req, res) => res.send("mcp-toolbox: OK. Endpoint MCP : POST /mcp"));
app.post("/mcp", async (req, res) => {
  if (!checkAuth(req)) return res.status(401).send("Unauthorized");
  const { id, method, params } = req.body || {};
  if (method === "initialize") {
    return res.json(jsonRpcResult(id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mcp-toolbox", version: "1.0.0" } }));
  }
  if (method === "notifications/initialized") return res.status(202).end();
  if (method === "tools/list") return res.json(jsonRpcResult(id, { tools: TOOLS.map(({ run, ...t }) => t) }));
  if (method === "tools/call") {
    const { name, arguments: args } = params || {};
    return res.json(jsonRpcResult(id, await callTool(name, args)));
  }
  return res.json(jsonRpcError(id, -32601, `Methode inconnue: ${method}`));
});
app.listen(PORT, () => console.log(`mcp-toolbox en ecoute sur le port ${PORT}`));
