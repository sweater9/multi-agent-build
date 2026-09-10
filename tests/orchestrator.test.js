import test from 'node:test';
import assert from 'node:assert/strict';
import { PlannerAgent, BuilderAgent, QaAgent } from '../src/agents.js';
import { Orchestrator } from '../src/orchestrator.js';
import { ToolGateway, redactSecrets } from '../src/security.js';

function makeRuntime(overrides = {}) {
  return new Orchestrator({
    planner: overrides.planner || new PlannerAgent(),
    builder: overrides.builder || new BuilderAgent(),
    qa: overrides.qa || new QaAgent()
  });
}

test('completes planner -> builder -> qa workflow', async () => {
  const result = await makeRuntime().execute('Build a secure cloud service');
  assert.equal(result.workflow_status, 'completed');
  assert.equal(result.final_synthesized_result.approved, true);
  assert.deepEqual(result.audit_events.map((e) => e.state), [
    'received', 'planning', 'building', 'qa_review', 'completed'
  ]);
});

test('QA can block release', async () => {
  const qa = {
    async run() {
      return {
        agent_id: 'qa_test',
        agent_role: 'QA & Security Auditor',
        status: 'blocked',
        approved: false,
        findings: [{ severity: 'high', code: 'TEST_BLOCK', message: 'Blocking test finding' }]
      };
    }
  };
  const result = await makeRuntime({ qa }).execute('Build something');
  assert.equal(result.workflow_status, 'blocked');
  assert.equal(result.final_synthesized_result.approved, false);
});

test('invalid builder output fails closed', async () => {
  const builder = { async run() { return { artifacts: 'not-an-array', notes: [] }; } };
  const result = await makeRuntime({ builder }).execute('Build something');
  assert.equal(result.workflow_status, 'failed');
  assert.equal(result.final_synthesized_result.approved, false);
});

test('tool gateway enforces role allowlist', async () => {
  const gateway = new ToolGateway({
    allowlist: { builder: ['echo'] },
    handlers: { echo: async ({ value }) => value }
  });
  assert.equal(await gateway.invoke('builder', 'echo', { value: 'ok' }), 'ok');
  await assert.rejects(() => gateway.invoke('planner', 'echo', { value: 'no' }), /not allowed/);
});

test('secret redaction removes common inline credentials', () => {
  const output = redactSecrets('api_key=supersecret password:hunter2');
  assert.equal(output.includes('supersecret'), false);
  assert.equal(output.includes('hunter2'), false);
});
