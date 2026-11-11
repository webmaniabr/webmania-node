import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {inspect} from 'node:util';
import {readFileSync} from 'node:fs';
import {NfeClient,MonitorClient,IssuerClient,IssuerFilesClient,ResellerClient} from './sdk.mjs';
const id='ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF',other='12345678-1234-4234-8234-123456789abc';
const credentials={consumerKey:'company-key',consumerSecret:'company-secret',accessToken:'company-access',accessTokenSecret:'company-access-secret'};
const report={modelo:'nfe',relatorio:'xml',status:'emitidas',data_inicio:'2026-10-01',data_final:'2026-10-25'};
async function fixture(t,handler){const calls=[];const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const record={path:req.url,method:req.method,headers:req.headers,raw,body:raw?JSON.parse(raw):undefined};calls.push(record);handler(req,res,record);});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});return {baseUrl:'http://127.0.0.1:'+server.address().port,calls};}
function json(res,value,status=200,headers={}){res.writeHead(status,{'Content-Type':'application/json',...headers});res.end(JSON.stringify(value));}
function files(baseUrl,extra={}){return new IssuerFilesClient({baseUrl,trustedOrigins:[baseUrl],issuerBearerToken:'issuer-file-secret',...extra});}
function fileArgs(authorization={type:'company_bearer'}){return {path:{identifier:id},authorization};}

test('ERR-02 one actual serializer snapshot protects all values and extension keys through accepted depth',async t=>{
 const scalar='private-generic-canary',key='private-extension-key-canary';let nested={[key]:scalar};for(let i=0;i<62;i++)nested={level:nested};let serializations=0;
 const wire={informacoes_fisco:'Synthetic information',nested};const payload={toJSON(){serializations++;return wire;}};
 const {baseUrl,calls}=await fixture(t,(_req,res)=>json(res,{error:'DENIED',message:scalar,[key]:scalar,code:'SAFE_BUSINESS_CODE',retry:false,count:0},400));
 await assert.rejects(new NfeClient({baseUrl,credentials}).atualizarEmpresa(payload),error=>{assert.equal(error.kind,'http');assert.equal(error.response.code,'SAFE_BUSINESS_CODE');assert.equal(error.response.retry,false);assert.equal(error.response.count,0);assert.ok(!JSON.stringify(error).includes(scalar));assert.ok(!JSON.stringify(error).includes(key));return true;});
 assert.equal(serializations,1);assert.deepEqual(calls[0].body,wire);
 let tooDeep={};for(let i=0;i<65;i++)tooDeep={child:tooDeep};await assert.rejects(new NfeClient({baseUrl,credentials}).atualizarEmpresa({tooDeep}),{kind:'validation'});assert.equal(calls.length,1);
 // A serializer cannot bypass required schema fields.
 await assert.rejects(new NfeClient({baseUrl,credentials}).cancelarDocumento({uuid:id,motivo:'Synthetic cancellation reason',toJSON(){return {};}}),{kind:'validation'});assert.equal(calls.length,1);
});

test('ERR-04 recovery is protected, usable in a single explicit consultation and excludes secret collisions',async t=>{
 const {baseUrl,calls}=await fixture(t,(req,res)=>{if(req.method==='PUT')json(res,{error:'uncertain',copy:id},500);else json(res,{uuid:id,status:'cancelado'});});
 const client=new NfeClient({baseUrl,credentials});let recovery;
 await assert.rejects(client.cancelarDocumento({uuid:id,motivo:'Synthetic cancellation reason'}),error=>{assert.equal(error.outcome,'unknown');assert.ok(!JSON.stringify(error).includes(id));assert.ok(!inspect(error).includes(id));recovery=error.recovery.reveal();assert.equal(recovery.uuid,id);return true;});
 assert.equal((await client.consultarDocumento(recovery)).uuid,id);assert.equal(calls.length,2);
 const collision=new NfeClient({baseUrl,credentials:{...credentials,accessToken:id}});
 await assert.rejects(collision.cancelarDocumento({uuid:id,motivo:'Synthetic cancellation reason'}),error=>{assert.equal(error.recovery,undefined);return true;});assert.equal(calls.length,3);
});

