import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCiStatus, DeliveryGate } from '../src/delivery.js';
import { ToolGateway } from '../src/security.js';
import { Orchestrator } from '../src/orchestrator.js';

function approvedQa() {
  return { agent_id: 'qa', agent_role: 'QA & Security Auditor', status: 'success', approved: true, findings: [] };
}

function makeGateway(ciStatus) {
  const handlers = {
    'repo.compare': async () => ({ files: [{ filename: 'src/app.js' }], additions: 5, deletions: 1 }),
    'repo.open_pr': async () => ({ number: 12, url: 'https://example.test/pr/12' }),
    'repo.ci_status': async () => ciStatus
  };
  return new ToolGateway({ allowlist: { release: Object.keys(handlers) }, handlers });
}

test('evaluateCiStatus accepts terminal success', () => {
  assert.deepEqual(evaluateCiStatus({ status: 'completed', checks: [{ name: 'test', conclusion: 'success' }] }).ready, true);
});

test('evaluateCiStatus rejects failed check', () => {
  const result = evaluateCiStatus({ status: 'completed', checks: [{ name: 'test', conclusion: 'failure' }] });
  assert.equal(result.ready, false);
  assert.equal(result.pending, false);
  assert.equal(result.findings[0].code, 'CI_CHECK_FAILED');
});

test('evaluateCiStatus preserves pending state', () => {
  const result = evaluateCiStatus({ status: 'in_progress', checks: [] });
  assert.equal(result.ready, false);
  assert.equal(result.pending, true);
});

test('delivery gate opens PR only after approved QA and reviewable diff', async () => {
  const gate = new DeliveryGate({
    toolGateway: makeGateway({ status: 'completed', checks: [{ name: 'test', conclusion: 'success' }] }),
    repositoryTarget: { repository: 'owner/repo', base: 'main', branch: 'feature/agent-build' }
  });
  const result = await gate.review({ qa: approvedQa() });
  assert.equal(result.ready, true);
  assert.equal(result.pull_request.number, 12);
  assert.equal(result.diff_summary.files_changed, 1);
});

test('orchestrator returns awaiting_ci when CI is pending', async () => {
  const planner = { async run() { return { steps: ['build'], acceptance_criteria: ['passes'] }; } };
  const builder = { async run() { return { artifacts: [{ name: 'x' }], notes: [] }; } };
  const qa = { async run() { return approvedQa(); } };
  const deliveryGate = { async review() { return { ready: false, pending: true, pull_request: { number: 1 }, ci_status: { status: 'queued' }, findings: [] }; } };
  const result = await new Orchestrator({ planner, builder, qa, deliveryGate }).execute('ship change');
  assert.equal(result.workflow_status, 'awaiting_ci');
  assert.equal(result.final_synthesized_result.ready_for_merge, false);
});

test('CI failure is fed back into one bounded repair before success', async () => {
  const planner = { async run() { return { steps: ['build'], acceptance_criteria: ['passes'] }; } };
  const attempts = [];
  const builder = { async run(input) { attempts.push(input); return { artifacts: [{ name: `attempt-${input.attempt}` }], notes: [] }; } };
  const qa = { async run() { return approvedQa(); } };
  let checks = 0;
  const deliveryGate = {
    async review() {
      checks += 1;
      if (checks === 1) return { ready: false, pending: false, findings: [{ severity: 'high', code: 'CI_FAILED', message: 'tests failed' }] };
      return { ready: true, pending: false, findings: [], pull_request: { number: 2 }, ci_status: { status: 'completed' } };
    }
  };
  const result = await new Orchestrator({ planner, builder, qa, deliveryGate, maxRepairAttempts: 2 }).execute('ship change');
  assert.equal(result.workflow_status, 'completed');
  assert.equal(result.repair_attempts, 1);
  assert.equal(attempts[1].previousQa.agent_id, 'delivery_gate');
  assert.equal(result.final_synthesized_result.ready_for_merge, true);
  assert.equal(result.final_synthesized_result.merge_requires_human_approval, true);
});
