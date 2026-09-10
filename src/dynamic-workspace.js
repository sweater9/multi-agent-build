import crypto from 'node:crypto';

const DEFAULT_SPECIALISTS = [
  { id: 'analyst', name: 'Analyst', focus: 'Analyze the problem, assumptions, tradeoffs, and practical implications.' },
  { id: 'critic', name: 'Critical Reviewer', focus: 'Challenge weak assumptions, identify gaps, risks, and counterarguments.' }
];

function cleanSpecialists(value) {
  if (!Array.isArray(value)) return DEFAULT_SPECIALISTS;
  const seen = new Set();
  const out = [];
  for (const item of value.slice(0, 4)) {
    const name = String(item?.name || item?.role || '').trim().slice(0, 60);
    const focus = String(item?.focus || item?.task || '').trim().slice(0, 500);
    if (!name || !focus) continue;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `specialist-${out.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, focus });
  }
  return out.length >= 2 ? out : DEFAULT_SPECIALISTS;
}

function text(value) {
  if (typeof value === 'string') return value;
  if (value?.answer) return String(value.answer);
  if (value?.output) return typeof value.output === 'string' ? value.output : JSON.stringify(value.output, null, 2);
  return JSON.stringify(value ?? '', null, 2);
}

function safeError(error) {
  const message = String(error?.message || error || 'unknown error');
  if (/429|rate.?limit|too many requests/i.test(message)) return 'provider_rate_limited';
  if (/abort|timeout/i.test(message)) return 'provider_timeout';
  if (/HTTP 5\d\d/i.test(message)) return 'provider_unavailable';
  return 'provider_failed';
}

export class DynamicPromptWorkspace {
  constructor({ provider, stateStore = null, clock = () => new Date(), specialistConcurrency = 2 } = {}) {
    if (!provider?.generate) throw new Error('provider is required');
    this.provider = provider;
    this.stateStore = stateStore;
    this.clock = clock;
    this.specialistConcurrency = Math.max(1, Math.min(2, Number(specialistConcurrency) || 2));
  }

  async save(run) { if (this.stateStore?.save) await this.stateStore.save(run); }
  async ask(agentRole, input) { return this.provider.generate({ agentRole, input }); }

  async runSpecialists({ specialists, goal, plan, research }) {
    const successes = [];
    const failures = [];
    for (let i = 0; i < specialists.length; i += this.specialistConcurrency) {
      const batch = specialists.slice(i, i + this.specialistConcurrency);
      const settled = await Promise.allSettled(batch.map(async specialist => {
        const output = await this.ask('specialist', {
          goal,
          specialist,
          plan,
          research,
          instruction: `Act only as the ${specialist.name}. ${specialist.focus} Produce a substantive independent answer. Clearly distinguish facts, assumptions, and recommendations. ${research ? 'Ground current factual claims in the supplied research packet and preserve source references.' : 'Do not claim to have browsed or verified external sources.'}`
        });
        return { id: specialist.id, name: specialist.name, focus: specialist.focus, status: 'success', output };
      }));
      settled.forEach((item, index) => {
        const specialist = batch[index];
        if (item.status === 'fulfilled') successes.push(item.value);
        else failures.push({ id: specialist.id, name: specialist.name, focus: specialist.focus, status: 'failed', error: safeError(item.reason) });
      });
    }
    return { successes, failures };
  }

  async execute(goal, options = {}) {
    const cleanGoal = String(goal || '').trim();
    if (!cleanGoal) throw new Error('Prompt is required');
    const researchMode = options?.research === true;
    const now = this.clock().toISOString();
    const run = {
      workflow_run_id: crypto.randomUUID(),
      workflow_status: 'planning',
      state: 'planning',
      project_title: 'dynamic-prompt-workspace',
      goal: cleanGoal,
      research_mode: researchMode,
      created_at: now,
      updated_at: now,
      agents: []
    };
    await this.save(run);

    try {
      let research = null;
      if (researchMode) {
        if (typeof this.provider.research !== 'function') throw new Error('Research mode is not available with the configured provider');
        run.state = 'researching';
        run.workflow_status = 'researching';
        await this.save(run);
        research = await this.provider.research({ goal: cleanGoal });
        run.research = research;
        run.agents.push({ id: 'researcher', name: 'Web Researcher', status: 'success', output: research });
      }

      const planRaw = await this.ask('dynamic_planner', {
        goal: cleanGoal,
        research,
        instruction: 'Return JSON with objective, approach, and specialists. specialists must be an array of 2 to 4 objects with name and focus. Select expertise specifically for this task. Do not perform the task yet.'
      });
      const specialists = cleanSpecialists(planRaw?.specialists);
      run.plan = {
        objective: String(planRaw?.objective || cleanGoal),
        approach: String(planRaw?.approach || 'Use independent specialist analysis, adjudication, and QA.'),
        specialists
      };
      run.agents.push({ id: 'planner', name: 'Planner', status: 'success', output: run.plan });
      run.state = 'specialists';
      run.workflow_status = 'specialists';
      await this.save(run);

      const specialistRun = await this.runSpecialists({ specialists, goal: cleanGoal, plan: run.plan, research });
      run.agents.push(...specialistRun.successes, ...specialistRun.failures);
      if (!specialistRun.successes.length) throw new Error('All specialist agents were temporarily unavailable');
      run.state = 'judging';
      run.workflow_status = 'judging';
      await this.save(run);

      const judge = await this.ask('judge', {
        goal: cleanGoal,
        plan: run.plan,
        research,
        specialist_outputs: specialistRun.successes.map(r => ({ name: r.name, output: r.output })),
        specialist_failures: specialistRun.failures.map(r => ({ name: r.name, error: r.error })),
        instruction: 'Compare the available independent specialist outputs. Resolve disagreements, reject unsupported claims, retain the strongest reasoning, and produce one complete candidate final answer. If one specialist failed, continue with the successful evidence rather than failing the workflow. If research sources are supplied, preserve useful source references and do not invent any.'
      });
      run.agents.push({ id: 'judge', name: 'Judge & Synthesizer', status: 'success', output: judge });
      run.state = 'qa_review';
      run.workflow_status = 'qa_review';
      await this.save(run);

      const qa = await this.ask('dynamic_qa', {
        goal: cleanGoal,
        candidate: judge,
        plan: run.plan,
        research,
        specialist_failures: specialistRun.failures,
        instruction: 'Perform final quality and safety review. Check whether the candidate actually answers the user, is internally consistent, and states important uncertainty. When research is present, remove unsupported current claims rather than inventing citations. A non-critical specialist failure alone is not a reason to block an otherwise sound answer.'
      });
      const approved = qa?.approved !== false;
      run.agents.push({ id: 'qa', name: 'QA & Security', status: approved ? 'success' : 'blocked', output: qa });
      run.state = approved ? 'completed' : 'blocked';
      run.workflow_status = run.state;
      run.final_synthesized_result = {
        approved,
        summary: approved ? 'Dynamic specialist workflow completed.' : 'Final QA blocked the result.',
        answer: text(qa?.answer || judge?.answer || judge),
        quality_score: Number(qa?.quality_score || 0),
        confidence: Number(judge?.confidence || 0),
        findings: qa?.findings || []
      };
      await this.save(run);

      return {
        workflow_run_id: run.workflow_run_id,
        status: run.workflow_status,
        goal: cleanGoal,
        output: run.final_synthesized_result.answer,
        summary: run.final_synthesized_result.summary,
        confidence: run.final_synthesized_result.confidence,
        quality_score: run.final_synthesized_result.quality_score,
        research_mode: researchMode,
        sources: research?.sources || [],
        degraded: specialistRun.failures.length > 0,
        specialist_failures: specialistRun.failures.map(({ name, error }) => ({ name, error })),
        agent_team: specialists.map(s => ({ name: s.name, focus: s.focus })),
        agents: Object.fromEntries(run.agents.map(a => [a.id, { name: a.name, status: a.status, output: a.output, error: a.error }]))
      };
    } catch (error) {
      run.state = 'failed';
      run.workflow_status = 'failed';
      run.final_synthesized_result = { approved: false, summary: 'Dynamic workflow failed safely.', error: safeError(error) };
      await this.save(run);
      throw error;
    }
  }
}
