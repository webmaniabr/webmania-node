import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const root=join(import.meta.dirname,'..');
rmSync(join(root,'dist'),{recursive:true,force:true});
execFileSync(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'-p',join(root,'tsconfig.json')],{stdio:'inherit'});
