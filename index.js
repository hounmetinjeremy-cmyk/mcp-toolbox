// ===========================
//  Cloudflare Worker — MCP Server
//  Transport: SSE
// ===========================

import { randomUUID } from 'node:crypto';

/* ---------- Configuration ---------- */
const SERVER_NAME = 'mcp-toolbox';
const SERVER_VERSION = '2.0.0';
const PROTOCOL_VERSION = '2024-11-05';

/* ---------- Sessions SSE ---------- */
const sessions = new Map(); // sessionId -> controller

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

/* ---------- Tools ---------- */
const TOOLS = [
  {
    name: 'base64_encode',
    description: 'Encode une chaîne en base64.',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value']
    }
  },
  {
    name: 'base64_decode',
    description: 'Décode une chaîne base64.',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value']
    }
  },
  {
    name: 'url_encode',
    description: 'URL-encode une chaîne.',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value']
    }
  },
  {
    name: 'url_decode',
    description: 'URL-decode une chaîne.',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value']
    }
  },
  {
    name: 'html_escape',
    description: 'Échappe les caractères HTML.',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value']
    }
  },
  {
    name: 'html_unescape',
    description: 'Déséchappe les entités HTML.',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value']
    }
  },
  {
    name: 'hash_md5',
    description: 'Hash MD5.',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value']
    }
  },
  {
    name: 'hash_sha256',
    description: 'Hash SHA-256.',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value']
    }
  },
  {
    name: 'hash_sha512',
    description: 'Hash SHA-512.',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value']
    }
  },
  {
    name: 'hmac_sha256',
    description: 'HMAC SHA-256.',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string' }, value: { type: 'string' } },
      required: ['key', 'value']
    }
  },
  {
    name: 'uuid',
    description: 'Génère un UUID v4.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'timestamp',
    description: 'Timestamp Unix actuel.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'datetime',
    description: 'Date/heure actuelle ISO + locale.',
    inputSchema: {
      type: 'object',
      properties: { timezone: { type: 'string', description: 'ex: Europe/Paris' } }
    }
  },
  {
    name: 'random_string',
    description: 'Chaîne aléatoire.',
    inputSchema: {
      type: 'object',
      properties: { length: { type: 'integer', default: 16 }, charset: { type: 'string' } }
    }
  },
  {
    name: 'random_number',
    description: 'Nombre entier aléatoire.',
    inputSchema: {
      type: 'object',
      properties: { min: { type: 'number', default: 0 }, max: { type: 'number', default: 100 } },
      required: ['min', 'max']
    }
  },
  {
    name: 'generate_password',
    description: 'Mot de passe sécurisé.',
    inputSchema: { type: 'object', properties: { length: { type: 'integer', default: 16 } } }
  },
  {
    name: 'calculate',
    description: 'Expression mathématique.',
    inputSchema: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] }
  },
  {
    name: 'regex_match',
    description: 'Teste une regex.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' }, pattern: { type: 'string' }, flags: { type: 'string', default: 'g' } },
      required: ['text', 'pattern']
    }
  },
  {
    name: 'regex_replace',
    description: 'Remplace par regex.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' }, pattern: { type: 'string' },
        replacement: { type: 'string' }, flags: { type: 'string', default: 'g' }
      },
      required: ['text', 'pattern', 'replacement']
    }
  },
  {
    name: 'json_parse',
    description: 'Parse et formate un JSON.',
    inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] }
  },
  {
    name: 'json_minify',
    description: 'Minifie un JSON.',
    inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] }
  },
  {
    name: 'jwt_decode',
    description: 'Décode un JWT (sans vérifier la signature).',
    inputSchema: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'] }
  },
  {
    name: 'count_words',
    description: 'Compte mots, caractères, lignes.',
    inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] }
  },
  {
    name: 'convert_case',
    description: 'Change la casse.',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string' },
        to: { type: 'string', enum: ['upper', 'lower', 'title', 'camel', 'snake'], default: 'upper' }
      },
      required: ['value', 'to']
    }
  },
  {
    name: 'slugify',
    description: 'Transforme un texte en slug.',
    inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] }
  },
  {
    name: 'csv_to_json',
    description: 'CSV simple vers JSON.',
    inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] }
  },
  {
    name: 'lorem_ipsum',
    description: 'Génère du Lorem ipsum.',
    inputSchema: { type: 'object', properties: { words: { type: 'integer', default: 30 } } }
  },
  {
    name: 'diff_text',
    description: 'Diff ligne par ligne.',
    inputSchema: {
      type: 'object',
      properties: { before: { type: 'string' }, after: { type: 'string' } },
      required: ['before', 'after']
    }
  }
];

const CAPABILITIES = {
  protocolVersion: PROTOCOL_VERSION,
  capabilities: {
    logging: {},
    tools: { listChanged: false }
  },
  serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
};

