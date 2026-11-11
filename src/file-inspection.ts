import { inflateRawSync } from 'node:zlib';
/** Recognize only a bounded XML prefix. No DTD/entity resolution or XML execution. */
export function fiscalXmlRoot(prefix: string): string | undefined {
  let position = prefix.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (position < prefix.length) {
    while (/\s/.test(prefix[position] ?? '') && position < prefix.length) position++;
    if (prefix.startsWith('<!--', position)) {
      const end = prefix.indexOf('-->', position + 4);
      if (end === -1) return undefined;
      position = end + 3;
    } else if (prefix.startsWith('<?', position)) {
      const end = prefix.indexOf('?>', position + 2);
      if (end === -1) return undefined;
      position = end + 2;
    } else {
      return /^<([A-Za-z_][A-Za-z0-9_.:-]*)(?:\s|\/?>)/.exec(prefix.slice(position))?.[1]?.split(':').at(-1);
    }
  }
  return undefined;
}

/** A bounded lexical well-formedness gate; never resolves entities or namespaces. */
export function validXmlAttributes(bytes:Buffer):boolean {
  try {
    let text:string;
    if(bytes[0]===255&&bytes[1]===254)text=bytes.subarray(2).toString('utf16le');
    else if(bytes[0]===254&&bytes[1]===255){if(bytes.length%2)return false;text=Buffer.from(bytes.subarray(2)).swap16().toString('utf16le');}
    else text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    let at=text.charCodeAt(0)===0xfeff?1:0,root=false,closed=false,nodes=0;
    const stack:string[]=[];
    const name=/^[A-Za-z_][A-Za-z0-9_.:-]*/;
    while(at<text.length){
      const start=text.indexOf('<',at);
      if(start<0)return closed&&text.slice(at).trim()==='';
      if(!stack.length&&text.slice(at,start).trim())return false;
      at=start;
      if(++nodes>100000)return false;
      if(text.startsWith('<!--',at)){const end=text.indexOf('-->',at+4);if(end<0||text.slice(at+4,end).includes('--'))return false;at=end+3;continue;}
      if(text.startsWith('<?',at)){const end=text.indexOf('?>',at+2);if(end<0)return false;at=end+2;continue;}
      if(text.startsWith('<![CDATA[',at)){if(!stack.length)return false;const end=text.indexOf(']]>',at+9);if(end<0)return false;at=end+3;continue;}
      if(text.startsWith('<!',at))return false;
      at++;const closing=text[at]==='/';if(closing)at++;
      const tag=name.exec(text.slice(at))?.[0];if(!tag)return false;at+=tag.length;
      if(closing){while(/\s/.test(text[at]??''))at++;if(text[at++]!=='>'||stack.pop()!==tag)return false;if(!stack.length)closed=true;continue;}
      if(closed)return false;
      const attributes=new Set<string>();let self=false;
      while(at<text.length){
        const before=at;while(/\s/.test(text[at]??''))at++;
        if(text.startsWith('/>',at)){at+=2;self=true;break;}
        if(text[at]==='>'){at++;break;}
        if(before===at)return false;
        const key=name.exec(text.slice(at))?.[0];if(!key||attributes.has(key)||attributes.size>=4096)return false;
        attributes.add(key);at+=key.length;while(/\s/.test(text[at]??''))at++;
        if(text[at++]!=='=')return false;while(/\s/.test(text[at]??''))at++;
        const quote=text[at++];if(quote!=="'"&&quote!=='"')return false;
        const end=text.indexOf(quote,at);if(end<0||text.slice(at,end).includes('<'))return false;at=end+1;
      }
      if(at>text.length||text[at-1]!=='>')return false;
      if(!root)root=true;
      if(!self){if(stack.length>=128)return false;stack.push(tag);}else if(!stack.length)closed=true;
    }
    return root&&closed&&!stack.length;
  } catch {return false;}
}

