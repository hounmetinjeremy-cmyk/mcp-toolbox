// ===========================
//  Cloudflare Worker — MCP Server
//  Transport: SSE
//  60+ outils utilitaires (pas d'OpenAI)
// ===========================

import { randomUUID } from 'node:crypto';

const SERVER_NAME = 'mcp-toolbox';
const SERVER_VERSION = '2.0.0';
const PROTOCOL_VERSION = '2024-11-05';
const sessions = new Map();

function sendEvent(controller, event, data) {
  controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

function jsonRpc(id, result, isError = false) {
  const base = { jsonrpc: '2.0', id };
  if (isError) return { ...base, error: { code: -32603, message: result } };
  return { ...base, result };
}

async function createHash(algo, data) {
  const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(key, value) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function b64enc(str) { return btoa(String.fromCharCode(...new TextEncoder().encode(str))); }
function b64dec(str) { return new TextDecoder().decode(Uint8Array.from(atob(str), c => c.charCodeAt(0))); }

function randomString(length, charset) {
  const cs = charset || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i++) out += cs[Math.floor(Math.random() * cs.length)];
  return out;
}

function safeEval(expr) {
  const tokens = String(expr).match(/\d+\.?\d*|\d*\.\d+|[+\-*/%^()]/g) || [];
  let pos = 0;
  const peek = () => tokens[pos], next = () => tokens[pos++];
  const parseExpr = () => { let v = parseTerm(); while (peek() === '+' || peek() === '-') v = next() === '+' ? v + parseTerm() : v - parseTerm(); return v; };
  const parseTerm = () => { let v = parsePower(); while (peek() === '*' || peek() === '/' || peek() === '%') { const op = next(); const r = parsePower(); if (op === '*') v *= r; else if (op === '/') { if (r === 0) throw new Error('Division par zéro'); v /= r; } else v %= r; } return v; };
  const parsePower = () => { let v = parseUnary(); if (peek() === '^') { next(); v = Math.pow(v, parsePower()); } return v; };
  const parseUnary = () => { const op = peek(); if (op === '+' || op === '-') { next(); const v = parseUnary(); return op === '-' ? -v : v; } return parsePrimary(); };
  const parsePrimary = () => { const t = peek(); if (t === '(') { next(); const v = parseExpr(); if (next() !== ')') throw new Error('Parenthèse fermante manquante'); return v; } if (t === undefined) throw new Error('Expression incomplète'); next(); const n = parseFloat(t); if (Number.isNaN(n)) throw new Error(`Nombre invalide : ${t}`); return n; };
  const result = parseExpr();
  if (pos !== tokens.length) throw new Error('Caractères non autorisés');
  return result;
}

const MORSE = { A:'.-', B:'-...', C:'-.-.', D:'-..', E:'.', F:'..-.', G:'--.', H:'....', I:'..', J:'.---', K:'-.-', L:'.-..', M:'--', N:'-.', O:'---', P:'.--.', Q:'--.-', R:'.-.', S:'...', T:'-', U:'..-', V:'...-', W:'.--', X:'-..-', Y:'-.--', Z:'--..', 0:'-----', 1:'.----', 2:'..---', 3:'...--', 4:'....-', 5:'.....', 6:'-....', 7:'--...', 8:'---..', 9:'----.', ' ':'/' };
const RMORSE = Object.fromEntries(Object.entries(MORSE).map(([k,v])=>[v,k]));
const ROMAN = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
const RMAP = { I:1, V:5, X:10, L:50, C:100, D:500, M:1000 };

function intToRoman(n) { let num = parseInt(n); if (num <= 0 || num > 3999) throw new Error('Hors 1-3999'); let res = ''; for (const [v,s] of ROMAN) while (num >= v) { res += s; num -= v; } return res; }
function romanToInt(s) { let t = 0, p = 0; for (const c of s.toUpperCase().split('').reverse()) { const v = RMAP[c]; if (!v) throw new Error(`Invalide: ${c}`); t += v < p ? -v : v; p = v; } return t; }
function humanBytes(b) { const u = ['B','KB','MB','GB','TB']; let i = 0, n = parseInt(b); while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return `${n.toFixed(2)} ${u[i]}`; }
function bytesFromHuman(s) { const m = String(s).trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i); if (!m) throw new Error('Format: 1.5 MB'); const mult = { B:1, KB:1024, MB:1048576, GB:1073741824, TB:1099511627776 }; return Math.round(parseFloat(m[1]) * mult[m[2].toUpperCase()]); }
function toTitleCase(s) { return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()); }
function toCamelCase(s) { return s.toLowerCase().replace(/[^a-z0-9]+(.)/gi, (_, c) => c.toUpperCase()); }
function toSnakeCase(s) { const w = s.match(/[A-Z]{2,}(?=[A-Z][a-z]+|\b)|[A-Z]?[a-z]+|[A-Z]|[0-9]+/g); return w ? w.map(x => x.toLowerCase()).join('_') : ''; }
function passwordStrength(pwd) { let s = 0; if (pwd.length >= 8) s++; if (pwd.length >= 12) s++; if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) s++; if (/\d/.test(pwd)) s++; if (/[^A-Za-z0-9]/.test(pwd)) s++; const l = ['Très faible','Faible','Moyen','Bon','Très bon','Excellent']; return { score: s, label: l[s] }; }

