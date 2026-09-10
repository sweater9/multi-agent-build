import { PlannerAgent, BuilderAgent, QaAgent } from './agents.js';
import { Orchestrator } from './orchestrator.js';
import { HttpJsonProvider } from './providers.js';
import { JsonFileStateStore } from './state-store.js';

const goal = process.argv.slice(2).join(' ').trim() || 'Produce a secure multi-agent architecture and security review';

const provider = process.env.AGENT_PROVIDER_URL
  ? new HttpJsonProvider({
      endpoint: process.env.AGENT_PROVIDER_URL,
      apiKey: process.env.AGENT_PROVIDER_API_KEY || null,
      timeoutMs: Number(process.env.AGENT_PROVIDER_TIMEOUT_MS || 30000)
    })
  : null;

const stateStore = new JsonFileStateStore({
  directory: process.env.WORKFLOW_STATE_DIR || '.multi-agent-runs'
});

const orchestrator = new Orchestrator({
  planner: new PlannerAgent({ provider }),
  builder: new BuilderAgent({ provider }),
  qa: new QaAgent({ provider }),
  stateStore
});

const result = await orchestrator.execute(goal);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.workflow_status === 'completed' ? 0 : 1;
