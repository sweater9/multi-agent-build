export class MultiProvider {
  constructor({ providers = [] } = {}) {
    this.providers = providers.filter(Boolean);
    if (!this.providers.length) throw new Error('At least one provider is required');
  }
  async generate(request) {
    const errors = [];
    for (const provider of this.providers) {
      try { return await provider.generate(request); }
      catch (error) { errors.push(String(error?.message || error)); }
    }
    throw new Error(`All providers failed: ${errors.join(' | ')}`);
  }
}

class OpenAICompatibleProvider {
  constructor({ endpoint, apiKey, model, timeoutMs = 30000, maxTokens = 3000, temperature = 0.2, name = 'provider' } = {}) {
    if (!endpoint || !apiKey || !model) throw new Error(`${name} provider configuration is incomplete`);
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.maxTokens = maxTokens;
    this.temperature = temperature;
    this.name = name;
  }

  promptFor(agentRole, input) {
    const roleInstructions = {
      planner: 'Return strict JSON for a planning agent with keys: agent_role, status, goal, steps, acceptance_criteria, risks. agent_role must be System Planner. status must be success.',
      builder: 'Return strict JSON for a builder agent with keys: agent_role, status, artifacts, notes. agent_role must be Core Builder. status must be success. artifacts must contain at least one object with type final_answer, name answer, and content containing the complete user-facing answer.',
      qa: 'Return strict JSON for a QA agent with keys: agent_role, status, approved, findings, checks. agent_role must be QA & Security Auditor. If the answer is acceptable set approved true, status success, findings []. Otherwise approved false, status blocked and provide actionable findings.'
    };
    return `${roleInstructions[agentRole] || 'Return strict JSON.'}\n\nINPUT:\n${JSON.stringify(input)}`;
  }

  async generate({ agentRole, input }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
        redirect: 'error',
        signal: controller.signal,
        body: JSON.stringify({ model: this.model, messages: [
          { role: 'system', content: 'You are part of a multi-agent workflow. Follow the requested JSON schema exactly. Do not wrap JSON in markdown.' },
          { role: 'user', content: this.promptFor(agentRole, input) }
        ], temperature: this.temperature, max_tokens: this.maxTokens, response_format: { type: 'json_object' } })
      });
      if (!response.ok) throw new Error(`${this.name} returned HTTP ${response.status}`);
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error(`${this.name} returned no content`);
      const parsed = typeof content === 'string' ? JSON.parse(content) : content;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${this.name} returned invalid JSON`);
      return parsed;
    } finally { clearTimeout(timer); }
  }
}

export class GroqProvider extends OpenAICompatibleProvider {
  constructor({ apiKey, model = 'openai/gpt-oss-120b', ...rest } = {}) {
    super({ endpoint: 'https://api.groq.com/openai/v1/chat/completions', apiKey, model, name: 'groq', ...rest });
  }
}

export class NvidiaNimProvider extends OpenAICompatibleProvider {
  constructor({ apiKey, model = 'meta/llama-3.1-70b-instruct', ...rest } = {}) {
    super({ endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', apiKey, model, name: 'nvidia-nim', ...rest });
  }
}
