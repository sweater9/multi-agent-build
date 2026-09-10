import { validatePlan, validateBuild, validateQa } from './contracts.js';
import { hasBlockingFinding } from './security.js';

export class PlannerAgent {
  constructor({ id = 'planner_01' } = {}) {
    this.id = id;
    this.role = 'planner';
  }

  async run({ goal }) {
    const plan = {
      agent_id: this.id,
      agent_role: 'System Planner',
      status: 'success',
      goal,
      steps: [
        'Clarify the requested outcome and constraints from supplied context',
        'Define implementation artifacts and acceptance criteria',
        'Build only within the approved scope',
        'Run independent QA and security checks',
        'Synthesize approved outputs into the final result'
      ],
      acceptance_criteria: [
        'All required outputs are present',
        'Agent handoffs satisfy contracts',
        'No critical or high security finding remains open',
        'Final output records workflow state and audit events'
      ],
      risks: [
        'Untrusted prompt or retrieved content influencing privileged actions',
        'Over-broad tool permissions',
        'Secrets leaking through logs or outputs',
        'Incomplete QA allowing unsafe release'
      ]
    };
    return validatePlan(plan);
  }
}

export class BuilderAgent {
  constructor({ id = 'builder_02', toolGateway = null } = {}) {
    this.id = id;
    this.role = 'builder';
    this.toolGateway = toolGateway;
  }

  async run({ goal, plan }) {
    validatePlan(plan);
    return validateBuild({
      agent_id: this.id,
      agent_role: 'Core Builder',
      status: 'success',
      artifacts: [
        {
          type: 'architecture_blueprint',
          name: 'multi-agent-runtime',
          content: {
            execution: 'orchestrated sequential pipeline',
            stages: ['planner', 'builder', 'qa', 'synthesis'],
            isolation: 'tool access is mediated by role-scoped gateway',
            release_policy: 'critical/high QA findings block completion'
          }
        }
      ],
      notes: [
        `Build prepared for goal: ${goal}`,
        'No external privileged tool action is performed by default.'
      ]
    });
  }
}

export class QaAgent {
  constructor({ id = 'qa_03' } = {}) {
    this.id = id;
    this.role = 'qa';
  }

  async run({ plan, build }) {
    validatePlan(plan);
    validateBuild(build);

    const findings = [];
    if (build.artifacts.length === 0) {
      findings.push({ severity: 'high', code: 'NO_ARTIFACTS', message: 'Builder produced no artifacts.' });
    }

    const approved = !hasBlockingFinding(findings);
    return validateQa({
      agent_id: this.id,
      agent_role: 'QA & Security Auditor',
      status: approved ? 'success' : 'blocked',
      approved,
      findings,
      checks: {
        plan_valid: true,
        build_valid: true,
        blocking_findings_absent: approved,
        least_privilege_required: true,
        secret_redaction_required: true
      }
    });
  }
}
