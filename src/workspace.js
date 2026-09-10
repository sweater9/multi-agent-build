import crypto from 'node:crypto';
import { validatePlan, validateBuild, validateQa } from './contracts.js';

function latest(run, role) {
  return [...(run?.agents || [])].reverse().find((agent) => agent?.agent_role === role) || null;
}

function artifactText(artifact) {
  if (!artifact) return '';
  if (typeof artifact.content === 'string') return artifact.content;
  try { return JSON.stringify(artifact.content, null, 2); } catch { return String(artifact.content || ''); }
}

export function synthesizeWorkspaceResult(run) {
  const plan = latest(run, 'System Planner');
  const build = latest(run, 'Core Builder');
  const qa = latest(run, 'QA & Security Auditor');
  const artifacts = build?.artifacts || [];
  const preferred = artifacts.find((item) => ['final_answer', 'document', 'analysis', 'report', 'research', 'content'].includes(item?.type)) || artifacts[0];
  const output = preferred ? artifactText(preferred) : String(run?.final_synthesized_result?.summary || 'No output was produced.');
  return {
    workflow_run_id: run.workflow_run_id,
    status: run.workflow_status,
    goal: run.goal,
    output,
    summary: run.final_synthesized_result?.summary || null,
    agents: {
      planner: plan ? { status: plan.status, output: { steps: plan.steps, acceptance_criteria: plan.acceptance_criteria, risks: plan.risks } } : null,
      builder: build ? { status: build.status, output: { artifacts: build.artifacts, notes: build.notes } } : null,
      qa: qa ? { status: qa.status, approved: qa.approved, output: { findings: qa.findings, checks: qa.checks } } : null
    }
  };
}

export class PromptWorkspace {
  constructor({ planner, builder, qa, maxRepairAttempts = 2, stateStore = null, clock = () => new Date() } = {}) {
    if (!planner?.run || !builder?.run || !qa?.run) throw new Error('planner, builder, and qa are required');
    this.planner = planner;
    this.builder = builder;
    this.qa = qa;
    this.maxRepairAttempts = Math.max(0, Number(maxRepairAttempts) || 0);
    this.stateStore = stateStore;
    this.clock = clock;
  }

  async save(run) { if (this.stateStore?.save) await this.stateStore.save(run); }

  async execute(goal) {
    const cleanGoal = String(goal || '').trim();
    if (!cleanGoal) throw new Error('Prompt is required');
    const now = this.clock().toISOString();
    const run = { workflow_run_id: crypto.randomUUID(), workflow_status: 'planning', state: 'planning', project_title: 'prompt-workspace', goal: cleanGoal, created_at: now, updated_at: now, repair_attempts: 0, agents: [], final_synthesized_result: null };
    await this.save(run);
    try {
      const plan = validatePlan(await this.planner.run({ goal: cleanGoal }));
      run.agents.push(plan); run.state = 'building'; run.workflow_status = 'building'; await this.save(run);
      let previousQa = null;
      while (true) {
        const build = validateBuild(await this.builder.run({ goal: cleanGoal, plan, attempt: run.repair_attempts, previousQa }));
        run.agents.push(build); run.state = 'qa_review'; run.workflow_status = 'qa_review'; await this.save(run);
        const qa = validateQa(await this.qa.run({ goal: cleanGoal, plan, build, attempt: run.repair_attempts, previousQa }));
        run.agents.push(qa);
        if (qa.approved) {
          run.state = 'completed'; run.workflow_status = 'completed';
          run.final_synthesized_result = { approved: true, summary: 'Planner, Builder, and QA completed successfully.', artifacts: build.artifacts, findings: qa.findings };
          await this.save(run);
          return synthesizeWorkspaceResult(run);
        }
        if (run.repair_attempts >= this.maxRepairAttempts) {
          run.state = 'blocked'; run.workflow_status = 'blocked';
          run.final_synthesized_result = { approved: false, summary: 'QA blocked the output after bounded repair attempts.', findings: qa.findings };
          await this.save(run);
          return synthesizeWorkspaceResult(run);
        }
        previousQa = qa; run.repair_attempts += 1; run.state = 'building'; run.workflow_status = 'building'; await this.save(run);
      }
    } catch (error) {
      run.state = 'failed'; run.workflow_status = 'failed'; run.final_synthesized_result = { approved: false, summary: 'Workflow failed safely.', error: String(error?.message || error) }; await this.save(run); throw error;
    }
  }
}
