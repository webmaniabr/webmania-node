import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import http from 'node:http';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),arg=process.argv.indexOf('--candidate-tarball'),tarball=arg<0?undefined:resolve(process.argv[arg+1]);
if(!tarball)throw new Error('Pass the immutable --candidate-tarball path.');
const outputArg=process.argv.indexOf('--artifact-directory'),out=outputArg<0?undefined:resolve(process.argv[outputArg+1]);
if(out)mkdirSync(out,{recursive:false});
const started=Date.now(),dir=mkdtempSync(join(tmpdir(),'webmania-node-full-installed-'));
const corpus=JSON.parse(readFileSync(join(root,'test/fixtures/operations.json'),'utf8')).cases;
const enabled=corpus.filter(c=>c.enabled);
const routes=JSON.parse(readFileSync(join(root,'contracts.lock.json'),'utf8'));
const pdf=readFileSync(join(root,'test/fixtures/synthetic-danfe.pdf')),xml=Buffer.from('<?xml version="1.0"?><!-- synthetic --><nfeProc><NFe/></nfeProc>'),zip=readFileSync(join(root,'test/fixtures/synthetic-report.zip'));
const fileNames={nfeDownloadDanfe:'baixarDanfe',nfeDownloadSimpleDanfe:'baixarDanfeSimplificado',nfeDownloadLabelDanfe:'baixarDanfeEtiqueta',nfeDownloadCorrectionPdf:'baixarCartaCorrecaoPdf',nfeDownloadCorrectionPdfSequence:'baixarCartaCorrecaoPdfSequencia',nfeDownloadXml:'baixarXml',nfeDownloadCancellationXml:'baixarXmlCancelamento',nfeDownloadCorrectionXml:'baixarCartaCorrecaoXml',nfeDownloadCorrectionXmlSequence:'baixarCartaCorrecaoXmlSequencia',nfeDownloadManifestationXml:'baixarManifestacaoXml',nfeDownloadPaymentEventXml:'baixarConciliacaoXml',nfeDownloadPaymentEventXmlSequence:'baixarConciliacaoXmlSequencia',nfeDownloadIbsCbsEventXml:'baixarEventoIbsCbsXml',fiscalDownloadReport:'baixarRelatorio'};
const imports=`import assert from 'node:assert/strict';\nimport {NfeClient,MonitorClient,IssuerClient,ResellerClient,FiscalFilesClient,IssuerFilesClient} from '@webmaniabr/sdk';\n`;
const setup=`
const baseUrl=process.env.FIXTURE_URL;if(!baseUrl)throw new Error('Missing loopback fixture');
const credentials={consumerKey:'synthetic-company-key',consumerSecret:'synthetic-company-secret',accessToken:'synthetic-company-access',accessTokenSecret:'synthetic-company-access-secret'};
const resellerCredentials={consumerKey:'synthetic-reseller-key',consumerSecret:'synthetic-reseller-secret',accessToken:'synthetic-reseller-access',accessTokenSecret:'synthetic-reseller-access-secret'};
const pool={Nfe:new NfeClient({baseUrl,credentials}),Monitor:new MonitorClient({baseUrl,bearerToken:'synthetic-monitor'}),Emitter:new IssuerClient({baseUrl,issuerBearerToken:'synthetic-issuer'}),Reseller:new ResellerClient({baseUrl,resellerCredentials}),NfeFiles:new FiscalFilesClient({baseUrl,trustedOrigins:[baseUrl],credentials}),EmitterFiles:new IssuerFilesClient({baseUrl,trustedOrigins:[baseUrl],issuerBearerToken:'synthetic-issuer-files'})};
`;
let js=imports+setup,ts=imports+setup;const types=new Set();
for(const [i,c]of corpus.entries()){
 let statement='';
 if(c.client==='NfeFiles'){
  const values=[Object.values(c.path_params)[0]];if(c.path_params.event!==undefined)values.push(c.path_params.event);if(c.operation!=='fiscalDownloadReport')values.push({type:'company'});
  statement=`pool.NfeFiles.${fileNames[c.operation]}(${values.map(x=>JSON.stringify(x)).join(',')})`;
 }else{
  const args={};if(Object.keys(c.path_params).length)args.path=c.path_params;if(Object.keys(c.query).length)args.query=c.query;if(c.has_request)args.body=c.request;if(c.client==='EmitterFiles')args.authorization={type:'company_bearer'};
  const type=c.client==='EmitterFiles'?'IssuerFileArguments':c.operation[0].toUpperCase()+c.operation.slice(1)+'Arguments';types.add(type);
  js+=`const args${i}=${JSON.stringify(args)};\n`;ts+=`const args${i}:${type}=${JSON.stringify(args)};\n`;
  statement=`pool.${c.client}.${c.operation}(args${i})`;
 }
 const test=!c.enabled?`await assert.rejects(${statement},{kind:'configuration'});\n`:c.binary?`{const result=await ${statement};assert.equal(result.kind,'file');if(result.kind==='file')assert.ok(result.byteLength>0);}\n`:`assert.deepEqual(await ${statement},${JSON.stringify(c.response)});\n`;
 js+=test;ts+=test;
}
ts=imports+`import type {${[...types].join(',')},NfeCancelRequest,MonitorCreateCompanyRequest,MonitorUpdateCompanyRequest} from '@webmaniabr/sdk';\n`+ts.slice(imports.length);
ts+=`
const composed:NfeCancelRequest={uuid:'00000000-0000-4000-8000-000000000001',motivo:'Synthetic cancellation reason'};
const reason:string=composed.motivo;const selector:string|undefined=composed.uuid;void reason;void selector;
// @ts-expect-error Common motivo must remain a typed string across anyOf.
const invalidReason:NfeCancelRequest={uuid:'00000000-0000-4000-8000-000000000001',motivo:123};
// @ts-expect-error Body and operation wrapper are distinct; a wrapper is not a company body.
const invalidCompany:MonitorCreateCompanyRequest={body:{cnpj:'00000000000000'}};
// @ts-expect-error Updating a company requires a typed path wrapper.
const invalidUpdate:MonitorUpdateCompanyArguments={body:{}};
`;
const records=[];let selected=0;
const server=http.createServer(async(req,res)=>{
 const c=enabled[selected++%enabled.length];let raw='';for await(const chunk of req)raw+=chunk;
 const u=new URL(req.url,'http://fixture');let expected=c.path;for(const[k,v]of Object.entries(c.path_params))expected=expected.replace('{'+k+'}',encodeURIComponent(v));if(c.client==='Nfe')expected='/api'+expected;
 assert.equal(u.pathname,expected);assert.equal(req.method,c.http_method);assert.deepEqual(raw?JSON.parse(raw):null,c.request);assert.deepEqual(Object.fromEntries(u.searchParams),Object.fromEntries(Object.entries(c.query).map(([k,v])=>[k,String(v)])));
 const bearer=c.client==='Monitor'?'synthetic-monitor':c.client==='Emitter'?'synthetic-issuer':c.client==='EmitterFiles'?'synthetic-issuer-files':undefined;
 assert.equal(req.headers.authorization,bearer?'Bearer '+bearer:undefined);
 const company=c.client==='Nfe'||(c.client==='NfeFiles'&&c.operation!=='fiscalDownloadReport');assert.equal(req.headers['x-consumer-key'],company?'synthetic-company-key':c.client==='Reseller'?'synthetic-reseller-key':undefined);
 records.push({operation:c.operation,method:req.method,path:u.pathname,body_preserved:true,auth_isolated:true});
 const bytes=c.binary?(c.media_type==='application/pdf'?pdf:['application/xml','text/xml'].includes(c.media_type)?xml:zip):Buffer.from(JSON.stringify(c.response));res.writeHead(c.status,{'Content-Type':c.media_type,'Content-Length':bytes.length});res.end(bytes);
});
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const baseUrl='http://127.0.0.1:'+server.address().port;
 for(const language of ['JavaScript','TypeScript']){
  const consumer=join(dir,language);mkdirSync(consumer);writeFileSync(join(consumer,'package.json'),JSON.stringify({private:true,type:'module'}));
  execFileSync('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund',tarball],{cwd:consumer,stdio:'pipe'});
  // The receipt reports the repository lock, so each installed package must carry the same one.
  assert.deepEqual(JSON.parse(readFileSync(join(consumer,'node_modules/@webmaniabr/sdk/contracts.lock.json'),'utf8')),routes);
  for(const model of ['nfe','nfce','nfse','cte','cte_os','mdfe','nfcom','dce']){const result=JSON.parse(execFileSync(process.execPath,[join(consumer,'node_modules/@webmaniabr/sdk/examples/fiscal-models.mjs'),model],{encoding:'utf8'}));assert.equal(result.network_calls,0);assert.equal(result.environment,2);}
  writeFileSync(join(consumer,language==='JavaScript'?'consumer.mjs':'consumer.ts'),language==='JavaScript'?js:ts);
  if(language==='TypeScript')execFileSync(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'consumer.ts','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--strict','--exactOptionalPropertyTypes','--types','node','--typeRoots',join(root,'node_modules/@types')],{cwd:consumer,stdio:'inherit'});
  const name=language==='JavaScript'?'consumer.mjs':'consumer.js';
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[name],{cwd:consumer,env:{...process.env,FIXTURE_URL:baseUrl},stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(language+' consumer failed')));});
  if(out){writeFileSync(join(out,language==='JavaScript'?'consumer.mjs':'consumer.ts'),language==='JavaScript'?js:ts);}
 }
 assert.equal(records.length,2*enabled.length);
 const receipt={classification:'exact_installed_artifact_controlled_loopback_not_live',result:'pass',node:process.version,package_version:JSON.parse(readFileSync(join(dir,'JavaScript/node_modules/@webmaniabr/sdk/package.json'),'utf8')).version,tarball_sha256:createHash('sha256').update(readFileSync(tarball)).digest('hex'),contract_digest:routes.contract_digest,unique_models:routes.unique_models,consumers:['JavaScript','TypeScript'],empty_consumer_installations:2,enabled_operations_per_consumer:enabled.length,blocked_operations_per_consumer:corpus.length-enabled.length,consumer_http_calls:records.length,negative_types_verified:3,packaged_model_dry_runs:16,elapsed_ms:Date.now()-started,live_api_calls:0,full_fiscal_acceptance:false,safe_merge_certified:false};
 if(out){writeFileSync(join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');writeFileSync(join(out,'interactions.json'),JSON.stringify(records,null,2)+'\n');}
 console.log(JSON.stringify(receipt));
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