test('REDIR-02 sent mutation redirects preserve uncertainty and passive reads remain passive',async t=>{
 let forwarded=0;const destination=await fixture(t,(_req,res)=>{forwarded++;json(res,{status:'online'});});
 const {baseUrl,calls}=await fixture(t,(_req,res)=>{res.writeHead(303,{Location:destination.baseUrl+'/target/'+other});res.end();});
 const client=new NfeClient({baseUrl,credentials});
 await assert.rejects(client.cancelarDocumento({uuid:id,motivo:'Synthetic cancellation reason'}),error=>error.kind==='http'&&error.status===303&&error.outcome==='unknown'&&error.recovery.reveal().uuid===id);
 await assert.rejects(client.consultarSefaz(),error=>error.kind==='http'&&error.outcome===undefined);assert.equal(calls.length,2);assert.equal(forwarded,0);
});

test('REDIR-01 documented NFSe Location is protected absolute/relative metadata with zero forwarding',async t=>{
 let location,forwarded=0;const destination=await fixture(t,(_req,res)=>{forwarded++;json(res,{msg:'unexpected'});});
 const {baseUrl,calls}=await fixture(t,(_req,res)=>{res.writeHead(302,{Location:location});res.end();});const client=files(baseUrl);
 for(location of [destination.baseUrl+'/darps/'+other+'?token=opaque-secret','/darps/'+other+'?token=opaque-secret']){
  const result=await client.fileGetNfsePdf(fileArgs());assert.equal(result.kind,'redirect');assert.equal(result.location.reveal(),location);assert.ok(!JSON.stringify(result).includes(other));assert.ok(!inspect(result).includes('opaque-secret'));
 }
 assert.equal(calls.length,2);assert.equal(forwarded,0);
});

test('REDIR-03 Location values are observed before diagnostics even with malformed authority',async t=>{
 const query='FEDCBA98-7654-4321-8765-ABCDEFABCDEF',username='OpaqueUserCanary',authority='OpaqueHostCanary.invalid';let location,status=400;
 const {baseUrl}=await fixture(t,(_req,res)=>json(res,{error:'DENIED',path_case:other.toUpperCase(),opaque_exact:query,opaque_alternative:query.toLowerCase(),authority,user:username,code:'DENIED'},status,{Location:location,'X-Request-ID':other.toUpperCase()+' '+query}));
 const client=files(baseUrl);
 for(location of ['https://'+username+':OpaquePasswordCanary@'+authority+'/darps/'+other+'?token='+query+'#FragmentCanary','https://['+username+'@'+authority+'/darps/'+other+'?token='+query+'#FragmentCanary']){
  await assert.rejects(client.fileGetNfsePdf(fileArgs()),error=>{assert.ok(!JSON.stringify(error).includes(other.toUpperCase()));assert.ok(!JSON.stringify(error).includes(query));assert.ok(!JSON.stringify(error).includes(username));assert.ok(!JSON.stringify(error).includes(authority));assert.equal(error.response.opaque_alternative,query.toLowerCase());return true;});
 }
 status=302;location='https://[bad/darps/'+other+'?token='+query;await assert.rejects(client.fileGetNfsePdf(fileArgs()),error=>error.kind==='protocol'&&!JSON.stringify(error).includes(other));
});

test('REDIR-01 missing duplicate and malformed Location fail without a fetch',async t=>{
 let mode=0;const {baseUrl,calls}=await fixture(t,(_req,res)=>{const headers=mode===0?{}:mode===1?{Location:['/darps/'+id,'/darps/'+other]}:{Location:'https://[bad/darps/'+id};res.writeHead(302,headers);res.end();});
 for(mode of [0,1,2])await assert.rejects(files(baseUrl).fileGetNfsePdf(fileArgs()),{kind:'protocol'});assert.equal(calls.length,3);
});

test('AUTH-01 API2 file modes are explicit and never fall back, MDF-e requires company Bearer',async t=>{
 const {baseUrl,calls}=await fixture(t,(_req,res)=>json(res,{error:'DENIED'},401));const client=files(baseUrl);
 for(const authorization of [{type:'company_bearer'},{type:'document_token',token:'document-opaque'},{type:'public'}])await assert.rejects(client.fileGetNfseXml(fileArgs(authorization)),{kind:'http',status:401});
 assert.equal(calls.length,3);assert.equal(calls[0].headers.authorization,'Bearer issuer-file-secret');assert.equal(calls[1].headers.authorization,undefined);assert.equal(new URL(calls[1].path,baseUrl).searchParams.get('token'),'document-opaque');assert.equal(calls[2].headers.authorization,undefined);assert.equal(new URL(calls[2].path,baseUrl).search,'');
 for(const authorization of [{type:'public'},{type:'document_token',token:'x'}])await assert.rejects(client.fileGetMdfeXml(fileArgs(authorization)),{kind:'validation'});assert.equal(calls.length,3);
});

