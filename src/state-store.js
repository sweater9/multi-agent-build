import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
function targetFromRun(run){return run?.delivery?.target||null}
function repairKey(repository,branch){return crypto.createHash('sha256').update(`${String(repository)}\n${String(branch)}`).digest('hex')}
export class JsonFileStateStore{
 constructor({directory='.multi-agent-runs'}={}){this.directory=directory;this.eventDirectory=path.join(directory,'.events');this.ciRepairDirectory=path.join(directory,'.ci-repair')}
 async save(run){if(!run?.workflow_run_id)throw new Error('workflow_run_id is required');await fs.mkdir(this.directory,{recursive:true,mode:0o700});const target=path.join(this.directory,`${run.workflow_run_id}.json`),temp=`${target}.tmp`;await fs.writeFile(temp,`${JSON.stringify(run,null,2)}\n`,{encoding:'utf-8',mode:0o600});await fs.rename(temp,target);return target}
 async load(workflowRunId){if(!/^[a-f0-9-]+$/i.test(String(workflowRunId)))throw new Error('Invalid workflow_run_id');return JSON.parse(await fs.readFile(path.join(this.directory,`${workflowRunId}.json`),'utf-8'))}
 async findAwaitingByTarget({repository,branch}){await fs.mkdir(this.directory,{recursive:true,mode:0o700});const entries=await fs.readdir(this.directory,{withFileTypes:true}),matches=[];for(const entry of entries){if(!entry.isFile()||!entry.name.endsWith('.json'))continue;try{const run=JSON.parse(await fs.readFile(path.join(this.directory,entry.name),'utf-8')),target=targetFromRun(run);if(run.state==='awaiting_ci'&&target?.repository===repository&&target?.branch===branch)matches.push(run.workflow_run_id)}catch{}}return matches}
 async claimEvent(deliveryId){if(!/^[A-Za-z0-9._:-]+$/.test(String(deliveryId)))throw new Error('Invalid delivery id');await fs.mkdir(this.eventDirectory,{recursive:true,mode:0o700});const marker=path.join(this.eventDirectory,`${deliveryId}.claimed`);try{const handle=await fs.open(marker,'wx',0o600);await handle.writeFile(`${new Date().toISOString()}\n`,'utf-8');await handle.close();return true}catch(error){if(error?.code==='EEXIST')return false;throw error}}
 async claimCiRepairAttempt({repository,branch,maxAttempts=2}={}){if(!repository||!branch)throw new Error('repository and branch are required');const max=Math.min(Math.max(Number(maxAttempts)||1,1),3),key=repairKey(repository,branch);await fs.mkdir(this.ciRepairDirectory,{recursive:true,mode:0o700});for(let attempt=1;attempt<=max;attempt++){const marker=path.join(this.ciRepairDirectory,`${key}.${attempt}.claimed`);try{const handle=await fs.open(marker,'wx',0o600);await handle.writeFile(`${new Date().toISOString()}\n`,'utf-8');await handle.close();return attempt}catch(error){if(error?.code==='EEXIST')continue;throw error}}return null}
}
export class MemoryStateStore{
 constructor(){this.runs=new Map();this.events=new Set();this.ciRepairs=new Set()}
 async save(run){this.runs.set(run.workflow_run_id,structuredClone(run));return run.workflow_run_id}
 async load(workflowRunId){const run=this.runs.get(workflowRunId);if(!run)throw new Error('Workflow run not found');return structuredClone(run)}
 async findAwaitingByTarget({repository,branch}){return [...this.runs.values()].filter(run=>{const target=targetFromRun(run);return run.state==='awaiting_ci'&&target?.repository===repository&&target?.branch===branch}).map(run=>run.workflow_run_id)}
 async claimEvent(deliveryId){if(this.events.has(deliveryId))return false;this.events.add(deliveryId);return true}
 async claimCiRepairAttempt({repository,branch,maxAttempts=2}={}){const max=Math.min(Math.max(Number(maxAttempts)||1,1),3),key=repairKey(repository,branch);for(let attempt=1;attempt<=max;attempt++){const marker=`${key}:${attempt}`;if(this.ciRepairs.has(marker))continue;this.ciRepairs.add(marker);return attempt}return null}
}
