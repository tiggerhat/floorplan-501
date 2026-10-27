const {test,before}=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
let handle;before(async()=>({handle}=await import('../cloud/worker.mjs')));
class MemoryR2{
  constructor(){this.data=new Map();this.serial=0;}
  async get(key){const o=this.data.get(key);return o?{etag:o.etag,json:async()=>JSON.parse(o.body)}:null;}
  async put(key,body,options={}){
    const current=this.data.get(key),condition=options.onlyIf;
    if(condition?.etagDoesNotMatch==='*'&&current)return null;
    if(condition?.etagMatches&&condition.etagMatches!==current?.etag)return null;
    const etag=createHash('md5').update(body+String(this.serial++)).digest('hex');this.data.set(key,{body,etag});return {etag};
  }
  async delete(key){this.data.delete(key);}
  async list({prefix,limit}){return {objects:[...this.data.keys()].filter(k=>k.startsWith(prefix)).slice(0,limit).map(key=>({key}))};}
}
function environment(){return {PLANS:new MemoryR2(),IDENTITY_KEY:'test-only-key-do-not-use-in-production-501',ALLOWED_ORIGINS:'https://tiggerhat.github.io'};}
async function call(env,path,method='GET',data,token,extra={}){
 const response=await handle(new Request('https://api.example'+path,{method,headers:{Origin:'https://tiggerhat.github.io',...(data!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...extra},...(data!==undefined?{body:JSON.stringify(data)}:{})}),env);
 return {status:response.status,headers:response.headers,data:response.status===204?null:await response.json()};
}
const passwordA='test-A-long-password-501',passwordB='test-B-long-password-501';
async function register(env,password=passwordA,label='用户甲'){const r=await call(env,'/api/register','POST',{password,label});assert.equal(r.status,201);return r.data;}
function plan(x=4000){return {version:2,geometry:{WALLS:[[0,0,x,240,'u']],WINS:[],DOORS:[],SLIDES:[],ROOMS:[]},furniture:[],rooms:{},demolished:[],measures:[]};}

test('cloud: password login, logout and no plaintext passwords in JSON storage',async()=>{
 const env=environment(),auth=await register(env);
 const shortEnv=environment();
 assert.equal((await call(shortEnv,'/api/register','POST',{password:'Abc12',label:'短密码'})).status,400);
 const six=await register(shortEnv,'Abc123','六位密码');
 assert.equal((await call(shortEnv,'/api/login','POST',{password:'Abc123'})).data.user.id,six.user.id);
 assert.equal((await call(shortEnv,'/api/login','POST',{password:'Abc12'})).status,400);
 assert.equal((await call(env,'/api/login','POST',{password:'wrong-long-password'})).status,401);
 const login=await call(env,'/api/login','POST',{password:passwordA});assert.equal(login.status,200);assert.equal(login.data.user.id,auth.user.id);
 assert.notEqual(login.data.token,auth.token);assert.ok([...env.PLANS.data.values()].every(v=>!v.body.includes(passwordA)));
 assert.equal((await call(env,'/api/logout','POST',undefined,login.data.token)).status,200);
 assert.equal((await call(env,'/api/plan','GET',undefined,login.data.token)).status,401);
});
test('cloud: different passwords isolate user JSON and ignore forged user ids',async()=>{
 const env=environment(),a=await register(env),b=await register(env,passwordB,'用户乙');assert.notEqual(a.user.id,b.user.id);
 assert.equal((await call(env,'/api/plan','PUT',{state:plan(),baseRevision:null,userId:b.user.id},a.token)).status,200);
 const aPlan=await call(env,'/api/plan?userId='+b.user.id,'GET',undefined,a.token),bPlan=await call(env,'/api/plan','GET',undefined,b.token);
 assert.equal(aPlan.data.state.geometry.WALLS[0][2],4000);assert.equal(bPlan.data.state,null);
 assert.ok(env.PLANS.data.has('plans/'+a.user.id+'.json'));assert.equal(env.PLANS.data.has('plans/'+b.user.id+'.json'),false);
 assert.equal((await call(env,'/api/plan','GET')).status,401);
});
test('cloud: building facilities round-trip independently for different users',async()=>{
 const G=require('../geometry-core.js'),env=environment(),a=await register(env),b=await register(env,passwordB,'用户乙');
 const first=plan(),second=plan();
 first.geometry.FACILITIES=G.facilityPresets.map((p,i)=>({type:p.id,name:p.name,rect:[i*1000,0,i*1000+p.width,p.depth],height:2300}));
 second.geometry.FACILITIES=[{type:'column',name:'柱',rect:[100,100,500,500],height:1800}];
 assert.equal((await call(env,'/api/plan','PUT',{state:first,baseRevision:null},a.token)).status,200);
 assert.equal((await call(env,'/api/plan','PUT',{state:second,baseRevision:null},b.token)).status,200);
 assert.deepEqual((await call(env,'/api/plan','GET',undefined,a.token)).data.state.geometry.FACILITIES,first.geometry.FACILITIES);
 assert.deepEqual((await call(env,'/api/plan','GET',undefined,b.token)).data.state.geometry.FACILITIES,second.geometry.FACILITIES);
 const invalid=plan();invalid.geometry.FACILITIES=[{type:'column',name:'柱',rect:[0,0,400,400],height:-1}];
 assert.equal((await call(env,'/api/plan','PUT',{state:invalid,baseRevision:null},a.token)).status,400);
});
test('cloud: concurrent saves reject stale versions instead of overwriting',async()=>{
 const env=environment(),{token}=await register(env),first=await call(env,'/api/plan','PUT',{state:plan(),baseRevision:null},token);
 const results=await Promise.all([5000,6000].map(x=>call(env,'/api/plan','PUT',{state:plan(x),baseRevision:first.data.revision},token)));
 assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
 const current=await call(env,'/api/plan','GET',undefined,token);assert.equal(current.data.state.geometry.WALLS[0][2],[5000,6000][results.findIndex(r=>r.status===200)]);
 assert.equal((await call(env,'/api/plan','PUT',{state:plan(),baseRevision:null},token)).status,409);
});
test('cloud: invalid geometry, missing revision and oversized input leave saved data untouched',async()=>{
 const env=environment(),{token}=await register(env),first=await call(env,'/api/plan','PUT',{state:plan(),baseRevision:null},token);
 const invalid=plan();invalid.geometry.WALLS[0][2]=-1;
 assert.equal((await call(env,'/api/plan','PUT',{state:invalid,baseRevision:first.data.revision},token)).status,400);
 assert.equal((await call(env,'/api/plan','PUT',{state:plan()},token)).status,400);
 assert.equal((await call(env,'/api/plan','PUT',{},token,{'Content-Length':'2097153'})).status,413);
 assert.equal((await call(env,'/api/plan','GET',undefined,token)).data.revision,first.data.revision);
});
test('cloud: origin restrictions, rate limiting and duplicate passwords are enforced',async()=>{
 const env=environment();assert.equal((await call(env,'/api/register','POST',{password:passwordA,label:'甲'},null,{Origin:'https://evil.example'})).status,403);
 await register(env);assert.equal((await call(env,'/api/register','POST',{password:passwordA,label:'重复'})).status,409);
 env.AUTH_LIMITER={limit:async()=>({success:false})};assert.equal((await call(env,'/api/login','POST',{password:passwordA})).status,429);
 const preflight=await call(env,'/api/plan','OPTIONS');assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://tiggerhat.github.io');
});
test('cloud: sessions expire and persisted JSON is recoverable with a new login',async()=>{
 const env=environment(),auth=await register(env);await call(env,'/api/plan','PUT',{state:plan(7500),baseRevision:null},auth.token);
 for(const [key,value]of env.PLANS.data)if(key.startsWith('sessions/')){const s=JSON.parse(value.body);s.expiresAt=0;env.PLANS.data.set(key,{...value,body:JSON.stringify(s)});}
 assert.equal((await call(env,'/api/session','GET',undefined,auth.token)).status,401);
 const next=await call(env,'/api/login','POST',{password:passwordA});assert.equal(next.status,200);
 assert.equal((await call(env,'/api/plan','GET',undefined,next.data.token)).data.state.geometry.WALLS[0][2],7500);
});
