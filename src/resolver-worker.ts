// Runs only in an isolated child. Native getaddrinfo cannot be cancelled in a
// Node worker thread: terminating the process releases its private libuv pool.
import { lookup } from 'node:dns';
let input='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',(chunk:string)=>{input+=chunk;if(input.length>65536)process.exit(2);});
process.stdin.on('end',()=>{
  try { const hostname=JSON.parse(input) as string;
    if(typeof hostname!=='string'||hostname.length>253)process.exit(2);
    lookup(hostname,{all:true,verbatim:true},(error,addresses)=>{
      if(error){process.exitCode=1;return;}
      process.stdout.write(JSON.stringify(addresses));
    });
  } catch { process.exitCode=2; }
});