test('ERR-05 effect policy covers API2 file GET, reseller recovery GET and conditional Monitor refresh',async t=>{
 const {baseUrl,calls}=await fixture(t,(_req,res)=>json(res,{error:'UPSTREAM'},500));const monitor=new MonitorClient({baseUrl,bearerToken:'monitor'});
 await assert.rejects(monitor.monitorGetDocument({path:{fd:id},query:{atualizar_status:1}}),e=>e.outcome==='unknown');
 await assert.rejects(monitor.monitorGetDocument({path:{fd:id}}),e=>e.outcome===undefined);
 await assert.rejects(files(baseUrl).fileGetNfseXml(fileArgs()),e=>e.outcome==='unknown');
 const reseller=new ResellerClient({baseUrl,resellerCredentials:credentials});await assert.rejects(reseller.b2bV1ListCompanies(),e=>e.outcome==='unknown');await assert.rejects(reseller.b2bV1GetProcessedRequests(),e=>e.outcome===undefined);
 assert.equal(calls.length,5);
});

test('PAGE-01 all three collections keep page size and return precise continuation after item75',async t=>{
 const {baseUrl,calls}=await fixture(t,(req,res)=>{const u=new URL(req.url,'http://fixture'),page=Number(u.searchParams.get('page')),size=Number(u.searchParams.get('per_page'));const data=Array.from({length:Math.max(0,Math.min(size,80-(page-1)*size))},(_v,i)=>({uuid:id,item:(page-1)*size+i,...(u.pathname.includes('municipios-nfse')?{tipo_download:1,municipio:'Synthetic city',uf:'SP',codigo_ibge:'3550308'}:u.pathname.includes('relatorios')?{relatorio:'xml',modelo:'nfe',status:'concluido'}:{})}));json(res,{data,meta:{current_page:page,last_page:2,per_page:size,total:80}});});
 const client=new MonitorClient({baseUrl,bearerToken:'monitor'});
 for(const collect of [()=>client.coletarEmpresas({per_page:50},{maxItems:75}),()=>client.coletarMunicipiosEmpresa(id,{per_page:50},{maxItems:75}),()=>client.coletarRelatorios({per_page:50},{maxItems:75})]){const result=await collect();assert.deepEqual(result.items.map(x=>x.item),Array.from({length:75},(_v,i)=>i));assert.deepEqual(result.continuation,{page:2,index:25,per_page:50});}
 assert.equal(calls.length,6);assert.ok(calls.every(c=>new URL(c.path,baseUrl).searchParams.get('per_page')==='50'));
});

test('PAGE-02 safe huge starting page survives and invalid metadata or limits fail explicitly',async t=>{
 let mismatch=false;const large=2147483665;const {baseUrl,calls}=await fixture(t,(req,res)=>{const u=new URL(req.url,'http://fixture'),page=Number(u.searchParams.get('page'));json(res,{data:[{uuid:id}],meta:{current_page:page,last_page:page,per_page:mismatch?10:50,total:1}});});const client=new MonitorClient({baseUrl,bearerToken:'monitor'});
 assert.equal((await client.coletarEmpresas({page:large})).items.length,1);assert.equal(new URL(calls[0].path,baseUrl).searchParams.get('page'),String(large));
 for(const query of [{page:null},{page:0},{page:9007199254740992},{per_page:null},{per_page:1}])await assert.rejects(client.coletarEmpresas(query),{kind:'validation'});assert.equal(calls.length,1);
 mismatch=true;await assert.rejects(client.coletarEmpresas(),{kind:'protocol'});assert.equal(calls.length,2);
});