async function generateKeyPair() {
  const kp = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['encrypt','decrypt']);
  const pub = await crypto.subtle.exportKey('spki', kp.publicKey);
  const priv = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
  return { public: b64enc(String.fromCharCode(...new Uint8Array(pub))), private: b64enc(String.fromCharCode(...new Uint8Array(priv))) };
}

async function aesEncrypt(plain, keyB64) {
  const rawKey = Uint8Array.from(atob(keyB64), c => c.charCodeAt(0));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  const combined = new Uint8Array([...iv, ...new Uint8Array(enc)]);
  return b64enc(String.fromCharCode(...combined));
}

async function aesDecrypt(cipherB64, keyB64) {
  const rawKey = Uint8Array.from(atob(keyB64), c => c.charCodeAt(0));
  const buf = Uint8Array.from(atob(cipherB64), c => c.charCodeAt(0));
  const iv = buf.slice(0, 12);
  const data = buf.slice(12);
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(dec);
}

function lorem(words = 30) {
  const dict = ['lorem','ipsum','dolor','sit','amet','consectetur','adipiscing','elit','sed','do','eiusmod','tempor','incididunt','ut','labore','et','dolore','magna','aliqua','enim','ad','minim','veniam','quis','nostrud','exercitation','ullamco','laboris','nisi','aliquip','ex','ea','commodo','consequat','duis','aute','irure','in','reprehenderit','voluptate','velit','esse','cillum','fugiat','nulla','pariatur','excepteur','sint','occaecat','cupidatat','non','proident','sunt','culpa','qui','officia','deserunt','mollit','anim','id','est','laborum'];
  return Array.from({ length: words }, () => dict[Math.floor(Math.random() * dict.length)]).join(' ');
}

/* ---------- Tools ---------- */
function tool(name, desc, props, req = []) {
  return { name, description: desc, inputSchema: { type: 'object', properties: props, required: req } };
}

