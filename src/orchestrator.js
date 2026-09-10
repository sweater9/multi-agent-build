import crypto from 'node:crypto';
import { STATES, assertNonEmptyString, validatePlan, validateBuild, validateQa } from './contracts.js';
import { redactSecrets } from './security.js';

const ALLOWED_TRANSITIONS = Object.freeze({
  [STATES.RECEIVED]: [STATES.PLANNING, STATES.FAILED],
  [STATES.PLANNING]: [STATES.BUILDING, STATES.FAILED],
  [STATES.BUILDING]: [STATES.QA_REVIEW, STATES.FAILED],
  [STATES.QA_REVIEW]: [STATES.COMPLETED, STATES.BLOCKED, STATES.FAILED],
  [STATES.COMPLETED]: [],
  [STATES.BLOCKED]: [],
  [STATES.FAILED]: []
});

export class Orchestrator {
  constructor({ planner, builder, qa, clock = () => new Date() }) {
    this.planner = planner;
    this.builder = builder;
    this.qa = qa;
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
      agents: [],
      audit_events: [{ at: now, state: STATES.RECEIVED, detail: 'request accepted' }],
      final_synthesized_result: null
    };

    try {
      this.transition(run, STATES.PLANNING);
      const plan = validatePlan(await this.planner.run({ goal }));
      run.agents.push(plan);

      this.transition(run, STATES.BUILDING);
      const build = validateBuild(await this.builder.run({ goal, plan }));
      run.agents.push(build);

      this.transition(run, STATES.QA_REVIEW);
      const qa = validateQa(await this.qa.run({ goal, plan, build }));
      run.agents.push(qa);

      if (!qa.approved) {
        this.transition(run, STATES.BLOCKED, 'QA/security release gate blocked completion');
        run.workflow_status = STATES.BLOCKED;
        run.final_synthesized_result = {
          approved: false,
          summary: 'Build blocked by QA/security gate.',
          findings: qa.findings
        };
        return run;
      }

      this.transition(run, STATES.COMPLETED);
      run.workflow_status = STATES.COMPLETED;
      run.final_synthesized_result = {
        approved: true,
        summary: 'Plan, build, and independent QA completed successfully.',
        goal,
        artifacts: build.artifacts,
        security_findings: qa.findings,
        acceptance_criteria: plan.acceptance_criteria
      };
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
      return run;
    }
  }
}
