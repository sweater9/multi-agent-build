import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { GitHubWorkflowEventHandler } from '../src/webhook.js';
import { MemoryStateStore } from '../src/state-store.js';

function sign(secret, body) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

function payload(status = 'completed') {
  return JSON.stringify({
    repository: { full_name: 'owner/repo' },
    workflow_run: { id: 123, status, conclusion: status === 'completed' ? 'success' : null, head_branch: 'feature/agent-build' }
  });
}

test('rejects invalid signature', async () => {
  const store = new MemoryStateStore();
  const handler = new GitHubWorkflowEventHandler({ orchestrator: { resume: async () => ({}) }, stateStore: store, webhookSecret: 'secret' });
  const result = await handler.handle({ event: 'workflow_run', deliveryId: 'd1', signature: 'sha256=bad', rawBody: payload() });
  assert.equal(result.status, 401);
});

test('resumes matching awaiting workflow exactly once per delivery', async () => {
  const store = new MemoryStateStore();
  await store.save({
    workflow_run_id: 'abc-123',
    state: 'awaiting_ci',
    delivery: { target: { repository: 'owner/repo', branch: 'feature/agent-build', base: 'main' } }
  });
  let calls = 0;
  const handler = new GitHubWorkflowEventHandler({
    stateStore: store,
    webhookSecret: 'secret',
    orchestrator: { resume: async (id) => { calls += 1; return { workflow_run_id: id, workflow_status: 'completed', final_synthesized_result: { ready_for_merge: true } }; } }
  });
  const body = payload();
  const input = { event: 'workflow_run', deliveryId: 'd2', signature: sign('secret', body), rawBody: body };
  const first = await handler.handle(input);
  const second = await handler.handle(input);
  assert.equal(first.accepted, true);
  assert.equal(first.resumed_workflows[0].ready_for_merge, true);
  assert.equal(calls, 1);
  assert.equal(second.reason, 'duplicate_delivery');
});

test('ignores completed workflow with no matching awaiting run', async () => {
  const store = new MemoryStateStore();
  const body = payload();
  const handler = new GitHubWorkflowEventHandler({ orchestrator: { resume: async () => { throw new Error('should not run'); } }, stateStore: store, webhookSecret: 'secret' });
  const result = await handler.handle({ event: 'workflow_run', deliveryId: 'd3', signature: sign('secret', body), rawBody: body });
  assert.equal(result.reason, 'no_matching_workflow');
});

test('ignores workflow events until GitHub marks them completed', async () => {
  const store = new MemoryStateStore();
  const body = payload('in_progress');
  const handler = new GitHubWorkflowEventHandler({ orchestrator: { resume: async () => { throw new Error('should not run'); } }, stateStore: store, webhookSecret: 'secret' });
  const result = await handler.handle({ event: 'workflow_run', deliveryId: 'd4', signature: sign('secret', body), rawBody: body });
  assert.equal(result.reason, 'workflow_not_completed');
});
