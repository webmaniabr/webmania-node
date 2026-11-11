import { JsonTransport, WebmaniaError, credential } from './internal.js';
import type { RequestOptions, TransportOptions } from './internal.js';
import type { NfeCredentials } from './index.js';
import type { BinaryPolicy, FiscalFile } from './files-types.js';
import { fileRoutes } from './generated/file-routes.js';
import { wellFormedText } from './unicode.js';
export type { FiscalFile } from './files-types.js';

export type DocumentAuthorization = { type: 'company' } | { type: 'document_token'; token: string };
export interface FileRequestOptions extends RequestOptions {
  /** Per-file override; large reports do not inherit the JSON response limit. */
  maxResponseBytes?: number;
  timeoutMs?: number;
  /** XML attachment hint. false is omitted, never sent as the truthy text "false". */
  download?: boolean;
}
export interface FiscalFilesClientOptions extends TransportOptions {
  /** Explicit complete origins; a URL returned by the API never grants trust by itself. */
  trustedOrigins: readonly string[];
  /** Optional company credentials, used only when a call explicitly selects company authorization. */
  credentials?: NfeCredentials;
  /** The public webmania.com.br alias mounts file routes at /api. */
  pathPrefix?: '' | '/api';
  /** Origin of current report exports (fiscalDownloadReportV2); it must also be listed in trustedOrigins. */
  reportsBaseUrl?: string;
}
type Route = typeof fileRoutes[number];

