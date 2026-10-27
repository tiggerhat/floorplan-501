const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const file of ['geometry-core.js','geometry-editor.js']){
 const r=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});
 if(r.status!==0)throw Error(r.stderr);
}
for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){
 if(match[1].includes('importmap')){
  for(const value of Object.values(JSON.parse(match[2]).imports))if(!fs.existsSync(path.join(root,value)))throw Error('Missing import: '+value);
  continue;
 }
 if(!match[2].trim())continue;
 const r=spawnSync(process.execPath,['--input-type='+ (match[1].includes('module')?'module':'commonjs'),'--check'],{input:match[2],encoding:'utf8'});
 if(r.status!==0)throw Error(r.stderr);
}
for(const match of html.matchAll(/(?:src|href)="([^"<>]+\.(?:js|css)(?:\?[^"<>]*)?)"/g))if(!fs.existsSync(path.join(root,match[1].split('?')[0])))throw Error('Missing asset: '+match[1]);
console.log('HTML scripts, import map and local assets OK');
