import {readFile,writeFile,stat} from 'node:fs/promises';
import {analyzeLegacy} from '../src/migration/legacy.js';
const [input,output]=process.argv.slice(2);if(!input||!output)throw new Error('Usage: npm run migration:analyze -- <legacy-export.json> <new-review.json>');
if((await stat(input)).size>100*1024*1024)throw new Error('Export exceeds the 100 MB local analysis limit');
const report=analyzeLegacy(await readFile(input,'utf8'));await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({products:report.products.length,issues:report.issues.length,sourceUnchanged:true,readyToPost:false}));