test('FILE-01 API2 pending HTML protected and valid representations remain distinct',async t=>{
 let bytes,media='application/pdf';const {baseUrl}=await fixture(t,(_req,res)=>{res.writeHead(200,{'Content-Type':media,'Content-Disposition':'attachment; filename="synthetic"'});res.end(bytes);});const client=files(baseUrl);
 bytes=Buffer.from('{"msg":"Still retrieving municipal PDF"}');media='application/json';assert.equal((await client.fileGetNfsePdf(fileArgs())).kind,'pending');await assert.rejects(client.fileGetCtePdf(fileArgs()),{kind:'protocol'});
 bytes=Buffer.from('<html><iframe src="https://untrusted.invalid"></iframe></html>');media='text/html';assert.equal((await client.fileGetCtePdf(fileArgs())).kind,'html');
 bytes=readFileSync(new URL('./fixtures/synthetic-report.zip',import.meta.url));media='application/zip';assert.equal((await client.fileGetNfseXml(fileArgs({type:'public'}))).kind,'protected_archive');
 bytes=Buffer.from('%PDF-1.4\ntrailer << /Encrypt 8 0 R >>\n%%EOF');media='application/pdf';assert.equal((await client.fileGetCtePdf(fileArgs())).kind,'protected_pdf');
 bytes=Buffer.from('<CTe/>');media='text/xml';const result=await client.fileGetCteXml(fileArgs());assert.equal(result.kind,'file');assert.deepEqual(Buffer.from(result.bytes),bytes);assert.equal(result.contentDisposition,'attachment; filename="synthetic"');
 bytes=Buffer.from('<!DOCTYPE CTe SYSTEM "https://invalid.example/entity"><CTe/>');await assert.rejects(client.fileGetCteXml(fileArgs()),{kind:'protocol'});
});

async function rawFixture(t,response){let calls=0;const sockets=new Set();const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let input='';socket.on('data',chunk=>{input+=chunk;if(input.includes('\r\n\r\n')){calls++;socket.end(response);input='';}});});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{for(const s of sockets)s.destroy();return new Promise(r=>server.close(r));});return {baseUrl:'http://127.0.0.1:'+server.address().port,calls:()=>calls};}
for(const [name,response]of Object.entries({close:'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{"status":"online"}',http10:'HTTP/1.0 200 OK\r\nContent-Type: application/json\r\n\r\n{"status":"online"}',information:'HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 103 Early Hints\r\nLink: </style.css>\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\nTrailer: X-Synthetic\r\n\r\n13\r\n{"status":"online"}\r\n0\r\nX-Synthetic: done\r\n\r\n'}))test('HTTP-01/02 complete '+name+' remains usable on another call',async t=>{const f=await rawFixture(t,response),client=new NfeClient({baseUrl:f.baseUrl,credentials});assert.equal((await client.consultarSefaz()).status,'online');assert.equal((await client.consultarSefaz()).status,'online');assert.equal(f.calls(),2);});
for(const [name,response]of Object.entries({truncated:'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 999\r\n\r\n{',switch:'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: synthetic\r\n\r\n',ambiguous:'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 1\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n',duplicate:'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Type: application/json\r\nContent-Length: 19\r\n\r\n{"status":"online"}'}))test('HTTP-01/02 invalid '+name+' fails without replay',async t=>{const f=await rawFixture(t,response);await assert.rejects(new NfeClient({baseUrl:f.baseUrl,credentials,timeoutMs:1000}).consultarSefaz());assert.equal(f.calls(),1);});

test('POLL-01 learned UUID URL and opaque token context stays scoped and serializer runs once',async t=>{
 const opaque='FEDCBA98-7654-4321-8765-ABCDEFABCDEF';let serializations=0;const times=[];
 const {baseUrl,calls}=await fixture(t,(_req,res,record)=>{times.push(Date.now());if(calls.length===1)json(res,{uuid:id,status:'processando',url:'https://reports.invalid/report/'+other+'?token='+opaque,token:opaque});else json(res,{error:'DENIED',known:id.toLowerCase(),path:other.toUpperCase(),opaque_exact:opaque,opaque_alternative:opaque.toLowerCase()},400);});const client=new NfeClient({baseUrl,credentials});
 await assert.rejects(client.aguardarRelatorio({toJSON(){serializations++;return report;}},{maxAttempts:2,intervalMs:5000,deadlineMs:15000}),error=>{assert.ok(!JSON.stringify(error).includes(id.toLowerCase()));assert.ok(!JSON.stringify(error).includes(other.toUpperCase()));assert.ok(!JSON.stringify(error).includes(opaque));assert.equal(error.response.opaque_alternative,opaque.toLowerCase());return true;});
 assert.equal(serializations,1);assert.equal(calls[0].raw,calls[1].raw);assert.ok(times[1]-times[0]>=4990);
 await assert.rejects(client.atualizarEmpresa({informacoes_fisco:'Independent workflow'}),error=>{assert.equal(error.response.known,id.toLowerCase());return true;});assert.equal(calls.length,3);
 const importBody=JSON.parse(readFileSync(new URL('./fixtures/operations.json',import.meta.url),'utf8')).cases.find(c=>c.operation==='monitorImportDocument').request;
 await assert.rejects(new MonitorClient({baseUrl,bearerToken:'monitor'}).monitorImportDocument({body:importBody}),error=>{assert.equal(error.response.known,id.toLowerCase());return true;});assert.equal(calls.length,4);
});

