function validateProviderEndpoint(endpoint, { allowHttp = false, allowedHosts = [] } = {}) {
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('provider endpoint must be a valid URL'); }
  if (url.username || url.password) throw new Error('provider endpoint must not contain credentials');
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new Error('provider endpoint must use HTTPS');
  }
  if (allowedHosts.length && !allowedHosts.includes(url.hostname)) {
    throw new Error('provider endpoint host is not allowlisted');
  }
  return url.toString();
}

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
  constructor({
    endpoint,
    apiKey = null,
    fetchImpl = globalThis.fetch,
    timeoutMs = 30000,
    maxResponseBytes = 1024 * 1024,
    allowedHosts = [],
    allowHttp = false
  } = {}) {
    if (!endpoint) throw new Error('endpoint is required');
    if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) throw new Error('timeoutMs must be between 1000 and 120000');
    if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1024 || maxResponseBytes > 10 * 1024 * 1024) {
      throw new Error('maxResponseBytes must be between 1024 and 10485760');
    }
    this.endpoint = validateProviderEndpoint(endpoint, { allowHttp, allowedHosts });
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes = maxResponseBytes;
  }

  async generate({ agentRole, input }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
        },
        body: JSON.stringify({ agent_role: agentRole, input }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Provider request failed with HTTP ${response.status}`);
      const contentType = String(response.headers?.get?.('content-type') || '');
      if (!contentType.toLowerCase().includes('application/json')) throw new Error('Provider returned non-JSON content type');
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf-8') > this.maxResponseBytes) throw new Error('Provider response exceeded maximum size');
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('Provider returned invalid JSON'); }
      if (!data || typeof data.output !== 'object' || Array.isArray(data.output)) throw new Error('Provider returned invalid JSON contract');
      return data.output;
    } finally {
      clearTimeout(timer);
    }
  }
}
