import crypto from 'node:crypto';
import http from 'node:http';
import { SlidingWindowRateLimiter } from './rate-limit.js';

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders
  });
  res.end(JSON.stringify(body));
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function constantTimeEqual(left, right) {
  const a = crypto.createHash('sha256').update(String(left || '')).digest();
  const b = crypto.createHash('sha256').update(String(right || '')).digest();
  return crypto.timingSafeEqual(a, b);
}

function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function isAuthorized(req, apiKey) {
  if (!apiKey) return false;
  return constantTimeEqual(bearerToken(req), apiKey);
}

function clientKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'anonymous';
}

function parseWorkflowPath(url) {
  const match = /^\/api\/workflows\/([a-f0-9-]+)(?:\/(resume))?$/i.exec(url || '');
  return match ? { id: match[1], action: match[2] || null } : null;
}

export function createService({
  orchestrator,
  stateStore,
  webhookHandler = null,
  apiKey,
  maxBodyBytes = 1024 * 1024,
  readinessCheck = async () => ({ ok: true }),
  rateLimiter = new SlidingWindowRateLimiter(),
  auditLog = null
} = {}) {
  if (!orchestrator?.execute || !orchestrator?.resume) throw new Error('orchestrator with execute() and resume() is required');
  if (!stateStore?.load) throw new Error('stateStore with load() is required');
  if (!apiKey) throw new Error('API key is required');

  const audit = async (event) => {
    try { await auditLog?.append?.(event); } catch { /* audit failure must not expose internals to clients */ }
  };

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/health') {
        return json(res, 200, { ok: true, service: 'multi-agent-build' });
      }

      if (req.method === 'GET' && url.pathname === '/ready') {
        try {
          const readiness = await readinessCheck();
          return json(res, readiness?.ok ? 200 : 503, readiness || { ok: false });
        } catch {
          return json(res, 503, { ok: false, error: 'not_ready' });
        }
      }

      if (req.method === 'POST' && url.pathname === '/webhooks/github') {
        if (!webhookHandler?.handle) return json(res, 503, { accepted: false, error: 'webhook_not_configured' });
        const rawBody = await readBody(req, maxBodyBytes);
        const result = await webhookHandler.handle({
          event: req.headers['x-github-event'],
          deliveryId: req.headers['x-github-delivery'],
          signature: req.headers['x-hub-signature-256'],
          rawBody
        });
        await audit({ type: 'github_webhook', accepted: Boolean(result.accepted), status: result.status || 202, reason: result.reason || null });
        return json(res, result.status || 202, result);
      }

      const rate = rateLimiter.check(clientKey(req));
      if (!rate.allowed) {
        await audit({ type: 'rate_limited', path: url.pathname, method: req.method });
        return json(res, 429, { error: 'rate_limited' }, { 'retry-after': String(Math.ceil(rate.retryAfterMs / 1000)) });
      }

      if (!isAuthorized(req, apiKey)) {
        await audit({ type: 'auth_failed', path: url.pathname, method: req.method });
        return json(res, 401, { error: 'unauthorized' });
      }

      if (req.method === 'POST' && url.pathname === '/api/workflows') {
        const raw = await readBody(req, maxBodyBytes);
        let payload;
        try { payload = JSON.parse(raw.toString('utf-8')); } catch { return json(res, 400, { error: 'invalid_json' }); }
        if (typeof payload?.goal !== 'string' || !payload.goal.trim()) return json(res, 400, { error: 'goal_required' });
        if (payload.goal.length > 10000) return json(res, 413, { error: 'goal_too_large' });
        const run = await orchestrator.execute(payload.goal.trim());
        await audit({ type: 'workflow_started', workflow_run_id: run.workflow_run_id, workflow_status: run.workflow_status });
        return json(res, 202, run);
      }

      const workflowPath = parseWorkflowPath(url.pathname);
      if (workflowPath && req.method === 'GET' && !workflowPath.action) {
        try {
          const run = await stateStore.load(workflowPath.id);
          return json(res, 200, run);
        } catch {
          return json(res, 404, { error: 'workflow_not_found' });
        }
      }

      if (workflowPath && req.method === 'POST' && workflowPath.action === 'resume') {
        try {
          const run = await orchestrator.resume(workflowPath.id);
          await audit({ type: 'workflow_resumed', workflow_run_id: run.workflow_run_id, workflow_status: run.workflow_status });
          return json(res, 202, run);
        } catch (error) {
          const message = String(error?.message || 'resume_failed');
          const status = /not found/i.test(message) ? 404 : /awaiting_ci/i.test(message) ? 409 : 400;
          return json(res, status, { error: 'resume_failed', message });
        }
      }

      return json(res, 404, { error: 'not_found' });
    } catch (error) {
      const status = Number(error?.statusCode) || 500;
      return json(res, status, { error: status === 500 ? 'internal_error' : error.message });
    }
  });
}
