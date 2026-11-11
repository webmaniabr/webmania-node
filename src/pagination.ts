import { WebmaniaError } from './internal.js';
import type { RequestOptions } from './internal.js';
export interface PaginationOptions extends RequestOptions {
  maxPages?:number;
  maxItems?:number;
  deadlineMs?:number;
  /** Resume at this zero-based offset within the explicitly selected starting page. */
  startIndex?:number;
}
export interface PaginationContinuation {page:number;index:number;per_page:number}
export interface PageCollection<T>{items:T[];continuation:PaginationContinuation|undefined}
export interface OffsetPage<T>{data:T[];meta:{current_page:number;last_page:number;per_page:number;total:number}}
/** Offset pagination never shrinks per_page to satisfy an item limit. */
export async function* iteratePages<T>(fetch:(page:number,perPage:number,options:RequestOptions)=>Promise<OffsetPage<T>>,query:{page?:number;per_page?:number},options:PaginationOptions={}):AsyncGenerator<T,PaginationContinuation|undefined>{
  const initial=query.page===undefined?1:query.page,perPage=query.per_page===undefined?50:query.per_page;
  const maxPages=options.maxPages===undefined?100:options.maxPages,maxItems=options.maxItems===undefined?10000:options.maxItems,deadlineMs=options.deadlineMs===undefined?300000:options.deadlineMs,index=options.startIndex===undefined?0:options.startIndex;
  if(!Number.isSafeInteger(initial)||initial<1||!Number.isSafeInteger(perPage)||perPage<10||perPage>200||!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>10000||!Number.isSafeInteger(maxItems)||maxItems<1||maxItems>1000000||!Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>2147483647||!Number.isSafeInteger(index)||index<0||index>=perPage)throw new WebmaniaError('validation','Pagination requires safe positive pages, per_page 10..200, bounded pages/items/deadline and a valid startIndex.');
  const deadline=AbortSignal.timeout(deadlineMs),signal=options.signal?AbortSignal.any([options.signal,deadline]):deadline;
  const deadlineAt=performance.now()+deadlineMs;
  const checkActive=()=>{
    if(options.signal?.aborted)throw new WebmaniaError('cancelled','Pagination cancelled.');
    if(deadline.aborted||performance.now()>=deadlineAt)throw new WebmaniaError('timeout','Pagination exceeded its deadline.');
  };
  let page=initial,count=0;
  try{
    for(let request=0;request<maxPages;request++){
      checkActive();
      const result=await fetch(page,perPage,{signal}),meta=result.meta;
      checkActive();
      if(!meta||!Number.isSafeInteger(meta.current_page)||meta.current_page!==page||!Number.isSafeInteger(meta.last_page)||meta.last_page<1||!Number.isSafeInteger(meta.per_page)||meta.per_page!==perPage||!Number.isSafeInteger(meta.total)||meta.total<0||!Array.isArray(result.data)||result.data.length>perPage)throw new WebmaniaError('protocol','Pagination metadata must match the requested page and constant per_page.');
      if(page>meta.last_page){
        if(result.data.length!==0||meta.last_page!==Math.max(1,Math.ceil(meta.total/perPage)))throw new WebmaniaError('protocol','A past-end page must be empty with coherent pagination metadata.');
        checkActive();return undefined;
      }
      const from=request===0?index:0;
      if(from>result.data.length)throw new WebmaniaError('protocol','The continuation index exceeds the returned page length.');
      for(let i=from;i<result.data.length;i++){
        checkActive();
        yield result.data[i]!;
        checkActive();count++;
        if(count===maxItems){
          if(i+1<result.data.length)return {page,index:i+1,per_page:perPage};
          if(page<meta.last_page){if(page===Number.MAX_SAFE_INTEGER)throw new WebmaniaError('response_limit','The next page exceeds JavaScript safe integer range.');return {page:page+1,index:0,per_page:perPage};}
          return undefined;
        }
      }
      checkActive();
      if(page>=meta.last_page)return undefined;
      if(!result.data.length)throw new WebmaniaError('protocol','An empty nonterminal page prevents reliable continuation.');
      if(page===Number.MAX_SAFE_INTEGER)throw new WebmaniaError('response_limit','The next page exceeds JavaScript safe integer range.');
      page++;
    }
    checkActive();
    throw new WebmaniaError('response_limit','Pagination exceeded maxPages; request the next page explicitly.');
  }catch(error){
    if(deadline.aborted&&!options.signal?.aborted)throw new WebmaniaError('timeout','Pagination exceeded its deadline.');
    throw error;
  }
}
export async function collectPages<T>(iterator:AsyncGenerator<T,PaginationContinuation|undefined>):Promise<PageCollection<T>>{
  const items:T[]=[];for(;;){const step=await iterator.next();if(step.done)return {items,continuation:step.value};items.push(step.value);}
}
