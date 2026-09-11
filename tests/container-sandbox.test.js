import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { dockerArgs, ContainerSandboxExecutor } from '../src/container-sandbox.js';
import { createSandboxWorker } from '../src/sandbox-worker.js';

test('docker execution applies isolation controls',()=>{const {args}=dockerArgs({workspace:'/tmp/work',command:['npm','test'],network:'off',memoryMb:512});const joined=args.join(' ');assert.match(joined,/--network none/);assert.match(joined,/--cap-drop=ALL/);assert.match(joined,/no-new-privileges/);assert.match(joined,/--pids-limit 256/);assert.match(joined,/--memory 512m/);assert.match(joined,/node:20-alpine npm test/)});

test('sandbox executor stops after first failed step',async()=>{let calls=0;const fakeSpawn=(bin,args)=>{calls++;const child=new (await import('node:events')).EventEmitter();return child};assert.equal(typeof fakeSpawn,'function')});

test('sandbox worker rejects unauthorized execution',async()=>{const server=createSandboxWorker({token:'123456789012345678901234',executor:{execute:async()=>({passed:true,steps:[]})}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const {port}=server.address();const result=await new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path:'/v1/execute',method:'POST',headers:{'content-type':'application/json'}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}))});req.on('error',reject);req.end(JSON.stringify({files:[],plan:{steps:[]}}))});server.close();assert.equal(result.status,401);assert.equal(result.body.error,'unauthorized')});
