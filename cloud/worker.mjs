import Geometry from '../geometry-core.js';
import {JsonStore} from './kv-store.mjs';

const encoder=new TextEncoder();
const MAX_BYTES=2*1024*1024,SESSION_MS=8*60*60*1000;
const origins=env=>(env.ALLOWED_ORIGINS||'https://tiggerhat.github.io').split(',').map(v=>v.trim());
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
const bad=(status,message)=>{throw new HttpError(status,message);};
const hex=bytes=>[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
async function sha(value){return hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));}
async function identity(password,key){
  const material=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const derived=await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode('floorplan-501:'+key),iterations:100000,hash:'SHA-256'},material,256);
  return sha(hex(derived));
}
async function body(request){
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))bad(415,'请使用 JSON 格式');
  if(Number(request.headers.get('content-length')||0)>MAX_BYTES)bad(413,'方案超过 2 MB，请减少家具或拆分方案');
  const reader=request.body?.getReader();if(!reader)bad(400,'请求内容不能为空');
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();bad(413,'方案超过 2 MB');}chunks.push(value);}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{bad(400,'JSON 格式不正确');}
}
export function validatePlan(input){
  if(!input||typeof input!=='object'||Array.isArray(input))bad(400,'方案数据无效');
  let geometry;try{geometry=Geometry.normalize(input.geometry);}catch(e){bad(400,e.message);}
  if(!Array.isArray(input.furniture)||input.furniture.length>3000)bad(400,'家具数据无效');
  const furniture=input.furniture.map(f=>{
    if(!f||typeof f.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(f.id)||typeof f.type!=='string'||f.type.length>80||typeof f.name!=='string'||f.name.length>200||typeof f.color!=='string'||!/^#[a-fA-F0-9]{3,8}$/.test(f.color)||![f.cx,f.cy,f.w,f.d,f.rot].every(v=>Number.isFinite(v)&&Math.abs(v)<200000)||f.w<=0||f.d<=0)bad(400,'家具名称、坐标或尺寸无效');
    return {id:f.id,type:f.type,name:f.name,color:f.color,cx:f.cx,cy:f.cy,w:f.w,d:f.d,rot:f.rot};
  });
  const rooms=Object.create(null),mats=new Set(['wood','walnut','tile800','tile600','marble','antislip','terrazzo','carpet']);
  for(const room of geometry.ROOMS){const s=input.rooms?.[room.id];rooms[room.id]={name:typeof s?.name==='string'?s.name.slice(0,200):room.name,mat:mats.has(s?.mat)?s.mat:'tile800'};}
  const demolished=Array.isArray(input.demolished)?input.demolished.filter(v=>typeof v==='string'&&/^w\d+$/.test(v)&&+v.slice(1)<geometry.WALLS.length):[];
  const measures=Array.isArray(input.measures)?input.measures.slice(0,2000).map(m=>{
    if(!m?.a||!m?.b||![m.a.x,m.a.y,m.b.x,m.b.y].every(v=>Number.isFinite(v)&&Math.abs(v)<200000))bad(400,'测量数据无效');return {a:{x:m.a.x,y:m.a.y},b:{x:m.b.x,y:m.b.y}};
  }):[];
  return {version:2,geometry,furniture,rooms,demolished,measures};
}
async function session(request,env){
  const token=request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!token)bad(401,'请先登录');
  const key='sessions/'+await sha(token)+'.json',object=await env.PLANS.get(key);
  if(!object)bad(401,'登录已过期，请重新输入密码');
  const value=await object.json();
  if(value.expiresAt<Date.now()){await env.PLANS.delete(key);bad(401,'登录已过期，请重新输入密码');}
  if(!/^[a-f0-9]{64}$/.test(value.userId))bad(401,'登录信息无效');
  return {...value,key};
}
async function authenticate(request,env,register){
  if(env.AUTH_LIMITER){const result=await env.AUTH_LIMITER.limit({key:request.headers.get('CF-Connecting-IP')||'unknown'});if(!result.success)bad(429,'尝试次数较多，请一分钟后重试');}
  const input=await body(request),password=input?.password;
  if(typeof password!=='string'||password.length<12||password.length>128)bad(400,'访问密码需要 12–128 个字符');
  const userId=await identity(password,env.IDENTITY_KEY),key='users/'+userId+'.json';
  let object=await env.PLANS.get(key),user=object?await object.json():null;
  if(register){
    if(user)bad(409,'这个密码已有用户，请直接登录');
    if(typeof input.label!=='string'||!input.label.trim()||input.label.length>60)bad(400,'请填写 1–60 字的用户名称');
    const listing=await env.PLANS.list({prefix:'users/',limit:51});if(listing.objects.length>=50)bad(403,'当前最多支持 50 个用户，请联系网站所有者');
    user={id:userId,label:input.label.trim(),createdAt:new Date().toISOString()};
    const created=await env.PLANS.put(key,JSON.stringify(user),{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
    if(!created)bad(409,'这个密码刚刚已创建，请直接登录');
  }else if(!user)bad(401,'密码不正确，或尚未创建这个用户');
  const token=hex(crypto.getRandomValues(new Uint8Array(32))),expiresAt=Date.now()+SESSION_MS;
  await env.PLANS.put('sessions/'+await sha(token)+'.json',JSON.stringify({userId,label:user.label,expiresAt}),{httpMetadata:{contentType:'application/json'}});
  return {token,user:{id:userId,label:user.label},expiresAt};
}
export async function handle(request,env){
  const origin=request.headers.get('origin'),allowed=origin&&origins(env).includes(origin);
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
  if(allowed)headers['Access-Control-Allow-Origin']=origin;
  const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
  try{
    if(origin&&!allowed)bad(403,'此网站未获准访问接口');
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}});
    const path=new URL(request.url).pathname.replace(/\/$/,'');
    if(path==='/api/health'&&request.method==='GET')return reply({ok:true,version:'3.0.0'});
    if(!env.PLANS||!env.IDENTITY_KEY||env.IDENTITY_KEY.length<32)bad(503,'云端服务尚未配置完成');
    if(path==='/api/login'&&request.method==='POST')return reply(await authenticate(request,env,false));
    if(path==='/api/register'&&request.method==='POST')return reply(await authenticate(request,env,true),201);
    const known=['/api/session','/api/plan','/api/logout'];if(!known.includes(path))bad(404,'接口不存在');
    const user=await session(request,env);
    if(path==='/api/session'&&request.method==='GET')return reply({user:{id:user.userId,label:user.label},expiresAt:user.expiresAt});
    if(path==='/api/logout'&&request.method==='POST'){await env.PLANS.delete(user.key);return reply({ok:true});}
    const key='plans/'+user.userId+'.json';
    if(path==='/api/plan'&&request.method==='GET'){
      const object=await env.PLANS.get(key);if(!object)return reply({state:null,revision:null,updatedAt:null});
      const doc=await object.json();return reply({state:doc.state,revision:object.etag,updatedAt:doc.updatedAt});
    }
    if(path==='/api/plan'&&request.method==='PUT'){
      const data=await body(request);if(data.baseRevision!==null&&(typeof data.baseRevision!=='string'||!/^[a-fA-F0-9]{1,128}$/.test(data.baseRevision)))bad(400,'缺少有效的方案版本，请先读取云端方案');
      const state=validatePlan(data.state),updatedAt=new Date().toISOString();
      const written=await env.PLANS.put(key,JSON.stringify({schema:1,nonce:crypto.randomUUID(),updatedAt,state}),{onlyIf:data.baseRevision===null?{etagDoesNotMatch:'*'}:{etagMatches:data.baseRevision},httpMetadata:{contentType:'application/json'}});
      if(!written)bad(409,'另一设备已更新方案，当前修改尚未上传，请先导出本机备份或载入云端版本');
      return reply({revision:written.etag,updatedAt});
    }
    bad(405,'请求方法不支持');
  }catch(e){return reply({error:e instanceof HttpError||e.status===503||e.status===429?e.message:'云端服务暂时不可用，请稍后重试'},e.status||500);}
}
export class WorkspaceCoordinator {
  constructor(ctx,env){
    this.ctx=ctx;this.env=env;
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, body TEXT NOT NULL, etag TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)');
  }
  async fetch(request){return this.ctx.blockConcurrencyWhile(()=>handle(request,{...this.env,PLANS:new JsonStore(this.ctx.storage.sql,this.env.JSON_DATA)}));}
}
export default {fetch(request,env){return env.COORDINATOR.get(env.COORDINATOR.idFromName('floorplan-501-workspaces')).fetch(request);}};