const crcTable=Array.from({length:256},(_,value)=>{let n=value;for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes:Buffer):number {let n=0xffffffff;for(const byte of bytes)n=crcTable[(n^byte)&255]!^(n>>>8);return (n^0xffffffff)>>>0;}
/** ZIP32 metadata, disjoint records, sizes and CRC, with one bounded inflate/member.
 * No extraction, filesystem paths, XML relationship traversal or entity fetching.
 * Multi-disk, ZIP64, encrypted and unsupported methods fail closed explicitly.
 */
export function inspectArchive(bytes:Buffer):boolean {
  try {
    let eocd=-1;
    for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--)if(bytes.readUInt32LE(at)===0x06054b50&&at+22+bytes.readUInt16LE(at+20)===bytes.length){eocd=at;break;}
    if(eocd<0||bytes.readUInt16LE(eocd+4)||bytes.readUInt16LE(eocd+6))return false;
    const count=bytes.readUInt16LE(eocd+10),centralSize=bytes.readUInt32LE(eocd+12),central=bytes.readUInt32LE(eocd+16);
    if(count!==bytes.readUInt16LE(eocd+8)||count>4096||central+centralSize!==eocd)return false;
    let at=central,aggregate=0;const names=new Set<string>(),ranges:Array<[number,number]>=[];
    for(let i=0;i<count;i++){
      if(at+46>eocd||bytes.readUInt32LE(at)!==0x02014b50)return false;
      const flags=bytes.readUInt16LE(at+8),method=bytes.readUInt16LE(at+10),crc=bytes.readUInt32LE(at+16),compressed=bytes.readUInt32LE(at+20),size=bytes.readUInt32LE(at+24),nameLength=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),local=bytes.readUInt32LE(at+42);
      if((flags&~0x080e)!==0||(flags&1)||![0,8].includes(method)||bytes.readUInt16LE(at+34)||size===0xffffffff||compressed===0xffffffff||local===0xffffffff)return false;
      if(at+46+nameLength+extra+comment>eocd||local+30>central||bytes.readUInt32LE(local)!==0x04034b50)return false;
      const nameBytes=bytes.subarray(at+46,at+46+nameLength),name=nameBytes.toString('hex');
      if(!nameLength||names.has(name))return false;names.add(name);
      const localName=bytes.readUInt16LE(local+26),localExtra=bytes.readUInt16LE(local+28),start=local+30+localName+localExtra,end=start+compressed;
      if(flags!==bytes.readUInt16LE(local+6)||method!==bytes.readUInt16LE(local+8)||localName!==nameLength||!nameBytes.equals(bytes.subarray(local+30,local+30+localName))||end>central)return false;
      let recordEnd=end;
      if(flags&8){
        const hasSignature=end+4<=central&&bytes.readUInt32LE(end)===0x08074b50,descriptor=end+(hasSignature?4:0);
        if(descriptor+12>central||bytes.readUInt32LE(descriptor)!==crc||bytes.readUInt32LE(descriptor+4)!==compressed||bytes.readUInt32LE(descriptor+8)!==size)return false;
        recordEnd=descriptor+12;
        if(![0,crc].includes(bytes.readUInt32LE(local+14))||![0,compressed].includes(bytes.readUInt32LE(local+18))||![0,size].includes(bytes.readUInt32LE(local+22)))return false;
      }else if(crc!==bytes.readUInt32LE(local+14)||compressed!==bytes.readUInt32LE(local+18)||size!==bytes.readUInt32LE(local+22))return false;
      aggregate+=size;if(size>32*1024*1024||aggregate>64*1024*1024)return false;
      const data=bytes.subarray(start,end),plain=method===0?data:inflateRawSync(data,{maxOutputLength:Math.max(1,size)});
      if(plain.length!==size||crc32(plain)!==crc)return false;
      ranges.push([local,recordEnd]);at+=46+nameLength+extra+comment;
    }
    if(at!==eocd)return false;
    ranges.sort((a,b)=>a[0]-b[0]);
    return ranges.every((range,i)=>i===0||range[0]>=ranges[i-1]![1]);
  }catch{return false;}
}

type Token = { kind: 'name' | 'word'; value: string } | { kind: 'opaque' | 'dict' | 'enddict' | 'array' | 'endarray' };
type Dictionary = { kind: 'dict'; key?: string; expectKey: boolean; trailer: boolean; xref: boolean; encrypted: boolean; length?: number };
type Frame = Dictionary | { kind: 'array' };
const whitespace = (value: number): boolean => [0, 9, 10, 12, 13, 32].includes(value);
const delimiter = (value: number): boolean => whitespace(value) || [40, 41, 60, 62, 91, 93, 123, 125, 47, 37].includes(value);
const hex = (value: number): number => value >= 48 && value <= 57 ? value - 48 : value >= 65 && value <= 70 ? value - 55 : value >= 97 && value <= 102 ? value - 87 : -1;

/**
 * Limited PDF lexical inspection: only a trailer/XRef dictionary encryption entry
 * is positive evidence. Strings, comments, hex strings and known-length streams
 * are opaque. Unknown-length streams or inspection bounds are inconclusive.
 * No complete PDF text copy, unbounded token/name collection or stream decoding.
 */
