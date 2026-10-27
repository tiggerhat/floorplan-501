// Local front end for testing against `wrangler dev --port 8787`.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),publicFiles=new Set(['index.html','geometry-core.js','geometry-editor.js','geometry-editor.css','cloud-sync.js','cloud-sync.css']);
http.createServer((req,res)=>{
 const route=new URL(req.url,'http://localhost').pathname;
 if(route==='/cloud-config.js'){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});res.end('window.FLOORPLAN_CLOUD={enabled:true,apiBase:"http://localhost:8787"};');return;}
 let name;try{name=decodeURIComponent(route.slice(1)||'index.html');}catch{res.writeHead(400);res.end();return;}
 if(!publicFiles.has(name)&&!/^vendor\/three\/[a-zA-Z0-9/._-]+\.(js|txt)$/.test(name)){res.writeHead(404);res.end();return;}
 const file=path.resolve(root,name);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html','Cache-Control':'no-store'});res.end(data);});
}).listen(8767,'127.0.0.1',()=>console.log('Cloud login test UI: http://localhost:8767'));
