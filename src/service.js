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

function html(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer'
  });
  res.end(body);
}

function landingPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Multi-Agent Build</title>
  <style>
    :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0b1020;color:#eef2ff;min-height:100vh;display:grid;place-items:center;padding:32px}.card{width:min(760px,100%);background:#121a2f;border:1px solid #293453;border-radius:22px;padding:34px;box-shadow:0 24px 70px rgba(0,0,0,.28)}.eyebrow{font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;color:#93c5fd;font-weight:700}.status{display:inline-flex;align-items:center;gap:9px;margin-top:18px;padding:8px 12px;border-radius:999px;background:#10281e;color:#86efac;font-weight:700;font-size:.9rem}.dot{width:9px;height:9px;border-radius:50%;background:#22c55e}h1{font-size:clamp(2rem,5vw,3.4rem);line-height:1.02;margin:18px 0 12px}p{color:#cbd5e1;line-height:1.7;font-size:1.03rem}.flow{margin-top:24px;padding:18px;border-radius:14px;background:#0d1528;border:1px solid #25304d;color:#bfdbfe;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9rem;overflow-wrap:anywhere}.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:24px}.meta div{padding:15px;border-radius:12px;background:#0d1528;border:1px solid #25304d}.meta strong{display:block;color:#f8fafc;margin-bottom:5px}.meta span{color:#94a3b8;font-size:.9rem}.note{margin-top:24px;font-size:.92rem;color:#94a3b8}
  </style>
</head>
<body>
  <main class="card">
    <div class="eyebrow">Multi-Agent Build</div>
    <div class="status"><span class="dot"></span> Service online</div>
    <h1>Secure multi-agent software delivery.</h1>
    <p>This hosted service coordinates planning, controlled building, QA, pull-request delivery, CI checks, bounded repair, and resumable workflows. Workflow APIs remain protected by bearer authentication.</p>
    <div class="flow">PLAN → BUILD → QA → PR → CI → RESUME / REPAIR → READY FOR HUMAN MERGE</div>
    <section class="meta">
      <div><strong>Health</strong><span>/health</span></div>
      <div><strong>Readiness</strong><span>/ready</span></div>
      <div><strong>Workflow API</strong><span>Authenticated</span></div>
      <div><strong>Final merge</strong><span>Human approval only</span></div>
    </section>
    <p class="note">The browser landing page is public; operational workflow endpoints remain private by design.</p>
  </main>
</body>
</html>`;
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

      if (req.method === 'GET' && url.pathname === '/') {
        return html(res, 200, landingPage());
      }

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
