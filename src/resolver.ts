import { spawn } from 'node:child_process';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { LookupAddress } from 'node:dns';
/** OS hosts/NSS lookup with a per-call process and thread pool, never c-ares. */
export function isolatedLookup(hostname:string):{result:Promise<LookupAddress[]>;closed:Promise<void>;stop:()=>void}{
  const literal=hostname.replace(/^\[|\]$/g,''),family=isIP(literal);
  if(family)return {result:Promise.resolve([{address:literal,family}]),closed:Promise.resolve(),stop:()=>{}};
  const env={...process.env};delete env.NODE_OPTIONS;delete env.NODE_PATH;
  const child=spawn(process.execPath,[fileURLToPath(new URL('./resolver-worker.js',import.meta.url))],{env,stdio:['pipe','pipe','ignore'],windowsHide:true});
  let output='',failed=false;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',(chunk:string)=>{output+=chunk;if(output.length>65536){failed=true;child.kill('SIGKILL');}});
  child.on('error',()=>{failed=true;});child.stdin.on('error',()=>{failed=true;});
  let code:number|null=null;
  // The next timer phase also drains the already-reaped child's closing handle.
  const closed=new Promise<void>(resolve=>child.once('close',exitCode=>{code=exitCode;setTimeout(resolve,0);}));
  const result=closed.then(()=>{
    try {const addresses=JSON.parse(output) as LookupAddress[];
      if(failed||code!==0||!Array.isArray(addresses)||!addresses.length||addresses.some(a=>!a||isIP(a.address)!==a.family))throw new Error();
      return addresses;
    } catch {throw new Error('OS hostname lookup failed.');}
  });
  // Always observe rejection, including cancellation before the caller awaits it.
  void result.catch(()=>{});child.stdin.end(JSON.stringify(literal));
  return {result,closed,stop:()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}};
}
