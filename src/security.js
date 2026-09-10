const SECRET_PATTERNS = [
  /(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g
];

export function redactSecrets(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return SECRET_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, '[REDACTED]'), text);
}

export class ToolGateway {
  constructor({ allowlist = {}, handlers = {} } = {}) {
    this.allowlist = allowlist;
    this.handlers = handlers;
  }

  async invoke(agentRole, toolName, input = {}) {
    const allowed = this.allowlist[agentRole] || [];
    if (!allowed.includes(toolName)) {
      throw new Error(`Tool '${toolName}' is not allowed for role '${agentRole}'`);
    }
    const handler = this.handlers[toolName];
    if (typeof handler !== 'function') {
      throw new Error(`No handler registered for tool '${toolName}'`);
    }
    return handler(input);
  }
}

export function hasBlockingFinding(findings = []) {
  return findings.some((finding) => ['critical', 'high'].includes(String(finding.severity).toLowerCase()));
}
