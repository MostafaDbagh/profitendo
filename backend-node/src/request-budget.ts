import type {RequestHandler} from 'express';
// Cheap per-process shield before parsing bodies or querying the database.
// Authenticated expensive operations additionally use a shared database budget.
export function requestBudget(max=600,windowMs=60000,capacity=10000):RequestHandler{
 const buckets=new Map<string,{count:number;until:number}>();let sweep=0;
 return(req,res,next)=>{
  if(req.method==='OPTIONS'||req.path==='/health/live')return next();
  const now=Date.now();
  if(now>=sweep){for(const [key,b] of buckets)if(b.until<=now)buckets.delete(key);sweep=now+windowMs;}
  const key=req.ip??'unknown';let b=buckets.get(key);
  if(b&&b.until<=now){buckets.delete(key);b=undefined;}
  if(!b&&buckets.size<capacity){b={count:0,until:now+windowMs};buckets.set(key,b);}
  if(!b||++b.count>max){res.setHeader('Retry-After',String(Math.max(1,Math.ceil(((b?.until??now+windowMs)-now)/1000))));res.status(429).json({error:{code:'RATE_LIMITED',message:'Too many requests'},detail:'Too many requests. Try again later.'});return;}
  next();
 };
}
