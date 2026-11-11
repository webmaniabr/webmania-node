import http from 'node:http';
import https from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { isolatedLookup } from './resolver.js';
import type { BinaryPolicy, FiscalFile, FiscalTransferResult } from './files-types.js';
import { isObject, sanitized, sensitiveKey, snapshotValues, UUID_CAPABILITY, MutationReference, ProtectedLocation, locationContext } from './diagnostics.js';
import { WireSnapshot, parseResponseJson, UnsafeJsonNumberError } from './wire.js';
import { fiscalXmlRoot, inspectPdfProtection, inspectArchive, validXmlAttributes } from './file-inspection.js';

export const VERSION = '0.1.0-alpha.8';
export type ErrorKind = 'configuration' | 'validation' | 'http' | 'api' | 'protocol' | 'network' | 'timeout' | 'cancelled' | 'response_limit' | 'protected_file';
/** Errors exclude request headers, raw response bodies and low-level transport causes. */
export class WebmaniaError extends Error {
  readonly kind: ErrorKind;
  readonly status: number | undefined;
  readonly response: Readonly<Record<string, unknown>> | undefined;
  readonly correlationId: string | undefined;
  readonly outcome: 'unknown' | undefined;
  readonly requestReference: string | undefined;
  readonly recovery: MutationReference | undefined;
  readonly location: ProtectedLocation | undefined;
  constructor(kind: ErrorKind, message: string, status?: number, response?: Record<string, unknown>, correlationId?: string, uncertain?: { reference?: string; recovery?: MutationReference }, location?: ProtectedLocation) {
    super(message);
    this.name = 'WebmaniaError';
    this.kind = kind;
    this.status = status;
    this.response = response ? Object.freeze(response) : undefined;
    this.correlationId = correlationId;
    this.outcome = uncertain ? 'unknown' : undefined;
    this.requestReference = uncertain?.reference;
    this.recovery = uncertain?.recovery;
    this.location = location;
  }
  toJSON(): object { return { name: this.name, kind: this.kind, message: this.message, status: this.status, response: this.response, correlationId: this.correlationId, outcome: this.outcome, requestReference: this.requestReference, recovery: this.recovery?.toJSON(), location: this.location?.toJSON() }; }
}
export interface TransportOptions {
  /** HTTPS origin. HTTP is accepted only for an explicitly selected loopback test server. */
  baseUrl?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** Trust an explicit test/private CA; hostname verification remains enabled. */
  ca?: string;
}
export interface RequestOptions { signal?: AbortSignal }
const requestStart=Symbol('requestStart');
type TimedOptions=RequestOptions&{[requestStart]?:number};
export interface DiagnosticContext { secrets?: readonly string[]; uuidCapabilities?: readonly string[]; selectors?: Record<string,unknown>; capabilityAccess?: boolean }
export { sanitized } from './diagnostics.js';
export const object = isObject;
export { WireSnapshot } from './wire.js';
export class JsonTransport {
  #headers: Record<string, string>;
  #origin: string;
  #timeout: number;
  #maximum: number;
  #ca: string | undefined;
  constructor(options: TransportOptions, headers: Record<string, string>, defaultOrigin: string) {
    let base: URL;
    try {
      const raw=options.baseUrl??defaultOrigin;
      // Validate the lexical origin BEFORE WHATWG removes dot segments, empty
      // query/fragment markers, whitespace or backslashes.
      if(typeof raw!=='string'||!/^https?:\/\/[^/?#\\\s]+\/?$/.test(raw))throw new Error();
      base = new URL(raw);
    }
    catch { throw new WebmaniaError('configuration', 'baseUrl must be an absolute origin.'); }
    const local = ['127.0.0.1', '[::1]', 'localhost'].includes(base.hostname);
    if (base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
        !(base.protocol === 'https:' || (base.protocol === 'http:' && local)))
      throw new WebmaniaError('configuration', 'baseUrl must be an HTTPS origin (HTTP loopback is test-only).');
    const timeout = options.timeoutMs ?? 30_000;
    const maximum = options.maxResponseBytes ?? 2 * 1024 * 1024;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 2_147_483_647 || !Number.isSafeInteger(maximum) || maximum < 1)
      throw new WebmaniaError('configuration', 'Timeout and response limit must be positive integers within supported bounds.');
    if (options.ca !== undefined && typeof options.ca !== 'string')
      throw new WebmaniaError('configuration', 'ca must be PEM text.');
    this.#headers = { ...headers }; this.#origin = base.origin;
    this.#timeout = timeout; this.#maximum = maximum; this.#ca = options.ca;
  }
  get(path: string, options: RequestOptions): Promise<unknown> { return this.request('GET', path, undefined, options, false); }
  /** Internal boundary: generated and convenience methods include serialization. */
  start(options:RequestOptions):RequestOptions {
    if(!options||typeof options!=='object'||Array.isArray(options))throw new WebmaniaError('validation','Request options must be an object.');
    return {...options,[requestStart]:(options as TimedOptions)[requestStart]??performance.now()} as TimedOptions;
  }
  download(path: string, options: RequestOptions, policy: BinaryPolicy, secrets: string[] = []): Promise<FiscalFile> {
    // The pinned report capability consumes a bounded download quota even on GET.
    const possibleQuotaEffect = policy.authorization === 'report_capability';
    return this.request('GET', path, undefined, options, possibleQuotaEffect, undefined, policy, secrets, {capabilityAccess: possibleQuotaEffect}) as Promise<FiscalFile>;
  }
  request(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body: unknown, options: RequestOptions, uncertainOnFailure = method !== 'GET', responseParser?: (value: unknown) => unknown, binary?: BinaryPolicy, additionalSecrets: string[] = [], context: DiagnosticContext = {}): Promise<unknown> {
    const started=(options as TimedOptions)?.[requestStart]??performance.now();
    if(!options||typeof options!=='object'||Array.isArray(options)||(options.signal!==undefined&&!(options.signal instanceof AbortSignal)))return Promise.reject(new WebmaniaError('validation','Request options require an AbortSignal when signal is provided.'));
    const uuidCapabilities = [...(context.uuidCapabilities ?? []), ...(binary?.authorization === 'report_capability' ? additionalSecrets.filter(value => UUID_CAPABILITY.test(value)) : [])];
    let snapshot: WireSnapshot | undefined;
    try { snapshot=body===undefined?undefined:body instanceof WireSnapshot?body:WireSnapshot.create(body); }
    catch(error) { return Promise.reject(error); }
    const payload=snapshot?.payload, data=snapshot?.value;
    if (method === 'GET' && payload !== undefined) return Promise.reject(new WebmaniaError('validation','GET requests cannot contain a body.'));
    const locationSecrets:string[]=[];
    const credentialSecrets = [...Object.values(this.#headers), ...additionalSecrets, ...snapshotValues(data,true)]
      .flatMap(value => value.startsWith('Bearer ') ? [value,value.slice(7)] : [value]);
    const literalSecrets=[...Object.values(this.#headers),...additionalSecrets,...snapshotValues(data,false,true),...(context.secrets??[])].flatMap(value=>value.startsWith('Bearer ')?[value,value.slice(7)]:[value]);
    const secrets = [...new Set([...credentialSecrets,...snapshotValues(data),...(context.secrets??[])])].sort((a,b)=>b.length-a.length);
    const candidates:Record<string,unknown>={...(object(data)?Object.fromEntries(['uuid','ID','id','chave'].filter(k=>Object.hasOwn(data,k)).map(k=>[k,data[k]])):{}),...(context.selectors??{})};
    const reference=Object.values(candidates).find(v=>typeof v==='string') as string|undefined;
    const recoveryValues:Record<string,string|number>={};
    for(const[key,value]of Object.entries(candidates))if((typeof value==='string'||typeof value==='number')&&String(value)&&String(sanitized(String(value),credentialSecrets,0,uuidCapabilities))===String(value))recoveryValues[key]=value;
    let recovery=Object.keys(recoveryValues).length&&!context.capabilityAccess?new MutationReference(recoveryValues):undefined;
    if (options.signal?.aborted) return Promise.reject(new WebmaniaError('cancelled', 'Request cancelled.'));
    const url = new URL(path, this.#origin);
    return new Promise((resolve, reject) => {
      let settled = false;
      let dispatched = false;
      let startingBytes=0;
      let informationCount=0;
      let completeHeadersObserved=false;
      let trailerObservationPending=false;
      let declaredTrailerContext=false;
      let lookup:ReturnType<typeof isolatedLookup>|undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let request: http.ClientRequest;
      const finish = (error?: WebmaniaError, value?: unknown) => {
        if (settled) return;
        if(!error&&(options.signal?.aborted||performance.now()-started>=this.#timeout))error=new WebmaniaError(options.signal?.aborted?'cancelled':'timeout','Request deadline exceeded; no automatic retry was performed.');
        settled = true; if (timer) clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        lookup?.stop();
        if(error&&trailerObservationPending)recovery=undefined;
        const closing:Promise<unknown>[]=[lookup?.closed??Promise.resolve()];
        // Redirect metadata is returned before consuming a representation. Its
        // intentionally abandoned connection must close before the call settles.
        if(!error&&object(value)&&value.kind==='redirect'&&request&&!request.closed){closing.push(new Promise<void>(resolve=>request.once('close',resolve)));request.destroy();}
        if (error) {
          dispatched ||= (request?.socket?.bytesWritten??0)>startingBytes;
          if(request&&!request.closed){closing.push(new Promise<void>(resolve=>request.once('close',resolve)));request.destroy();}
          if (dispatched && uncertainOnFailure && (['network','timeout','cancelled','response_limit','protocol','api'].includes(error.kind) || (error.kind === 'http' && ((error.status ?? 0) >= 500 || ((error.status ?? 0) >= 300 && (error.status ?? 0)<400))))) {
            const safeReference = reference === undefined ? undefined : String(sanitized(reference, secrets, 0, uuidCapabilities,literalSecrets));
            const result=new WebmaniaError(error.kind, 'Operation outcome is unknown; consult the previous result before repeating the request.', error.status, error.response as Record<string, unknown> | undefined, error.correlationId, {...(safeReference===undefined?{}:{reference:safeReference}),...(recovery===undefined?{}:{recovery})},error.location);
            void Promise.all(closing).then(()=>reject(result));
          } else {const result=error;void Promise.all(closing).then(()=>reject(result));}
        } else void Promise.all(closing).then(()=>resolve(value));
      };
      const abort = () => finish(new WebmaniaError('cancelled', 'Request cancelled.'));
      const observeLocations=(rawHeaders:readonly string[]):string[]=>{
        // Every native header event shares observation before continuing or rejecting.
        const locations:string[]=[];
        for(let i=0;i<rawHeaders.length;i+=2)if(rawHeaders[i]!.toLowerCase()==='location')locations.push(rawHeaders[i+1]!);
        for(const location of locations){const seen=locationContext(location);secrets.push(...seen.secrets);locationSecrets.push(...seen.secrets);uuidCapabilities.push(...seen.uuidCapabilities);}
        // A newly observed capability cannot remain a recovery selector.
        if(recovery&&Object.values(recovery.reveal()).some(v=>String(sanitized(String(v),secrets,0,uuidCapabilities,literalSecrets))!==String(v))) {
          const safe=Object.fromEntries(Object.entries(recovery.reveal()).filter(([_k,v])=>String(sanitized(String(v),[...credentialSecrets,...locationSecrets],0,uuidCapabilities,credentialSecrets))===String(v)));
          recovery=Object.keys(safe).length?new MutationReference(safe):undefined;
        }
        return locations;
      };
      const dispatch=async()=>{try {
        lookup=isolatedLookup(url.hostname);
        const addresses=await lookup.result;
        if(settled)return;
        if(options.signal?.aborted||performance.now()-started>=this.#timeout){finish(new WebmaniaError(options.signal?.aborted?'cancelled':'timeout','Request deadline exceeded; no automatic retry was performed.'));return;}
        request = (url.protocol === 'https:' ? https : http).request(url, {
          method, headers: { ...this.#headers, Accept: binary ? binary.mediaTypes.join(', ') + ', application/json' : 'application/json', 'User-Agent': `webmania-node/${VERSION}`, ...(payload === undefined ? {} : { 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(payload) }) },
          ...(this.#ca !== undefined ? { ca: this.#ca } : {}), rejectUnauthorized: true,
          checkServerIdentity:(hostname,certificate)=>certificate.subjectaltname?checkServerIdentity(hostname,certificate):new Error('A matching Subject Alternative Name is required.'),
          lookup:(_hostname,lookupOptions,callback)=>{
            const family=typeof lookupOptions==='number'?lookupOptions:lookupOptions.family;
            const selected=family?addresses.filter(a=>a.family===family):addresses;
            if(!selected.length){callback(new Error('No address for requested family.'),[],0);return;}
            if(typeof lookupOptions==='object'&&lookupOptions.all)(callback as unknown as (error:null,addresses:typeof selected)=>void)(null,selected);
            else callback(null,selected[0]!.address,selected[0]!.family);
          },
        }, response => {
          dispatched=true;
          const status = response.statusCode ?? 0;
          const failedHttp = status < 200 || status >= 300;
          const locations=observeLocations(response.rawHeaders);
          completeHeadersObserved=true;
          trailerObservationPending=typeof response.headers['transfer-encoding']==='string'&&/\bchunked\b/i.test(response.headers['transfer-encoding']);
          declaredTrailerContext=response.headers.trailer!==undefined;
          const correlationHeader = response.headers['x-request-id'] ?? response.headers['x-correlation-id'];
          const correlationId = typeof correlationHeader === 'string' ? String(sanitized(correlationHeader, secrets, 0, uuidCapabilities,literalSecrets)) : undefined;
          const singleton=['content-type','content-encoding','location'];
          if(singleton.some(name=>response.rawHeaders.filter((_v,i)=>i%2===0&&response.rawHeaders[i]!.toLowerCase()===name).length>1)&&!(binary?.redirect&&status===302)){finish(new WebmaniaError('protocol','Ambiguous singleton HTTP response header.',status,undefined,correlationId));response.destroy();return;}
          if(binary?.redirect&&status===302){
            let location:ProtectedLocation;
            try{if(locations.length!==1)throw new Error();location=new ProtectedLocation(locations[0]!);}
            catch{finish(new WebmaniaError('protocol','Invalid, missing or ambiguous redirect Location.',status,undefined,correlationId));response.destroy();return;}
            finish(undefined,{kind:'redirect',status:302,location,requestedAuthorization:binary.authorization});response.destroy();return;
          }
          if (binary && !failedHttp && status !== 200) {
            finish(new WebmaniaError('protocol', 'The provider did not return a complete fiscal file response.', status)); response.destroy(); return;
          }
          const declaredLength = response.headers['content-length'];
          if (declaredLength !== undefined && /^\d+$/.test(declaredLength) && Number(declaredLength) > this.#maximum) {
            if(!declaredTrailerContext)trailerObservationPending=false;
            finish(new WebmaniaError('response_limit', 'Response exceeded the configured byte limit.', status)); response.destroy(); return;
          }
          const type = response.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
          const jsonResponse = type === 'application/json' || !!type?.endsWith('+json');
          const chunks: Buffer[] = []; let length = 0;
          response.on('data', (chunk: Buffer) => {
            length += chunk.length;
            if (length > this.#maximum) { if(!declaredTrailerContext)trailerObservationPending=false;finish(new WebmaniaError('response_limit', 'Response exceeded the configured byte limit.', status)); response.destroy(); }
            else chunks.push(chunk);
          });
          response.on('error', () => finish(new WebmaniaError('network', 'Response interrupted; no automatic retry was performed.', status)));
          response.on('aborted', () => finish(new WebmaniaError('network', 'Response interrupted; no automatic retry was performed.', status)));
          response.on('end', () => {
            if (settled) return;
            observeLocations(response.rawTrailers);
            trailerObservationPending=false;
            const bytes = Buffer.concat(chunks);
            if(!jsonResponse&&!binary){finish(new WebmaniaError(failedHttp?'http':'protocol',failedHttp?`The API returned HTTP ${status}.`:'The API returned a non-JSON response.',status,undefined,correlationId));return;}
            if (binary && !jsonResponse) {
              if (failedHttp) { finish(new WebmaniaError('http', `The API returned HTTP ${status}.`, status, undefined, correlationId)); return; }
              try { finish(undefined, decodeFile(bytes, type ?? '', binary, response.headers['content-disposition'])); }
              catch (error) { finish(error instanceof WebmaniaError ? error : new WebmaniaError('protocol', 'Invalid fiscal file response.', status)); }
              return;
            }
            let value: unknown;
            try { value = parseResponseJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
            catch(error) { finish(new WebmaniaError(failedHttp ? 'http' : 'protocol', failedHttp ? `The API returned HTTP ${status}.` : error instanceof UnsafeJsonNumberError?'The API returned an unsupported JSON number; precise values must be strings.':'The API returned malformed JSON.', status, undefined, correlationId)); return; }
            if (failedHttp || (object(value) && Object.hasOwn(value, 'error'))) {
              const safe = object(value) ? sanitized(value, secrets, 0, uuidCapabilities,literalSecrets) as Record<string, unknown> : undefined;
              finish(new WebmaniaError(failedHttp ? 'http' : 'api', failedHttp ? `The API returned HTTP ${status}.` : 'The API reported an application error.', status, safe, correlationId));
            } else if(binary?.pending&&object(value)&&typeof value.msg==='string'){
              finish(undefined,{kind:'pending',status,contentType:type??'application/json',bytes,byteLength:bytes.length,requestedAuthorization:binary.authorization});
            } else if (binary) {
              finish(new WebmaniaError('protocol', 'The provider returned JSON instead of the requested fiscal file.', status));
            } else {
              try { finish(undefined, responseParser ? responseParser(value) : value); }
              catch(error) { finish(error instanceof WebmaniaError ? error : new WebmaniaError('protocol', 'Invalid API response.', status)); }
            }
          });
        });
        request.on('error', (error:NodeJS.ErrnoException) => {
          const parserFailure=error.code?.startsWith('HPE_')??false;
          // An incomplete header parse can hide a Location capability. Ordinary
          // network close before headers and body errors after observation retain
          // their existing, separately checked recovery behavior.
          if(parserFailure&&(!completeHeadersObserved||trailerObservationPending))recovery=undefined;
          finish(new WebmaniaError(parserFailure?'protocol':'network', 'Request failed; no automatic retry was performed.'));
        });
        request.on('upgrade',(response,socket)=>{
          observeLocations(response.rawHeaders);
          socket.destroy();
          finish(new WebmaniaError('protocol','HTTP protocol switching is not supported.',response.statusCode));
        });
        request.on('information',information=>{
          observeLocations(information.rawHeaders);
          if(++informationCount>8||![100,102,103].includes(information.statusCode))finish(new WebmaniaError('protocol','Unsupported or excessive informational HTTP responses.'));
        });
        request.on('socket',socket=>{startingBytes=socket.bytesWritten;});
        request.on('finish',()=>{dispatched=true;});
        request.end(payload);
      } catch {finish(new WebmaniaError('network','Request failed; no automatic retry was performed.'));}};
      options.signal?.addEventListener('abort', abort, { once: true });
      if(options.signal?.aborted){abort();return;}
      const remaining=this.#timeout-(performance.now()-started);
      if(remaining<=0){finish(new WebmaniaError('timeout','Request deadline exceeded before dispatch.'));return;}
      timer=setTimeout(()=>finish(new WebmaniaError('timeout','Request deadline exceeded; no automatic retry was performed.')),remaining);
      void dispatch();
    });
  }
}

export function credential(value: unknown): value is string { return typeof value === 'string' && /^[\x21-\x7e]+$/.test(value); }

const XLSX='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** True when a body starts like XML, HTML or JSON (after a BOM and whitespace). */
function markupOrJson(bytes: Buffer): boolean {
  let leading=bytes.subarray(0,1024).toString('utf8');
  if(bytes[0]===0xff&&bytes[1]===0xfe)leading=bytes.subarray(2,1024).toString('utf16le');
  else if(bytes[0]===0xfe&&bytes[1]===0xff)leading=Buffer.from(bytes.subarray(2,Math.min(bytes.length-bytes.length%2,1024))).swap16().toString('utf16le');
  return /^[\ufeff\s]*[<{]/.test(leading);
}
/** Report files: the declared media type and the bytes must agree. Only the legacy report route accepts
 *  text/xml: a ZIP local-file signature is XLSX, any other body is CSV returned byte-exact (never decoded);
 *  XML, HTML and JSON bodies are refused. The result's contentType carries the detected format. */
function decodeReport(bytes: Buffer, contentType: string, policy: BinaryPolicy, zipped: boolean, contentDisposition?: string): FiscalFile {
  if (!policy.mediaTypes.includes(contentType))
    throw new WebmaniaError('protocol', 'The provider returned an unexpected fiscal file content type.', 200);
  let detected=contentType, protection: FiscalFile['protection']='not_established';
  const local=bytes.length>=4&&bytes[0]===0x50&&bytes[1]===0x4b&&bytes[2]===3&&bytes[3]===4;
  const malformed=()=>new WebmaniaError('protocol','The provider returned a report whose bytes do not match its format.',200);
  if(contentType==='text/xml'&&policy.reportRoute==='legacy'){
    if(local){if(!inspectArchive(bytes))throw malformed();detected=XLSX;}
    else if(bytes.includes(0)||markupOrJson(bytes))throw new WebmaniaError('protocol','A report labeled text/xml must be CSV or XLSX; XML, HTML and JSON bodies are refused.',200);
    else detected='text/csv';
  }else if(contentType==='application/zip'||contentType===XLSX){
    if(!(contentType===XLSX?local:zipped)||!inspectArchive(bytes))throw malformed();
  }else if(contentType==='application/pdf'){
    if(!bytes.subarray(0,8).toString('ascii').startsWith('%PDF-'))throw malformed();
    const inspection=inspectPdfProtection(bytes);
    if(inspection==='encryption_entry')throw new WebmaniaError('protected_file','The PDF declares an encryption entry. Verify document authorization.',200);
    protection=inspection;
  }else if(contentType==='text/csv'){
    if(zipped||bytes.includes(0)||markupOrJson(bytes))throw malformed();
  }else if(contentType==='text/html'||contentType==='application/xml'||contentType==='text/xml'){
    // Declared text renderings of a report: never executed or parsed as fiscal XML.
    if(zipped||bytes.includes(0))throw malformed();
    if(contentType!=='text/html'&&(!markupOrJson(bytes)||!validXmlAttributes(bytes)))throw malformed();
  }else if(contentType!=='application/octet-stream'||(zipped&&!inspectArchive(bytes)))throw malformed();
  return { kind:'file', bytes, byteLength: bytes.length, contentType: detected, ...(contentDisposition === undefined ? {} : { contentDisposition }), format: 'report', requestedAuthorization: policy.authorization, protection };
}

function decodeFile(bytes: Buffer, contentType: string, policy: BinaryPolicy, contentDisposition?: string): FiscalTransferResult {
  if (bytes.length === 0) throw new WebmaniaError('protocol', 'The provider returned an empty fiscal file.', 200);
  const zipped = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
    ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6) || (bytes[2] === 7 && bytes[3] === 8));
  if (policy.reportRoute) return decodeReport(bytes, contentType, policy, zipped, contentDisposition);
  const nonfile=(kind:'html'|'protected_archive'|'protected_pdf')=>({kind,status:200,contentType,bytes,byteLength:bytes.length,requestedAuthorization:policy.authorization,...(contentDisposition===undefined?{}:{contentDisposition})});
  if(policy.representations&&contentType==='text/html')return nonfile('html');
  if(policy.representations&&policy.format==='xml'&&zipped&&contentType==='application/zip')return nonfile('protected_archive');
  if (policy.format === 'xml' && (zipped || contentType === 'application/zip'))
    throw new WebmaniaError('protected_file', 'A ZIP fallback is not authenticated plaintext XML. Verify document authorization.', 200);
  if (!policy.mediaTypes.includes(contentType))
    throw new WebmaniaError('protocol', 'The provider returned an unexpected fiscal file content type.', 200);
  let protection: FiscalFile['protection'] = 'not_established';
  if (contentType === 'application/pdf') {
    if (!bytes.subarray(0, 8).toString('ascii').startsWith('%PDF-'))
      throw new WebmaniaError('protocol', 'The provider returned invalid PDF bytes.', 200);
    const inspection = inspectPdfProtection(bytes);
    if (inspection === 'encryption_entry'&&policy.representations)return nonfile('protected_pdf');
    if (inspection === 'encryption_entry')
      throw new WebmaniaError('protected_file', 'The PDF declares an encryption entry. Verify document authorization.', 200);
    protection = inspection;
  } else if (policy.format === 'xml') {
    let leading = bytes.subarray(0, 4096).toString('utf8');
    if (bytes[0] === 0xff && bytes[1] === 0xfe) leading = bytes.subarray(2, 4096).toString('utf16le');
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      const prefix = Buffer.from(bytes.subarray(2, Math.min(bytes.length - bytes.length % 2, 4096)));
      leading = prefix.swap16().toString('utf16le');
    }
    const root = fiscalXmlRoot(leading);
    if (!root || !(policy.xmlRoots??['NFe','nfeProc','procNFe','procEventoNFe','procEvento','envEvento','evento','retEvento','retEnvEvento','procInutNFe','inutNFe','retInutNFe']).includes(root))
      throw new WebmaniaError('protocol', 'The provider returned an unexpected fiscal XML document.', 200);
    if(!validXmlAttributes(bytes))throw new WebmaniaError('protocol','The provider returned malformed or unsupported fiscal XML.',200);
    protection = 'not_applicable';
  } else if (zipped || contentType === 'application/zip' || contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    if (!zipped) throw new WebmaniaError('protocol', 'The provider returned invalid archive bytes.', 200);
    if(!inspectArchive(bytes))throw new WebmaniaError('protocol','The provider returned an inconsistent or unsupported archive.',200);
  }
  return { kind:'file', bytes, byteLength: bytes.length, contentType, ...(contentDisposition === undefined ? {} : { contentDisposition }), format: policy.format, requestedAuthorization: policy.authorization, protection };
}
