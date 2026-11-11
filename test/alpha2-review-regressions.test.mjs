import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {inspect} from 'node:util';
import {NfeClient,MonitorClient,IssuerFilesClient} from './sdk.mjs';
const id='abcdefab-cdef-4abc-8def-abcdefabcdef',cap='fedcba98-7654-4321-8765-abcdefabcdef';
const opaque='11223344-5566-4778-899A-AABBCCDDEEFF';
const credentials={consumerKey:'review-key',consumerSecret:'review-secret',accessToken:'review-access',accessTokenSecret:'review-access-secret'};
const json=(res,value,status=200,headers={})=>{res.writeHead(status,{'Content-Type':'application/json',...headers});res.end(JSON.stringify(value));};
async function fixture(t,handler){const calls=[];const server=http.createServer(async(req,res)=>{let raw='';for await(const bytes of req)raw+=bytes;calls.push({path:req.url,method:req.method,raw});handler(req,res,calls);});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});return {baseUrl:'http://127.0.0.1:'+server.address().port,calls};}
async function rawFixture(t,reply){const calls=[],sockets=new Set();const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let input=Buffer.alloc(0),done=false;socket.on('data',chunk=>{input=Buffer.concat([input,chunk]);const split=input.indexOf('\r\n\r\n');if(done||split<0)return;const size=Number(/content-length:\s*(\d+)/i.exec(input.subarray(0,split).toString())?.[1]??0);if(input.length<split+4+size)return;done=true;calls.push(input.toString());reply(socket);});});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{for(const s of sockets)s.destroy();return new Promise(r=>server.close(r));});return {baseUrl:'http://127.0.0.1:'+server.address().port,calls};}
function client(baseUrl,extra={}){return new NfeClient({baseUrl,credentials,...extra});}
function files(baseUrl){return new IssuerFilesClient({baseUrl,trustedOrigins:[baseUrl],issuerBearerToken:'review-files'});}
function assertPrivate(error,secret){assert.ok(!JSON.stringify(error).includes(secret));assert.ok(!inspect(error).includes(secret));}
const encoded=[...cap].map(c=>'%'+c.charCodeAt(0).toString(16)).join('');
for(const [label,path]of Object.entries({plain:'/reports/'+cap+'.pdf',filename:'/reports/archive'+cap+'.pdf',suffix:'/reports/archive'+cap+'abcdef.pdf',malformedAdjacent:'/reports/%zz-'+encoded+'.pdf',malformedElsewhere:'https://[bad/bad%ZZ/prefix-%66'+cap.slice(1)+'-file.pdf',invalidUtf8Adjacent:'/reports/%ff'+encoded+'.pdf'}))test('alpha2 A-01/B-01 observes path UUID '+label,async t=>{
 const {baseUrl,calls}=await fixture(t,(_req,res)=>json(res,{error:'DENIED',capability:cap.toUpperCase()},400,{Location:path,'X-Request-ID':cap.toUpperCase()}));
 await assert.rejects(files(baseUrl).fileGetNfsePdf({path:{identifier:id},authorization:{type:'company_bearer'}}),error=>{assert.equal(error.kind,'http');assert.equal(error.status,400);assert.equal(error.response.capability,'[REDACTED]');assert.equal(error.correlationId,'[REDACTED]');assertPrivate(error,cap.toUpperCase());return true;});assert.equal(calls.length,1);
});
test('alpha2 A-01/B-01 path observation keeps opaque query authority and userinfo case literal',async t=>{
 const hostname=opaque+'.invalid',location='https://'+opaque+':password@'+hostname+'/bad%zz/archive'+encoded+'.pdf?token='+opaque;
 const {baseUrl,calls}=await fixture(t,(_req,res)=>json(res,{error:'DENIED',path:cap.toUpperCase(),opaque_exact:opaque,opaque_other_case:opaque.toLowerCase(),authority_exact:hostname,authority_other_case:hostname.toLowerCase()},400,{Location:location}));
 await assert.rejects(files(baseUrl).fileGetNfsePdf({path:{identifier:id},authorization:{type:'company_bearer'}}),error=>{assert.equal(error.response.path,'[REDACTED]');assert.equal(error.response.opaque_exact,'[REDACTED]');assert.equal(error.response.opaque_other_case,opaque.toLowerCase());assert.equal(error.response.authority_exact,'[REDACTED]');assert.equal(error.response.authority_other_case,hostname.toLowerCase());return true;});assert.equal(calls.length,1);
});
for(const first of [false,true])test('alpha2 A-02/B-02 header overflow suppresses recovery Location '+(first?'before':'after')+' padding',async t=>{
 const location='Location: /report/'+id+'\r\n',padding='X-Padding: '+'x'.repeat(20000)+'\r\n';
 const f=await rawFixture(t,socket=>socket.end('HTTP/1.1 503 Service Unavailable\r\n'+(first?location+padding:padding+location)+'Content-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}'));
 await assert.rejects(client(f.baseUrl).cancelarDocumento({uuid:id,motivo:'Synthetic cancellation reason'}),error=>{assert.equal(error.kind,'protocol');assert.equal(error.outcome,'unknown');assert.equal(error.recovery,undefined);assertPrivate(error,id);return true;});assert.equal(f.calls.length,1);
});
test('alpha2 A-02/B-02 close before response headers retains safe recovery',async t=>{
 const f=await rawFixture(t,socket=>socket.destroy());
 await assert.rejects(client(f.baseUrl).cancelarDocumento({uuid:id,motivo:'Synthetic cancellation reason'}),error=>{assert.equal(error.kind,'network');assert.equal(error.outcome,'unknown');assert.equal(error.recovery.reveal().uuid,id);assertPrivate(error,id);return true;});assert.equal(f.calls.length,1);
});
for(const collision of [false,true])test('alpha2 A-02/B-02 body limit after complete headers '+(collision?'suppresses collision':'retains safe recovery'),async t=>{
 const {baseUrl,calls}=await fixture(t,(_req,res)=>json(res,{error:'UPSTREAM',padding:'x'.repeat(300)},503,{Location:'/report/'+(collision?id.toUpperCase():cap)}));
 await assert.rejects(client(baseUrl,{maxResponseBytes:64}).cancelarDocumento({uuid:id,motivo:'Synthetic cancellation reason'}),error=>{assert.equal(error.kind,'response_limit');assert.equal(error.outcome,'unknown');if(collision)assert.equal(error.recovery,undefined);else assert.equal(error.recovery.reveal().uuid,id);return true;});assert.equal(calls.length,1);
});
for(const target of [
 {name:'Nfe query',client:(baseUrl)=>client(baseUrl),alias:(c)=>c.consultarDocumento({uuid:id}),named:(c)=>c.nfeGetDocument({query:{uuid:id}}),secret:id},
 {name:'Monitor company path',alias:(c)=>c.consultarEmpresa(id),named:(c)=>c.monitorGetCompany({path:{company:id}}),secret:id},
 {name:'Monitor company search',alias:(c)=>c.listarEmpresas({pesquisa:'private-company-query'}),named:(c)=>c.monitorListCompanies({query:{pesquisa:'private-company-query'}}),secret:'private-company-query'},
 {name:'Monitor municipality query',alias:(c)=>c.listarMunicipiosEmpresa(id,{municipio:'private-city-query'}),named:(c)=>c.monitorListCompanyMunicipalities({path:{company:id},query:{municipio:'private-city-query'}}),secret:'private-city-query'},
 {name:'Monitor municipality path',alias:(c)=>c.consultarMunicipioEmpresa(id,cap),named:(c)=>c.monitorGetCompanyMunicipality({path:{company:id,download:cap}}),secret:cap},
 {name:'Monitor available municipality query',alias:(c)=>c.listarMunicipiosDisponiveis('3550308'),named:(c)=>c.monitorListAvailableMunicipalities({query:{codigo_ibge:'3550308'}}),secret:'3550308'},
 {name:'Monitor statistics query',alias:(c)=>c.estatisticasDownloads({ano:9876,mes:10}),named:(c)=>c.monitorGetDownloadStatistics({query:{ano:9876,mes:10}}),secret:'9876'},
])test('alpha2 A-03 alias diagnostic parity '+target.name,async t=>{
 const {baseUrl,calls}=await fixture(t,(_req,res)=>json(res,{error:'DENIED',echo:target.secret},400,{'X-Request-ID':target.secret}));const c=target.client?target.client(baseUrl):new MonitorClient({baseUrl,bearerToken:'review-monitor'}),errors=[];
 for(const run of [target.named,target.alias])await assert.rejects(run(c),error=>{assert.equal(error.kind,'http');assert.equal(error.status,400);assertPrivate(error,target.secret);errors.push(error.toJSON());return true;});
 assert.deepEqual(errors[0],errors[1]);assert.equal(calls.length,2);assert.equal(calls[0].path,calls[1].path);
});
test('alpha2 A-03 legacy query serializer is observed once and keeps exact wire',async t=>{
 let count=0;const {baseUrl,calls}=await fixture(t,(_req,res)=>json(res,{error:'DENIED',echo:id},400));
 await assert.rejects(client(baseUrl).consultarDocumento({toJSON(){count++;return {uuid:id,ambiente:2,future:'0.0010'};}}),error=>{assertPrivate(error,id);return true;});assert.equal(count,1);assert.equal(calls.length,1);assert.equal(calls[0].path,'/api/1/nfe/consulta/?uuid='+id+'&ambiente=2&future=0.0010');
});
for(const mode of ['abort','deadline'])for(const limit of ['buffered','continuation','completion'])test('alpha2 A-04 stops '+mode+' before '+limit,async t=>{
 const rows=limit==='completion'?1:10;
 const {baseUrl,calls}=await fixture(t,(_req,res)=>json(res,{data:Array.from({length:rows},(_v,i)=>({uuid:id,ordinal:i})),meta:{current_page:1,last_page:1,per_page:10,total:rows}}));
 const controller=new AbortController(),options=mode==='abort'?{signal:controller.signal}: {deadlineMs:50};if(limit==='continuation')options.maxItems=1;
 const iterator=new MonitorClient({baseUrl,bearerToken:'review-monitor'}).iterarEmpresas({per_page:10},options);
 assert.equal((await iterator.next()).value.ordinal,0);if(mode==='abort')controller.abort();else await new Promise(r=>setTimeout(r,90));
 await assert.rejects(iterator.next(),{kind:mode==='abort'?'cancelled':'timeout'});assert.equal(calls.length,1);assert.equal((await iterator.next()).done,true);
});
for(const family of ['companies','municipalities','reports'])test('alpha2 B-03 coherent empty past-end '+family+' completes once',async t=>{
 const {baseUrl,calls}=await fixture(t,(_req,res)=>json(res,{data:[],meta:{current_page:3,last_page:2,per_page:50,total:80}}));const c=new MonitorClient({baseUrl,bearerToken:'review-monitor'});
 const result=await (family==='companies'?c.coletarEmpresas({page:3},{startIndex:25}):family==='municipalities'?c.coletarMunicipiosEmpresa(id,{page:3}):c.coletarRelatorios({page:3}));
 assert.deepEqual(result,{items:[],continuation:undefined});assert.equal(calls.length,1);
});
for(const [label,data,meta]of [
 ['nonempty-past-end',[{uuid:id}],{current_page:3,last_page:2,per_page:50,total:80}],
 ['wrong-requested-page',[],{current_page:2,last_page:2,per_page:50,total:80}],
 ['wrong-page-size',[],{current_page:3,last_page:2,per_page:10,total:80}],
 ['incompatible-total',[],{current_page:3,last_page:2,per_page:50,total:101}],
])test('alpha2 B-03 incompatible past-end metadata remains a protocol failure '+label,async t=>{
 const {baseUrl,calls}=await fixture(t,(_req,res)=>json(res,{data,meta}));await assert.rejects(new MonitorClient({baseUrl,bearerToken:'review-monitor'}).coletarEmpresas({page:3}),{kind:'protocol'});assert.equal(calls.length,1);
});
