// KV stores the user's JSON snapshots. A SQLite Durable Object serializes edits and
// retains current revisions, because KV alone is eventually consistent and has no CAS.
export class JsonStore {
  constructor(sql,kv,dailyLimit=800){this.sql=sql;this.kv=kv;this.dailyLimit=dailyLimit;}
  row(key){return this.sql.exec('SELECT body, etag, deleted FROM records WHERE key = ?',key).toArray()[0];}
  async get(key){
    const record=this.row(key);if(!record||record.deleted)return null;
    return {etag:record.etag,json:async()=>JSON.parse(record.body)};
  }
  async put(key,body,options={}){
    const old=this.row(key),exists=old&&!old.deleted,c=options.onlyIf;
    if(c?.etagDoesNotMatch==='*'&&exists||c?.etagMatches&&(!exists||old.etag!==c.etagMatches))return null;
    const etag=crypto.randomUUID().replaceAll('-','');
    if(key.startsWith('plans/')){
      const dayKey='limits/'+new Date().toISOString().slice(0,10),counter=Number(this.row(dayKey)?.body||0);
      if(counter>=this.dailyLimit){const e=new Error('已达到本站每日免费保存保护上限，请导出备份，额度重置后再保存');e.status=429;throw e;}
      try{await this.kv.put(key,body,{metadata:{revision:etag}});}catch{
        const e=new Error('云端存储暂不可用或免费额度已用完；改动尚未上传，请稍后重试或导出备份');e.status=503;throw e;
      }
      this.sql.exec('INSERT INTO records (key, body, etag, deleted) VALUES (?, ?, ?, 0) ON CONFLICT(key) DO UPDATE SET body=excluded.body',dayKey,String(counter+1),'');
    }
    this.sql.exec('INSERT INTO records (key, body, etag, deleted) VALUES (?, ?, ?, 0) ON CONFLICT(key) DO UPDATE SET body=excluded.body, etag=excluded.etag, deleted=0',key,body,etag);
    return {etag};
  }
  async delete(key){
    // Session tombstones prevent a revoked session from becoming valid again.
    this.sql.exec('UPDATE records SET deleted = 1, body = ? WHERE key = ?','{}',key);
  }
  async list({prefix,limit}){
    return {objects:this.sql.exec('SELECT key FROM records WHERE deleted = 0 AND key >= ? AND key < ? ORDER BY key LIMIT ?',prefix,prefix+'\uffff',limit).toArray()};
  }
}
