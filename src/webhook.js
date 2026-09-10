import crypto from 'node:crypto';

function timingSafeEqualHex(a, b) {
  const left = Buffer.from(String(a || ''), 'hex');
  const right = Buffer.from(String(b || ''), 'hex');
  if (left.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function verifyGitHubSignature({ secret, rawBody, signature }) {
  if (!secret) throw new Error('Webhook secret is required');
  if (typeof rawBody !== 'string' && !Buffer.isBuffer(rawBody)) throw new Error('rawBody is required');
  const supplied = String(signature || '').replace(/^sha256=/, '');
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return timingSafeEqualHex(expected, supplied);
}

export class ReplayGuard {
  constructor({ ttlMs = 15 * 60 * 1000, clock = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.clock = clock;
    this.seen = new Map();
  }

  consume(deliveryId) {
    if (!deliveryId) throw new Error('GitHub delivery id is required');
    const now = this.clock();
    for (const [id, expiresAt] of this.seen.entries()) if (expiresAt <= now) this.seen.delete(id);
    if (this.seen.has(deliveryId)) return false;
    this.seen.set(deliveryId, now + this.ttlMs);
    return true;
  }
}

export class GitHubWorkflowEventHandler {
  constructor({ resumeResolver, webhookSecret, replayGuard = new ReplayGuard() } = {}) {
    if (typeof resumeResolver !== 'function') throw new Error('resumeResolver is required');
    if (!webhookSecret) throw new Error('webhookSecret is required');
    this.resumeResolver = resumeResolver;
    this.webhookSecret = webhookSecret;
    this.replayGuard = replayGuard;
  }

  async handle({ event, deliveryId, signature, rawBody }) {
    if (!verifyGitHubSignature({ secret: this.webhookSecret, rawBody, signature })) {
      return { accepted: false, status: 401, reason: 'invalid_signature' };
    }
    if (!this.replayGuard.consume(deliveryId)) {
      return { accepted: false, status: 202, reason: 'duplicate_delivery' };
    }
    if (event !== 'workflow_run') return { accepted: false, status: 202, reason: 'event_ignored' };

    let payload;
    try {
      payload = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf-8') : rawBody);
    } catch {
      return { accepted: false, status: 400, reason: 'invalid_json' };
    }

    const workflowRun = payload?.workflow_run;
    if (!workflowRun || workflowRun.status !== 'completed') {
      return { accepted: false, status: 202, reason: 'workflow_not_completed' };
    }

    const repository = payload?.repository?.full_name;
    const headBranch = workflowRun.head_branch;
    if (!repository || !headBranch) return { accepted: false, status: 400, reason: 'missing_repository_context' };

    const result = await this.resumeResolver({ repository, branch: headBranch, workflowRun });
    return { accepted: true, status: 202, repository, head_branch: headBranch, result };
  }
}
