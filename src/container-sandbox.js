import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function safeFiles(files){const out=[];let total=0;for(const file of Array.isArray(files)?files:[]){const rel=String(file?.path||'').replace(/\\/g,'/').replace(/^\/+/, '');const content=String(file?.content||'');if(!rel||rel.includes('..')||rel.startsWith('.git/')||rel.length>240)throw new Error('Invalid sandbox file path');const size=Buffer.byteLength(content,'utf8');total+=size;if(size>200000||total>4*1024*1024)throw new Error('Sandbox input exceeds size limit');out.push({path:rel,content})}if(out.length>120)throw new Error('Sandbox input exceeds file limit');return out}
function cleanCommand(command){if(!Array.isArray(command)||command.length===0||command.length>16)throw new Error('Invalid sandbox command');return command.map(part=>{const value=String(part);if(!value||value.length>200)throw new Error('Invalid sandbox command part');return value})}
export function imageIsDigestPinned(image){return /@sha256:[a-f0-9]{64}$/i.test(String(image||''))}
function defaultUser(){return typeof process.getuid==='function'&&typeof process.getgid==='function'?`${process.getuid()}:${process.getgid()}`:null}

export function dockerArgs({workspace,image='node:20-alpine',command,network='off',registryNetwork=null,memoryMb=768,timeoutMs=180000,user=defaultUser(),readOnlyRoot=true,shmMb=128}){
  const args=['run','--rm','--init','--cap-drop=ALL','--security-opt','no-new-privileges','--pids-limit','256','--memory',`${Math.max(128,Math.min(Number(memoryMb)||768,2048))}m`,'--cpus','1.5','--ulimit','nofile=1024:1024','--workdir','/workspace','--mount',`type=bind,src=${workspace},dst=/workspace`,'--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=128m','--env','HOME=/tmp','--env','npm_config_cache=/tmp/.npm'];
  if(readOnlyRoot)args.push('--read-only');
  if(user)args.push('--user',String(user));
  if(Number(shmMb)>0)args.push('--shm-size',`${Math.max(32,Math.min(Number(shmMb)||128,512))}m`);
  if(network==='off')args.push('--network','none');
  else if(network==='registry-only'){if(!registryNetwork)throw new Error('registry-only network requires an isolated registry network');args.push('--network',String(registryNetwork))}
  else throw new Error('Unsupported sandbox network mode');
  args.push(image,...cleanCommand(command));
  return {args,timeoutMs:Math.max(1000,Math.min(Number(timeoutMs)||180000,300000))};
}

export function spawnCapture(bin,args,{timeoutMs,maxOutputBytes=256000,spawnImpl=spawn}={}){return new Promise(resolve=>{let stdout='',stderr='',settled=false;const child=spawnImpl(bin,args,{stdio:['ignore','pipe','pipe']});const append=(target,chunk)=>{const next=target+String(chunk);return Buffer.byteLength(next,'utf8')>maxOutputBytes?next.slice(0,maxOutputBytes)+'\n...[truncated]':next};child.stdout?.on('data',c=>{stdout=append(stdout,c)});child.stderr?.on('data',c=>{stderr=append(stderr,c)});const timer=setTimeout(()=>{if(!settled)child.kill('SIGKILL')},timeoutMs);child.on('error',error=>{if(settled)return;settled=true;clearTimeout(timer);resolve({status:'failed',exit_code:null,stdout,stderr:`${stderr}${error.message}`})});child.on('close',(code,signal)=>{if(settled)return;settled=true;clearTimeout(timer);resolve({status:code===0?'success':'failed',exit_code:code,signal:signal||null,stdout,stderr})})})}

export class ContainerSandboxExecutor{
  constructor({engine='docker',image='node:20-alpine',spawnImpl=spawn,tmpRoot=os.tmpdir(),registryNetwork=null,user=defaultUser(),readOnlyRoot=true,requirePinnedImage=false}={}){if(!['docker','podman'].includes(engine))throw new Error('Sandbox engine must be docker or podman');if(requirePinnedImage&&!imageIsDigestPinned(image))throw new Error('Sandbox image must be pinned by digest');this.engine=engine;this.image=image;this.spawnImpl=spawnImpl;this.tmpRoot=tmpRoot;this.registryNetwork=registryNetwork;this.user=user;this.readOnlyRoot=readOnlyRoot}
  async execute({files,plan,project_id='project',attempt=0}={}){const clean=safeFiles(files),root=await fs.mkdtemp(path.join(this.tmpRoot,'multi-agent-sandbox-')),workspace=path.join(root,'workspace');await fs.mkdir(workspace,{recursive:true,mode:0o700});try{for(const file of clean){const target=path.join(workspace,file.path);await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});await fs.writeFile(target,file.content,{mode:0o600})}const results=[];for(const step of Array.isArray(plan?.steps)?plan.steps:[]){const {args,timeoutMs}=dockerArgs({workspace,image:this.image,command:step.command,network:step.network,registryNetwork:this.registryNetwork,memoryMb:plan?.limits?.memory_mb,timeoutMs:step.timeout_ms||plan?.limits?.timeout_ms,user:this.user,readOnlyRoot:this.readOnlyRoot});const result=await spawnCapture(this.engine,args,{timeoutMs,maxOutputBytes:plan?.limits?.max_output_bytes||256000,spawnImpl:this.spawnImpl});results.push({name:String(step.name||'step'),...result});if(result.status!=='success')break}return{passed:results.every(step=>step.status==='success'),project_id,attempt,steps:results}}finally{await fs.rm(root,{recursive:true,force:true})}}
}
