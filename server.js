// ===========================
//  Express server (Node ESM)
//  Proxy OpenAI + outils
// ===========================

import express from 'express';
import crypto from 'crypto';

const app = express();
app.use(express.json({ limit: '50mb' }));

const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_TOOL_LOOPS = 10;

const ALL_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Effectue une recherche web via Brave Search.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Requête de recherche' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Récupère une URL et retourne son texte complet (pas de clipping artificiel).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL complète' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description: 'Évalue une expression mathématique simple.',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string' }
        },
        required: ['expression']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: 'Retourne la date et l’heure actuelles.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description: 'Génère une image via DALL·E à partir d’un prompt.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string' }
        },
        required: ['prompt']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'store_memory',
      description: 'Stocke un fait en mémoire.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'string' }
        },
        required: ['key', 'value']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'recall_memory',
      description: 'Recherche dans les faits stockés en mémoire.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' }
        },
        required: ['query']
      }
    }
  }
];

const localMemory = new Map();

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

app.use((req, res, next) => {
  res.set(corsHeaders());
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

function makeId() {
  return crypto.randomUUID();
}

function cleanHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeEval(expr) {
  const tokens = expr.match(/\d+\.?\d*|\d*\.\d+|[+\-*/%^()]/g) || [];
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
    if (Number.isNaN(n)) throw new Error('Nombre invalide : ' + t);
    return n;
  }

  const result = parseExpression();
  if (pos !== tokens.length) throw new Error('Caractères non autorisés');
  return result;
}

function mergeTools(base, extra) {
  const names = new Set(base.map((t) => t.function.name));
  const out = [...base];
  for (const t of extra || []) {
    if (t?.function?.name && !names.has(t.function.name)) {
      names.add(t.function.name);
      out.push(t);
    }
  }
  return out;
}

async function storeMemory(key, value, env) {
  if (env.MEMORY_KV) await env.MEMORY_KV.put(key, value);
  else localMemory.set(key, value);
  return 'Mémorisé.';
}

async function recallMemory(query, env) {
  if (env.MEMORY_KV) {
    const list = await env.MEMORY_KV.list();
    const matches = [];
    for (const k of list.keys || []) {
      const name = k.name;
      if (name.toLowerCase().includes(query.toLowerCase())) {
        const v = await env.MEMORY_KV.get(name);
        matches.push(`${name}: ${v}`);
      }
    }
    return matches.join('\n') || 'Aucun souvenir trouvé.';
  } else {
    const matches = [];
    for (const [k, v] of localMemory) {
      if (k.toLowerCase().includes(query.toLowerCase()) ||
          v.toLowerCase().includes(query.toLowerCase())) {
        matches.push(`${k}: ${v}`);
      }
    }
    return matches.join('\n') || 'Aucun souvenir trouvé.';
  }
}

async function executeTool(name, args, env) {
  switch (name) {
    case 'web_search': {
      const key = env.BRAVE_API_KEY;
      if (!key) return 'Clé BRAVE_API_KEY non configurée.';
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(args.query)}&count=5`;
      const r = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': key
        }
      });
      const j = await r.json();
      if (!r.ok) return `Erreur recherche ${r.status}: ${JSON.stringify(j)}`;
      return (j.web?.results || [])
        .map((x) => `Titre: ${x.title}\nURL: ${x.url}\nRésumé: ${x.description}`)
        .join('\n---\n');
    }

    case 'fetch_url': {
      try {
        const r = await fetch(args.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const html = await r.text();
        let text = cleanHtml(html);
        const maxBytes = env.MAX_FETCH_BYTES ? parseInt(env.MAX_FETCH_BYTES, 10) : null;
        if (maxBytes && text.length > maxBytes) {
          text = text.slice(0, maxBytes) + '\n[truncated by MAX_FETCH_BYTES]';
        }
        return text || '[page vide]';
      } catch (e) {
        return `Erreur fetch_url: ${e.message}`;
      }
    }

    case 'calculate': {
      try {
        return String(safeEval(args.expression));
      } catch (e) {
        return `Erreur calcul: ${e.message}`;
      }
    }

    case 'get_current_time': {
      const now = new Date();
      return `UTC: ${now.toISOString()}\nLocale (FR): ${now.toLocaleString('fr-FR')}`;
    }

    case 'generate_image': {
      const base = env.OPENAI_BASE_URL
        ? env.OPENAI_BASE_URL.replace(/\/chat\/completions\/?$/, '')
        : 'https://api.openai.com/v1';
      const r = await fetch(`${base}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({ prompt: args.prompt, n: 1, size: '1024x1024' })
      });
      const j = await r.json();
      return j.data?.[0]?.url || JSON.stringify(j);
    }

    case 'store_memory':
      return await storeMemory(args.key, args.value, env);

    case 'recall_memory':
      return await recallMemory(args.query, env);

    default:
      return `Outil inconnu: ${name}`;
  }
}

async function runAgent(messages, env, body) {
  const model = body.model || env.OPENAI_MODEL || DEFAULT_MODEL;
  const tool_choice = body.tool_choice ?? 'auto';
  const tools = tool_choice === 'none' ? undefined : mergeTools(ALL_TOOLS, body.tools);

  const currentMessages = [...(messages || [])];

  for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
    const payload = {
      model,
      messages: currentMessages,
      temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
      ...(tools && { tools }),
      ...(tools && { tool_choice })
    };

    const res = await fetch(env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${txt}`);
    }

    const data = await res.json();
    if (!data.choices?.[0]) throw new Error('Réponse OpenAI invalide');

    const choice = data.choices[0];
    const message = choice.message;

    if (choice.finish_reason === 'tool_calls' || message?.tool_calls?.length) {
      currentMessages.push({
        role: 'assistant',
        content: message.content || '',
        tool_calls: message.tool_calls
      });
      for (const tc of message.tool_calls) {
        let args = tc.function.arguments;
        if (typeof args === 'string') args = JSON.parse(args);
        const result = await executeTool(tc.function.name, args, env);
        currentMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: String(result)
        });
      }
      continue;
    }

    return message;
  }

  return { role: 'assistant', content: "Trop d'appels d'outils successifs." };
}

function buildJSONResponse(message, model) {
  return {
    id: 'chatcmpl-' + makeId(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  };
}

function buildSSEStream(message, model) {
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const id = 'chatcmpl-' + makeId();
      const created = Math.floor(Date.now() / 1000);

      const words = (message.content || '').split(/(\s+)/).filter(Boolean);
      for (const word of words) {
        const chunk = {
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: { content: word }, finish_reason: null }]
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }

      const stop = {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(stop)}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    }
  });
}

app.get('/', (req, res) => {
  res.json({ ok: true, tools: ALL_TOOLS.map((t) => t.function.name) });
});

app.post('/v1/chat/completions', async (req, res) => {
  try {
    const body = req.body;
    const model = body.model || process.env.OPENAI_MODEL || DEFAULT_MODEL;
    const finalMessage = await runAgent(body.messages, process.env, body);

    if (body.stream) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const reader = buildSSEStream(finalMessage, model).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      return res.end();
    }

    return res.json(buildJSONResponse(finalMessage, model));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Express server running on port ${PORT}`));
