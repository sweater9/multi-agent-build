import { spawn } from 'node:child_process';
import { imageIsDigestPinned,spawnCapture } from './container-sandbox.js';

function cleanEngine(value){const engine=String(value||'docker').trim().toLowerCase();if(!['docker','podman'].includes(engine))throw new Error('Sandbox engine must be docker or podman');return engine}
function cleanNetwork(value){const network=String(value||'').trim();if(!network)throw new Error('SANDBOX_REGISTRY_NETWORK is required');if(['bridge','host','none','default'].includes(network.toLowerCase()))throw new Error('SANDBOX_REGISTRY_NETWORK must be a dedicated isolated network');if(!/^[A-Za-z0-9_.-]{1,128}$/.test(network))throw new Error('SANDBOX_REGISTRY_NETWORK is invalid');return network}
export async function runSandboxPreflight({engine='docker',registryNetwork,nodeImage='node:20-alpine',browserImage='mcr.microsoft.com/playwright:v1.55.0-noble',requirePinnedImages=false,spawnImpl=spawn}={}){
 const runtime=cleanEngine(engine),network=cleanNetwork(registryNetwork),checks=[];
 const version=await spawnCapture(runtime,['version','--format','{{.Server.Version}}'],{timeoutMs:5000,maxOutputBytes:20000,spawnImpl});checks.push({id:'engine',passed:version.status==='success',detail:(version.stdout||version.stderr||'').trim().slice(0,500)});if(version.status!=='success')return{ready:false,engine:runtime,registry_network:network,checks};
 const inspect=await spawnCapture(runtime,['network','inspect',network],{timeoutMs:5000,maxOutputBytes:50000,spawnImpl});checks.push({id:'registry-network',passed:inspect.status==='success',detail:inspect.status==='success'?'configured':(inspect.stderr||inspect.stdout||'network inspect failed').trim().slice(0,500)});if(inspect.status!=='success')return{ready:false,engine:runtime,registry_network:network,checks};
 const nodePinned=imageIsDigestPinned(nodeImage),browserPinned=imageIsDigestPinned(browserImage);checks.push({id:'node-image-pinned',passed:nodePinned||!requirePinnedImages});checks.push({id:'browser-image-pinned',passed:browserPinned||!requirePinnedImages});
 return{ready:checks.every(c=>c.passed),engine:runtime,registry_network:network,node_image_digest_pinned:nodePinned,browser_image_digest_pinned:browserPinned,checks};
}
export async function assertSandboxPreflight(options={}){const result=await runSandboxPreflight(options);if(!result.ready){const failed=result.checks.filter(c=>!c.passed).map(c=>c.id).join(', ');throw new Error(`Sandbox runtime preflight failed: ${failed||'unknown'}`)}return result}
