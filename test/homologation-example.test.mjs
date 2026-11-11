import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {chmodSync,copyFileSync,existsSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
// The neutral homologation example against a loopback fixture: masked lines, ledger, never a replay.
const run=new URL('../examples/homologacao/run.sh',import.meta.url).pathname;
const cases=Object.fromEntries(JSON.parse(readFileSync(new URL('./fixtures/operations.json',import.meta.url),'utf8')).cases.map(c=>[c.operation,c]));
const pdf=readFileSync(new URL('./fixtures/synthetic-danfe.pdf',import.meta.url)),xml=readFileSync(new URL('./fixtures/synthetic-nfe.xml',import.meta.url));
const NFE='00000000-0000-4000-8000-0000000000a1',NFSE='00000000-0000-4000-8000-0000000000b2';
const secrets={WEBMANIA_CONSUMER_KEY:'example-key-value',WEBMANIA_CONSUMER_SECRET:'example-secret-value',WEBMANIA_ACCESS_TOKEN:'example-access-value',WEBMANIA_ACCESS_TOKEN_SECRET:'example-access-secret-value',WEBMANIA_ISSUER_TOKEN:'example-issuer-value'};
const clean=extra=>({...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('WEBMANIA_'))),...extra});

test('without WEBMANIA_LIVE=1 the example is blocked before building or any request',()=>{
  const result=spawnSync('sh',[run],{env:clean(secrets),encoding:'utf8'});
  assert.equal(result.status,77);assert.deepEqual(JSON.parse(result.stdout),{result:'blocked'});
});
test('full cycle prints masked steps, records the ledger and issues each document once',async t=>{
  const state={nfe:'aprovado',nfse:'aprovado'},calls=[];
  const json=(r,v)=>{const b=Buffer.from(JSON.stringify(v));r.writeHead(200,{'Content-Type':'application/json','Content-Length':b.length});r.end(b);};
  const bin=(r,b,type)=>{r.writeHead(200,{'Content-Type':type,'Content-Length':b.length});r.end(b);};
  const s=http.createServer((q,r)=>{let body='';q.on('data',d=>body+=d);q.on('end',()=>{const path=q.url.split('?')[0];calls.push(q.method+' '+path);
    if(path==='/api/1/nfe/sefaz/')return json(r,{status:'online'});
    if(path==='/api/1/nfe/certificado/')return json(r,{expiration:30});
    if(path==='/api/1/nfe/classe-imposto/')return json(r,[]);
    if(path==='/2/nfse/status')return json(r,cases.emitterGetNfseProviderStatus.response);
    if(path==='/api/1/nfe/emissao/')return json(r,{uuid:NFE,status:'processando'});
    if(path==='/api/1/nfe/consulta/')return json(r,{uuid:NFE,status:state.nfe});
    if(path==='/api/1/nfe/cancelar/'){state.nfe='cancelado';return json(r,{status:'cancelado'});}
    if(path.startsWith('/danfe/'))return bin(r,pdf,'application/pdf');
    if(path.startsWith('/xmlnfe/'))return bin(r,xml,'text/xml');
    if(path==='/2/nfse/emissao')return json(r,{...cases.emitterIssueNfse.response,uuid:NFSE,status:'processando'});
    if(path==='/2/nfse/consulta/'+NFSE)return json(r,{...cases.emitterGetNfse.response,uuid:NFSE,status:state.nfse,pdf_nfse:'ok'});
    if(path==='/2/nfse/cancelar'){state.nfse='cancelado';return json(r,{...cases.emitterCancelNfse.response,uuid:NFSE,status:'cancelado'});}
    if(path==='/xmlnfse/'+NFSE)return bin(r,Buffer.from('<?xml version="1.0"?><CompNfse/>'),'text/xml');
    if(path==='/nfse/'+NFSE)return bin(r,pdf,'application/pdf');
    r.writeHead(404,{'Content-Type':'application/json'});r.end('{"error":"unexpected"}');});});
  await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{s.close(r);s.closeAllConnections();}));
  const base=`http://127.0.0.1:${s.address().port}`,dir=mkdtempSync(join(tmpdir(),'webmania-example-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  writeFileSync(join(dir,'nfe.json'),JSON.stringify({...cases.nfeIssueDocument.request,ambiente:2}));
  writeFileSync(join(dir,'nfse.json'),JSON.stringify({...cases.emitterIssueNfse.request,ambiente:2}));
  const env=clean({...secrets,WEBMANIA_LIVE:'1',WEBMANIA_LIVE_SCOPE:'all',WEBMANIA_API1_BASE_URL:base+'/api',WEBMANIA_FILES_BASE_URL:base,WEBMANIA_API2_BASE_URL:base,WEBMANIA_LIVE_ALLOWED_HOSTS:'127.0.0.1',WEBMANIA_LIVE_LEDGER:join(dir,'ledger.jsonl'),WEBMANIA_LIVE_NFE_PAYLOAD:join(dir,'nfe.json'),WEBMANIA_LIVE_NFSE_PAYLOAD:join(dir,'nfse.json')});
  const result=await new Promise(resolve=>{const child=spawn('sh',[run],{env});let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('close',status=>resolve({status,out,err}));});
  const lines=result.out.trim().split('\n').map(l=>JSON.parse(l));
  assert.equal(result.status,0,result.out+result.err);
  assert.ok(lines.every(l=>l.ok),result.out);
  for(const step of ['readonly.sefaz','readonly.nfse_provider','nfe.issue','nfe.cancel','nfe.cancellation_xml','nfse.issue','nfse.cancel','nfse.pdf'])assert.ok(lines.some(l=>l.step===step),step);
  for(const value of [...Object.values(secrets),NFE,NFSE,base])assert.ok(!(result.out+result.err).includes(value),'leaked '+value);
  const entries=readFileSync(join(dir,'ledger.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l));
  assert.deepEqual(new Set(entries.map(e=>e.model+':'+e.identifier)),new Set(['nfe:'+NFE,'nfse:'+NFSE]));
  assert.deepEqual(entries.filter(e=>['nfeCancelDocument','emitterCancelNfse'].includes(e.operation)).map(e=>e.status),['cancelado','cancelado']);
  assert.equal(calls.filter(c=>c==='POST /api/1/nfe/emissao/'||c==='POST /2/nfse/emissao').length,2);
});
test('an unknown cancellation outcome is recorded in the ledger as unknown and is never repeated',async t=>{
  for(const [scope,cancelPath,operation,uuid] of [['nfe','/api/1/nfe/cancelar/','nfeCancelDocument',NFE],['nfse','/2/nfse/cancelar','emitterCancelNfse',NFSE]]){
    const calls=[];
    const json=(r,v,status=200)=>{const b=Buffer.from(JSON.stringify(v));r.writeHead(status,{'Content-Type':'application/json','Content-Length':b.length});r.end(b);};
    const bin=(r,b,type)=>{r.writeHead(200,{'Content-Type':type,'Content-Length':b.length});r.end(b);};
    const s=http.createServer((q,r)=>{let body='';q.on('data',d=>body+=d);q.on('end',()=>{const path=q.url.split('?')[0];calls.push(q.method+' '+path);
      if(path===cancelPath)return json(r,{error:'controlled failure'},500);
      if(path==='/api/1/nfe/sefaz/')return json(r,{status:'online'});
      if(path==='/api/1/nfe/certificado/')return json(r,{expiration:30});
      if(path==='/api/1/nfe/classe-imposto/')return json(r,[]);
      if(path==='/2/nfse/status')return json(r,cases.emitterGetNfseProviderStatus.response);
      if(path==='/api/1/nfe/emissao/')return json(r,{uuid:NFE,status:'processando'});
      if(path==='/api/1/nfe/consulta/')return json(r,{uuid:NFE,status:'aprovado'});
      if(path.startsWith('/danfe/'))return bin(r,pdf,'application/pdf');
      if(path.startsWith('/xmlnfe/'))return bin(r,xml,'text/xml');
      if(path==='/2/nfse/emissao')return json(r,{...cases.emitterIssueNfse.response,uuid:NFSE,status:'processando'});
      if(path==='/2/nfse/consulta/'+NFSE)return json(r,{...cases.emitterGetNfse.response,uuid:NFSE,status:'aprovado'});
      if(path==='/xmlnfse/'+NFSE)return bin(r,Buffer.from('<?xml version="1.0"?><CompNfse/>'),'text/xml');
      r.writeHead(404,{'Content-Type':'application/json'});r.end('{"error":"unexpected"}');});});
    await new Promise(r=>s.listen(0,'127.0.0.1',r));
    const base=`http://127.0.0.1:${s.address().port}`,dir=mkdtempSync(join(tmpdir(),'webmania-example-'));
    try{
      writeFileSync(join(dir,'nfe.json'),JSON.stringify({...cases.nfeIssueDocument.request,ambiente:2}));
      writeFileSync(join(dir,'nfse.json'),JSON.stringify({...cases.emitterIssueNfse.request,ambiente:2}));
      const env=clean({...secrets,WEBMANIA_LIVE:'1',WEBMANIA_LIVE_SCOPE:scope,WEBMANIA_API1_BASE_URL:base+'/api',WEBMANIA_FILES_BASE_URL:base,WEBMANIA_API2_BASE_URL:base,WEBMANIA_LIVE_ALLOWED_HOSTS:'127.0.0.1',WEBMANIA_LIVE_LEDGER:join(dir,'ledger.jsonl'),WEBMANIA_LIVE_NFE_PAYLOAD:join(dir,'nfe.json'),WEBMANIA_LIVE_NFSE_PAYLOAD:join(dir,'nfse.json')});
      const result=await new Promise(resolve=>{const child=spawn('sh',[run],{env});let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('close',status=>resolve({status,out,err}));});
      assert.equal(result.status,1,result.out+result.err);
      const lines=result.out.trim().split('\n').map(l=>JSON.parse(l));
      assert.ok(lines.some(l=>l.step===scope+'.cancel'&&l.ok===false&&l.outcome==='unknown'),result.out);
      assert.ok(!lines.some(l=>l.step===scope+'.consult_cancelled'),result.out);
      const entries=readFileSync(join(dir,'ledger.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l));
      assert.deepEqual(entries.at(-1),{model:scope,identifier:uuid,status:'unknown',operation});
      assert.equal(calls.filter(c=>c.endsWith(' '+cancelPath)).length,1,JSON.stringify(calls));
    }finally{rmSync(dir,{recursive:true,force:true});await new Promise(r=>{s.close(r);s.closeAllConnections();});}
  }
});
test('without an allow list the example is blocked before any credential or request',async t=>{
  const calls=[];
  const s=http.createServer((q,r)=>{calls.push(q.method+' '+q.url);r.writeHead(500);r.end();});
  await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{s.close(r);s.closeAllConnections();}));
  const base=`http://127.0.0.1:${s.address().port}`;
  for(const hosts of [undefined,' , ']){
    const env=clean({...secrets,WEBMANIA_LIVE:'1',WEBMANIA_API1_BASE_URL:base+'/api',WEBMANIA_FILES_BASE_URL:base,WEBMANIA_API2_BASE_URL:base,...(hosts===undefined?{}:{WEBMANIA_LIVE_ALLOWED_HOSTS:hosts})});
    // Asynchronous, so the fixture keeps serving (and recording) while the example runs.
    const result=await new Promise(resolve=>{const child=spawn('sh',[run],{env});let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('close',status=>resolve({status,out,err}));});
    assert.equal(result.status,77,result.out+result.err);assert.deepEqual(JSON.parse(result.out),{result:'blocked',reason:'allowed_hosts'});
  }
  assert.deepEqual(calls,[]);
});
test('a mutation scope without a writable ledger is blocked before any request',async t=>{
  const calls=[];
  const s=http.createServer((q,r)=>{calls.push(q.method+' '+q.url);r.writeHead(500);r.end();});
  await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{s.close(r);s.closeAllConnections();}));
  const base=`http://127.0.0.1:${s.address().port}`,dir=mkdtempSync(join(tmpdir(),'webmania-example-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  writeFileSync(join(dir,'nfe.json'),JSON.stringify({...cases.nfeIssueDocument.request,ambiente:2}));
  writeFileSync(join(dir,'nfse.json'),JSON.stringify({...cases.emitterIssueNfse.request,ambiente:2}));
  for(const [scope,variable] of [['nfe','WEBMANIA_LIVE_NFE_PAYLOAD'],['nfse','WEBMANIA_LIVE_NFSE_PAYLOAD']])for(const ledger of [undefined,join(dir,'missing','ledger.jsonl')]){
    const env=clean({...secrets,WEBMANIA_LIVE:'1',WEBMANIA_LIVE_SCOPE:scope,WEBMANIA_API1_BASE_URL:base+'/api',WEBMANIA_FILES_BASE_URL:base,WEBMANIA_API2_BASE_URL:base,WEBMANIA_LIVE_ALLOWED_HOSTS:'127.0.0.1',[variable]:join(dir,scope+'.json'),...(ledger===undefined?{}:{WEBMANIA_LIVE_LEDGER:ledger})});
    const result=await new Promise(resolve=>{const child=spawn('sh',[run],{env});let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('close',status=>resolve({status,out,err}));});
    assert.equal(result.status,77,result.out+result.err);assert.deepEqual(JSON.parse(result.out),{result:'blocked',reason:'ledger'});
  }
  assert.deepEqual(calls,[]);
});
test('the consult after an accepted cancellation succeeds only with status cancelado',async t=>{
  // The fixture accepts each cancellation, but the documents never show 'cancelado'.
  const calls=[];
  const json=(r,v)=>{const b=Buffer.from(JSON.stringify(v));r.writeHead(200,{'Content-Type':'application/json','Content-Length':b.length});r.end(b);};
  const bin=(r,b,type)=>{r.writeHead(200,{'Content-Type':type,'Content-Length':b.length});r.end(b);};
  const s=http.createServer((q,r)=>{let body='';q.on('data',d=>body+=d);q.on('end',()=>{const path=q.url.split('?')[0];calls.push(q.method+' '+path);
    if(path==='/api/1/nfe/sefaz/')return json(r,{status:'online'});
    if(path==='/api/1/nfe/certificado/')return json(r,{expiration:30});
    if(path==='/api/1/nfe/classe-imposto/')return json(r,[]);
    if(path==='/2/nfse/status')return json(r,cases.emitterGetNfseProviderStatus.response);
    if(path==='/api/1/nfe/emissao/')return json(r,{uuid:NFE,status:'processando'});
    if(path==='/api/1/nfe/consulta/')return json(r,{uuid:NFE,status:'aprovado'});
    if(path==='/api/1/nfe/cancelar/')return json(r,{status:'cancelado'});
    if(path.startsWith('/danfe/'))return bin(r,pdf,'application/pdf');
    if(path.startsWith('/xmlnfe/'))return bin(r,xml,'text/xml');
    if(path==='/2/nfse/emissao')return json(r,{...cases.emitterIssueNfse.response,uuid:NFSE,status:'processando'});
    if(path==='/2/nfse/consulta/'+NFSE)return json(r,{...cases.emitterGetNfse.response,uuid:NFSE,status:'aprovado'});
    if(path==='/2/nfse/cancelar')return json(r,{...cases.emitterCancelNfse.response,uuid:NFSE,status:'cancelado'});
    if(path==='/xmlnfse/'+NFSE)return bin(r,Buffer.from('<?xml version="1.0"?><CompNfse/>'),'text/xml');
    r.writeHead(404,{'Content-Type':'application/json'});r.end('{"error":"unexpected"}');});});
  await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{s.close(r);s.closeAllConnections();}));
  const base=`http://127.0.0.1:${s.address().port}`,dir=mkdtempSync(join(tmpdir(),'webmania-example-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  writeFileSync(join(dir,'nfe.json'),JSON.stringify({...cases.nfeIssueDocument.request,ambiente:2}));
  writeFileSync(join(dir,'nfse.json'),JSON.stringify({...cases.emitterIssueNfse.request,ambiente:2}));
  // Same example, with the wait between consults skipped so every attempt runs at once.
  writeFileSync(join(dir,'no-wait.mjs'),"import module from 'node:module';import timers from 'node:timers/promises';timers.setTimeout=async()=>{};module.syncBuiltinESMExports();\n");
  const main=new URL('../examples/homologacao/main.mjs',import.meta.url).pathname;
  const env=clean({...secrets,WEBMANIA_LIVE:'1',WEBMANIA_LIVE_SCOPE:'all',WEBMANIA_API1_BASE_URL:base+'/api',WEBMANIA_FILES_BASE_URL:base,WEBMANIA_API2_BASE_URL:base,WEBMANIA_LIVE_ALLOWED_HOSTS:'127.0.0.1',WEBMANIA_LIVE_LEDGER:join(dir,'ledger.jsonl'),WEBMANIA_LIVE_NFE_PAYLOAD:join(dir,'nfe.json'),WEBMANIA_LIVE_NFSE_PAYLOAD:join(dir,'nfse.json')});
  const result=await new Promise(resolve=>{const child=spawn(process.execPath,['--import',join(dir,'no-wait.mjs'),main],{env});let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('close',status=>resolve({status,out,err}));});
  assert.equal(result.status,1,result.out+result.err);
  const lines=result.out.trim().split('\n').map(l=>JSON.parse(l));
  for(const [model,operation] of [['nfe','nfeGetDocument'],['nfse','emitterGetNfse']]){
    const verdict=lines.filter(l=>l.step===model+'.consult_cancelled'&&!l.ok);
    assert.equal(verdict.length,1,result.out);assert.deepEqual([verdict[0].operation,verdict[0].kind],[operation,'not_cancelled']);
  }
  assert.ok(!lines.some(l=>l.step==='nfe.cancellation_xml'),result.out);
  assert.deepEqual(calls.filter(c=>c.endsWith('/cancelar/')||c.endsWith('/cancelar')).map(c=>c.split(' ')[1]).sort(),['/2/nfse/cancelar','/api/1/nfe/cancelar/']);
  const entries=readFileSync(join(dir,'ledger.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l));
  assert.deepEqual(entries.filter(e=>['nfeCancelDocument','emitterCancelNfse'].includes(e.operation)).map(e=>e.status),['aprovado','aprovado']);
});
// The stand-in npm must be executable, and some sandboxes mount the system temporary directory noexec
// (the stub would be skipped and the real npm run). These runs keep their files in the checkout's
// ignored node_modules/.cache instead.
const execTemp=()=>{const root=fileURLToPath(new URL('../node_modules/.cache/',import.meta.url));mkdirSync(root,{recursive:true});return mkdtempSync(join(root,'webmania-example-'));};
// A stand-in npm on PATH: records each call; `ci` lists any nested copy of the temporary directory and fails.
const fakeNpm=dir=>{const bin=join(dir,'bin');mkdirSync(bin);writeFileSync(join(bin,'npm'),['#!/bin/sh','echo "npm $*" >> "$FAKE_NPM_LOG"','if [ "$1" = ci ]; then find . -name "webmania-example.*" >> "$FAKE_NPM_LOG"; [ -f marker.txt ] && echo copied >> "$FAKE_NPM_LOG"; exit 1; fi','exit 0',''].join('\n'));chmodSync(join(bin,'npm'),0o755);return bin;};
test('the npm script builds only after the WEBMANIA_LIVE guard',t=>{
  assert.equal(JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).scripts['example:homologacao'],'sh examples/homologacao/run.sh --build');
  const dir=execTemp();t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const bin=fakeNpm(dir),log=join(dir,'npm.log'),PATH=bin+':'+process.env.PATH;
  const blocked=spawnSync('sh',[run,'--build'],{env:clean({PATH,FAKE_NPM_LOG:log}),encoding:'utf8'});
  assert.equal(blocked.status,77);assert.deepEqual(JSON.parse(blocked.stdout),{result:'blocked'});assert.ok(!existsSync(log),'built before the guard');
  // Enabled without the allow list or credentials: the build runs first, then the example stops before any request.
  const enabled=spawnSync('sh',[run,'--build'],{env:clean({PATH,FAKE_NPM_LOG:log,WEBMANIA_LIVE:'1'}),encoding:'utf8'});
  assert.equal(enabled.status,77,enabled.stdout+enabled.stderr);assert.deepEqual(JSON.parse(enabled.stdout),{result:'blocked',reason:'allowed_hosts'});
  assert.equal(readFileSync(log,'utf8'),'npm run build\n');
});
test('the temporary copy of a checkout without dist/ never copies itself and is removed when installation fails',t=>{
  const dir=execTemp();t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const bin=fakeNpm(dir),log=join(dir,'npm.log'),checkout=join(dir,'checkout'),temp=join(checkout,'tmp [x]*');
  mkdirSync(join(checkout,'examples/homologacao'),{recursive:true});mkdirSync(temp);
  copyFileSync(run,join(checkout,'examples/homologacao/run.sh'));writeFileSync(join(checkout,'package.json'),'{}');writeFileSync(join(checkout,'marker.txt'),'synthetic');
  const result=spawnSync('sh',[join(checkout,'examples/homologacao/run.sh')],{env:clean({PATH:bin+':'+process.env.PATH,FAKE_NPM_LOG:log,TMPDIR:temp,WEBMANIA_LIVE:'1'}),encoding:'utf8'});
  assert.equal(result.status,1,result.stdout+result.stderr);
  assert.equal(readFileSync(log,'utf8'),'npm ci --ignore-scripts --no-audit --no-fund\ncopied\n');
  assert.deepEqual(readdirSync(temp),[]);
});
