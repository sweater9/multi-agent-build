import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { GitHubWorkflowEventHandler } from '../src/webhook.js';

function sign(secret, body) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

const payload = JSON.stringify({
  repository: { full_name: 'owner/repo' },
  workflow_run: { id: 123, status: 'completed', conclusion: 'success', head_branch: 'feature/agent-build' }
});

test('rejects invalid signature', async () => {
  const handler = new GitHubWorkflowEventHandler({ resumeResolver: async () => ({}), webhookSecret: 'secret' });
  const result = await handler.handle({ event: 'workflow_run', deliveryId: 'd1', signature: 'sha256=bad', rawBody: payload });
  assert.equal(result.status, 401);
});

test('accepts signed completed workflow and invokes resolver once', async () => {
  let calls = 0;
  const handler = new GitHubWorkflowEventHandler({
    webhookSecret: 'secret',
    resumeResolver: async ({ repository, branch }) => { calls += 1; return { repository, branch }; }
  });
  const input = { event: 'workflow_run', deliveryId: 'd2', signature: sign('secret', payload), rawBody: payload };
  const first = await handler.handle(input);
  const second = await handler.handle(input);
  assert.equal(first.accepted, true);
  assert.equal(first.result.repository, 'owner/repo');
  assert.equal(calls, 1);
  assert.equal(second.reason, 'duplicate_delivery');
});

test('ignores non-completed workflow events', async () => {
  const body = JSON.stringify({ repository: { full_name: 'owner/repo' }, workflow_run: { status: 'in_progress', head_branch: 'feature/agent-build' } });
  const handler = new GitHubWorkflowEventHandler({ resumeResolver: async () => { throw new Error('should not run'); }, webhookSecret: 'secret' });
  const result = await handler.handle({ event: 'workflow_run', deliveryId: 'd3', signature: sign('secret', body), rawBody: body });
  assert.equal(result.reason, 'workflow_not_completed');
});
