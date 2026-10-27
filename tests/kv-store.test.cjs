const {test}=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
function database(){const db=new DatabaseSync(':memory:');const sql={exec(query,...args){const s=db.prepare(query);const rows=s.columns().length?s.all(...args):(s.run(...args),[]);return {toArray:()=>rows};}};sql.exec('CREATE TABLE records (key TEXT PRIMARY KEY, body TEXT NOT NULL, etag TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)');return sql;}
test('KV JSON mirror and SQLite coordinator keep revisions without exposing sessions',async()=>{
 const {JsonStore}=await import('../cloud/kv-store.mjs'),values=new Map(),kv={put:async(k,v)=>values.set(k,v)},store=new JsonStore(database(),kv);
 const first=await store.put('plans/user-a.json','{"wall":4000}',{onlyIf:{etagDoesNotMatch:'*'}});
 assert.equal(values.get('plans/user-a.json'),'{"wall":4000}');
 assert.equal(await store.put('plans/user-a.json','{}',{onlyIf:{etagDoesNotMatch:'*'}}),null);
 assert.equal(await store.put('plans/user-a.json','{}',{onlyIf:{etagMatches:'stale'}}),null);
 await store.put('sessions/abc.json','{"userId":"a"}');assert.equal(values.has('sessions/abc.json'),false);
 await store.delete('sessions/abc.json');assert.equal(await store.get('sessions/abc.json'),null);
 assert.equal((await store.get('plans/user-a.json')).etag,first.etag);
});
test('KV failures and daily write protection never acknowledge or replace unsaved plans',async()=>{
 const {JsonStore}=await import('../cloud/kv-store.mjs');let failing=false;
 const store=new JsonStore(database(),{put:async()=>{if(failing)throw new Error('quota');}},1);
 failing=true;await assert.rejects(()=>store.put('plans/a.json','{}'),{status:503});assert.equal(await store.get('plans/a.json'),null);
 failing=false;const first=await store.put('plans/a.json','{"v":1}');
 await assert.rejects(()=>store.put('plans/a.json','{"v":2}'),{status:429});
 assert.equal((await store.get('plans/a.json')).etag,first.etag);
});
