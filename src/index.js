import { PlannerAgent, BuilderAgent, QaAgent } from './agents.js';
import { Orchestrator } from './orchestrator.js';

const goal = process.argv.slice(2).join(' ').trim() || 'Produce a secure multi-agent architecture and security review';

const orchestrator = new Orchestrator({
  planner: new PlannerAgent(),
  builder: new BuilderAgent(),
  qa: new QaAgent()
});

const result = await orchestrator.execute(goal);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.workflow_status === 'completed' ? 0 : 1;
