import crypto from 'node:crypto';
import { STATES, assertNonEmptyString, validatePlan, validateBuild, validateQa } from './contracts.js';
import { redactSecrets } from './security.js';

const ALLOWED_TRANSITIONS = Object.freeze({
  [STATES.RECEIVED]: [STATES.PLANNING, STATES.FAILED],
  [STATES.PLANNING]: [STATES.BUILDING, STATES.FAILED],
  [STATES.BUILDING]: [STATES.QA_REVIEW, STATES.FAILED],
  [STATES.QA_REVIEW]: [STATES.BUILDING, STATES.AWAITING_CI, STATES.COMPLETED, STATES.BLOCKED, STATES.FAILED],
  [STATES.AWAITING_CI]: [STATES.BUILDING, STATES.COMPLETED, STATES.BLOCKED, STATES.FAILED],
  [STATES.COMPLETED]: [],
  [STATES.BLOCKED]: [],
  [STATES.FAILED]: []
});

export class Orchestrator {
  constructor({ planner, builder, qa, deliveryGate = null, stateStore = null, maxRepairAttempts = 2, clock = () => new Date() }) {
    this.planner = planner;
    this.builder = builder;
    this.qa = qa;
    this.deliveryGate = deliveryGate;
    this.stateStore = stateStore;
    this.maxRepairAttempts = Math.max(0, Number(maxRepairAttempts) || 0);
    this.clock = clock;
  }

  transition(run, nextState, detail = null) {
    const allowed = ALLOWED_TRANSITIONS[run.state] || [];
    if (!allowed.includes(nextState)) throw new Error(`Invalid workflow transition: ${run.state} -> ${nextState}`);
    run.state = nextState;
    run.updated_at = this.clock().toISOString();
    run.audit_events.push({ at: run.updated_at, state: nextState, detail });
  }

  async persist(run) {
    if (this.stateStore) await this.stateStore.save(run);
  }

  findLatest(run, role) {
    return [...(run.agents || [])].reverse().find((agent) => agent?.agent_role === role) || null;
  }

  async finalizeSuccess(run, { goal, plan, build, qa }) {
    this.transition(run, STATES.COMPLETED);
    run.workflow_status = STATES.COMPLETED;
    run.final_synthesized_result = {
      approved: true,
      ready_for_merge: Boolean(this.deliveryGate),
      merge_requires_human_approval: Boolean(this.deliveryGate),
      summary: this.deliveryGate
        ? 'Plan, build, QA, repository review, and CI completed successfully. Ready for explicit human merge approval.'
        : 'Plan, build, bounded repair loop, and independent QA completed successfully.',
      goal,
      repair_attempts: run.repair_attempts,
      artifacts: build.artifacts,
      security_findings: qa.findings,
      acceptance_criteria: plan.acceptance_criteria,
      delivery: run.delivery
    };
    await this.persist(run);
    return run;
  }

  async continueBuildLoop(run, { goal, plan, previousQa = null }) {
    let build;
    let qa;

    while (true) {
      this.transition(run, STATES.BUILDING, run.repair_attempts === 0 ? 'initial build' : `repair attempt ${run.repair_attempts}`);
      await this.persist(run);

      build = validateBuild(await this.builder.run({ goal, plan, attempt: run.repair_attempts, previousQa }));
      run.agents.push(build);
      await this.persist(run);

      this.transition(run, STATES.QA_REVIEW, `review build attempt ${run.repair_attempts}`);
      await this.persist(run);

      qa = validateQa(await this.qa.run({ goal, plan, build, attempt: run.repair_attempts, previousQa }));
      run.agents.push(qa);
      await this.persist(run);

      if (!qa.approved) {
        if (run.repair_attempts >= this.maxRepairAttempts) {
          this.transition(run, STATES.BLOCKED, 'QA/security release gate blocked completion after repair limit');
          run.workflow_status = STATES.BLOCKED;
          run.final_synthesized_result = { approved: false, ready_for_merge: false, summary: 'Build blocked by QA/security gate after bounded repair attempts.', repair_attempts: run.repair_attempts, findings: qa.findings };
          await this.persist(run);
          return run;
        }
        previousQa = qa;
        run.repair_attempts += 1;
        continue;
      }

      if (!this.deliveryGate) return this.finalizeSuccess(run, { goal, plan, build, qa });

      this.transition(run, STATES.AWAITING_CI, 'QA approved; evaluating pull request and CI');
      await this.persist(run);
      const delivery = await this.deliveryGate.review({ qa, existingPullRequest: run.delivery?.pull_request || null });
      run.delivery = delivery;
      await this.persist(run);

      if (delivery.pending) {
        run.workflow_status = STATES.AWAITING_CI;
        run.final_synthesized_result = {
          approved: false,
          ready_for_merge: false,
          summary: 'QA passed and pull request is open; CI is still pending.',
          pull_request: delivery.pull_request,
          ci_status: delivery.ci_status,
          repair_attempts: run.repair_attempts,
          resume_required: true
        };
        await this.persist(run);
        return run;
      }

      if (!delivery.ready) {
        if (run.repair_attempts >= this.maxRepairAttempts) {
          this.transition(run, STATES.BLOCKED, 'CI gate blocked completion after repair limit');
          run.workflow_status = STATES.BLOCKED;
          run.final_synthesized_result = {
            approved: false,
            ready_for_merge: false,
            summary: 'Build blocked by CI after bounded repair attempts.',
            repair_attempts: run.repair_attempts,
            findings: delivery.findings,
            pull_request: delivery.pull_request,
            ci_status: delivery.ci_status
          };
          await this.persist(run);
          return run;
        }

        previousQa = {
          agent_id: 'delivery_gate',
          agent_role: 'CI Delivery Gate',
          status: 'blocked',
          approved: false,
          findings: delivery.findings
        };
        run.repair_attempts += 1;
        continue;
      }

      return this.finalizeSuccess(run, { goal, plan, build, qa });
    }
  }

