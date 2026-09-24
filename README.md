# 🧰 mcp-toolbox

Serveur MCP (Model Context Protocol) utilitaire déployé sur **Cloudflare Workers**.  
Transport : **SSE (Server-Sent Events)**. Aucun terminal requis.

## 🛠️ Stack

- Cloudflare Workers (ESM)
- `node:crypto` pour UUID
- Web Crypto API (hash, HMAC, AES, RSA)
- Aucune dépendance externe

## 🚀 Déploiement automatique

À chaque push sur `main`, le workflow `.github/workflows/deploy.yml` déploie le Worker automatiquement.

### Prérequis

1. Allez dans **Settings → Secrets and variables → Actions** de ce repo.
2. Ajoutez un secret nommé `CLOUDFLARE_API_TOKEN` avec un token ayant les permissions :
   - `Cloudflare Workers:Edit`
   - `Account:Read`

### Déploiement manuel

```bash
npm install
npx wrangler login
npx wrangler deploy
```

## 🔌 Endpoints

| Endpoint | Méthode | Description |
|---|---|---|
| `/` | GET | Informations + liste des outils |
| `/health` | GET | Santé du serveur |
| `/sse` | GET | Connexion SSE |
| `/messages?sessionId=...` | POST | Messages JSON-RPC |

## 🧰 Outils MCP disponibles (60+)

### Encodage
- `base64_encode`, `base64_decode`
- `url_encode`, `url_decode`
- `html_escape`, `html_unescape`
- `rot13`, `morse_encode`, `morse_decode`
- `binary_encode`, `binary_decode`, `hex_encode`, `hex_decode`

### Hash / Sécurité
- `hash_md5`, `hash_sha256`, `hash_sha512`, `hmac_sha256`
- `generate_password`, `password_strength`
- `generate_rsa_keypair`, `encrypt_aes`, `decrypt_aes`

### Texte
- `reverse`, `palindrome_check`
- `extract_emails`, `extract_urls`, `extract_hashtags`
- `truncate`, `word_wrap`, `remove_accents`, `repeat`
- `pad_left`, `pad_right`
- `convert_case` (upper, lower, title, camel, snake)
- `slugify`, `count_words`, `diff_text`, `lorem_ipsum`

### JSON / Web
- `json_parse`, `json_minify`, `jwt_decode`
- `qr_code`, `url_parse`, `dns_lookup`, `ip_info`

### Conversion / Validation
- `celsius_to_fahrenheit`, `fahrenheit_to_celsius`
- `bytes_to_human`, `human_to_bytes`
- `int_to_roman`, `roman_to_int`
- `is_email`, `is_url`, `is_ipv4`, `is_ipv6`

### Génération / Temps
- `uuid`, `uuid_bulk`, `timestamp`, `datetime`
- `random_string`, `random_number`
- `calculate`, `regex_match`, `regex_replace`

## ⚠️ Notes

- `jwt_decode` ne vérifie pas la signature.
- Les sessions SSE sont stockées en mémoire. Elles disparaissent si le Worker redémarre.
- `dns_lookup` utilise Cloudflare DNS over HTTPS.
- `ip_info` utilise ipapi.co.
- `qr_code` génère un lien vers l'API qrserver.com.

## 📄 Licence

MIT
