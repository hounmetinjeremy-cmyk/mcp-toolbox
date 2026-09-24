// ===========================
//  Cloudflare Worker — MCP Server
//  Transport: SSE
//  50+ outils utilitaires sans dépendance externe (sauf web optionnel)
// ===========================

import { randomUUID } from 'node:crypto';

/* ---------- Configuration ---------- */
const SERVER_NAME = 'mcp-toolbox';
const SERVER_VERSION = '2.1.0';
const PROTOCOL_VERSION = '2024-11-05';

/* ---------- Sessions SSE ---------- */
const sessions = new Map();

function sendEvent(controller, event, data) {
  controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

/* ---------- Helpers utilitaires ---------- */
function jsonRpc(id, result, isError = false) {
  const base = { jsonrpc: '2.0', id };
  if (isError) return { ...base, error: { code: -32603, message: result } };
  return { ...base, result };
}

function createHash(algo, data) {
  return crypto.subtle.digest(algo, new TextEncoder().encode(data)).then(buf => {
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  });
}

async function hmacSha256(key, value) {
  const k = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomString(length, charset) {
  const cs = charset || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += cs[Math.floor(Math.random() * cs.length)];
  }
  return out;
}

function lorem(words = 30) {
  const dict = [
    'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
    'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore',
    'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud',
    'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'ex', 'ea', 'commodo',
    'consequat', 'duis', 'aute', 'irure', 'in', 'reprehenderit', 'voluptate',
    'velit', 'esse', 'cillum', 'fugiat', 'nulla', 'pariatur', 'excepteur', 'sint',
    'occaecat', 'cupidatat', 'non', 'proident', 'sunt', 'culpa', 'qui', 'officia',
    'deserunt', 'mollit', 'anim', 'id', 'est', 'laborum'
  ];
  return Array.from({ length: words }, () => dict[Math.floor(Math.random() * dict.length)]).join(' ');
}

function safeEval(expr) {
  const tokens = String(expr).match(/\d+\.?\d*|\d*\.\d+|[+\-*/%^()]/g) || [];
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpression() {
    let val = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const rhs = parseTerm();
      val = op === '+' ? val + rhs : val - rhs;
    }
    return val;
  }

  function parseTerm() {
    let val = parsePower();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = next();
      const rhs = parsePower();
      if (op === '*') val *= rhs;
      else if (op === '/') {
        if (rhs === 0) throw new Error('Division par zéro');
        val /= rhs;
      } else val %= rhs;
    }
    return val;
  }

  function parsePower() {
    let val = parseUnary();
    if (peek() === '^') {
      next();
      const exp = parsePower();
      val = Math.pow(val, exp);
    }
    return val;
  }

  function parseUnary() {
    const op = peek();
    if (op === '+' || op === '-') {
      next();
      const val = parseUnary();
      return op === '-' ? -val : val;
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const t = peek();
    if (t === '(') {
      next();
      const val = parseExpression();
      if (peek() !== ')') throw new Error('Parenthèse fermante manquante');
      next();
      return val;
    }
    if (t === undefined) throw new Error('Expression incomplète');
    next();
    const n = parseFloat(t);
    if (Number.isNaN(n)) throw new Error(`Nombre invalide : ${t}`);
    return n;
  }

  const result = parseExpression();
  if (pos !== tokens.length) throw new Error('Caractères non autorisés');
  return result;
}

function removeAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function rot13(str) {
  return str.replace(/[a-zA-Z]/g, c => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(base + ((c.charCodeAt(0) - base + 13) % 26));
  });
}

const MORSE_CODE = {
  'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.',
  'G': '--.', 'H': '....', 'I': '..', 'J': '.---', 'K': '-.-', 'L': '.-..',
  'M': '--', 'N': '-.', 'O': '---', 'P': '.--.', 'Q': '--.-', 'R': '.-.',
  'S': '...', 'T': '-', 'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-',
  'Y': '-.--', 'Z': '--..', '0': '-----', '1': '.----', '2': '..---',
  '3': '...--', '4': '....-', '5': '.....', '6': '-....', '7': '--...',
  '8': '---..', '9': '----.', ' ': '/', '.': '.-.-.-', ',': '--..--',
  '?': '..--..', "'": '.----.', '!': '-.-.--', '/': '-..-.', '(': '-.--.',
  ')': '-.--.-', '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-',
  '+': '.-.-.', '-': '-....-', '_': '..--.-', '"': '.-..-.', '$': '...-..-',
  '@': '.--.-.'
};
const REVERSE_MORSE = Object.fromEntries(Object.entries(MORSE_CODE).map(([k, v]) => [v, k]));

