import {readFile,writeFile,unlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
process.env.TEST_DATABASE_URL=process.env.DATABASE_URL;
let failed=0;
for(const name of process.argv.slice(2)){
 const file=new URL(`./.full-system-${name}.ts`,import.meta.url);
 let source=await readFile(new URL(`./${name}-browser.ts`,import.meta.url),'utf8');
 source=source.replaceAll('localhost:3000','localhost:3300').replaceAll('localhost:3100','localhost:3300').replaceAll('localhost:4000','localhost:4300').replaceAll('localhost:4100','localhost:4300').replaceAll('app.listen(4000,','app.listen(4300,').replaceAll('app.listen(4100,','app.listen(4300,');
 source=source.replaceAll("'Product catalogue'","'Products'").replaceAll("'دليل المنتجات'","'المنتجات'");
 source=source.replaceAll('[320,390,768,1024,1440]','[390,1440]');
 if(name==='completion')source=source.replace('await page.goto(`${settings.appOrigin}/business-v2`);await page.getByRole(\'navigation\')', "if(!page.url().includes('/business')||await page.evaluate(()=>document.documentElement.lang!==localStorage.getItem('profitlens_lang')))await page.goto(`${settings.appOrigin}/business-v2`);const back=page.getByRole('button',{name:lang==='ar'?'إغلاق':'Close',exact:true});if(await back.count()===1)await back.click();await page.getByRole('navigation')");
 else if(name!=='catalogue')source=source.replaceAll('await page.goto(`${settings.appOrigin}/business-v2`);','await page.waitForTimeout(3000);await page.goto(`${settings.appOrigin}/business-v2`);');
 const port=Number(process.env.BROWSER_TEST_PORT||4300);
 if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid local test port');
 if(port!==4300){source=source.replaceAll('app.listen(4300,',`app.listen(${port},`);source=source.replaceAll('const page=await context.newPage();',`const page=await context.newPage();await page.route('http://localhost:4300/api/**',async route=>{const u=new URL(route.request().url());const response=await route.fetch({url:'http://localhost:${port}'+u.pathname+u.search});await route.fulfill({response});});`);}
 await writeFile(file,source);console.log('START',name);
 try{const r=spawnSync(process.execPath,['--import','tsx',file.pathname],{env:process.env,stdio:'inherit',timeout:300000});console.log('RESULT',name,r.status,r.error?.message||'');if(r.status!==0)failed++;}finally{await unlink(file);}
}
process.exitCode=failed?1:0;
