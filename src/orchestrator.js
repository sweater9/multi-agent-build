import crypto from 'node:crypto';
import { STATES, assertNonEmptyString, validatePlan, validateBuild, validateQa } from './contracts.js';
import { redactSecrets } from './security.js';

const ALLOWED_TRANSITIONS = Object.freeze({
  [STATES.RECEIVED]: [STATES.PLANNING, STATES.FAILED],
  [STATES.PLANNING]: [STATES.BUILDING, STATES.FAILED],
  [STATES.BUILDING]: [STATES.QA_REVIEW, STATES.FAILED],
  [STATES.QA_REVIEW]: [STATES.BUILDING, STATES.COMPLETED, STATES.BLOCKED, STATES.FAILED],
  [STATES.COMPLETED]: [],
  [STATES.BLOCKED]: [],
  [STATES.FAILED]: []
});

export class Orchestrator {
  constructor({
    planner,
    builder,
    qa,
    stateStore = null,
    maxRepairAttempts = 2,
    clock = () => new Date()
  }) {
    this.planner = planner;
    this.builder = builder;
    this.qa = qa;
    this.stateStore = stateStore;
    this.maxRepairAttempts = Math.max(0, Number(maxRepairAttempts) || 0);
    this.clock = clock;
  }

  transition(run, nextState, detail = null) {
    const allowed = ALLOWED_TRANSITIONS[run.state] || [];
    if (!allowed.includes(nextState)) {
      throw new Error(`Invalid workflow transition: ${run.state} -> ${nextState}`);
    }
    run.state = nextState;
    run.updated_at = this.clock().toISOString();
    run.audit_events.push({ at: run.updated_at, state: nextState, detail });
  }

  async persist(run) {
    if (this.stateStore) await this.stateStore.save(run);
  }

  async execute(goal) {
    assertNonEmptyString(goal, 'goal');
    const now = this.clock().toISOString();
    const run = {
      workflow_run_id: crypto.randomUUID(),
      workflow_status: STATES.RECEIVED,
      state: STATES.RECEIVED,
      project_title: 'multi-agent-build',
      created_at: now,
      updated_at: now,
      repair_attempts: 0,
      agents: [],
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

      let previousQa = null;
      let build;
      let qa;

      while (true) {
        this.transition(
          run,
          STATES.BUILDING,
          run.repair_attempts === 0 ? 'initial build' : `repair attempt ${run.repair_attempts}`
        );
        await this.persist(run);

        build = validateBuild(await this.builder.run({
          goal,
          plan,
          attempt: run.repair_attempts,
          previousQa
        }));
        run.agents.push(build);
        await this.persist(run);

        this.transition(run, STATES.QA_REVIEW, `review build attempt ${run.repair_attempts}`);
        await this.persist(run);

        qa = validateQa(await this.qa.run({
          goal,
          plan,
          build,
          attempt: run.repair_attempts,
          previousQa
        }));
        run.agents.push(qa);
        await this.persist(run);

        if (qa.approved) break;

        if (run.repair_attempts >= this.maxRepairAttempts) {
          this.transition(run, STATES.BLOCKED, 'QA/security release gate blocked completion after repair limit');
          run.workflow_status = STATES.BLOCKED;
          run.final_synthesized_result = {
            approved: false,
            summary: 'Build blocked by QA/security gate after bounded repair attempts.',
            repair_attempts: run.repair_attempts,
            findings: qa.findings
          };
          await this.persist(run);
          return run;
        }

        previousQa = qa;
        run.repair_attempts += 1;
      }

      this.transition(run, STATES.COMPLETED);
      run.workflow_status = STATES.COMPLETED;
      run.final_synthesized_result = {
        approved: true,
        summary: 'Plan, build, bounded repair loop, and independent QA completed successfully.',
        goal,
        repair_attempts: run.repair_attempts,
        artifacts: build.artifacts,
        security_findings: qa.findings,
        acceptance_criteria: plan.acceptance_criteria
      };
      await this.persist(run);
      return run;
    } catch (error) {
      if ((ALLOWED_TRANSITIONS[run.state] || []).includes(STATES.FAILED)) {
        this.transition(run, STATES.FAILED, redactSecrets(error.message));
      }
      run.workflow_status = STATES.FAILED;
      run.final_synthesized_result = {
        approved: false,
        summary: 'Workflow failed safely.',
        error: redactSecrets(error.message)
      };
      await this.persist(run);
      return run;
    }
  }
}