/* ---------- Appel des outils ---------- */
async function callTool(name, args) {
  const v = args.value;

  switch (name) {
    case 'base64_encode':
      return btoa(v);

    case 'base64_decode':
      return atob(v);

    case 'url_encode':
      return encodeURIComponent(v);

    case 'url_decode':
      return decodeURIComponent(v);

    case 'html_escape':
      return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    case 'html_unescape':
      return v.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
              .replace(/&amp;/g, '&').replace(/&#39;/g, "'");

    case 'hash_md5':
      return createHash('MD5', v);

    case 'hash_sha256':
      return createHash('SHA-256', v);

    case 'hash_sha512':
      return createHash('SHA-512', v);

    case 'hmac_sha256':
      return hmacSha256(args.key, v);

    case 'uuid':
      return randomUUID();

    case 'timestamp':
      return Math.floor(Date.now() / 1000);

    case 'datetime': {
      const now = new Date();
      return {
        iso: now.toISOString(),
        unix: Math.floor(now / 1000),
        local: now.toLocaleString('fr-FR', { timeZone: args.timezone || 'UTC' })
      };
    }

    case 'random_string':
      return randomString(args.length || 16, args.charset);

    case 'random_number': {
      const min = Number(args.min);
      const max = Number(args.max);
      if (min >= max) throw new Error('min doit être inférieur à max');
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    case 'generate_password': {
      const len = args.length || 16;
      const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
      return randomString(len, charset);
    }

    case 'calculate':
      return String(safeEval(args.expression));

    case 'regex_match': {
      const re = new RegExp(args.pattern, args.flags || 'g');
      const matches = String(args.text).match(re);
      return matches || [];
    }

    case 'regex_replace': {
      const re = new RegExp(args.pattern, args.flags || 'g');
      return String(args.text).replace(re, args.replacement);
    }

    case 'json_parse': {
      const obj = JSON.parse(v);
      return JSON.stringify(obj, null, 2);
    }

    case 'json_minify': {
      const obj = JSON.parse(v);
      return JSON.stringify(obj);
    }

    case 'jwt_decode': {
      const parts = args.token.split('.');
      if (parts.length !== 3) throw new Error('JWT invalide');
      const header = JSON.parse(atob(parts[0]));
      const payload = JSON.parse(atob(parts[1]));
      return { header, payload };
    }

    case 'count_words':
      return {
        chars: v.length,
        chars_no_space: v.replace(/\s/g, '').length,
        words: v.trim().split(/\s+/).filter(Boolean).length,
        lines: v.split(/\r?\n/).length
      };

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

    case 'slugify':
      return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

    case 'csv_to_json': {
      const lines = v.trim().split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) throw new Error('CSV invalide');
      const headers = lines[0].split(',').map(h => h.trim());
      return lines.slice(1).map(line => {
        const values = line.split(',');
        const obj = {};
        headers.forEach((h, i) => obj[h] = values[i] !== undefined ? values[i].trim() : '');
        return obj;
      });
    }

    case 'lorem_ipsum':
      return lorem(args.words || 30);

    case 'diff_text': {
      const a = args.before.split(/\r?\n/);
      const b = args.after.split(/\r?\n/);
      const out = [];
      const max = Math.max(a.length, b.length);
      for (let i = 0; i < max; i++) {
        if (a[i] === b[i]) out.push(`  ${a[i] ?? ''}`);
        else {
          if (a[i] !== undefined) out.push(`- ${a[i]}`);
          if (b[i] !== undefined) out.push(`+ ${b[i]}`);
        }
      }
      return out.join('\n');
    }

    default:
      throw new Error(`Outil inconnu: ${name}`);
  }
}

/* ---------- Handlers MCP ---------- */
async function initialize(id) {
  return jsonRpc(id, CAPABILITIES);
}

async function listTools(id) {
  return jsonRpc(id, { tools: TOOLS });
}

async function callToolRpc(id, params) {
  const { name, arguments: args = {} } = params;
  try {
    const result = await callTool(name, args);
    const text = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
    return jsonRpc(id, {
      content: [{ type: 'text', text }],
      isError: false
    });
  } catch (err) {
    return jsonRpc(id, {
      content: [{ type: 'text', text: err.message }],
      isError: true
    });
  }
}

/* ---------- Routes ---------- */
function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

async function handleSse(request) {
  const sessionId = randomUUID();
  const stream = new ReadableStream({
    start(controller) {
      sessions.set(sessionId, controller);
      sendEvent(controller, 'endpoint', { sessionId });
      sendEvent(controller, 'message', { jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    },
    cancel() {
      sessions.delete(sessionId);
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

async function handleMessages(request) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId || !sessions.has(sessionId)) {
    return jsonResponse({ error: 'Session SSE non trouvée' }, 404);
  }

  const body = await request.json();

  if (body.jsonrpc !== '2.0') {
    return jsonResponse({ jsonrpc: '2.0', id: body.id, error: { code: -32600, message: 'Requête invalide' } });
  }

  let response;
  switch (body.method) {
    case 'initialize':
      response = await initialize(body.id);
      break;
    case 'tools/list':
      response = await listTools(body.id);
      break;
    case 'tools/call':
      response = await callToolRpc(body.id, body.params);
      break;
    case 'notifications/initialized':
      return new Response(null, { status: 202 });
    default:
      response = { jsonrpc: '2.0', id: body.id, error: { code: -32601, message: `Méthode inconnue: ${body.method}` } };
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
    session_count: sessions.size,
    endpoints: {
      sse: `${url.origin}/sse`,
      messages: `${url.origin}/messages?sessionId=<sessionId>`
    },
    tools: TOOLS.map(t => t.name)
  });
}

async function handleHealth() {
  return jsonResponse({ ok: true, tools: TOOLS.length, sessions: sessions.size });
}

/* ---------- Export Worker ---------- */
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
        case '/messages': return await handleMessages(request);
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