function morseEncode(text) {
  return text.toUpperCase().split('').map(c => MORSE_CODE[c] || c).join(' ');
}

function morseDecode(code) {
  return code.split(' ').map(c => REVERSE_MORSE[c] || c).join('');
}

function textToBinary(text) {
  return text.split('').map(c => c.charCodeAt(0).toString(2).padStart(8, '0')).join(' ');
}

function binaryToText(binary) {
  return binary.replace(/\s/g, '').match(/.{8}/g).map(b => String.fromCharCode(parseInt(b, 2))).join('');
}

function textToHex(text) {
  return text.split('').map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
}

function hexToText(hex) {
  return hex.replace(/\s/g, '').match(/.{2}/g).map(h => String.fromCharCode(parseInt(h, 16))).join('');
}

function bytesToHuman(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let size = Number(bytes);
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(2)} ${units[i]}`;
}

function humanToBytes(str) {
  const match = String(str).trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i);
  if (!match) throw new Error('Format invalide, ex: 1.5 GB');
  const size = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const powers = { B: 0, KB: 1, MB: 2, GB: 3, TB: 4 };
  return Math.floor(size * Math.pow(1024, powers[unit]));
}

function intToRoman(num) {
  const map = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
  ];
  let n = parseInt(num);
  if (n <= 0 || n > 3999) throw new Error('Nombre hors plage (1-3999)');
  let out = '';
  for (const [v, s] of map) { while (n >= v) { out += s; n -= v; } }
  return out;
}

function romanToInt(roman) {
  const map = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let i = 0; i < roman.length; i++) {
    const curr = map[roman[i]];
    const next = map[roman[i + 1]];
    if (next && curr < next) total -= curr;
    else total += curr;
  }
  return total;
}

function passwordStrength(pwd) {
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[a-z]/.test(pwd)) score++;
  if (/\d/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  const levels = ['Très faible', 'Faible', 'Moyen', 'Bon', 'Fort', 'Très fort'];
  return { score, strength: levels[Math.min(score, 5)] };
}

async function importAesKey(key) {
  const raw = new TextEncoder().encode(key.padEnd(32, ' ').slice(0, 32));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function aesEncrypt(text, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const k = await importAesKey(key);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(text));
  const combined = new Uint8Array(iv.length + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function aesDecrypt(b64, key) {
  const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const iv = data.slice(0, 12);
  const cipher = data.slice(12);
  const k = await importAesKey(key);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k, cipher);
  return new TextDecoder().decode(plain);
}

async function generateRsaKeypair() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt']
  );
  const pub = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const priv = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  return {
    public: '-----BEGIN PUBLIC KEY-----\n' + btoa(String.fromCharCode(...new Uint8Array(pub))) + '\n-----END PUBLIC KEY-----',
    private: '-----BEGIN PRIVATE KEY-----\n' + btoa(String.fromCharCode(...new Uint8Array(priv))) + '\n-----END PRIVATE KEY-----'
  };
}

function pad(str, length, char, side) {
  const s = String(str);
  if (s.length >= length) return s;
  const padStr = char.repeat(length - s.length);
  return side === 'left' ? padStr + s : s + padStr;
}

/* ---------- Tools ---------- */
const TOOLS = [
  { name: 'base64_encode', description: 'Encode une chaîne en base64.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'base64_decode', description: 'Décode une chaîne base64.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'url_encode', description: 'URL-encode une chaîne.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'url_decode', description: 'URL-decode une chaîne.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'html_escape', description: 'Échappe les caractères HTML.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'html_unescape', description: 'Déséchappe les entités HTML.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'hash_md5', description: 'Hash MD5.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'hash_sha256', description: 'Hash SHA-256.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'hash_sha512', description: 'Hash SHA-512.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'hmac_sha256', description: 'HMAC SHA-256.', inputSchema: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'] } },
  { name: 'uuid', description: 'Génère un UUID v4 aléatoire.', inputSchema: { type: 'object', properties: {} } },
  { name: 'uuid_bulk', description: 'Génère plusieurs UUID v4.', inputSchema: { type: 'object', properties: { count: { type: 'integer', default: 5 } } } },
  { name: 'timestamp', description: 'Timestamp Unix actuel.', inputSchema: { type: 'object', properties: {} } },
  { name: 'datetime', description: 'Date/heure actuelle ISO + locale.', inputSchema: { type: 'object', properties: { timezone: { type: 'string', description: 'ex: Europe/Paris' } } } },
  { name: 'random_string', description: 'Chaîne aléatoire.', inputSchema: { type: 'object', properties: { length: { type: 'integer', default: 16 }, charset: { type: 'string' } } } },
  { name: 'random_number', description: 'Nombre entier aléatoire.', inputSchema: { type: 'object', properties: { min: { type: 'number', default: 0 }, max: { type: 'number', default: 100 } }, required: ['min', 'max'] } },
  { name: 'generate_password', description: 'Mot de passe sécurisé.', inputSchema: { type: 'object', properties: { length: { type: 'integer', default: 16 } } } },
  { name: 'password_strength', description: 'Évalue la force d\'un mot de passe.', inputSchema: { type: 'object', properties: { password: { type: 'string' } }, required: ['password'] } },
  { name: 'calculate', description: 'Expression mathématique (+ - * / % ^).', inputSchema: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] } },
  { name: 'regex_match', description: 'Teste une regex.', inputSchema: { type: 'object', properties: { text: { type: 'string' }, pattern: { type: 'string' }, flags: { type: 'string', default: 'g' } }, required: ['text', 'pattern'] } },
  { name: 'regex_replace', description: 'Remplace par regex.', inputSchema: { type: 'object', properties: { text: { type: 'string' }, pattern: { type: 'string' }, replacement: { type: 'string' }, flags: { type: 'string', default: 'g' } }, required: ['text', 'pattern', 'replacement'] } },
  { name: 'json_parse', description: 'Parse et formate un JSON.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'json_minify', description: 'Minifie un JSON.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'jwt_decode', description: 'Décode un JWT (sans signature).', inputSchema: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'] } },
  { name: 'count_words', description: 'Compte mots, caractères, lignes.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'convert_case', description: 'Change la casse.', inputSchema: { type: 'object', properties: { value: { type: 'string' }, to: { type: 'string', enum: ['upper', 'lower', 'title', 'camel', 'snake'], default: 'upper' } }, required: ['value', 'to'] } },
  { name: 'slugify', description: 'Transforme un texte en slug.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'csv_to_json', description: 'CSV simple vers JSON.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'lorem_ipsum', description: 'Génère du Lorem ipsum.', inputSchema: { type: 'object', properties: { words: { type: 'integer', default: 30 } } } },
  { name: 'diff_text', description: 'Diff ligne par ligne.', inputSchema: { type: 'object', properties: { before: { type: 'string' }, after: { type: 'string' } }, required: ['before', 'after'] } },
  { name: 'reverse', description: 'Inverse une chaîne.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'palindrome_check', description: 'Vérifie si un texte est un palindrome.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'extract_emails', description: 'Extrait les adresses email.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'extract_urls', description: 'Extrait les URLs.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'extract_hashtags', description: 'Extrait les hashtags.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'truncate', description: 'Tronque un texte avec ellipse.', inputSchema: { type: 'object', properties: { value: { type: 'string' }, length: { type: 'integer', default: 100 }, suffix: { type: 'string', default: '...' } }, required: ['value'] } },
  { name: 'word_wrap', description: 'Coupe un texte en lignes de N caractères.', inputSchema: { type: 'object', properties: { value: { type: 'string' }, width: { type: 'integer', default: 80 } }, required: ['value'] } },
  { name: 'remove_accents', description: 'Supprime les accents.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'repeat', description: 'Répète un texte N fois.', inputSchema: { type: 'object', properties: { value: { type: 'string' }, count: { type: 'integer', default: 2 } }, required: ['value'] } },
  { name: 'pad_left', description: 'Remplit à gauche.', inputSchema: { type: 'object', properties: { value: { type: 'string' }, length: { type: 'integer' }, char: { type: 'string', default: ' ' } }, required: ['value', 'length'] } },
  { name: 'pad_right', description: 'Remplit à droite.', inputSchema: { type: 'object', properties: { value: { type: 'string' }, length: { type: 'integer' }, char: { type: 'string', default: ' ' } }, required: ['value', 'length'] } },
  { name: 'rot13', description: 'Chiffrement/déchiffrement ROT13.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'morse_encode', description: 'Texte vers morse.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'morse_decode', description: 'Morse vers texte.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'binary_encode', description: 'Texte vers binaire.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'binary_decode', description: 'Binaire vers texte.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'hex_encode', description: 'Texte vers hexadécimal.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'hex_decode', description: 'Hexadécimal vers texte.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'qr_code', description: 'Génère un lien QR code (API goqr.me).', inputSchema: { type: 'object', properties: { value: { type: 'string', description: 'Données à encoder' }, size: { type: 'integer', default: 200 } }, required: ['value'] } },
  { name: 'url_parse', description: 'Parse une URL en composants.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'dns_lookup', description: 'Résolution DNS via Cloudflare DoH.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string', default: 'A' } }, required: ['name'] } },
  { name: 'ip_info', description: 'Infos sur une IP via ipapi.co.', inputSchema: { type: 'object', properties: { ip: { type: 'string', description: 'IP ou laisser vide pour l\'IP courante' } } } },
  { name: 'celsius_to_fahrenheit', description: 'Convertit °C en °F.', inputSchema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] } },
  { name: 'fahrenheit_to_celsius', description: 'Convertit °F en °C.', inputSchema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] } },
  { name: 'bytes_to_human', description: 'Octets vers format lisible.', inputSchema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] } },
  { name: 'human_to_bytes', description: 'Format lisible vers octets.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'int_to_roman', description: 'Entier vers chiffre romain (1-3999).', inputSchema: { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'] } },
  { name: 'roman_to_int', description: 'Chiffre romain vers entier.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'is_email', description: 'Vérifie un email.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'is_url', description: 'Vérifie une URL.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'is_ipv4', description: 'Vérifie une IPv4.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'is_ipv6', description: 'Vérifie une IPv6.', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } },
  { name: 'generate_rsa_keypair', description: 'Génère une paire de clés RSA 2048 bits.', inputSchema: { type: 'object', properties: {} } },
  { name: 'encrypt_aes', description: 'Chiffre un texte avec AES-256-GCM.', inputSchema: { type: 'object', properties: { value: { type: 'string' }, key: { type: 'string' } }, required: ['value', 'key'] } },
  { name: 'decrypt_aes', description: 'Déchiffre un texte AES-256-GCM.', inputSchema: { type: 'object', properties: { value: { type: 'string' }, key: { type: 'string' } }, required: ['value', 'key'] } }
];

const CAPABILITIES = {
  protocolVersion: PROTOCOL_VERSION,
  capabilities: { logging: {}, tools: { listChanged: false } },
  serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
};

/* ---------- Appel des outils ---------- */
async function callTool(name, args, env) {
  const v = args.value;

  switch (name) {
    case 'base64_encode': return btoa(v);
    case 'base64_decode': return atob(v);
    case 'url_encode': return encodeURIComponent(v);
    case 'url_decode': return decodeURIComponent(v);
    case 'html_escape': return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    case 'html_unescape': return v.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#39;/g, "'");
    case 'hash_md5': return createHash('MD5', v);
    case 'hash_sha256': return createHash('SHA-256', v);
    case 'hash_sha512': return createHash('SHA-512', v);
    case 'hmac_sha256': return hmacSha256(args.key, v);
    case 'uuid': return randomUUID();
    case 'uuid_bulk': return Array.from({ length: Math.min(args.count || 5, 100) }, () => randomUUID());
    case 'timestamp': return Math.floor(Date.now() / 1000);
    case 'datetime': { const now = new Date(); return { iso: now.toISOString(), unix: Math.floor(now / 1000), local: now.toLocaleString('fr-FR', { timeZone: args.timezone || 'UTC' }) }; }
    case 'random_string': return randomString(args.length || 16, args.charset);
    case 'random_number': { const min = Number(args.min), max = Number(args.max); if (min >= max) throw new Error('min doit être inférieur à max'); return Math.floor(Math.random() * (max - min + 1)) + min; }
    case 'generate_password': { const len = args.length || 16; const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?'; return randomString(len, charset); }
    case 'password_strength': return passwordStrength(args.password);
    case 'calculate': return String(safeEval(args.expression));
    case 'regex_match': { const re = new RegExp(args.pattern, args.flags || 'g'); const matches = String(args.text).match(re); return matches || []; }
    case 'regex_replace': { const re = new RegExp(args.pattern, args.flags || 'g'); return String(args.text).replace(re, args.replacement); }
    case 'json_parse': { const obj = JSON.parse(v); return JSON.stringify(obj, null, 2); }
    case 'json_minify': { const obj = JSON.parse(v); return JSON.stringify(obj); }
    case 'jwt_decode': { const parts = args.token.split('.'); if (parts.length !== 3) throw new Error('JWT invalide'); const header = JSON.parse(atob(parts[0])); const payload = JSON.parse(atob(parts[1])); return { header, payload }; }
    case 'count_words': return { chars: v.length, chars_no_space: v.replace(/\s/g, '').length, words: v.trim().split(/\s+/).filter(Boolean).length, lines: v.split(/\r?\n/).length };
    case 'convert_case': {
      switch (args.to) {
        case 'upper': return v.toUpperCase();
        case 'lower': return v.toLowerCase();
        case 'title': return v.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
        case 'camel': return v.toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase());
        case 'snake': return v.match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g).map(x => x.toLowerCase()).join('_');
        default: throw new Error('Cas non supporté');
      }
    }
    case 'slugify': return removeAccents(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    case 'csv_to_json': { const lines = v.trim().split(/\r?\n/).filter(Boolean); if (lines.length < 2) throw new Error('CSV invalide'); const headers = lines[0].split(',').map(h => h.trim()); return lines.slice(1).map(line => { const values = line.split(','); const obj = {}; headers.forEach((h, i) => obj[h] = values[i] !== undefined ? values[i].trim() : ''); return obj; }); }
    case 'lorem_ipsum': return lorem(args.words || 30);
    case 'diff_text': { const a = args.before.split(/\r?\n/), b = args.after.split(/\r?\n/); const out = []; const max = Math.max(a.length, b.length); for (let i = 0; i < max; i++) { if (a[i] === b[i]) out.push(`  ${a[i] ?? ''}`); else { if (a[i] !== undefined) out.push(`- ${a[i]}`); if (b[i] !== undefined) out.push(`+ ${b[i]}`); } } return out.join('\n'); }
    case 'reverse': return v.split('').reverse().join('');
    case 'palindrome_check': { const clean = removeAccents(v.toLowerCase()).replace(/[^a-z0-9]/g, ''); return { isPalindrome: clean === clean.split('').reverse().join(''), cleaned: clean }; }
    case 'extract_emails': return [...v.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)].map(m => m[0]);
    case 'extract_urls': return [...v.matchAll(/https?:\/\/[^\s\"'<>]+/g)].map(m => m[0]);
    case 'extract_hashtags': return [...v.matchAll(/#\w+/g)].map(m => m[0]);
    case 'truncate': return v.length > args.length ? v.slice(0, args.length - args.suffix.length) + (args.suffix || '...') : v;
    case 'word_wrap': { const width = args.width || 80; const lines = []; for (let i = 0; i < v.length; i += width) lines.push(v.slice(i, i + width)); return lines.join('\n'); }
    case 'remove_accents': return removeAccents(v);
    case 'repeat': return v.repeat(args.count || 2);
    case 'pad_left': return pad(v, args.length, args.char || ' ', 'left');
    case 'pad_right': return pad(v, args.length, args.char || ' ', 'right');
    case 'rot13': return rot13(v);
    case 'morse_encode': return morseEncode(v);
    case 'morse_decode': return morseDecode(v);
    case 'binary_encode': return textToBinary(v);
    case 'binary_decode': return binaryToText(v);
    case 'hex_encode': return textToHex(v);
    case 'hex_decode': return hexToText(v);
    case 'qr_code': return `https://api.qrserver.com/v1/create-qr-code/?size=${args.size || 200}x${args.size || 200}&data=${encodeURIComponent(args.value)}`;
    case 'url_parse': { const u = new URL(args.value); return { href: u.href, protocol: u.protocol, host: u.host, hostname: u.hostname, port: u.port, pathname: u.pathname, search: u.search, hash: u.hash, origin: u.origin }; }
    case 'dns_lookup': {
      const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(args.name)}&type=${args.type || 'A'}`, { headers: { Accept: 'application/dns-json' } });
      return res.json();
    }
    case 'ip_info': { const ip = args.ip || ''; const res = await fetch(`https://ipapi.co/${ip}/json/`); return res.json(); }
    case 'celsius_to_fahrenheit': return `${(args.value * 9 / 5 + 32).toFixed(2)} °F`;
    case 'fahrenheit_to_celsius': return `${((args.value - 32) * 5 / 9).toFixed(2)} °C`;
    case 'bytes_to_human': return bytesToHuman(args.value);
    case 'human_to_bytes': return humanToBytes(args.value);
    case 'int_to_roman': return intToRoman(args.value);
    case 'roman_to_int': return romanToInt(args.value);
    case 'is_email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.value);
    case 'is_url': return /^(https?|ftp):\/\/[^\s\/$.?#].[^\s]*$/i.test(args.value);
    case 'is_ipv4': return /^(\d{1,3}\.){3}\d{1,3}$/.test(args.value) && args.value.split('.').every(n => parseInt(n) <= 255);
    case 'is_ipv6': return /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::1|::)$/i.test(args.value) || /^([0-9a-fA-F]{1,4}:)*::([0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{1,4}$/i.test(args.value);
    case 'generate_rsa_keypair': return generateRsaKeypair();
    case 'encrypt_aes': return aesEncrypt(args.value, args.key);
    case 'decrypt_aes': return aesDecrypt(args.value, args.key);
    default: throw new Error(`Outil inconnu: ${name}`);
  }
}

