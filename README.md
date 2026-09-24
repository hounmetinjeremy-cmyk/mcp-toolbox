# 🧰 mcp-toolbox — Cloudflare Worker MCP Server

Serveur MCP utilitaire déployé sur Cloudflare Workers.  
Transport : **SSE (Server-Sent Events)**.

## 🛠️ Stack

- Cloudflare Workers
- Transport SSE maison (sans Express)
- Protocol MCP 2024-11-05

## 🚀 Déploiement

```bash
npm install
npx wrangler login
npx wrangler deploy
```

## 🔌 Endpoints

| Endpoint | Méthode | Description |
|---|---|---|
| `/` | GET | Infos + liste des outils |
| `/health` | GET | Santé du serveur |
| `/sse` | GET | Connexion SSE |
| `/messages?sessionId=...` | POST | Messages JSON-RPC |

## 🧰 Outils MCP disponibles

- `base64_encode` / `base64_decode`
- `url_encode` / `url_decode`
- `html_escape` / `html_unescape`
- `hash_md5` / `hash_sha256` / `hash_sha512` / `hmac_sha256`
- `uuid`, `timestamp`, `datetime`
- `random_string`, `random_number`, `generate_password`
- `calculate`
- `regex_match`, `regex_replace`
- `json_parse`, `json_minify`, `jwt_decode`
- `count_words`, `convert_case`, `slugify`, `csv_to_json`
- `lorem_ipsum`, `diff_text`

## ⚠️ Notes

- `jwt_decode` ne vérifie pas la signature.
- Les sessions SSE sont stockées en mémoire (pas de Durable Objects). Un Worker qui s'endort ou est recyclé perd les sessions.
