import {readFile,stat,writeFile} from 'node:fs/promises';
import {validateMigrationReview} from '../src/migration/review.js';
const [source,review,output]=process.argv.slice(2);
if(!source||!review||!output)throw new Error('Usage: migration:review -- source.json review.json new-result.json');
for(const file of [source,review])if((await stat(file)).size>100*1024*1024)throw new Error('Input exceeds 100 MB');
const result=validateMigrationReview(await readFile(source,'utf8'),JSON.parse(await readFile(review,'utf8')));
await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({issues:result.issues.length,readyForOpeningReview:result.readyForOpeningReview,productionCutoverApproved:false}));
if(result.issues.length)process.exitCode=1;
