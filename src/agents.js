import { validatePlan, validateBuild, validateQa } from './contracts.js';
import { hasBlockingFinding } from './security.js';

export class PlannerAgent {
  constructor({ id = 'planner_01', provider = null } = {}) {
    this.id = id;
    this.role = 'planner';
    this.provider = provider;
  }

  async run({ goal }) {
    const plan = this.provider
      ? await this.provider.generate({ agentRole: this.role, input: { goal } })
      : {
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
    return validatePlan({ ...plan, agent_id: plan.agent_id || this.id });
  }
}

export class BuilderAgent {
  constructor({ id = 'builder_02', toolGateway = null, provider = null, repositoryTarget = null } = {}) {
    this.id = id;
    this.role = 'builder';
    this.toolGateway = toolGateway;
    this.provider = provider;
    this.repositoryTarget = repositoryTarget;
  }

  async executeRepositoryActions(actions = []) {
    if (!actions.length) return [];
    if (!this.toolGateway || !this.repositoryTarget) {
      throw new Error('Repository actions requested without a configured ToolGateway and repository target');
    }

    const results = [];
    for (const action of actions) {
      if (!action || !['repo.create_branch', 'repo.create_file', 'repo.update_file'].includes(action.tool)) {
        throw new Error(`Unsupported builder repository action '${action?.tool}'`);
      }
      const input = { ...(action.input || {}), repository: this.repositoryTarget.repository };
      if (action.tool === 'repo.create_branch') {
        input.branch = this.repositoryTarget.branch;
        input.base = this.repositoryTarget.base || 'main';
      } else {
        input.branch = this.repositoryTarget.branch;
      }
      results.push({ tool: action.tool, result: await this.toolGateway.invoke(this.role, action.tool, input) });
    }
    return results;
  }

  async run({ goal, plan, attempt = 0, previousQa = null }) {
    validatePlan(plan);
    const build = this.provider
      ? await this.provider.generate({
          agentRole: this.role,
          input: { goal, plan, attempt, previous_qa: previousQa, repository_target: this.repositoryTarget }
        })
      : {
          agent_id: this.id,
          agent_role: 'Core Builder',
          status: 'success',
          artifacts: [{
            type: 'architecture_blueprint',
            name: 'multi-agent-runtime',
            content: {
              execution: 'orchestrated sequential pipeline',
              stages: ['planner', 'builder', 'qa', 'synthesis'],
              isolation: 'tool access is mediated by role-scoped gateway',
              release_policy: 'critical/high QA findings block completion'
            }
          }],
          notes: [`Build prepared for goal: ${goal}`, 'No external privileged tool action is performed by default.']
        };

    const validated = validateBuild({ ...build, agent_id: build.agent_id || this.id });
    const actionResults = await this.executeRepositoryActions(validated.repository_actions || []);
    if (actionResults.length) {
      validated.artifacts.push({ type: 'repository_actions', name: `attempt-${attempt}`, content: actionResults });
      validated.notes.push(`Executed ${actionResults.length} controlled repository action(s).`);
    }
    return validated;
  }
}

export class QaAgent {
  constructor({ id = 'qa_03', provider = null, toolGateway = null, repositoryTarget = null } = {}) {
    this.id = id;
    this.role = 'qa';
    this.provider = provider;
    this.toolGateway = toolGateway;
    this.repositoryTarget = repositoryTarget;
  }

  async getRepositoryDiff() {
    if (!this.toolGateway || !this.repositoryTarget) return null;
    return this.toolGateway.invoke(this.role, 'repo.compare', {
      repository: this.repositoryTarget.repository,
      base: this.repositoryTarget.base || 'main',
      head: this.repositoryTarget.branch
    });
  }

  async run({ goal, plan, build, attempt = 0, previousQa = null }) {
    validatePlan(plan);
    validateBuild(build);
    const repositoryDiff = await this.getRepositoryDiff();

    if (this.provider) {
      const qa = await this.provider.generate({
        agentRole: this.role,
        input: {
          goal,
          plan,
          build,
          attempt,
          previous_qa: previousQa,
          repository_diff: repositoryDiff
        }
      });
      return validateQa({ ...qa, agent_id: qa.agent_id || this.id });
    }

    const findings = [];
    if (build.artifacts.length === 0) {
      findings.push({ severity: 'high', code: 'NO_ARTIFACTS', message: 'Builder produced no artifacts.' });
    }
    if (this.repositoryTarget && (!repositoryDiff || !Array.isArray(repositoryDiff.files) || repositoryDiff.files.length === 0)) {
      findings.push({ severity: 'high', code: 'NO_REPOSITORY_DIFF', message: 'Configured repository workflow produced no reviewable diff.' });
    }
    const approved = !hasBlockingFinding(findings);
    return validateQa({
      agent_id: this.id,
      agent_role: 'QA & Security Auditor',
      status: approved ? 'success' : 'blocked',
      approved,
      findings,
      repository_diff: repositoryDiff,
      checks: {
        plan_valid: true,
        build_valid: true,
        repository_diff_reviewed: this.repositoryTarget ? Boolean(repositoryDiff) : null,
        blocking_findings_absent: approved,
        least_privilege_required: true,
        secret_redaction_required: true
      }
    });
  }
}