const TOOLS = [
  tool('base64_encode','Encode en base64.',{value:{type:'string'}},['value']),
  tool('base64_decode','Décode du base64.',{value:{type:'string'}},['value']),
  tool('url_encode','URL-encode.',{value:{type:'string'}},['value']),
  tool('url_decode','URL-decode.',{value:{type:'string'}},['value']),
  tool('html_escape','Échappe HTML.',{value:{type:'string'}},['value']),
  tool('html_unescape','Déséchappe HTML.',{value:{type:'string'}},['value']),
  tool('binary_encode','Texte vers binaire.',{value:{type:'string'}},['value']),
  tool('binary_decode','Binaire vers texte.',{value:{type:'string'}},['value']),
  tool('hex_encode','Texte vers hexadécimal.',{value:{type:'string'}},['value']),
  tool('hex_decode','Hexadécimal vers texte.',{value:{type:'string'}},['value']),
  tool('rot13','ROT13.',{value:{type:'string'}},['value']),
  tool('morse_encode','Texte vers Morse.',{value:{type:'string'}},['value']),
  tool('morse_decode','Morse vers texte.',{value:{type:'string'}},['value']),
  tool('hash_md5','Hash MD5.',{value:{type:'string'}},['value']),
  tool('hash_sha256','Hash SHA-256.',{value:{type:'string'}},['value']),
  tool('hash_sha512','Hash SHA-512.',{value:{type:'string'}},['value']),
  tool('hmac_sha256','HMAC SHA-256.',{key:{type:'string'},value:{type:'string'}},['key','value']),
  tool('uuid','UUID v4.',{}),
  tool('uuid_bulk','Plusieurs UUID.',{count:{type:'integer',default:5}},['count']),
  tool('timestamp','Timestamp Unix.',{}),
  tool('datetime','Date/heure actuelle.',{timezone:{type:'string'}}),
  tool('random_string','Chaîne aléatoire.',{length:{type:'integer',default:16},charset:{type:'string'}}),
  tool('random_number','Nombre aléatoire.',{min:{type:'integer',default:0},max:{type:'integer',default:100}},['min','max']),
  tool('generate_password','Mot de passe.',{length:{type:'integer',default:16}}),
  tool('password_strength','Force mot de passe.',{value:{type:'string'}},['value']),
  tool('calculate','Calculatrice.',{expression:{type:'string'}},['expression']),
  tool('regex_match','Regex match.',{text:{type:'string'},pattern:{type:'string'},flags:{type:'string',default:'g'}},['text','pattern']),
  tool('regex_replace','Regex replace.',{text:{type:'string'},pattern:{type:'string'},replacement:{type:'string'},flags:{type:'string',default:'g'}},['text','pattern','replacement']),
  tool('json_parse','Parse JSON.',{value:{type:'string'}},['value']),
  tool('json_minify','Minifie JSON.',{value:{type:'string'}},['value']),
  tool('jwt_decode','Décode JWT.',{token:{type:'string'}},['token']),
  tool('count_words','Compte mots/lignes.',{value:{type:'string'}},['value']),
  tool('reverse','Inverse texte.',{value:{type:'string'}},['value']),
  tool('palindrome_check','Palindrome.',{value:{type:'string'}},['value']),
  tool('extract_emails','Extrait emails.',{value:{type:'string'}},['value']),
  tool('extract_urls','Extrait URLs.',{value:{type:'string'}},['value']),
  tool('extract_hashtags','Extrait hashtags.',{value:{type:'string'}},['value']),
  tool('truncate','Tronque texte.',{value:{type:'string'},length:{type:'integer'},suffix:{type:'string',default:'...'}},['value','length']),
  tool('word_wrap','Word wrap.',{value:{type:'string'},width:{type:'integer',default:80}},['value','width']),
  tool('remove_accents','Supprime accents.',{value:{type:'string'}},['value']),
  tool('repeat','Répète texte.',{value:{type:'string'},count:{type:'integer'}},['value','count']),
  tool('pad_left','Pad gauche.',{value:{type:'string'},length:{type:'integer'},char:{type:'string',default:' '}},['value','length']),
  tool('pad_right','Pad droite.',{value:{type:'string'},length:{type:'integer'},char:{type:'string',default:' '}},['value','length']),
  tool('convert_case','Change casse.',{value:{type:'string'},to:{type:'string',enum:['upper','lower','title','camel','snake']}},['value','to']),
  tool('slugify','Slug URL.',{value:{type:'string'}},['value']),
  tool('diff_text','Diff texte.',{before:{type:'string'},after:{type:'string'}},['before','after']),
  tool('csv_to_json','CSV vers JSON.',{value:{type:'string'}},['value']),
  tool('lorem_ipsum','Lorem ipsum.',{words:{type:'integer',default:30}}),
  tool('celsius_to_fahrenheit','Celsius vers Fahrenheit.',{value:{type:'number'}},['value']),
  tool('fahrenheit_to_celsius','Fahrenheit vers Celsius.',{value:{type:'number'}},['value']),
  tool('bytes_to_human','Octets lisibles.',{value:{type:'integer'}},['value']),
  tool('human_to_bytes','Lisible vers octets.',{value:{type:'string'}},['value']),
  tool('int_to_roman','Entier vers romain.',{value:{type:'integer'}},['value']),
  tool('roman_to_int','Romain vers entier.',{value:{type:'string'}},['value']),
  tool('is_email','Vérifie email.',{value:{type:'string'}},['value']),
  tool('is_url','Vérifie URL.',{value:{type:'string'}},['value']),
  tool('is_ipv4','Vérifie IPv4.',{value:{type:'string'}},['value']),
  tool('is_ipv6','Vérifie IPv6.',{value:{type:'string'}},['value']),
  tool('url_parse','Parse URL.',{value:{type:'string'}},['value']),
  tool('qr_code','Génère lien QR code.',{value:{type:'string'},size:{type:'integer',default:200}},['value']),
  tool('generate_rsa_keypair','Paire de clés RSA.',{}),
  tool('encrypt_aes','Chiffre AES-GCM.',{value:{type:'string'},key:{type:'string'}},['value','key']),
  tool('decrypt_aes','Déchiffre AES-GCM.',{value:{type:'string'},key:{type:'string'}},['value','key'])
];

