import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {NfeClient,IssuerClient} from './sdk.mjs';
const models=JSON.parse(readFileSync(new URL('../examples/model-payloads.json',import.meta.url),'utf8')).models;
const corpus=JSON.parse(readFileSync(new URL('./fixtures/operations.json',import.meta.url),'utf8')).cases;
const credentials={consumerKey:'synthetic-key',consumerSecret:'synthetic-secret',accessToken:'synthetic-access',accessTokenSecret:'synthetic-access-secret'};
for(const[name,example]of Object.entries(models))test('homologation structural example '+name,async t=>{
 let calls=0,received;
 const response=corpus.find(c=>c.operation===(example.client==='Nfe'?'nfeIssueDocument':example.operation)).response;
 const server=http.createServer(async(req,res)=>{calls++;let raw='';for await(const chunk of req)raw+=chunk;received=JSON.parse(raw);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(response));});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
 const baseUrl='http://127.0.0.1:'+server.address().port,client=example.client==='Nfe'?new NfeClient({baseUrl,credentials}):new IssuerClient({baseUrl,issuerBearerToken:'issuer'});
 await client[example.operation](example.client==='Nfe'?example.body:{body:example.body});assert.equal(calls,1);assert.deepEqual(received,example.body);assert.equal(String(received.ambiente),'2');
});