function origin(value: string): string {
  let url: URL;
  try { if(typeof value!=='string'||!/^https?:\/\/[^/?#\\\s]+\/?$/.test(value))throw new Error();url = new URL(value); } catch { throw new WebmaniaError('configuration', 'A valid fiscal file origin is required.'); }
  const local = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && local)) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash)
    throw new WebmaniaError('configuration', 'Fiscal file origins must be HTTPS origins; explicit loopback HTTP is test-only.');
  return url.origin;
}
function identifier(value: string, uuidOnly = false): string {
  if (typeof value !== 'string' || !(/^[a-z0-9-]{36}$/i.test(value) || (!uuidOnly && /^[a-z0-9]{44}$/i.test(value))))
    throw new WebmaniaError('validation', 'A fiscal UUID or access-key identifier is required.');
  return encodeURIComponent(value);
}
/** Binary fiscal files with explicit per-call authorization and per-origin trust. */
export class FiscalFilesClient {
  #options: TransportOptions;
  #base: string;
  #prefix: '' | '/api';
  #trusted: Set<string>;
  #reports: string;
  #headers: Record<string,string> | undefined;
  constructor(options: FiscalFilesClientOptions) {
    if (!options || !Array.isArray(options.trustedOrigins) || options.trustedOrigins.length === 0)
      throw new WebmaniaError('configuration', 'trustedOrigins must explicitly list the authorized fiscal file origins.');
    this.#trusted = new Set(options.trustedOrigins.map(value => origin(value)));
    this.#base = origin(options.baseUrl ?? 'https://nfe.webmania.com.br');
    this.#reports = origin(options.reportsBaseUrl ?? 'https://api.webmania.com.br');
    if (options.pathPrefix !== undefined && options.pathPrefix !== '' && options.pathPrefix !== '/api')
      throw new WebmaniaError('configuration', 'The fiscal file path prefix must be empty or /api.');
    this.#prefix = options.pathPrefix ?? '';
    this.#options = { timeoutMs: options.timeoutMs ?? 30_000, maxResponseBytes: options.maxResponseBytes ?? 32*1024*1024,
      ...(options.ca === undefined ? {} : { ca:options.ca }) };
    if (options.credentials !== undefined) {
      const c = options.credentials;
      if (!c || !credential(c.consumerKey) || !credential(c.consumerSecret) || !credential(c.accessToken) || !credential(c.accessTokenSecret))
        throw new WebmaniaError('configuration', 'All four company credentials are required for fiscal file authorization.');
      this.#headers = { 'X-Consumer-Key':c.consumerKey, 'X-Consumer-Secret':c.consumerSecret,
        'X-Access-Token':c.accessToken, 'X-Access-Token-Secret':c.accessTokenSecret };
    }
    // Validate transport bounds immediately, without making a network request.
    new JsonTransport({ ...this.#options, baseUrl:this.#base }, {}, this.#base);
  }
  async baixarDanfe(id: string, auth: DocumentAuthorization, options: FileRequestOptions = {}): Promise<FiscalFile> {
    return this.#named('nfeDownloadDanfe',id,auth,options);
  }
  async baixarDanfeSimplificado(id: string, auth: DocumentAuthorization, options: FileRequestOptions = {}): Promise<FiscalFile> {
    return this.#named('nfeDownloadSimpleDanfe',id,auth,options);
  }
  async baixarDanfeEtiqueta(id: string, auth: DocumentAuthorization, options: FileRequestOptions = {}): Promise<FiscalFile> {
    return this.#named('nfeDownloadLabelDanfe',id,auth,options);
  }
  async baixarCartaCorrecaoPdf(id: string, auth: DocumentAuthorization, options: FileRequestOptions = {}): Promise<FiscalFile> {
    return this.#named('nfeDownloadCorrectionPdf',id,auth,options);
  }
  async baixarCartaCorrecaoPdfSequencia(id: string, event: number, auth: DocumentAuthorization, options: FileRequestOptions = {}): Promise<FiscalFile> {
    return this.#named('nfeDownloadCorrectionPdfSequence',id,auth,options,event);
  }
  async baixarXml(id: string, auth: DocumentAuthorization, options: FileRequestOptions = {}): Promise<FiscalFile> {
    return this.#named('nfeDownloadXml',id,auth,options);
  }
  async baixarXmlCancelamento(id: string, auth: DocumentAuthorization, options: FileRequestOptions = {}): Promise<FiscalFile> {
    return this.#named('nfeDownloadCancellationXml',id,auth,options);
  }
  async baixarCartaCorrecaoXml(id: string, auth: DocumentAuthorization, options: FileRequestOptions = {}): Promise<FiscalFile> {
    return this.#named('nfeDownloadCorrectionXml',id,auth,options);
  }
  async baixarCartaCorrecaoXmlSequencia(id: string, event: number, auth: DocumentAuthorization, options: FileRequestOptions = {}): Promise<FiscalFile> {
    return this.#named('nfeDownloadCorrectionXmlSequence',id,auth,options,event);
  }
  async baixarManifestacaoXml(id: string, auth: DocumentAuthorization, options: FileRequestOptions = {}): Promise<FiscalFile> {
    return this.#named('nfeDownloadManifestationXml',id,auth,options);
  }
  async baixarConciliacaoXml(id: string, auth: DocumentAuthorization, options: FileRequestOptions = {}): Promise<FiscalFile> {
    return this.#named('nfeDownloadPaymentEventXml',id,auth,options);
  }
  async baixarConciliacaoXmlSequencia(id: string, event: number, auth: DocumentAuthorization, options: FileRequestOptions = {}): Promise<FiscalFile> {
    return this.#named('nfeDownloadPaymentEventXmlSequence',id,auth,options,event);
  }
  /** Not available in this SDK release: the call fails before any request is sent. */
  async baixarEventoIbsCbsXml(id: string, auth: DocumentAuthorization, options: FileRequestOptions = {}): Promise<FiscalFile> {
    return this.#named('nfeDownloadIbsCbsEventXml',id,auth,options);
  }
  /** Legacy report store (/relatorio/{uuid}/). CSV/XLSX labeled text/xml are identified by their bytes. */
  async baixarRelatorio(id: string, options: FileRequestOptions = {}): Promise<FiscalFile> {
    return this.#named('fiscalDownloadReport',id,undefined,options);
  }
  /** Current report exports (fiscalDownloadReportV2, GET /relatorios/{uuid} on the reports origin). */
  async baixarRelatorioV2(id: string, options: FileRequestOptions = {}): Promise<FiscalFile> {
    return this.#named('fiscalDownloadReportV2',id,undefined,options);
  }
  /** Accepts only the file routes in the pinned contract, on an explicitly trusted origin. */
  async baixarUrlDocumento(url: string, auth: DocumentAuthorization, options: FileRequestOptions = {}): Promise<FiscalFile> {
    return this.#returned(url,false,auth,options);
  }
  /** Report capability URLs (legacy /relatorio/{uuid}/ or current /relatorios/{uuid}) never receive company
   *  headers, even when configured on this instance; the URL origin must be explicitly trusted. */
  async baixarUrlRelatorio(url: string, options: FileRequestOptions = {}): Promise<FiscalFile> {
    return this.#returned(url,true,undefined,options);
  }
  #named(operation: string, id: string, auth: DocumentAuthorization | undefined, options: FileRequestOptions, event?: number): Promise<FiscalFile> {
    const route = fileRoutes.find(candidate => candidate.operationId === operation)!;
    let path = route.path.replace(/\{(identifier|uuid)\}/, (_match,key: string) => identifier(id,key === 'uuid'));
    if (route.eventMaximum !== undefined) {
      if (!Number.isInteger(event) || event! < 1 || event! > route.eventMaximum)
        throw new WebmaniaError('validation', 'Invalid fiscal event sequence.');
      path = path.replace('{event}',String(event));
    }
    return this.#download(route.current?new URL(path,this.#reports):new URL(this.#prefix+path,this.#base),route,auth,options);
  }
  #returned(value: string, report: boolean, auth: DocumentAuthorization | undefined, options: FileRequestOptions): Promise<FiscalFile> {
    let url: URL;
    try { if(typeof value!=='string'||!wellFormedText(value))throw new Error();url = new URL(value); } catch { throw new WebmaniaError('validation','A valid fiscal file URL with well-formed Unicode is required.'); }
    if (url.username || url.password || url.hash) throw new WebmaniaError('validation','Fiscal file URLs must not contain user information or fragments.');
    const path = url.pathname.replace(/^\/api(?=\/)/,'');
    let selected: Route | undefined;
    for (const route of fileRoutes) {
      if (route.report !== report) continue;
      const keys: string[]=[];
      const pattern=route.path.split(/(\{[^}]+\})/).map(part=>{
        if(part.startsWith('{')){keys.push(part.slice(1,-1));return '([^/]+)';}
        return part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      }).join('').replace(/\/$/,'/?');
      // Current report URLs live at the origin root; the /api alias applies only to legacy file routes.
      const match=new RegExp('^'+pattern+'$').exec(route.current?url.pathname:path);
      if (!match) continue;
      for(let i=0;i<keys.length;i++) {
        let segment: string;
        try{segment=decodeURIComponent(match[i+1]!);}catch{throw new WebmaniaError('validation','Invalid fiscal file identifier encoding.');}
        if(keys[i]==='event'){
          if(!/^\d+$/.test(segment)||Number(segment)<1||Number(segment)>route.eventMaximum!)throw new WebmaniaError('validation','Invalid fiscal event sequence.');
        }else identifier(segment,keys[i]==='uuid');
      }
      selected=route;break;
    }
    if(!selected)throw new WebmaniaError('validation','The URL does not match a supported fiscal file route.');
    return this.#download(url,selected,auth,options);
  }
  #download(url: URL, route: Route, auth: DocumentAuthorization | undefined, options: FileRequestOptions): Promise<FiscalFile> {
    const selectedOrigin=origin(url.origin);
    if(!this.#trusted.has(selectedOrigin))throw new WebmaniaError('configuration','The fiscal file origin was not explicitly trusted.');
    if(!route.enabled)throw new WebmaniaError('configuration','This operation is not available in this SDK release; no request was sent.');
    if(options.download!==undefined&&typeof options.download!=='boolean')throw new WebmaniaError('validation','download must be boolean.');
    for(const key of url.searchParams.keys())if(!['token','download'].includes(key))throw new WebmaniaError('validation','Unsupported fiscal file URL query parameter.');
    for(const key of ['token','download'])if(url.searchParams.getAll(key).length>1)throw new WebmaniaError('validation','Duplicate fiscal file URL query parameter.');
    if(url.searchParams.has('download')&&(route.format!=='xml'||url.searchParams.get('download')!=='1'))throw new WebmaniaError('validation','The XML download query hint must be 1 or omitted.');
    if(options.download){if(route.format!=='xml')throw new WebmaniaError('validation','The download query hint applies only to XML files.');url.searchParams.set('download','1');}
    const headers:Record<string,string>={};const secrets:string[]=[];
    let authorization:BinaryPolicy['authorization'];
    if(route.report){
      if(auth!==undefined||url.searchParams.has('token'))throw new WebmaniaError('validation','Report capability URLs use their UUID and no company or document-token authorization.');
      authorization='report_capability';
      const capability=url.pathname.split('/').filter(Boolean).at(-1);
      if(capability)secrets.push(capability,decodeURIComponent(capability));
    }else if(auth?.type==='company'){
      if(!this.#headers)throw new WebmaniaError('configuration','Company credentials were not configured for file authorization.');
      if(url.searchParams.has('token'))throw new WebmaniaError('validation','Select one file authorization method; do not mix a token URL with company headers.');
      Object.assign(headers,this.#headers);authorization='company';
    }else if(auth?.type==='document_token'){
      if(!credential(auth.token))throw new WebmaniaError('validation','A nonempty document token is required.');
      const existing=url.searchParams.get('token');
      if(existing!==null&&existing!==auth.token)throw new WebmaniaError('validation','The URL token does not match the explicitly selected document token.');
      url.searchParams.set('token',auth.token);authorization='document_token';secrets.push(auth.token,encodeURIComponent(auth.token));
    }else throw new WebmaniaError('validation','Select company credentials or a document-scoped token explicitly.');
    const policy:BinaryPolicy={format:route.format,mediaTypes:route.mediaTypes,authorization,...(route.report?{reportRoute:route.current?'current' as const:'legacy' as const}:{})};
    return new JsonTransport({...this.#options,baseUrl:selectedOrigin,...(options.maxResponseBytes===undefined?{}:{maxResponseBytes:options.maxResponseBytes}),...(options.timeoutMs===undefined?{}:{timeoutMs:options.timeoutMs})},headers,selectedOrigin).download(url.pathname+url.search,options,policy,secrets);
  }
}
