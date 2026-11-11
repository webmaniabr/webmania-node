/** Test UTF-16 without repairing or replacing any caller code unit. */
export function wellFormedText(value: string): boolean {
  for (let i=0;i<value.length;i++) {
    const unit=value.charCodeAt(i);
    if(unit>=0xd800&&unit<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))return false;}
    else if(unit>=0xdc00&&unit<=0xdfff)return false;
  }
  return true;
}
/** Diagnostic spellings are optional; malformed text always retains its literal identity. */
export function encodedDiagnostic(value:string):string|undefined {
  return wellFormedText(value)?encodeURIComponent(value):undefined;
}
