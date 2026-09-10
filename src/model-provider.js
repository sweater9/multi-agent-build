function stripJsonFence(value) {
  const text = String(value || '').trim();
  if (text.startsWith('```')) return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return text;
}

function uniqueSources(executedTools = []) {
  const seen = new Set();
  const sources = [];
  for (const tool of executedTools || []) {
    for (const item of tool?.search_results?.results || []) {
      const url = String(item?.url || '').trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      sources.push({ title: String(item?.title || url), url, snippet: String(item?.content || '').slice(0, 1000), score: Number.isFinite(Number(item?.score)) ? Number(item.score) : null });
    }
  }
  return sources.slice(0, 12);
}

const ROLE_TOKEN_BUDGETS = Object.freeze({ dynamic_planner: 650, specialist: 900, judge: 1400, dynamic_qa: 900, planner: 900, builder: 1800, qa: 900 });

export class MultiProvider {
  constructor({ providers = [] } = {}) {
    this.providers = providers.filter(Boolean);
    if (!this.providers.length) throw new Error('At least one model provider is required');
  }

  names() { return this.providers.map(provider => provider.name).filter(Boolean); }

  select(name = 'auto') {
    const choice = String(name || 'auto').trim().toLowerCase();
    if (!choice || choice === 'auto') return this;
    const aliases = {
      groq: 'groq',
      nvidia: 'nvidia-nim',
      'nvidia-nim': 'nvidia-nim',
      nim: 'nvidia-nim',
      alibaba: 'alibaba',
      dashscope: 'alibaba',
      qwen: 'alibaba',
      gemini: 'gemini',
      google: 'gemini'
    };
    const target = aliases[choice] || choice;
    const provider = this.providers.find(item => item.name === target);
    if (!provider) throw Object.assign(new Error(`Selected provider is not configured: ${choice}`), { statusCode: 400 });
    return provider;
  }

  async generate(request) {
    const failures = [];
    for (const provider of this.providers) {
      try { return await provider.generate(request); }
      catch (error) { failures.push(`${provider.name || 'provider'}: ${String(error?.message || error)}`); }
    }
    throw new Error(`All configured model providers failed (${failures.join(' | ')})`);
  }

  async research(request) {
    const failures = [];
    for (const provider of this.providers) {
      if (typeof provider.research !== 'function') continue;
      try { return await provider.research(request); }
      catch (error) { failures.push(`${provider.name || 'provider'}: ${String(error?.message || error)}`); }
    }
    throw new Error(failures.length ? `Research provider failed (${failures.join(' | ')})` : 'No configured provider supports research mode');
  }
}

export class OpenAICompatibleProvider {
  constructor({ endpoint, apiKey, model, timeoutMs = 45000, maxTokens = 4000, temperature = 0.2, name = 'provider', jsonMode = false } = {}) {
    if (!endpoint || !apiKey || !model) throw new Error(`${name} provider configuration is incomplete`);
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = Math.max(5000, Math.min(120000, Number(timeoutMs) || 45000));
    this.maxTokens = Math.max(500, Math.min(16000, Number(maxTokens) || 4000));
    this.temperature = Number.isFinite(Number(temperature)) ? Number(temperature) : 0.2;
    this.name = name;
    this.jsonMode = Boolean(jsonMode);
  }

  instruction(agentRole, input) {
    const schemas = {
      planner: 'Return ONLY valid JSON with: agent_role="System Planner", status="success", goal, steps (non-empty array), acceptance_criteria (non-empty array), risks (array). Build a concrete plan for the user request.',
      builder: 'Return ONLY valid JSON with: agent_role="Core Builder", status="success", artifacts (non-empty array), notes (array). artifacts[0] must be {"type":"final_answer","name":"answer","content":"..."}. The content must be the complete substantive answer to the original user request, not a meta-description.',
      qa: 'Return ONLY valid JSON with: agent_role="QA & Security Auditor", status, approved, findings (array), checks (object). Review the Builder output against the goal and plan.',
      dynamic_planner: 'Return ONLY valid JSON with objective (string), approach (string), specialists (array of 2-4 objects, each with name and focus). Select genuinely different experts that fit the task. Do not answer the task yet.',
      specialist: 'Return ONLY valid JSON with answer (string), key_points (array), assumptions (array), risks (array). Provide an independent substantive expert analysis from the assigned specialist perspective. If a research packet is provided, ground factual claims in it and preserve source references.',
      judge: 'Return ONLY valid JSON with answer (string), agreements (array), disagreements (array), confidence (integer 0-100), limitations (array). Compare specialist outputs and synthesize the strongest candidate answer. If sources are supplied, preserve useful citations and do not invent new ones.',
      dynamic_qa: 'Return ONLY valid JSON with approved (boolean), answer (string), findings (array), quality_score (integer 0-100). Correct the candidate where necessary and make answer the complete final response to the user. If sources were supplied, remove unsupported factual claims rather than fabricating citations.'
    };
    return `${schemas[agentRole] || 'Return ONLY valid JSON.'}\n\nINPUT:\n${JSON.stringify(input)}`;
  }

