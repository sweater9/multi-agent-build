import test from 'node:test';
import assert from 'node:assert/strict';
import { Orchestrator } from '../src/orchestrator.js';
import { MemoryStateStore } from '../src/state-store.js';

function planOutput() {
  return {
    agent_id: 'planner_01',
    agent_role: 'System Planner',
    status: 'success',
    steps: ['build'],
    acceptance_criteria: ['passes'],
    risks: []
  };
}

function buildOutput(attempt = 0) {
  return {
    agent_id: 'builder_02',
    agent_role: 'Core Builder',
    status: 'success',
    artifacts: [{ type: 'code', name: `attempt-${attempt}`, content: 'ok' }],
    notes: []
  };
}

function qaOutput() {
  return {
    agent_id: 'qa_03',
    agent_role: 'QA & Security Auditor',
    status: 'success',
    approved: true,
    findings: []
  };
}

test('resume rechecks CI without rerunning planner or builder and reuses PR', async () => {
  const stateStore = new MemoryStateStore();
  let plannerRuns = 0;
  let builderRuns = 0;
  let qaRuns = 0;
  const seenExistingPrs = [];
  const reviews = [
    {
      ready: false,
      pending: true,
      pull_request: { number: 17, url: 'https://example.test/pr/17' },
      ci_status: { status: 'in_progress' },
      findings: []
    },
    {
      ready: true,
      pending: false,
      pull_request: { number: 17, url: 'https://example.test/pr/17' },
      ci_status: { status: 'completed', conclusion: 'success' },
      findings: []
    }
  ];

  const orchestrator = new Orchestrator({
    planner: { async run() { plannerRuns += 1; return planOutput(); } },
    builder: { async run({ attempt }) { builderRuns += 1; return buildOutput(attempt); } },
    qa: { async run() { qaRuns += 1; return qaOutput(); } },
    deliveryGate: {
      async review({ existingPullRequest }) {
        seenExistingPrs.push(existingPullRequest);
        return reviews.shift();
      }
    },
    stateStore
  });

  const initial = await orchestrator.execute('Ship a tested change');
  assert.equal(initial.workflow_status, 'awaiting_ci');
  assert.equal(initial.final_synthesized_result.resume_required, true);
  assert.equal(plannerRuns, 1);
  assert.equal(builderRuns, 1);
  assert.equal(qaRuns, 1);

  const resumed = await orchestrator.resume(initial.workflow_run_id);
  assert.equal(resumed.workflow_status, 'completed');
  assert.equal(resumed.final_synthesized_result.ready_for_merge, true);
  assert.equal(resumed.final_synthesized_result.merge_requires_human_approval, true);
  assert.equal(plannerRuns, 1);
  assert.equal(builderRuns, 1);
  assert.equal(qaRuns, 1);
  assert.deepEqual(seenExistingPrs[1], { number: 17, url: 'https://example.test/pr/17' });
  assert.ok(resumed.audit_events.some((event) => event.detail === 'resumed persisted run and rechecked CI'));
});

test('resume leaves a still-pending run resumable and idempotent', async () => {
  const stateStore = new MemoryStateStore();
  let reviews = 0;
  const orchestrator = new Orchestrator({
    planner: { async run() { return planOutput(); } },
    builder: { async run({ attempt }) { return buildOutput(attempt); } },
    qa: { async run() { return qaOutput(); } },
    deliveryGate: {
      async review({ existingPullRequest }) {
        reviews += 1;
        return {
          ready: false,
          pending: true,
          pull_request: existingPullRequest || { number: 9 },
          ci_status: { status: 'queued' },
          findings: []
        };
      }
    },
    stateStore
  });

  const initial = await orchestrator.execute('Wait for CI');
  const resumed = await orchestrator.resume(initial.workflow_run_id);
  assert.equal(resumed.workflow_status, 'awaiting_ci');
  assert.equal(resumed.final_synthesized_result.resume_required, true);
  assert.equal(reviews, 2);
  assert.equal(resumed.delivery.pull_request.number, 9);
});

test('failed CI on resume feeds delivery findings into one bounded repair', async () => {
  const stateStore = new MemoryStateStore();
  let builderRuns = 0;
  let previousQaSeen = null;
  const reviews = [
    { ready: false, pending: true, pull_request: { number: 4 }, ci_status: { status: 'in_progress' }, findings: [] },
    { ready: false, pending: false, pull_request: { number: 4 }, ci_status: { conclusion: 'failure' }, findings: [{ severity: 'high', code: 'CI_FAILED', message: 'tests failed' }] },
    { ready: true, pending: false, pull_request: { number: 4 }, ci_status: { conclusion: 'success' }, findings: [] }
  ];

  const orchestrator = new Orchestrator({
    planner: { async run() { return planOutput(); } },
    builder: {
      async run({ attempt, previousQa }) {
        builderRuns += 1;
        if (attempt === 1) previousQaSeen = previousQa;
        return buildOutput(attempt);
      }
    },
    qa: { async run() { return qaOutput(); } },
    deliveryGate: { async review() { return reviews.shift(); } },
    stateStore,
    maxRepairAttempts: 2
  });

  const initial = await orchestrator.execute('Repair CI failure');
  const resumed = await orchestrator.resume(initial.workflow_run_id);
  assert.equal(resumed.workflow_status, 'completed');
  assert.equal(resumed.repair_attempts, 1);
  assert.equal(builderRuns, 2);
  assert.equal(previousQaSeen.agent_role, 'CI Delivery Gate');
  assert.equal(previousQaSeen.findings[0].code, 'CI_FAILED');
});

test('resume rejects terminal or non-awaiting workflow states', async () => {
  const stateStore = new MemoryStateStore();
  const orchestrator = new Orchestrator({
    planner: { async run() { return planOutput(); } },
    builder: { async run({ attempt }) { return buildOutput(attempt); } },
    qa: { async run() { return qaOutput(); } },
    stateStore
  });
  const completed = await orchestrator.execute('Complete normally');
  await assert.rejects(() => orchestrator.resume(completed.workflow_run_id), /not awaiting CI/);
});
