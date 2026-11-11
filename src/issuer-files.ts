import { IssuerFileOperations } from './generated/issuer-file-operations.js';
export type { IssuerFileAuthorization, IssuerFilesClientOptions, IssuerFileRequestOptions, IssuerFileArguments } from './issuer-file-service.js';
export type { FiscalTransferResult, NonFileResult, RedirectFileResult } from './files-types.js';
/** Fixed API2 fiscal file operations; each call explicitly chooses authorization. */
export class IssuerFilesClient extends IssuerFileOperations {}