  tokenBudget(agentRole) { return Math.min(this.maxTokens, ROLE_TOKEN_BUDGETS[agentRole] || this.maxTokens); }

  async generate({ agentRole, input }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const body = { model: this.model, messages: [{ role: 'system', content: 'You are one stage in an autonomous multi-agent workflow. Follow the requested JSON contract exactly. Do not wrap JSON in markdown. Never fabricate browsing, citations, tool use, or external verification.' }, { role: 'user', content: this.instruction(agentRole, input) }], temperature: this.temperature, max_tokens: this.tokenBudget(agentRole), stream: false };
    if (this.jsonMode) body.response_format = { type: 'json_object' };
    try {
      const response = await fetch(this.endpoint, { method: 'POST', headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', accept: 'application/json' }, redirect: 'error', signal: controller.signal, body: JSON.stringify(body) });
      if (!response.ok) { const retryAfter = response.headers?.get?.('retry-after'); throw new Error(`HTTP ${response.status}${retryAfter ? ` retry-after=${retryAfter}` : ''}`); }
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('empty model response');
      let parsed;
      try { parsed = typeof content === 'string' ? JSON.parse(stripJsonFence(content)) : content; }
      catch { throw new Error('model response was not valid JSON'); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('model response was not a JSON object');
      return parsed;
    } finally { clearTimeout(timer); }
  }
}

export class GroqProvider extends OpenAICompatibleProvider {
  constructor({ apiKey, model = 'openai/gpt-oss-120b', ...rest } = {}) { super({ endpoint: 'https://api.groq.com/openai/v1/chat/completions', apiKey, model, name: 'groq', jsonMode: true, ...rest }); }
  async research({ goal }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(this.timeoutMs, 60000));
    try {
      const response = await fetch(this.endpoint, { method: 'POST', headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', accept: 'application/json', 'Groq-Model-Version': 'latest' }, redirect: 'error', signal: controller.signal, body: JSON.stringify({ model: 'groq/compound', messages: [{ role: 'system', content: 'Research the user request using real web sources. Prefer primary and authoritative sources. Distinguish verified facts from uncertainty. Keep citations in the answer.' }, { role: 'user', content: String(goal || '') }], compound_custom: { tools: { enabled_tools: ['web_search', 'visit_website'] } }, stream: false }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const message = data?.choices?.[0]?.message;
      if (!message?.content) throw new Error('empty research response');
      return { answer: String(message.content), sources: uniqueSources(message.executed_tools || []), provider: 'groq/compound' };
    } finally { clearTimeout(timer); }
  }
}

export class NvidiaNimProvider extends OpenAICompatibleProvider {
  constructor({ apiKey, model = 'meta/llama-3.1-70b-instruct', ...rest } = {}) { super({ endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', apiKey, model, name: 'nvidia-nim', jsonMode: false, ...rest }); }
}

export class AlibabaProvider extends OpenAICompatibleProvider {
  constructor({ apiKey, model = 'qwen-plus', endpoint = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', ...rest } = {}) {
    super({ endpoint, apiKey, model, name: 'alibaba', jsonMode: false, ...rest });
  }
}

export class GeminiProvider extends OpenAICompatibleProvider {
  constructor({ apiKey, model = 'gemini-3.8-flash', ...rest } = {}) {
    super({ endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', apiKey, model, name: 'gemini', jsonMode: false, ...rest });
  }
}

export function createModelProviderFromEnvironment(env = process.env) {
  const groqKey = String(env.GROQ_API_KEY || env.GROQ_KEY || '').trim();
  const nvidiaKey = String(env.NVIDIA_NIM_API_KEY || env.NVIDIA_API_KEY || env.NIM_API_KEY || '').trim();
  const alibabaKey = String(env.ALIBABA_API_KEY || env.DASHSCOPE_API_KEY || '').trim();
  const geminiKey = String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '').trim();
  const timeoutMs = Number(env.AGENT_PROVIDER_TIMEOUT_MS || 45000);
  const maxTokens = Number(env.AGENT_PROVIDER_MAX_TOKENS || 4000);
  const providers = [];
  if (groqKey) providers.push(new GroqProvider({ apiKey: groqKey, model: String(env.GROQ_MODEL || 'openai/gpt-oss-120b').trim(), timeoutMs, maxTokens }));
  if (nvidiaKey) providers.push(new NvidiaNimProvider({ apiKey: nvidiaKey, model: String(env.NVIDIA_NIM_MODEL || env.NVIDIA_MODEL || 'meta/llama-3.1-70b-instruct').trim(), timeoutMs, maxTokens }));
  if (alibabaKey) providers.push(new AlibabaProvider({ apiKey: alibabaKey, model: String(env.ALIBABA_MODEL || env.DASHSCOPE_MODEL || 'qwen-plus').trim(), endpoint: String(env.ALIBABA_ENDPOINT || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions').trim(), timeoutMs, maxTokens }));
  if (geminiKey) providers.push(new GeminiProvider({ apiKey: geminiKey, model: String(env.GEMINI_MODEL || 'gemini-3.8-flash').trim(), timeoutMs, maxTokens }));
  return providers.length ? new MultiProvider({ providers }) : null;
}
