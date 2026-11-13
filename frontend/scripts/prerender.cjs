/* Render the real public React pages for every visitor, without a browser or API.
 * Runs after CRA, including in Docker. No private/customer state is loaded. */
const fs=require('node:fs/promises');
const path=require('node:path');
const webpack=require('webpack');
const root=path.resolve(__dirname,'..'),build=path.join(root,'build'),temp=path.join(root,'node_modules/.cache/profitlens-seo');
const escape=value=>String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
async function main(){
 await fs.mkdir(temp,{recursive:true});
 await new Promise((resolve,reject)=>webpack({mode:'production',target:'node',entry:path.join(__dirname,'seo/entry.jsx'),output:{path:temp,filename:'render.cjs',library:{type:'commonjs2'}},optimization:{minimize:false},externals:{react:'commonjs react','react-dom/server':'commonjs react-dom/server'},resolve:{extensions:['.js','.jsx','.json'],alias:{'@':path.join(root,'src')}},module:{rules:[{test:/\.jsx?$/,exclude:/node_modules/,use:{loader:require.resolve('babel-loader'),options:{babelrc:false,configFile:false,presets:[[require.resolve('@babel/preset-react'),{runtime:'automatic'}]]}}},{test:/\.css$/,use:path.join(__dirname,'seo/empty-loader.cjs')}]},plugins:[new webpack.NormalModuleReplacementPlugin(/context\/LanguageContext$/,resource=>{resource.request=path.join(__dirname,'seo/language.jsx');}),new webpack.NormalModuleReplacementPlugin(/context\/AuthContext$/,resource=>{resource.request=path.join(__dirname,'seo/auth.js');})]},(error,stats)=>error?reject(error):stats.hasErrors()?reject(new Error(stats.toString({all:false,errors:true}))):resolve()));
 const seo=require(path.join(temp,'render.cjs'));
 const original=await fs.readFile(path.join(build,await fs.access(path.join(build,'app.html')).then(()=>true,()=>false)?'app.html':'index.html'),'utf8');
 // Strip old head metadata only. Scripts/styles/fonts/icons remain exactly CRA's.
 const template=original.replace(/<title>[\s\S]*?<\/title>/gi,'').replace(/<meta\b[^>]*(?:name=["'](?:description|robots|twitter:[^"']+)["']|property=["']og:[^"']+["'])[^>]*>/gi,'').replace(/<link\b[^>]*rel=["'](?:canonical|alternate|describedby)["'][^>]*>/gi,'').replace(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi,'');
 const meta=(attr,key,value)=>`<meta ${attr}="${key}" content="${escape(value)}">`;
 function document({lang='ar',title,description,markup='',path:route,indexable=false}){
  const defaults=seo.DEFAULT_METADATA[lang],image=new URL(seo.SOCIAL_IMAGE.path,seo.SITE_URL).href;
  let head=`<title>${escape(title)}</title>`+meta('name','description',description)+meta('name','robots',indexable?'index, follow, max-image-preview:large':'noindex, nofollow');
  if(indexable){
   const url=seo.canonicalUrl(route,lang);
   const graph=seo.buildStructuredData({siteUrl:seo.SITE_URL,title,description,path:seo.publicPagePath(route,lang),lang});
   const properties={'og:type':'website','og:site_name':seo.SITE_NAME,'og:title':title,'og:description':description,'og:url':url,'og:image':image,'og:image:secure_url':image,'og:image:type':seo.SOCIAL_IMAGE.type,'og:image:width':seo.SOCIAL_IMAGE.width,'og:image:height':seo.SOCIAL_IMAGE.height,'og:image:alt':defaults.imageAlt};
   for(const [key,value]of Object.entries(properties))head+=meta('property',key,value);
   for(const [key,value]of Object.entries({'twitter:card':'summary_large_image','twitter:title':title,'twitter:description':description,'twitter:image':image,'twitter:image:alt':defaults.imageAlt}))head+=meta('name',key,value);
   head+=`<link rel="canonical" href="${escape(url)}">`;
   for(const code of ['ar','en','x-default'])head+=`<link rel="alternate" hreflang="${code}" href="${escape(seo.canonicalUrl(route,code==='en'?'en':'ar'))}">`;
   head+=`<link rel="describedby" type="text/plain" data-seo="true" href="${seo.SITE_URL}/llms.txt"><script id="profitlens-structured-data" type="application/ld+json">${seo.serializeStructuredData(graph)}</script>`;
  }
  return template.replace(/<html\b[^>]*>/,`<html lang="${lang}" dir="${lang==='ar'?'rtl':'ltr'}">`).replace('</head>',()=>head+'</head>').replace(/<div id="root"><\/div>/,()=>`<div id="root">${markup}</div>`);
 }
 await fs.writeFile(path.join(build,'app.html'),document({title:'ProfitLens — Account',description:seo.DEFAULT_METADATA.en.privateDescription}));
 await fs.writeFile(path.join(build,'404.html'),document({title:'Page not found | ProfitLens',description:'This page could not be found.',markup:'<main style="padding:3rem;font-family:sans-serif"><h1>الصفحة غير موجودة · Page not found</h1><p><a href="/">الرئيسية</a> · <a href="/en">Home</a></p></main>'}));
 const urls=[];
 for(const lang of ['ar','en'])for(const route of seo.PUBLIC_PATHS){
  const page=seo.renderPage(route,lang),publicPath=seo.publicPagePath(route,lang),destination=publicPath==='/'?build:path.join(build,publicPath.slice(1));
  await fs.mkdir(destination,{recursive:true});await fs.writeFile(path.join(destination,'index.html'),document({...page,path:route,lang,indexable:true}));urls.push({route,lang,url:seo.canonicalUrl(route,lang)});
 }
 const sitemap=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.map(({route,url})=>`  <url><loc>${escape(url)}</loc>${['ar','en','x-default'].map(lang=>`<xhtml:link rel="alternate" hreflang="${lang}" href="${escape(seo.canonicalUrl(route,lang==='en'?'en':'ar'))}"/>`).join('')}</url>`).join('\n')}\n</urlset>\n`;
 await fs.writeFile(path.join(build,'sitemap.xml'),sitemap);
 console.log(`Prerendered ${urls.length} public pages, private app shell, 404 and sitemap.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