export function inspectPdfProtection(bytes: Buffer): 'encryption_entry' | 'not_detected' | 'not_established' {
  let position = 0, tokens = 0, incomplete = false;
  const buffered: Token[] = [];
  function read(): Token | undefined {
    if (buffered.length) return buffered.shift();
    if (++tokens > 100_000) { incomplete = true; return undefined; }
    while (position < bytes.length) {
      const byte = bytes[position]!;
      if (whitespace(byte)) { position++; continue; }
      if (byte === 37) {
        while (position < bytes.length && ![10, 13].includes(bytes[position]!)) position++;
        continue;
      }
      break;
    }
    if (position >= bytes.length) return undefined;
    const byte = bytes[position++]!;
    if (byte === 40) {
      let nesting = 1;
      while (position < bytes.length && nesting) {
        const current = bytes[position++]!;
        if (current === 92) {
          if (bytes[position] === 13 && bytes[position + 1] === 10) position++;
          position++;
        } else if (current === 40) nesting++;
        else if (current === 41) nesting--;
      }
      if (nesting) incomplete = true;
      return { kind: 'opaque' };
    }
    if (byte === 60) {
      if (bytes[position] === 60) { position++; return { kind: 'dict' }; }
      const end = bytes.indexOf(62, position);
      if (end === -1) { incomplete = true; position = bytes.length; }
      else position = end + 1;
      return { kind: 'opaque' };
    }
    if (byte === 62 && bytes[position] === 62) { position++; return { kind: 'enddict' }; }
    if (byte === 91) return { kind: 'array' };
    if (byte === 93) return { kind: 'endarray' };
    const name = byte === 47;
    let value = name ? '' : String.fromCharCode(byte), oversized = false;
    while (position < bytes.length && !delimiter(bytes[position]!)) {
      let current = bytes[position++]!;
      if (name && current === 35 && hex(bytes[position] ?? -1) >= 0 && hex(bytes[position + 1] ?? -1) >= 0) {
        current = (hex(bytes[position]!) << 4) | hex(bytes[position + 1]!); position += 2;
      }
      if (value.length < 64) value += String.fromCharCode(current);
      else oversized = true;
    }
    return { kind: name ? 'name' : 'word', value: oversized ? '' : value };
  }
  const frames: Frame[] = [];
  let trailer = false, closedLength: number | undefined;
  for (let token = read(); token; token = read()) {
    if (incomplete) return 'not_established';
    if (token.kind === 'word' && token.value === 'stream') {
      if (frames.length || closedLength === undefined) return 'not_established';
      if (bytes[position] === 13) position++;
      if (bytes[position] !== 10) return 'not_established';
      position++;
      if (closedLength > bytes.length - position) return 'not_established';
      position += closedLength;
      const end = read();
      if (end?.kind !== 'word' || end.value !== 'endstream') return 'not_established';
      closedLength = undefined; trailer = false; continue;
    }
    closedLength = undefined;
    if (token.kind === 'enddict' || token.kind === 'endarray') {
      const frame = frames.pop();
      if (!frame || (token.kind === 'enddict') !== (frame.kind === 'dict')) return 'not_established';
      if (frame.kind === 'dict') {
        if (frame.encrypted && (frame.trailer || frame.xref)) return 'encryption_entry';
        if (!frames.length) closedLength = frame.length;
      }
      trailer = false; continue;
    }
    const frame = frames.at(-1);
    if (frame?.kind === 'dict') {
      if (frame.expectKey) {
        if (token.kind !== 'name') return 'not_established';
        frame.key = token.value; frame.expectKey = false; continue;
      }
      let reference = false;
      if (token.kind === 'word' && /^\d+$/.test(token.value ?? '')) {
        const second = read(), third = second?.kind === 'word' && /^\d+$/.test(second.value ?? '') ? read() : undefined;
        reference = third?.kind === 'word' && third.value === 'R';
        if (!reference) buffered.unshift(...[second, third].filter((item): item is Token => item !== undefined));
      }
      if (frame.key === 'Encrypt' && (token.kind === 'dict' || reference)) frame.encrypted = true;
      if (frame.key === 'Type' && token.kind === 'name' && token.value === 'XRef') frame.xref = true;
      if (frame.key === 'Length' && token.kind === 'word' && !reference && /^\d+$/.test(token.value ?? '') && Number.isSafeInteger(Number(token.value))) frame.length = Number(token.value);
      frame.expectKey = true; delete frame.key;
    }
    if (token.kind === 'dict') {
      if (frames.length >= 64) return 'not_established';
      frames.push({ kind: 'dict', expectKey: true, trailer: trailer && frames.length === 0, xref: false, encrypted: false });
    } else if (token.kind === 'array') {
      if (frames.length >= 64) return 'not_established';
      frames.push({ kind: 'array' });
    }
    trailer = !frames.length && token.kind === 'word' && token.value === 'trailer';
  }
  return incomplete || frames.length ? 'not_established' : 'not_detected';
}
