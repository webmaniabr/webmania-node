// The same controlled cases can exercise either the checkout build or an
// explicitly selected installed artifact. Production SDK code reads no test env.
const entry=process.env.WEBMANIA_TEST_INSTALLED_ENTRY ?? new URL('../dist/index.js',import.meta.url).href;
const sdk=await import(entry);
export const {NfeClient,MonitorClient,FiscalFilesClient,IssuerClient,IssuerFilesClient,ResellerClient,WebmaniaError,VERSION}=sdk;
