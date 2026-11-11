import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const started=Date.now(),root=resolve(import.meta.dirname,'..'),dir=mkdtempSync(join(tmpdir(),'webmania-installed-fiscal-'));
const candidateArg=process.argv.indexOf('--candidate-tarball');
if(candidateArg!==-1&&!process.argv[candidateArg+1])throw new Error('--candidate-tarball requires the existing candidate path');
const existingCandidate=candidateArg===-1?undefined:resolve(process.argv[candidateArg+1]);
const arg=process.argv.indexOf('--artifact-directory');
const artifactDirectory=arg===-1?undefined:resolve(process.argv[arg+1]??'');
if(arg!==-1&&!process.argv[arg+1])throw new Error('--artifact-directory requires a fresh output path');
if(artifactDirectory){mkdirSync(dirname(artifactDirectory),{recursive:true});mkdirSync(artifactDirectory);}
const id='00000000-0000-4000-8000-000000000001';
const pdf=readFileSync(join(root,'test/fixtures/synthetic-danfe.pdf')),xml=readFileSync(join(root,'test/fixtures/synthetic-nfe.xml')),zip=readFileSync(join(root,'test/fixtures/synthetic-report.zip'));
const issue={ID:'installed-001',modelo:'1',operacao:1,natureza_operacao:'Synthetic sale',finalidade:1,ambiente:2,cliente:{cpf:'000.000.000-00',nome_completo:'Synthetic person',endereco:'Synthetic street',numero:'1',bairro:'Synthetic district',cidade:'Synthetic city',uf:'SP',cep:'01001-000'},produtos:[{nome:'Synthetic item',codigo:'0001',ncm:'0000.00.00',quantidade:'1.0000',unidade:'UN',subtotal:'0.10',total:'0.10',origem:0,impostos:{icms:{codigo_cfop:'5102',situacao_tributaria:'102'}}}],pedido:{presenca:1,modalidade_frete:9,pagamento:0,forma_pagamento:'01',valor_pagamento:'0.10'}};
let calls=0,origin='';
function json(res,value){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}
function binary(res,value,type){res.writeHead(200,{'Content-Type':type,'Content-Length':value.length});res.end(value);}
const server=http.createServer(async(req,res)=>{
 calls++;let body='';for await(const chunk of req)body+=chunk;
 const path=new URL(req.url,'http://fixture').pathname;
 if(path.startsWith('/2/monitor/')){assert.equal(req.headers.authorization,'Bearer synthetic-monitor');assert.equal(req.headers['x-consumer-key'],undefined);return json(res,{data:[{uuid:id}],meta:{current_page:1,last_page:1,per_page:10,total:1}});}
 if(path.startsWith('/relatorio/')){assert.equal(req.headers['x-consumer-key'],undefined);assert.equal(req.headers.authorization,undefined);return binary(res,zip,'application/zip');}
 for(const[header,value]of Object.entries({'x-consumer-key':'synthetic-key','x-consumer-secret':'synthetic-secret','x-access-token':'synthetic-access','x-access-token-secret':'synthetic-access-secret'}))assert.equal(req.headers[header],value);
 assert.equal(req.headers['x-token'],undefined);assert.equal(req.headers.authorization,undefined);
 if(path.startsWith('/danfe/'))return binary(res,pdf,'application/pdf');if(path.startsWith('/xmlnfe/'))return binary(res,xml,'application/xml');
 if(path.endsWith('/certificado/'))return json(res,{expiration:25,extra:'São Paulo'});
 if(path.endsWith('/sefaz/'))return json(res,{status:'offline'});
 if(path==='/api/1/nfe/classe-imposto/')return json(res,req.method==='GET'?[{referencia:'REF1',descricao:'Synthetic',type:'nfe'}]:req.method==='DELETE'?[{referencia:'REF1',msg:'Deleted'}]:{referencia:'REF1',descricao:'Synthetic',data:'2026-10-25'});
 if(path==='/api/1/nfe/empresa/')return json(res,{success:'Updated'});
 if(path==='/api/1/nfe/relatorios/')return json(res,{uuid:id,status:'concluido',url:origin+'/relatorio/'+id+'/'});
 if(path==='/api/1/nfe/cancelar/')return json(res,{status:'cancelado'});
 if(path==='/api/1/nfe/inutilizar/')return json(res,{xml:origin+'/xmlnfe/'+id+'/'});
 return json(res,{uuid:id,status:'processando',future:false});
});
const body=`
const baseUrl=process.env.FIXTURE_URL;
if(!baseUrl)throw new Error('Fixture configuration missing');
const credentials={consumerKey:'synthetic-key',consumerSecret:'synthetic-secret',accessToken:'synthetic-access',accessTokenSecret:'synthetic-access-secret'};
const client=new NfeClient({credentials,baseUrl});
const id=${JSON.stringify(id)};
const payload=${JSON.stringify(issue)};
if((await client.consultarCertificado()).expiration!==25||(await client.consultarSefaz()).status!=='offline')throw new Error('Status schema');
await client.consultarDocumento({uuid:id});await client.consultarDocumentoPost({ID:'installed-001'});
await client.emitirCartaCorrecao({uuid:id,correcao:'Correct the controlled customer field.'});
await client.manifestarDocumento({chave:'0'.repeat(44),ambiente:2,evento:'210210'});
await client.cancelarDocumento({uuid:id,motivo:'Controlled cancellation justification.'});
await client.inutilizarNumeracao({sequencia:'10-12',motivo:'Controlled numbering justification.',ambiente:2,serie:'1',modelo:'1'});
await client.emitirConciliacao({uuid:id,pagamento:{forma_pagamento:'01',valor_pagamento:'0.10',data_pagamento:'2026-10-25'}});
await client.cancelarConciliacao({uuid:id});await client.cancelarEventoIbsCbs({uuid:id});await client.excluirClassesFiscais({referencia:'REF1'});
await client.emitirNota(payload);await client.emitirNfe(payload);
const{cliente,...withoutRecipient}=payload;await client.emitirNfce({...withoutRecipient,modelo:2});
await client.emitirDevolucao({uuid:id,natureza_operacao:'Synthetic return',ambiente:2,codigo_cfop:'5202',produtos:[1],quantidade:['0.2500']});
await client.emitirAjuste({operacao:1,natureza_operacao:'Synthetic adjustment',codigo_cfop:'5949',ambiente:2,cliente:payload.cliente,valor_icms:'0.00'});
await client.emitirComplementar({uuid:id,operacao:1,natureza_operacao:'Synthetic complement',ambiente:2,cliente:payload.cliente,impostos:{ibs_cbs:{situacao_tributaria:'000',classificacao_tributaria:'000001',base_calculo:0}}});
await client.registrarEventoIbsCbs({chave:'0'.repeat(44),ambiente:2,cod_evento:'211128',indicador_aceitacao:0});
await client.listarClassesFiscais();await client.salvarClassesFiscais({descricao:'Synthetic tax class',tipo:'nfcom',codigo_classificacao:'100101',icms:{situacao_tributaria:'40'},pis:{situacao_tributaria:'06'},cofins:{situacao_tributaria:'06'}});
await client.atualizarEmpresa({informacoes_fisco:'Controlled update'});
const report=await client.solicitarRelatorio({modelo:'nfe',relatorio:'xml',status:'emitidas',data_inicio:'2026-10-01',data_final:'2026-10-25'});
if(typeof report.url!=='string')throw new Error('Missing report capability');
const files=new FiscalFilesClient({baseUrl,trustedOrigins:[baseUrl],credentials});
if((await files.baixarDanfe(id,{type:'company'})).contentType!=='application/pdf')throw new Error('PDF transport');
const binary=await files.baixarXml(id,{type:'company'});
if(binary.format!=='xml'||binary.byteLength===0||binary.requestedAuthorization!=='company')throw new Error('XML transport');
if((await files.baixarUrlRelatorio(report.url)).contentType!=='application/zip')throw new Error('Report transport');
const monitor=new MonitorClient({baseUrl,bearerToken:'synthetic-monitor'});
if((await monitor.listarEmpresas({per_page:10})).data[0]?.uuid!==id)throw new Error('Monitor schema');
`;
try {
 const packed=existingCandidate?undefined:JSON.parse(execFileSync('npm',['pack','--json','--pack-destination',artifactDirectory??dir],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','inherit']}));
 const tarball=existingCandidate??join(artifactDirectory??dir,packed[0].filename);
 writeFileSync(join(dir,'package.json'),JSON.stringify({private:true,type:'module'}));
 execFileSync('npm',['install','--ignore-scripts','--no-audit','--no-fund',tarball],{cwd:dir,stdio:'pipe'});
 const installed=join(dir,'node_modules/@webmaniabr/sdk');
 const installedMetadata=JSON.parse(readFileSync(join(installed,'package.json'),'utf8'));
 assert.equal(installedMetadata.license,'SEE LICENSE IN LICENSE');assert.equal(installedMetadata.private,true);
 const license=readFileSync(join(installed,'LICENSE'),'utf8');
 for(const notice of ['Copyright (c) 2026 Webmania','Todos os direitos reservados','Licença proprietária','https://webmania.com.br/termos-de-uso/','terceiros'])assert.ok(license.includes(notice));
 const testFiles=readdirSync(join(root,'test')).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>join(root,'test',name));
 let controlledOutput;
 try{controlledOutput=execFileSync(process.execPath,['--test','--test-reporter=tap',...testFiles],{cwd:root,encoding:'utf8',env:{...process.env,WEBMANIA_TEST_INSTALLED_ENTRY:pathToFileURL(join(dir,'node_modules/@webmaniabr/sdk/dist/index.js')).href},stdio:['ignore','pipe','pipe']});}
 catch(error){if(error.stdout)process.stdout.write(error.stdout);if(error.stderr)process.stderr.write(error.stderr);throw error;}
 process.stdout.write(controlledOutput);
 const controlledTests=Number(/^# tests (\d+)$/m.exec(controlledOutput)?.[1]);
 assert.ok(controlledTests>0);for(const field of ['fail','cancelled','skipped'])assert.equal(Number(new RegExp('^# '+field+' (\\d+)$','m').exec(controlledOutput)?.[1]),0);
 const imports=`import {NfeClient,MonitorClient,FiscalFilesClient} from '@webmaniabr/sdk';\n`;
 const wireTypes=`
const ipi:G092={situacao_tributaria:'99',codigo_enquadramento:'001',aliquota:'0.00'};
const order:NfeOrder={presenca:1,modalidade_frete:9,pagamento:[0],forma_pagamento:['01'],cnpj_transacional_pag:['00000000000000'],cnpj_credenciadora:['00.000.000/0000-00'],cnpj_beneficiario:['00000000000000']};
// @ts-expect-error Numeric CNPJ entries are not identifier strings.
const wrongTransaction:NfeOrder['cnpj_transacional_pag']=[0];
// @ts-expect-error Numeric CNPJ entries are not identifier strings.
const wrongInstitution:NfeOrder['cnpj_credenciadora']=[0];
// @ts-expect-error Numeric CNPJ entries are not identifier strings.
const wrongBeneficiary:NfeOrder['cnpj_beneficiario']=[0];
`;
 writeFileSync(join(dir,'consumer.ts'),imports+`import type {Nfe55IssueRequest,FiscalFile,G092,NfeOrder} from '@webmaniabr/sdk';\n`+wireTypes+body.replace('const payload=','const payload:Nfe55IssueRequest=').replace('const binary=','const binary:FiscalFile='));
 execFileSync(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'consumer.ts','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--strict','--exactOptionalPropertyTypes','--types','node','--typeRoots',join(root,'node_modules/@types')],{cwd:dir,stdio:'inherit'});
 writeFileSync(join(dir,'javascript.mjs'),imports+body);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
 for(const file of ['consumer.js','javascript.mjs'])await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[file],{cwd:dir,env:{...process.env,FIXTURE_URL:origin},stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Installed consumer failed')));});
 assert.equal(calls,54);
 let gitHead=null,uncommitted=null;
 try{gitHead=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();uncommitted=!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}catch{/* A source-less container can still test the exact artifact hash; unavailable Git identity stays null. */}
 const receipt={artifact_source:existingCandidate?'provided_candidate_tarball':'packed_current_checkout',classification:'controlled_clean_install_not_live_api',result:'pass',node:process.version,tarball_sha256:createHash('sha256').update(readFileSync(tarball)).digest('hex'),consumers:['JavaScript','TypeScript'],controlled_suite_tests:controlledTests,consumer_flow_calls:calls,calls,license_notice_verified:true,elapsed_ms:Date.now()-started,git_head_at_execution:gitHead,uncommitted_source:uncommitted,live_api_calls:0,safe_merge_certified:false};
 if(artifactDirectory)writeFileSync(join(artifactDirectory,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify(receipt));
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