  async execute(goal) {
    assertNonEmptyString(goal, 'goal');
    const now = this.clock().toISOString();
    const run = {
      workflow_run_id: crypto.randomUUID(),
      workflow_status: STATES.RECEIVED,
      state: STATES.RECEIVED,
      project_title: 'multi-agent-build',
      goal,
      created_at: now,
      updated_at: now,
      repair_attempts: 0,
      agents: [],
      delivery: null,
      audit_events: [{ at: now, state: STATES.RECEIVED, detail: 'request accepted' }],
      final_synthesized_result: null
    };
    await this.persist(run);

    try {
      this.transition(run, STATES.PLANNING);
      await this.persist(run);
      const plan = validatePlan(await this.planner.run({ goal }));
      run.agents.push(plan);
      await this.persist(run);
      return await this.continueBuildLoop(run, { goal, plan });
    } catch (error) {
      if ((ALLOWED_TRANSITIONS[run.state] || []).includes(STATES.FAILED)) this.transition(run, STATES.FAILED, redactSecrets(error.message));
      run.workflow_status = STATES.FAILED;
      run.final_synthesized_result = { approved: false, ready_for_merge: false, summary: 'Workflow failed safely.', error: redactSecrets(error.message) };
      await this.persist(run);
      return run;
    }
  }

  async resume(workflowRunId) {
    if (!this.stateStore) throw new Error('Cannot resume without a state store');
    const run = await this.stateStore.load(workflowRunId);
    if (run.state !== STATES.AWAITING_CI || run.workflow_status !== STATES.AWAITING_CI) {
      throw new Error(`Workflow '${workflowRunId}' is not awaiting CI and cannot be resumed`);
    }
    if (!this.deliveryGate) throw new Error('Cannot resume awaiting CI without a delivery gate');

    const goal = run.goal || run.final_synthesized_result?.goal;
    assertNonEmptyString(goal, 'persisted goal');
    const plan = validatePlan(this.findLatest(run, 'System Planner'));
    const build = validateBuild(this.findLatest(run, 'Core Builder'));
    const qa = validateQa(this.findLatest(run, 'QA & Security Auditor'));

    try {
      const delivery = await this.deliveryGate.review({ qa, existingPullRequest: run.delivery?.pull_request || null });
      run.delivery = delivery;
      run.updated_at = this.clock().toISOString();
      run.audit_events.push({ at: run.updated_at, state: STATES.AWAITING_CI, detail: 'resumed persisted run and rechecked CI' });
      await this.persist(run);

      if (delivery.pending) {
        run.final_synthesized_result = {
          approved: false,
          ready_for_merge: false,
          summary: 'CI is still pending; workflow remains resumable.',
          pull_request: delivery.pull_request,
          ci_status: delivery.ci_status,
          repair_attempts: run.repair_attempts,
          resume_required: true
        };
        await this.persist(run);
        return run;
      }

      if (delivery.ready) return await this.finalizeSuccess(run, { goal, plan, build, qa });

      if (run.repair_attempts >= this.maxRepairAttempts) {
        this.transition(run, STATES.BLOCKED, 'CI gate blocked resumed workflow after repair limit');
        run.workflow_status = STATES.BLOCKED;
        run.final_synthesized_result = { approved: false, ready_for_merge: false, summary: 'Resumed workflow blocked by CI after bounded repair attempts.', repair_attempts: run.repair_attempts, findings: delivery.findings, pull_request: delivery.pull_request, ci_status: delivery.ci_status };
        await this.persist(run);
        return run;
      }

      run.repair_attempts += 1;
      const previousQa = { agent_id: 'delivery_gate', agent_role: 'CI Delivery Gate', status: 'blocked', approved: false, findings: delivery.findings };
      return await this.continueBuildLoop(run, { goal, plan, previousQa });
    } catch (error) {
      if ((ALLOWED_TRANSITIONS[run.state] || []).includes(STATES.FAILED)) this.transition(run, STATES.FAILED, redactSecrets(error.message));
      run.workflow_status = STATES.FAILED;
      run.final_synthesized_result = { approved: false, ready_for_merge: false, summary: 'Resumed workflow failed safely.', error: redactSecrets(error.message) };
      await this.persist(run);
      return run;
    }
  }
}
