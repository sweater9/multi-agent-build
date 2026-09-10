export class StaticProvider {
  constructor({ name = 'static', responses = {} } = {}) {
    this.name = name;
    this.responses = responses;
  }

  async generate({ agentRole, input }) {
    const response = this.responses[agentRole];
    if (typeof response === 'function') return response(input);
    if (response !== undefined) return structuredClone(response);
    throw new Error(`No provider response configured for role '${agentRole}'`);
  }
}

export class HttpJsonProvider {
  constructor({ endpoint, apiKey = null, fetchImpl = globalThis.fetch, timeoutMs = 30000 } = {}) {
    if (!endpoint) throw new Error('endpoint is required');
    if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async generate({ agentRole, input }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
        },
        body: JSON.stringify({ agent_role: agentRole, input }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Provider request failed with HTTP ${response.status}`);
      const data = await response.json();
      if (!data || typeof data.output !== 'object') throw new Error('Provider returned invalid JSON contract');
      return data.output;
    } finally {
      clearTimeout(timer);
    }
  }
}
