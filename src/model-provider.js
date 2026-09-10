function stripJsonFence(value) {
  const text = String(value || '').trim();
  if (text.startsWith('```')) return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return text;
}

export class MultiProvider {
  constructor({ providers = [] } = {}) {
    this.providers = providers.filter(Boolean);
    if (!this.providers.length) throw new Error('At least one model provider is required');
  }

  async generate(request) {
    const failures = [];
    for (const provider of this.providers) {
      try { return await provider.generate(request); }
      catch (error) { failures.push(`${provider.name || 'provider'}: ${String(error?.message || error)}`); }
    }
    throw new Error(`All configured model providers failed (${failures.join(' | ')})`);
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
      qa: 'Return ONLY valid JSON with: agent_role="QA & Security Auditor", status, approved, findings (array), checks (object). Review the Builder output against the goal and plan. If acceptable, approved=true,status="success",findings=[]. If material issues exist, approved=false,status="blocked" and findings must be actionable.'
    };
    return `${schemas[agentRole] || 'Return ONLY valid JSON.'}\n\nINPUT:\n${JSON.stringify(input)}`;
  }

  async generate({ agentRole, input }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: 'You are one stage in an autonomous multi-agent workflow. Follow the requested JSON contract exactly. Do not wrap JSON in markdown.' },
        { role: 'user', content: this.instruction(agentRole, input) }
      ],
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      stream: false
    };
    if (this.jsonMode) body.response_format = { type: 'json_object' };

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
        redirect: 'error',
        signal: controller.signal,
        body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
  constructor({ apiKey, model = 'openai/gpt-oss-120b', ...rest } = {}) {
    super({ endpoint: 'https://api.groq.com/openai/v1/chat/completions', apiKey, model, name: 'groq', jsonMode: true, ...rest });
  }
}

export class NvidiaNimProvider extends OpenAICompatibleProvider {
  constructor({ apiKey, model = 'meta/llama-3.1-70b-instruct', ...rest } = {}) {
    super({ endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', apiKey, model, name: 'nvidia-nim', jsonMode: false, ...rest });
  }
}

export function createModelProviderFromEnvironment(env = process.env) {
  const groqKey = String(env.GROQ_API_KEY || env.GROQ_KEY || '').trim();
  const nvidiaKey = String(env.NVIDIA_NIM_API_KEY || env.NVIDIA_API_KEY || env.NIM_API_KEY || '').trim();
  const providers = [];
  if (groqKey) providers.push(new GroqProvider({ apiKey: groqKey, model: String(env.GROQ_MODEL || 'openai/gpt-oss-120b').trim(), timeoutMs: Number(env.AGENT_PROVIDER_TIMEOUT_MS || 45000), maxTokens: Number(env.AGENT_PROVIDER_MAX_TOKENS || 4000) }));
  if (nvidiaKey) providers.push(new NvidiaNimProvider({ apiKey: nvidiaKey, model: String(env.NVIDIA_NIM_MODEL || env.NVIDIA_MODEL || 'meta/llama-3.1-70b-instruct').trim(), timeoutMs: Number(env.AGENT_PROVIDER_TIMEOUT_MS || 45000), maxTokens: Number(env.AGENT_PROVIDER_MAX_TOKENS || 4000) }));
  return providers.length ? new MultiProvider({ providers }) : null;
}
