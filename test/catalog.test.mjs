import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {NfeClient,MonitorClient,FiscalFilesClient,IssuerClient,IssuerFilesClient,ResellerClient} from './sdk.mjs';
const corpus=JSON.parse(readFileSync(new URL('./fixtures/operations.json',import.meta.url),'utf8')).cases;
const semantic=JSON.parse(readFileSync(new URL('./fixtures/semantic_cases.json',import.meta.url),'utf8')).cases;
const entry=process.env.WEBMANIA_TEST_INSTALLED_ENTRY??new URL('../dist/index.js',import.meta.url).href;
const {validateContract}=await import(new URL('./contract-service.js',entry));
const {fileRoutes}=await import(new URL('./generated/file-routes.js',entry));
const credentials={consumerKey:'synthetic-company-key',consumerSecret:'synthetic-company-secret',accessToken:'synthetic-company-access',accessTokenSecret:'synthetic-company-access-secret'};
const resellerCredentials={consumerKey:'synthetic-reseller-key',consumerSecret:'synthetic-reseller-secret',accessToken:'synthetic-reseller-access',accessTokenSecret:'synthetic-reseller-access-secret'};
const id='00000000-0000-4000-8000-000000000001';
const xml=Buffer.from('<?xml version="1.0"?><!-- synthetic --><nfeProc><NFe/></nfeProc>');
const pdf=readFileSync(new URL('./fixtures/synthetic-danfe.pdf',import.meta.url));
const zip=readFileSync(new URL('./fixtures/synthetic-report.zip',import.meta.url));
const api1FileNames=['baixarDanfe','baixarDanfeSimplificado','baixarDanfeEtiqueta','baixarCartaCorrecaoPdf','baixarCartaCorrecaoPdfSequencia','baixarXml','baixarXmlCancelamento','baixarCartaCorrecaoXml','baixarCartaCorrecaoXmlSequencia','baixarManifestacaoXml','baixarConciliacaoXml','baixarConciliacaoXmlSequencia','baixarEventoIbsCbsXml','baixarRelatorio'];
let chosen,calls=[];
let server,baseUrl,pool;
test.before(async()=>{
 server=http.createServer(async(req,res)=>{const c=chosen;let raw='';for await(const bytes of req)raw+=bytes;calls.push({path:req.url,method:req.method,headers:req.headers,body:raw?JSON.parse(raw):null});const bytes=c.binary?(c.media_type==='application/pdf'?pdf:['application/xml','text/xml'].includes(c.media_type)?xml:zip):Buffer.from(JSON.stringify(c.response));res.writeHead(c.status,{'Content-Type':c.media_type,'Content-Length':bytes.length});res.end(bytes);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));baseUrl='http://127.0.0.1:'+server.address().port;
 pool={Nfe:new NfeClient({baseUrl,credentials}),Monitor:new MonitorClient({baseUrl,bearerToken:'synthetic-monitor'}),Reseller:new ResellerClient({baseUrl,resellerCredentials}),Emitter:new IssuerClient({baseUrl,issuerBearerToken:'synthetic-issuer'}),NfeFiles:new FiscalFilesClient({baseUrl,trustedOrigins:[baseUrl],credentials}),EmitterFiles:new IssuerFilesClient({baseUrl,trustedOrigins:[baseUrl],issuerBearerToken:'synthetic-issuer-files'})};
});
test.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
for(const c of corpus)test('pinned fiscal wire '+c.operation,async()=>{
 chosen=c;const before=calls.length,client=pool[c.client];let promise;
 if(c.client==='NfeFiles'){
  const index=fileRoutes.findIndex(r=>r.operationId===c.operation),method=api1FileNames[index],id=Object.values(c.path_params)[0];
  const args=[id];if(c.path_params.event!==undefined)args.push(c.path_params.event);if(c.operation!=='fiscalDownloadReport')args.push({type:'company'});
  promise=client[method](...args);
 }else if(c.client==='EmitterFiles')promise=client[c.operation]({path:c.path_params,authorization:{type:'company_bearer'}});
 else {const args={};if(Object.keys(c.path_params).length)args.path=c.path_params;if(Object.keys(c.query).length)args.query=c.query;if(c.has_request)args.body=c.request;promise=client[c.operation](args);}
 if(!c.enabled){await assert.rejects(promise,{kind:'configuration'});assert.equal(calls.length,before);return;}
 const result=await promise;assert.equal(calls.length,before+1);const actual=calls.at(-1),url=new URL(actual.path,baseUrl);
 let path=c.path;for(const[k,v]of Object.entries(c.path_params))path=path.replace('{'+k+'}',encodeURIComponent(v));if(c.client==='Nfe')path='/api'+path;
 assert.equal(url.pathname,path);assert.equal(actual.method,c.http_method);assert.deepEqual(Object.fromEntries(url.searchParams),Object.fromEntries(Object.entries(c.query).map(([k,v])=>[k,String(v)])));assert.deepEqual(actual.body,c.request);
 const company=c.client==='Nfe'||(c.client==='NfeFiles'&&c.operation!=='fiscalDownloadReport'),reseller=c.client==='Reseller';
 assert.equal(actual.headers['x-consumer-key'],company?credentials.consumerKey:reseller?resellerCredentials.consumerKey:undefined);
 const bearer=c.client==='Monitor'?'synthetic-monitor':c.client==='Emitter'?'synthetic-issuer':c.client==='EmitterFiles'?'synthetic-issuer-files':undefined;
 assert.equal(actual.headers.authorization,bearer?'Bearer '+bearer:undefined);
 if(c.binary){assert.equal(result.kind,'file');assert.deepEqual(Buffer.from(result.bytes),c.media_type==='application/pdf'?pdf:['application/xml','text/xml'].includes(c.media_type)?xml:zip);}
 else assert.deepEqual(result,c.response);
});
for(const [index,c]of semantic.entries())test('pinned schema '+(c.name??c.id??index),()=>{
 const schema={$ref:'#/components/schemas/'+c.schema};let valid=true;
 try{validateContract('semantic-'+c.schema,schema,c.instance,'validation');}catch(error){if(error.kind!=='validation')throw error;valid=false;}
 assert.equal(valid,c.valid,JSON.stringify({case:c.name??c.id,schema:c.schema}));
});