test('HTTP-03 received GET POST PUT DELETE requests are not replayed on fresh or reused connections',async t=>{
 let close=false;const ports=[];const {baseUrl,calls}=await fixture(t,(req,res)=>{ports.push(req.socket.remotePort);if(close)req.socket.destroy();else json(res,{status:'online'});});
 const nfe=new NfeClient({baseUrl,credentials}),issuerFiles=files(baseUrl);
 const operations=[
  {mutation:false,run:()=>nfe.consultarSefaz()},
  {mutation:true,run:()=>nfe.atualizarEmpresa({ID:'safe-001',informacoes_fisco:'Synthetic update'})},
  {mutation:true,run:()=>nfe.cancelarDocumento({uuid:id,motivo:'Synthetic cancellation reason'})},
  {mutation:true,run:()=>nfe.excluirClassesFiscais({referencia:'SYNTHETIC'})},
  {mutation:true,run:()=>issuerFiles.fileGetNfseXml(fileArgs())},
 ];
 for(const operation of operations){
  close=true;const before=calls.length;await assert.rejects(operation.run(),e=>e.kind==='network'&&(operation.mutation?e.outcome==='unknown':e.outcome===undefined));assert.equal(calls.length,before+1);
  close=false;await nfe.consultarSefaz();const primed=ports.at(-1);close=true;
  await assert.rejects(operation.run(),e=>e.kind==='network'&&(operation.mutation?e.outcome==='unknown':e.outcome===undefined));assert.equal(calls.length,before+3);assert.equal(ports.at(-1),primed);
 }
 assert.equal(calls.length,15);
});

test('ERR-02/04 safe recovery and diagnostics come from the same custom serialized body',async t=>{
 let serializations=0;const {baseUrl,calls}=await fixture(t,(_req,res)=>json(res,{error:'uncertain',echo:other},500));
 const request={uuid:id,motivo:'Original unused reason',toJSON(){serializations++;return {uuid:other,motivo:'Serialized cancellation reason'};}};
 await assert.rejects(new NfeClient({baseUrl,credentials}).cancelarDocumento(request),error=>{assert.equal(error.outcome,'unknown');assert.equal(error.recovery.reveal().uuid,other);assert.ok(!JSON.stringify(error).includes(other));return true;});
 assert.equal(serializations,1);assert.equal(calls.length,1);assert.equal(calls[0].body.uuid,other);
});

test('REDIR-03 lexical Location protects removed path components and keeps opaque authority/userinfo case literal',async t=>{
 const user='FEDCBA98-7654-4321-8765-ABCDEFABCDEF',host='OpaqueHostCanary.invalid';
 const location='https://'+user+':password@'+host+'/private-path-canary/'+other+'/../darps/'+id+'?token=opaque-query';
 const {baseUrl}=await fixture(t,(_req,res)=>json(res,{error:'DENIED',user_exact:user,user_alternative:user.toLowerCase(),authority_exact:host,authority_alternative:host.toLowerCase(),path_case:other.toUpperCase(),removed:'private-path-canary'},400,{Location:location}));
 await assert.rejects(files(baseUrl).fileGetNfsePdf(fileArgs()),error=>{
  assert.equal(error.response.user_exact,'[REDACTED]');assert.equal(error.response.user_alternative,user.toLowerCase());
  assert.equal(error.response.authority_exact,'[REDACTED]');assert.equal(error.response.authority_alternative,host.toLowerCase());
  assert.equal(error.response.path_case,'[REDACTED]');assert.equal(error.response.removed,'[REDACTED]');return true;
 });
});

test('ERR-01 zero and empty array/object error discriminators always fail by property presence',async t=>{
 let marker;const {baseUrl,calls}=await fixture(t,(_req,res)=>json(res,{status:'online',error:marker}));
 for(marker of [0,[],{}])await assert.rejects(new NfeClient({baseUrl,credentials}).consultarSefaz(),{kind:'api',status:200});assert.equal(calls.length,3);
});