/* ---------- Handlers ---------- */
async function initialize(id) {
  return jsonRpc(id, {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { logging: {}, tools: { listChanged: false } },
    serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
  });
}

async function listTools(id) {
  return jsonRpc(id, { tools: TOOLS });
}

async function callToolRpc(id, params) {
  const { name, arguments: args = {} } = params;
  try {
    let v = args.value;

    switch (name) {
      case 'base64_encode': return jsonRpc(id, { content: [{ type: 'text', text: b64enc(v) }], isError: false });
      case 'base64_decode': return jsonRpc(id, { content: [{ type: 'text', text: b64dec(v) }], isError: false });
      case 'url_encode': return jsonRpc(id, { content: [{ type: 'text', text: encodeURIComponent(v) }], isError: false });
      case 'url_decode': return jsonRpc(id, { content: [{ type: 'text', text: decodeURIComponent(v) }], isError: false });
      case 'html_escape': return jsonRpc(id, { content: [{ type: 'text', text: v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;') }], isError: false });
      case 'html_unescape': return jsonRpc(id, { content: [{ type: 'text', text: v.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&#39;/g,"'") }], isError: false });
      case 'binary_encode': return jsonRpc(id, { content: [{ type: 'text', text: new TextEncoder().encode(v).map(b => b.toString(2).padStart(8,'0')).join(' ') }], isError: false });
      case 'binary_decode': return jsonRpc(id, { content: [{ type: 'text', text: new TextDecoder().decode(new Uint8Array(v.replace(/\s/g,'').match(/.{8}/g).map(b => parseInt(b,2)))) }], isError: false });
      case 'hex_encode': return jsonRpc(id, { content: [{ type: 'text', text: new TextEncoder().encode(v).map(b => b.toString(16).padStart(2,'0')).join(' ') }], isError: false });
      case 'hex_decode': return jsonRpc(id, { content: [{ type: 'text', text: new TextDecoder().decode(new Uint8Array(v.replace(/\s/g,'').match(/.{2}/g).map(h => parseInt(h,16)))) }], isError: false });
      case 'rot13': return jsonRpc(id, { content: [{ type: 'text', text: rot13 ? v.replace(/[a-zA-Z]/g, c => { const b = c <= 'Z' ? 65 : 97; return String.fromCharCode(b + ((c.charCodeAt(0) - b + 13) % 26)); }) : '' }] });
      case 'morse_encode': return jsonRpc(id, { content: [{ type: 'text', text: v.toUpperCase().split('').map(c => MORSE[c] || c).join(' ') }], isError: false });
      case 'morse_decode': return jsonRpc(id, { content: [{ type: 'text', text: v.split(' ').map(c => RMORSE[c] || c).join('') }], isError: false });
      case 'hash_md5': return jsonRpc(id, { content: [{ type: 'text', text: await createHash('MD5', v) }], isError: false });
      case 'hash_sha256': return jsonRpc(id, { content: [{ type: 'text', text: await createHash('SHA-256', v) }], isError: false });
      case 'hash_sha512': return jsonRpc(id, { content: [{ type: 'text', text: await createHash('SHA-512', v) }], isError: false });
      case 'hmac_sha256': return jsonRpc(id, { content: [{ type: 'text', text: await hmacSha256(args.key, v) }], isError: false });
      case 'uuid': return jsonRpc(id, { content: [{ type: 'text', text: randomUUID() }], isError: false });
      case 'uuid_bulk': return jsonRpc(id, { content: [{ type: 'text', text: Array.from({length: Math.min(args.count,100)}, () => randomUUID()).join('\n') }], isError: false });
      case 'timestamp': return jsonRpc(id, { content: [{ type: 'text', text: String(Math.floor(Date.now()/1000)) }], isError: false });
      case 'datetime': return jsonRpc(id, { content: [{ type: 'text', text: JSON.stringify({iso:new Date().toISOString(),unix:Math.floor(Date.now()/1000),local:new Date().toLocaleString('fr-FR',{timeZone:args.timezone||'UTC'})},null,2) }], isError: false });
      case 'random_string': return jsonRpc(id, { content: [{ type: 'text', text: randomString(args.length || 16, args.charset) }], isError: false });
      case 'random_number': { const min=Number(args.min), max=Number(args.max); if (min>=max) throw new Error('min<max requis'); return jsonRpc(id, { content: [{ type:'text', text: String(Math.floor(Math.random()*(max-min+1))+min) }], isError: false }); }
      case 'generate_password': return jsonRpc(id, { content: [{ type: 'text', text: randomString(args.length || 16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?') }], isError: false });
      case 'password_strength': return jsonRpc(id, { content: [{ type: 'text', text: JSON.stringify(passwordStrength(v),null,2) }], isError: false });
      case 'calculate': return jsonRpc(id, { content: [{ type: 'text', text: String(safeEval(args.expression)) }], isError: false });
      case 'regex_match': { const r = new RegExp(args.pattern, args.flags || 'g'); const m = String(args.text).match(r) || []; return jsonRpc(id, { content: [{ type:'text', text: JSON.stringify(m,null,2) }], isError: false }); }
      case 'regex_replace': { const r = new RegExp(args.pattern, args.flags || 'g'); return jsonRpc(id, { content: [{ type:'text', text: String(args.text).replace(r, args.replacement) }], isError: false }); }
      case 'json_parse': return jsonRpc(id, { content: [{ type: 'text', text: JSON.stringify(JSON.parse(v),null,2) }], isError: false });
      case 'json_minify': return jsonRpc(id, { content: [{ type: 'text', text: JSON.stringify(JSON.parse(v)) }], isError: false });
      case 'jwt_decode': { const p = args.token.split('.'); if (p.length !== 3) throw new Error('JWT invalide'); return jsonRpc(id, { content: [{ type:'text', text: JSON.stringify({header:JSON.parse(b64dec(p[0])),payload:JSON.parse(b64dec(p[1]))},null,2) }], isError: false }); }
      case 'count_words': return jsonRpc(id, { content: [{ type: 'text', text: JSON.stringify({chars:v.length,chars_no_space:v.replace(/\s/g,'').length,words:v.trim().split(/\s+/).filter(Boolean).length,lines:v.split(/\r?\n/).length},null,2) }], isError: false });
      case 'reverse': return jsonRpc(id, { content: [{ type: 'text', text: v.split('').reverse().join('') }], isError: false });
      case 'palindrome_check': { const c = v.toLowerCase().replace(/[^a-z0-9]/g,''); return jsonRpc(id, { content: [{ type:'text', text: String(c === c.split('').reverse().join('')) }], isError: false }); }
      case 'extract_emails': return jsonRpc(id, { content: [{ type: 'text', text: JSON.stringify(v.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [],null,2) }], isError: false });
      case 'extract_urls': return jsonRpc(id, { content: [{ type: 'text', text: JSON.stringify(v.match(/https?:\/\/[^\s"'<>]+/g) || [],null,2) }], isError: false });
      case 'extract_hashtags': return jsonRpc(id, { content: [{ type: 'text', text: JSON.stringify(v.match(/#[A-Za-z0-9_]+/g) || [],null,2) }], isError: false });
      case 'truncate': return jsonRpc(id, { content: [{ type: 'text', text: v.length > args.length ? v.slice(0,args.length-(args.suffix||'...').length)+(args.suffix||'...') : v }], isError: false });
      case 'word_wrap': { const w = args.width || 80; const lines = []; for (let i=0;i<v.length;i+=w) lines.push(v.slice(i,i+w)); return jsonRpc(id, { content: [{ type:'text', text: lines.join('\n') }], isError: false }); }
      case 'remove_accents': return jsonRpc(id, { content: [{ type: 'text', text: v.normalize('NFD').replace(/[\u0300-\u036f]/g,'') }], isError: false });
      case 'repeat': return jsonRpc(id, { content: [{ type: 'text', text: v.repeat(Math.max(0,args.count)) }], isError: false });
      case 'pad_left': return jsonRpc(id, { content: [{ type: 'text', text: v.padStart(args.length, args.char || ' ') }], isError: false });
      case 'pad_right': return jsonRpc(id, { content: [{ type: 'text', text: v.padEnd(args.length, args.char || ' ') }], isError: false });
      case 'convert_case': { const c = args.to; let r = v; if (c==='upper') r=v.toUpperCase(); else if (c==='lower') r=v.toLowerCase(); else if (c==='title') r=toTitleCase(v); else if (c==='camel') r=toCamelCase(v); else if (c==='snake') r=toSnakeCase(v); return jsonRpc(id, { content: [{type:'text',text:r}], isError: false }); }
      case 'slugify': return jsonRpc(id, { content: [{ type: 'text', text: v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') }], isError: false });
      case 'diff_text': { const a=v.split('\n'), b=args.after.split('\n'), out=[]; const mx=Math.max(a.length,b.length); for(let i=0;i<mx;i++){ if(a[i]===b[i]) out.push(`  ${a[i]??''}`); else { if(a[i]!==undefined) out.push(`- ${a[i]}`); if(b[i]!==undefined) out.push(`+ ${b[i]}`); } } return jsonRpc(id, { content: [{type:'text',text:out.join('\n')}], isError: false }); }
      case 'csv_to_json': { const lines = v.trim().split(/\r?\n/).filter(Boolean); if(lines.length<2) throw new Error('CSV invalide'); const h=lines[0].split(',').map(x=>x.trim()); const rows=lines.slice(1).map(line=>{ const vals=line.split(','); const o={}; h.forEach((k,i)=>o[k]=vals[i]?vals[i].trim():''); return o; }); return jsonRpc(id, { content: [{type:'text',text:JSON.stringify(rows,null,2)}], isError: false }); }
      case 'lorem_ipsum': return jsonRpc(id, { content: [{ type: 'text', text: lorem(args.words || 30) }], isError: false });
      case 'celsius_to_fahrenheit': return jsonRpc(id, { content: [{ type: 'text', text: String((args.value * 9/5) + 32) }], isError: false });
      case 'fahrenheit_to_celsius': return jsonRpc(id, { content: [{ type: 'text', text: String((args.value - 32) * 5/9) }], isError: false });
      case 'bytes_to_human': return jsonRpc(id, { content: [{ type: 'text', text: humanBytes(args.value) }], isError: false });
      case 'human_to_bytes': return jsonRpc(id, { content: [{ type: 'text', text: String(bytesFromHuman(args.value)) }], isError: false });
      case 'int_to_roman': return jsonRpc(id, { content: [{ type: 'text', text: intToRoman(args.value) }], isError: false });
      case 'roman_to_int': return jsonRpc(id, { content: [{ type: 'text', text: String(romanToInt(args.value)) }], isError: false });
      case 'is_email': return jsonRpc(id, { content: [{ type: 'text', text: String(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(args.value)) }], isError: false });
      case 'is_url': return jsonRpc(id, { content: [{ type: 'text', text: String(/^https?:\/\/.+\.?.+/.test(args.value)) }], isError: false });
      case 'is_ipv4': return jsonRpc(id, { content: [{ type: 'text', text: String(/^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/.test(args.value)) }], isError: false });
      case 'is_ipv6': return jsonRpc(id, { content: [{ type: 'text', text: String(/^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::$|^::1$/.test(args.value)) }], isError: false });
      case 'url_parse': { const u = new URL(args.value); return jsonRpc(id, { content: [{ type:'text', text: JSON.stringify({protocol:u.protocol,hostname:u.hostname,port:u.port,pathname:u.pathname,search:u.search,hash:u.hash,origin:u.origin},null,2) }], isError: false }); }
      case 'qr_code': return jsonRpc(id, { content: [{ type: 'text', text: `https://api.qrserver.com/v1/create-qr-code/?size=${args.size||200}x${args.size||200}&data=${encodeURIComponent(args.value)}` }], isError: false });
      case 'generate_rsa_keypair': return jsonRpc(id, { content: [{ type: 'text', text: JSON.stringify(await generateKeyPair(),null,2) }], isError: false });
      case 'encrypt_aes': return jsonRpc(id, { content: [{ type: 'text', text: await aesEncrypt(args.value, args.key) }], isError: false });
      case 'decrypt_aes': return jsonRpc(id, { content: [{ type: 'text', text: await aesDecrypt(args.value, args.key) }], isError: false });
      default: throw new Error(`Outil inconnu: ${name}`);
    }
  } catch (err) {
    return jsonRpc(id, { content: [{ type: 'text', text: err.message }], isError: true });
  }
}

/* ---------- Transport ---------- */
async function handleSse(request) {
  const sessionId = randomUUID();
  const stream = new ReadableStream({
    start(controller) {
      sessions.set(sessionId, controller);
      sendEvent(controller, 'endpoint', { sessionId });
      sendEvent(controller, 'message', { jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    },
    cancel() { sessions.delete(sessionId); }
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' } });
}

async function handleMessages(request) {
  const url = new URL(request.url);
  const sid = url.searchParams.get('sessionId');
  if (!sessions.has(sid)) return jsonResponse({ error: 'Session non trouvée' }, 404);
  const body = await request.json();
  let res;
  if (body.method === 'initialize') res = await initialize(body.id);
  else if (body.method === 'tools/list') res = await listTools(body.id);
  else if (body.method === 'tools/call') res = await callToolRpc(body.id, body.params);
  else if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
  else res = { jsonrpc: '2.0', id: body.id, error: { code: -32601, message: `Méthode inconnue: ${body.method}` } };
  return jsonResponse(res);
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
    try {
      switch (url.pathname) {
        case '/': return jsonResponse({ name: SERVER_NAME, version: SERVER_VERSION, protocol: PROTOCOL_VERSION, transport: 'sse', tools: TOOLS.length });
        case '/health': return jsonResponse({ ok: true, tools: TOOLS.length, sessions: sessions.size });
        case '/sse': return handleSse(request);
        case '/messages': return handleMessages(request);
        default: return jsonResponse({ error: 'Not found' }, 404);
      }
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }
};
