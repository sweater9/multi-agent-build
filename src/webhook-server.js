import http from 'node:http';

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

export function createWebhookServer({ handler, path = '/webhooks/github', maxBodyBytes = 1024 * 1024 } = {}) {
  if (!handler?.handle) throw new Error('handler with handle() is required');

  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method !== 'POST' || req.url !== path) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    try {
      const rawBody = await readBody(req, maxBodyBytes);
      const result = await handler.handle({
        event: req.headers['x-github-event'],
        deliveryId: req.headers['x-github-delivery'],
        signature: req.headers['x-hub-signature-256'],
        rawBody
      });
      res.writeHead(result.status || 202, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      const status = Number(error?.statusCode) || 500;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ accepted: false, error: status === 500 ? 'internal_error' : error.message }));
    }
  });
}
