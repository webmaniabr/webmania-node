import { inspect } from 'node:util';
import { fieldNames } from './generated/field-names.js';
import { encodedDiagnostic, wellFormedText } from './unicode.js';
/** Known UUID capabilities use case-equivalent hex spellings only in their scoped context. */
export const UUID_CAPABILITY = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function isObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function sensitiveKey(key: string): boolean {
  const normalized=key.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'');
  return /token|secret|password|passwd|authorization|credential|certificate|certificado|senha|segredo|credenci|autorizacao|apikey|privatekey|consumerkey|chaveapi|chaveprivada|chavesecreta|chaveconsumidor|cpf|cnpj|email/i.test(normalized);
}
/** The complete finite wire snapshot is traversed, independent of diagnostic truncation. */
export function snapshotValues(value: unknown, sensitiveOnly=false, stringsOnly=false): string[] {
  const result=new Set<string>(),pending=[{value,sensitive:!sensitiveOnly}];
  while(pending.length){
    const {value:node,sensitive}=pending.pop()!;
    if(Array.isArray(node)){for(const child of node)pending.push({value:child,sensitive});}
    else if(isObject(node))for(const[key,child]of Object.entries(node)){
      // Structural field names are useful in diagnostics; private extension keys are included.
      if(sensitive&&key&&(sensitiveOnly||!fieldNames.has(key)))result.add(key);
      pending.push({value:child,sensitive:sensitive||sensitiveKey(key)});
    }
    else if(sensitive&&((typeof node==='string'&&node.length>0)||(!stringsOnly&&typeof node==='number')))result.add(String(node));
  }
  return [...result];
}
export function sanitized(value: unknown, secrets: readonly string[], depth=0, uuidCapabilities: readonly string[]=[], literalSecrets:readonly string[]=secrets): unknown {
  if(depth>8)return '[TRUNCATED]';
  if(typeof value==='string'){
    // Discover every interval in the ORIGINAL text, including overlapping matches.
    // Replacing one credential first must never hide the prefix of another.
    const ranges:Array<[number,number]>=[];
    for(const match of value.matchAll(/(?:https?|ftp):\/\/[^\s<>"']+/gi))ranges.push([match.index!,match.index!+match[0].length]);
    for(const cap of uuidCapabilities)if(UUID_CAPABILITY.test(cap))for(const match of value.matchAll(new RegExp(cap,'gi')))ranges.push([match.index!,match.index!+match[0].length]);
    const expanded=new Set<string>();
    for(const secret of secrets)if(secret){expanded.add(secret);const encoded=encodedDiagnostic(secret);if(encoded!==undefined)expanded.add(encoded);}
    // Bound diagnostic work independently of request/body acceptance limits. A
    // whole-value mask is preferable to partial matching when the budget is full.
    if(value.length*expanded.size>32*1024*1024)return '[REDACTED]';
    const literals=new Set(literalSecrets.flatMap(s=>{const encoded=encodedDiagnostic(s);return encoded===undefined?[s]:[s,encoded];}));
    for(const secret of expanded){
      // Short opaque and purely numeric tokens use Unicode word boundaries.
      // Longer opaque capabilities retain literal, case-sensitive substring semantics.
      const bounded=!literals.has(secret)&&(secret.length<=3||/^\d+$/.test(secret));
      let offset=0;
      while(offset<value.length){const at=value.indexOf(secret,offset);if(at<0)break;offset=at+1;
        if(bounded&&(/[\p{L}\p{N}_]/u.test(value.slice(0,at).at(-1)??'')||/[\p{L}\p{N}_]/u.test(value[at+secret.length]??'')))continue;
        ranges.push([at,at+secret.length]);
        if(ranges.length>100000)return '[REDACTED]';
      }
    }
    ranges.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const union:Array<[number,number]>=[];
    for(const range of ranges){const last=union.at(-1);if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else union.push([...range]);}
    let text='',offset=0;
    for(const[start,end]of union){text+=value.slice(offset,start)+(/^(?:https?|ftp):\/\//i.test(value.slice(start,end))?'[REDACTED_URL]':'[REDACTED]');offset=end;}text+=value.slice(offset);
    return text.length>4096?text.slice(0,4096)+'[TRUNCATED]':text;
  }
  if(typeof value==='boolean')return literalSecrets.includes(String(value))?'[REDACTED]':value;
  if(typeof value==='number')return secrets.includes(String(value))||literalSecrets.some(s=>s&&String(value).includes(s))?'[REDACTED]':value;
  if(Array.isArray(value))return value.slice(0,100).map(v=>sanitized(v,secrets,depth+1,uuidCapabilities,literalSecrets));
  if(isObject(value)){
    const out:Record<string,unknown>=Object.create(null);
    for(const[key,child]of Object.entries(value).slice(0,100)){
      const base=fieldNames.has(key)&&!sensitiveKey(key)?key:String(sanitized(key,secrets,depth+1,uuidCapabilities,literalSecrets));let safe=base,n=1;
      while(Object.hasOwn(out,safe))safe=base+'#'+n++;
      out[safe]=sensitiveKey(key)?'[REDACTED]':sanitized(child,secrets,depth+1,uuidCapabilities,literalSecrets);
    }
    return out;
  }
  return value;
}
export class MutationReference {
  #selectors: Record<string,string|number>;
  constructor(selectors:Record<string,string|number>){this.#selectors={...selectors};}
  /** Deliberately recover a private copy to consult a previous fiscal attempt. */
  reveal(): Record<string,string|number>{return {...this.#selectors};}
  toJSON(): string{return '[REDACTED]';}
  toString(): string{return 'MutationReference([REDACTED])';}
  [inspect.custom]():string{return this.toString();}
}
export class ProtectedLocation {
  #reference:string;
  constructor(value:string){this.#reference=validateLocation(value);}
  /** Original URI reference. This neither trusts its origin nor authorizes a fetch. */
  reveal():string{return this.#reference;}
  get isRelative():boolean{return !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(this.#reference);}
  toJSON():string{return '[REDACTED]';}
  toString():string{return 'ProtectedLocation([REDACTED])';}
  [inspect.custom]():string{return this.toString();}
}
export function validateLocation(value:string):string {
  const v=value.trim();
  if(!v||value.length>65536||/[\x00-\x1f\x7f]/.test(value)||!/^[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+$/.test(v)||/%(?![0-9a-f]{2})|%(?:0[ad]|00)/i.test(v)||v.startsWith('///')||/,(?:https?:)?\/\//i.test(v))throw new Error('Invalid Location');
  if(/^[A-Za-z][A-Za-z0-9+.-]*:/.test(v)&&!/^https?:\/\//i.test(v))throw new Error('Invalid Location scheme');
  const parsed=new URL(v,'https://relative.invalid');
  if(parsed.username||parsed.password||(!parsed.hostname))throw new Error('Invalid Location authority');
  // Reject permissive WHATWG repairs of an invalid authority or path separator.
  if(v.includes('\\')||/^https?:\/\/[^/]*:($|[/?#])/i.test(v))throw new Error('Invalid Location authority');
  return v;
}
export function locationContext(value:string):{secrets:string[];uuidCapabilities:string[]} {
  // Observe lexical components before URL parsing can normalize authority or dot segments.
  // This is diagnostic-only separation, never URI repair or acceptance.
  const reference=value.trim(),secrets=[value,reference],valueTexts=new Set<string>();
  const observeValue=(text:string):void=>{
    if(!text)return;
    valueTexts.add(text);
    try{const decoded=decodeURIComponent(text);if(decoded)valueTexts.add(decoded);}catch{/* No replacement text is invented. */}
  };
  const hash=reference.indexOf('#'),head=hash<0?reference:reference.slice(0,hash),fragment=hash<0?'':reference.slice(hash+1);
  const mark=head.indexOf('?'),withoutQuery=mark<0?head:head.slice(0,mark),query=mark<0?'':head.slice(mark+1);
  let path=withoutQuery;
  const prefix=/^(?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\//.exec(withoutQuery);
  if(prefix){
    const tail=withoutQuery.slice(prefix[0].length),slash=tail.indexOf('/'),authority=slash<0?tail:tail.slice(0,slash);
    secrets.push(authority,...authority.split(/[\[\]@:]/));path=slash<0?'':tail.slice(slash);
  }else{
    const scheme=/^[A-Za-z][A-Za-z0-9+.-]*:/.exec(withoutQuery);if(scheme)path=withoutQuery.slice(scheme[0].length);
  }
  secrets.push(path,query,fragment,...path.split('/'));
  for(const text of [...path.split('/'),fragment])observeValue(text);
  for(const item of query.split('&')){secrets.push(item);const equal=item.indexOf('=');if(equal>=0)secrets.push(item.slice(equal+1));}
  // URLSearchParams converts native malformed UTF-16 and malformed percent
  // sequences to U+FFFD. Diagnostic observation must never create a different
  // capability. Decode each form value only when its original bytes are valid.
  for(const item of query.split('&')){const equal=item.indexOf('=');if(equal>=0){const raw=item.slice(equal+1).replace(/\+/g,' ');observeValue(raw);secrets.push(raw);try{secrets.push(decodeURIComponent(raw));}catch{/* Keep exact malformed spelling. */}}}
  for(const item of [...secrets])try{secrets.push(decodeURIComponent(item));}catch{/* Preserve malformed literal components. */}
  // Observe valid octets independently: an unrelated malformed escape or invalid
  // UTF-8 run must not hide an ASCII UUID. This never makes the URI acceptable.
  const decoded=path.replace(/(?:%[0-9a-f]{2})+/gi,run=>{
    try{return decodeURIComponent(run);}catch{return run.replace(/%([0-9a-f]{2})/gi,(_match,hex:string)=>String.fromCharCode(parseInt(hex,16)));}
  });
  // Conservative observation only: decoded delimiters, fragment assignments and
  // matrix assignments can carry a capability even when they are not URI queries.
  // Decode valid octets independently of malformed neighbours, without fetching.
  const observed=reference.replace(/%([0-9a-f]{2})/gi,(_match,hex:string)=>String.fromCharCode(parseInt(hex,16)));
  for(const match of reference.matchAll(/(?:[?&#;]|^)[^?&#;=]*=([^?&#;]*)/g))observeValue(match[1]!);
  for(const match of observed.matchAll(/(?:[?&#;]|^)[^?&#;=]*=([^?&#;]*)/g))if(match[1])secrets.push(match[1],...match[1].split(/%(?![0-9a-f]{2})/i));
  // Filename text can be adjacent to any UUID digit (for example archive<uuid>).
  const uuidCapabilities=decoded.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi)??[];
  // Actual nonempty values can consist entirely of symbols. Keep the lexical
  // filter for structural components, without discarding valid value text.
  return {secrets:[...secrets.filter(s=>/[\p{L}\p{N}]/u.test(s)||!wellFormedText(s)),...valueTexts],uuidCapabilities};
}
