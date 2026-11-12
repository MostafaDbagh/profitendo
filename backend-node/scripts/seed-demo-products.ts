import {createHash} from 'node:crypto';
import {createDatabase} from '../src/database.js';
import {stagingTarget,MOCK_MARKER} from '../src/staging/guard.js';
import {AuthService} from '../src/auth/service.js';
import {readAuthSettings} from '../src/auth/settings.js';
import {CatalogueService} from '../src/catalogue/service.js';
import {productSchema} from '../src/catalogue/contracts.js';
import {WorkflowService} from '../src/workflows/service.js';
import {adjustmentSchema} from '../src/workflows/contracts.js';
import {SalesService} from '../src/sales/service.js';
import {saleSchema,checkoutSchema} from '../src/sales/contracts.js';
import {productInsights} from '../src/catalogue/insights.js';
stagingTarget(process.env);
const db=createDatabase(process.env.DATABASE_URL!),auth=new AuthService(db,readAuthSettings(process.env));
const catalogue=new CatalogueService(auth),workflow=new WorkflowService(auth),sales=new SalesService(auth);
const key='demo-products-15-v1';
const uuid=(value:string)=>{const h=createHash('sha256').update(value).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
const names=['أرز بسمتي 1 كغ','سكر 1 كغ','زيت زيتون 1 لتر','حليب 1 لتر','شاي 200 غ','قهوة 250 غ','معكرونة 500 غ','عدس أحمر 1 كغ','حمص حب 1 كغ','ملح 1 كغ','معجون طماطم 400 غ','بسكويت 200 غ','مياه معدنية 1.5 لتر','سائل جلي 750 مل','مناديل ورقية'];
const price=['5','2','12','2.5','4','6','1.5','3','3.5','1','2','1.5','0.75','3','2'];
const cost=['3','1','8','1.5','2','4','0.8','2','2','0.5','1','0.75','0.3','1.5','1'];
const remaining=[0,2,4,5,8,12,20,25,30,35,40,45,50,60,75];
let sessionId:string|undefined;
try{
 if(!await db.systemMetadata.findUnique({where:{key:MOCK_MARKER}}))throw new Error('Seeded staging dataset required');
 const user=await db.authUser.findUniqueOrThrow({where:{email:'owner-trial@demo.example.test'}});
 const member=await db.membership.findFirstOrThrow({where:{userId:user.id,role:'OWNER',business:{name:{startsWith:'DEMO'}}},include:{business:true}});
 const bid=member.businessId,locations=await db.location.findMany({where:{businessId:bid,archivedAt:null},orderBy:{code:'asc'}}),shop=locations.find(l=>l.kind==='SHOP'),warehouse=locations.find(l=>l.kind==='WAREHOUSE');
 if(!shop||!warehouse||locations.length!==2)throw new Error('Expected original demo warehouse and shop');
 if(await db.systemMetadata.findUnique({where:{key}})){console.log('Demo products already seeded; no stock or sales duplicated.');}
 else{
 const ctx=await auth.transaction(tx=>auth.makeSession(tx,user,true));sessionId=ctx.session.id;
 const products=[];
 for(let i=0;i<names.length;i++){
  const sku=`DEMO-P${String(i+1).padStart(3,'0')}`;
  let p=await db.product.findUnique({where:{businessId_sku:{businessId:bid,sku}}});
  if(p&&p.description!==key)throw new Error('Existing product collision; no overwrite');
  if(!p){const base='20000000'+String(i+1).padStart(4,'0'),sum=[...base].reduce((n,v,index)=>n+Number(v)*(index%2?3:1),0),barcode=base+String((10-sum%10)%10);const created=await catalogue.create(ctx,bid,productSchema.parse({sku,name:`تجريبي · ${names[i]}`,unit:'PIECE',purchasePrice:cost[i],sellingPrice:price[i],minimumStock:'5',description:key,barcodes:[barcode]}));p=await db.product.findUniqueOrThrow({where:{id:created.id}});}
  products.push(p);
 }
 for(const location of [warehouse,shop]){
  const input=adjustmentSchema.parse({clientKey:uuid(`${key}:${bid}:${location.id}:opening`),kind:'OPENING',locationId:location.id,reason:'STAGING DEMO: simulated opening inventory',lines:products.map((p,i)=>({productId:p.id,quantity:String(remaining[i]!+(location.id===shop.id?Math.max(12-i,0):0))})).filter(l=>Number(l.quantity)>0)});
  const doc=await workflow.create(ctx,bid,input);if(doc.status==='DRAFT')await workflow.transition(ctx,bid,doc.id,{revision:doc.revision,action:'confirm'});
 }
 for(let n=0;n<12;n++){
  const doc=await sales.create(ctx,bid,saleSchema.parse({clientKey:uuid(`${key}:${bid}:sale:${n}`),locationId:shop.id,customerName:`عميل تجريبي ${n+1}`,notes:'STAGING DEMO — simulated sale, no real payment',lines:products.slice(0,n+1).map(p=>({productId:p.id,quantity:'1'}))}));
  if(doc.status==='DRAFT')await sales.checkout(ctx,bid,doc.id,checkoutSchema.parse({clientKey:uuid(`${key}:${bid}:payment:${n}`),revision:doc.revision,expectedTotal:doc.total.toFixed(4),confirm:true,payment:{method:'CARD',received:doc.total.toFixed(4),reference:`STAGING-DEMO-${n+1}`}}));
 }
 await db.systemMetadata.create({data:{key,value:JSON.stringify({businessId:bid,products:products.map(p=>p.id),sales:12})}});
 const report=await productInsights(auth,ctx,bid,{page:1,state:'active',filter:'low',export:false});
 console.log(JSON.stringify({business:member.business.name,products:15,completedDemoSales:12,lowStockProducts:'total' in report?report.total:0,currency:member.business.baseCurrency,barcodeExample:'2000000000015'},null,2));
 }
}finally{if(sessionId)await db.authSession.deleteMany({where:{id:sessionId}});await db.$disconnect();}
