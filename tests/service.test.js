import test from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../src/service.js';

async function withServer(options, fn) {
  const server = createService(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try { await fn(`http://127.0.0.1:${port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

function fixture() {
  const runs = new Map();
  const stateStore = {
    async load(id) {
      if (!runs.has(id)) throw new Error('Workflow run not found');
      return runs.get(id);
    }
  };
  const orchestrator = {
    async execute(goal) {
      const run = { workflow_run_id: 'abc-123', workflow_status: 'completed', goal };
      runs.set(run.workflow_run_id, run);
      return run;
    },
    async resume(id) {
      if (!runs.has(id)) throw new Error('Workflow run not found');
      return { ...runs.get(id), resumed: true };
    }
  };
  return { orchestrator, stateStore };
}

test('health and readiness are public', async () => {
  const runtime = fixture();
  await withServer({ ...runtime, apiKey: 'x'.repeat(24), readinessCheck: async () => ({ ok: true, mode: 'test' }) }, async (base) => {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    const ready = await fetch(`${base}/ready`);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).mode, 'test');
  });
});

test('workflow APIs require bearer authentication', async () => {
  const runtime = fixture();
  await withServer({ ...runtime, apiKey: 'secret-key-12345678901234' }, async (base) => {
    const response = await fetch(`${base}/api/workflows`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'test' }) });
    assert.equal(response.status, 401);
  });
});

test('authenticated workflow can be started and fetched', async () => {
  const runtime = fixture();
  const key = 'secret-key-12345678901234';
  await withServer({ ...runtime, apiKey: key }, async (base) => {
    const started = await fetch(`${base}/api/workflows`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'Build safely' })
    });
    assert.equal(started.status, 202);
    const run = await started.json();
    const fetched = await fetch(`${base}/api/workflows/${run.workflow_run_id}`, { headers: { authorization: `Bearer ${key}` } });
    assert.equal(fetched.status, 200);
    assert.equal((await fetched.json()).goal, 'Build safely');
  });
});

test('webhook endpoint is isolated from API bearer auth', async () => {
  const runtime = fixture();
  const webhookHandler = { async handle() { return { accepted: true, status: 202 }; } };
  await withServer({ ...runtime, apiKey: 'x'.repeat(24), webhookHandler }, async (base) => {
    const response = await fetch(`${base}/webhooks/github`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).accepted, true);
  });
});