/* ---------- Handlers MCP ---------- */
async function initialize(id) { return jsonRpc(id, CAPABILITIES); }
async function listTools(id) { return jsonRpc(id, { tools: TOOLS }); }

async function callToolRpc(id, params, env) {
  const { name, arguments: args = {} } = params;
  try {
    const result = await callTool(name, args, env);
    const text = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
    return jsonRpc(id, { content: [{ type: 'text', text }], isError: false });
  } catch (err) {
    return jsonRpc(id, { content: [{ type: 'text', text: err.message }], isError: true });
  }
}

/* ---------- Routes ---------- */
function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}

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
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' } });
}

async function handleMessages(request, env) {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId || !sessions.has(sessionId)) return jsonResponse({ error: 'Session SSE non trouvée' }, 404);

  const body = await request.json();
  if (body.jsonrpc !== '2.0') return jsonResponse({ jsonrpc: '2.0', id: body.id, error: { code: -32600, message: 'Requête invalide' } });

  let response;
  switch (body.method) {
    case 'initialize': response = await initialize(body.id); break;
    case 'tools/list': response = await listTools(body.id); break;
    case 'tools/call': response = await callToolRpc(body.id, body.params, env); break;
    case 'notifications/initialized': return new Response(null, { status: 202 });
    default: response = { jsonrpc: '2.0', id: body.id, error: { code: -32601, message: `Méthode inconnue: ${body.method}` } };
  }
  return jsonResponse(response);
}

async function handleRoot(request) {
  const url = new URL(request.url);
  return jsonResponse({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    protocol: PROTOCOL_VERSION,
    transport: 'sse',
    tools_count: TOOLS.length,
    sessions: sessions.size,
    endpoints: { sse: `${url.origin}/sse`, messages: `${url.origin}/messages?sessionId=<sessionId>`, health: `${url.origin}/health` },
    tools: TOOLS.map(t => t.name)
  });
}

async function handleHealth() { return jsonResponse({ ok: true, tools: TOOLS.length, sessions: sessions.size }); }

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }
    try {
      switch (url.pathname) {
        case '/sse': return await handleSse(request);
        case '/messages': return await handleMessages(request, env);
        case '/health': return await handleHealth();
        case '/': return await handleRoot(request);
        default: return jsonResponse({ error: 'Not found' }, 404);
      }
    } catch (err) {
      console.error(err);
      return jsonResponse({ error: err.message }, 500);
    }
  }
};
