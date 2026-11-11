import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {inspect} from 'node:util';
import {NfeClient} from './sdk.mjs';
const id='abcdefab-cdef-4abc-8def-abcdefabcdef',cap='fedcba98-7654-4321-8765-abcdefabcdef',other='12345678-1234-4234-8234-123456789abc';
const credentials={consumerKey:'header-event-key',consumerSecret:'header-event-secret',accessToken:'header-event-access',accessTokenSecret:'header-event-access-secret'};
const final=(value={error:'UPSTREAM',echo:cap.toUpperCase()},headers='')=>{const body=JSON.stringify(value);return 'HTTP/1.1 500 Unavailable\r\n'+headers+'Content-Type: application/json\r\nContent-Length: '+Buffer.byteLength(body)+'\r\nConnection: close\r\n\r\n'+body;};
const info=(status,location)=>'HTTP/1.1 '+status+' Information\r\n'+(location===undefined?'':'Location: '+location+'\r\n')+'\r\n';
async function fixture(t,reply){const requests=[],sockets=new Set();const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let input=Buffer.alloc(0),done=false;socket.on('data',chunk=>{if(done)return;input=Buffer.concat([input,chunk]);const split=input.indexOf('\r\n\r\n');if(split<0)return;const length=Number(/content-length:\s*(\d+)/i.exec(input.subarray(0,split).toString())?.[1]??0);if(input.length<split+4+length)return;done=true;requests.push(input.toString());socket.end(typeof reply==='function'?reply(requests.length):reply);});});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{for(const socket of sockets)socket.destroy();return new Promise(r=>server.close(r));});return {baseUrl:'http://127.0.0.1:'+server.address().port,requests};}
const client=baseUrl=>new NfeClient({baseUrl,credentials});
const mutate=c=>c.cancelarDocumento({uuid:id,motivo:'Synthetic cancellation reason'});
function assertPrivate(error,value){assert.ok(!JSON.stringify(error).includes(value));assert.ok(!inspect(error).includes(value));}
for(const c of [
 {name:'complete final response collision',reply:final(undefined,'Location: /report/'+id+'\r\n'),kind:'http',collision:true},
 {name:'complete final response new capability',reply:final(undefined,'Location: /prefix-'+cap+'f.pdf\r\n'),kind:'http',private:cap.toUpperCase()},
 {name:'101 upgrade collision',reply:'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: synthetic\r\nLocation: /report/'+id+'\r\n\r\n',kind:'protocol',collision:true},
 {name:'103 before final error echo',reply:info(103,'/prefix-'+cap+'f.pdf')+final(),kind:'http',private:cap.toUpperCase()},
 {name:'nine informational responses collide',reply:Array.from({length:9},()=>info(103,'/report/'+id)).join('')+final(),kind:'protocol',collision:true},
 {name:'ninth informational response first collision',reply:info(103).repeat(8)+info(103,'/report/'+id)+final(),kind:'protocol',collision:true},
 {name:'100 Continue before final error echo',reply:info(100,'/archive'+cap+'.pdf')+final(),kind:'http',private:cap.toUpperCase()},
 {name:'102 Processing before final error echo',reply:info(102,'/archive'+cap+'.pdf')+final(),kind:'http',private:cap.toUpperCase()},
 {name:'unsupported informational status observes collision before rejection',reply:info(199,'/report/'+id)+final(),kind:'protocol',collision:true},
])test('alpha3 A-05 '+c.name,async t=>{
 const f=await fixture(t,c.reply);await assert.rejects(mutate(client(f.baseUrl)),error=>{assert.equal(error.kind,c.kind);assert.equal(error.outcome,'unknown');if(c.collision)assert.equal(error.recovery,undefined);if(c.private)assertPrivate(error,c.private);return true;});assert.equal(f.requests.length,1);
});
test('alpha3 A-05 exactly eight informational responses retain safe ordinary recovery',async t=>{
 const f=await fixture(t,info(103,'/report/'+cap).repeat(8)+final());await assert.rejects(mutate(client(f.baseUrl)),error=>{assert.equal(error.kind,'http');assert.equal(error.status,500);assert.equal(error.outcome,'unknown');assert.equal(error.recovery.reveal().uuid,id);assertPrivate(error,cap.toUpperCase());return true;});assert.equal(f.requests.length,1);
});
test('alpha3 A-05 all informational Location capabilities remain protected through final diagnostics',async t=>{
 const f=await fixture(t,info(103,'/report/'+cap)+info(102,'https://[bad/bad%zz/archive%31'+other.slice(1)+'.pdf')+final({error:'UPSTREAM',first:cap.toUpperCase(),second:other.toUpperCase()},'X-Request-ID: '+other.toUpperCase()+'\r\n'));
 await assert.rejects(mutate(client(f.baseUrl)),error=>{assert.equal(error.kind,'http');assertPrivate(error,cap.toUpperCase());assertPrivate(error,other.toUpperCase());assert.equal(error.correlationId,'[REDACTED]');return true;});assert.equal(f.requests.length,1);
});
test('alpha3 A-05 informational query userinfo and authority preserve literal case semantics',async t=>{
 const opaque='11223344-5566-4778-899A-AABBCCDDEEFF',host='OpaqueAuthority.invalid',location='https://'+opaque+':password@'+host+'/archive'+cap+'.pdf?token='+opaque;
 const f=await fixture(t,info(103,location)+final({error:'UPSTREAM',capability:cap.toUpperCase(),exact:opaque,alternative:opaque.toLowerCase(),host_exact:host,host_alternative:host.toLowerCase()}));
 await assert.rejects(mutate(client(f.baseUrl)),error=>{assert.equal(error.response.capability,'[REDACTED]');assert.equal(error.response.exact,'[REDACTED]');assert.equal(error.response.alternative,opaque.toLowerCase());assert.equal(error.response.host_exact,'[REDACTED]');assert.equal(error.response.host_alternative,host.toLowerCase());return true;});assert.equal(f.requests.length,1);
});
test('alpha3 A-05 informational context stays local to the explicit request',async t=>{
 const f=await fixture(t,count=>(count===1?info(103,'/report/'+cap):'')+final()),c=client(f.baseUrl);
 await assert.rejects(mutate(c),error=>{assertPrivate(error,cap.toUpperCase());return true;});
 await assert.rejects(mutate(c),error=>{assert.equal(error.response.echo,cap.toUpperCase());assert.equal(error.recovery.reveal().uuid,id);return true;});assert.equal(f.requests.length,2);
});
test('alpha3 A-05 rejected upgrade without a Location retains safe recovery and never negotiates',async t=>{
 const f=await fixture(t,'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: synthetic\r\n\r\nignored protocol payload');
 await assert.rejects(mutate(client(f.baseUrl)),error=>{assert.equal(error.kind,'protocol');assert.equal(error.status,101);assert.equal(error.outcome,'unknown');assert.equal(error.recovery.reveal().uuid,id);return true;});assert.equal(f.requests.length,1);
});
