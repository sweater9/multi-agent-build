import fs from 'node:fs/promises';
import path from 'node:path';

function safeId(value){const id=String(value||'').trim();if(!/^[a-z0-9-]{8,80}$/i.test(id))throw new Error('Invalid project id');return id}
function safeRelative(value){const p=String(value||'').replace(/\\/g,'/').replace(/^\/+/, '');if(!p||p.includes('..')||p.startsWith('.git/')||p==='.'||p.length>240)throw new Error('Invalid project file path');return p}

export class ProjectWorkspaceStore{
 constructor({directory='.multi-agent-projects'}={}){this.directory=directory}
 async save(project){const id=safeId(project?.project_id);const root=path.join(this.directory,id);await fs.mkdir(root,{recursive:true,mode:0o700});const manifest={...project,files:(project.files||[]).map(f=>({path:safeRelative(f.path),size:Buffer.byteLength(String(f.content||''),'utf8')}))};await fs.writeFile(path.join(root,'project.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});for(const file of project.files||[]){const rel=safeRelative(file.path),target=path.join(root,'files',rel);await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});await fs.writeFile(target,String(file.content||''),{mode:0o600})}return manifest}
 async load(projectId){const id=safeId(projectId),root=path.join(this.directory,id),manifest=JSON.parse(await fs.readFile(path.join(root,'project.json'),'utf8'));const files=[];for(const file of manifest.files||[]){files.push({...file,content:await fs.readFile(path.join(root,'files',safeRelative(file.path)),'utf8')})}return{...manifest,files}}
}
