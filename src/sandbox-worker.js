import http from 'node:http';
import crypto from 'node:crypto';
import { ContainerSandboxExecutor } from './container-sandbox.js';

function json(res,status,body){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body))}
function readBody(req,max=6*1024*1024){return new Promise((resolve,reject)=>{const chunks=[];let size=0;req.on('data',chunk=>{size+=chunk.length;if(size>max){reject(Object.assign(new Error('Payload too large'),{statusCode:413}));req.destroy();return}chunks.push(chunk)});req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject)})}
function secureEqual(a,b){const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb)}

export function createSandboxWorker({executor,token,maxBodyBytes=6*1024*1024}={}){
  if(!executor?.execute)throw new Error('executor is required');if(!token||String(token).length<24)throw new Error('sandbox token must be at least 24 characters');
  return http.createServer(async(req,res)=>{try{const url=new URL(req.url||'/','http://localhost');if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{ok:true,service:'multi-agent-sandbox'});if(req.method==='POST'&&url.pathname==='/v1/execute'){const auth=String(req.headers.authorization||'');if(!auth.startsWith('Bearer ')||!secureEqual(auth.slice(7),token))return json(res,401,{error:'unauthorized'});const raw=await readBody(req,maxBodyBytes);let body;try{body=JSON.parse(raw.toString('utf8'))}catch{return json(res,400,{error:'invalid_json'})}if(!Array.isArray(body?.files)||!body?.plan)return json(res,400,{error:'invalid_execution_request'});const result=await executor.execute(body);return json(res,200,result)}return json(res,404,{error:'not_found'})}catch(error){const status=Number(error?.statusCode)||500;return json(res,status,{error:status===500?'execution_failed':String(error.message||'error').slice(0,500)})}})
}

export function createSandboxWorkerFromEnvironment(env=process.env){const token=String(env.SANDBOX_WORKER_TOKEN||'').trim();const engine=String(env.SANDBOX_ENGINE||'docker').trim().toLowerCase();const image=String(env.SANDBOX_NODE_IMAGE||'node:20-alpine').trim();return createSandboxWorker({token,executor:new ContainerSandboxExecutor({engine,image})})}

if(import.meta.url===`file://${process.argv[1]}`){const server=createSandboxWorkerFromEnvironment();const port=Number(process.env.PORT||4040);server.listen(port,'0.0.0.0',()=>process.stdout.write(`multi-agent sandbox worker listening on ${port}\n`))}
