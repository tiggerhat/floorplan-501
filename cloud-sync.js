/* Password-only cloud workspaces. The API, not this UI, enforces authorization. */
(() => {
  'use strict';
  const config=window.FLOORPLAN_CLOUD||{};
  if(!config.enabled)return;
  const api=String(config.apiBase||'').replace(/\/$/,'');
  const localDev=/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(api);
  if(!/^https:\/\//.test(api)&&!localDev){toast('云端地址尚未配置，暂不能登录');return;}
  const sessionKey='501-cloud-session:'+api,draftPrefix='501-cloud-draft:'+api+':';
  let user=null,token=null,revision=null,pending=0,acked=0,timer=null,inflight=null,conflict=false,loading=false,authMode='login';
  const dialog=document.createElement('dialog');dialog.id='cloudLogin';
  dialog.innerHTML=`<form id="cloudLoginForm"><h2>501 户型编辑器</h2><p>输入访问密码，打开自己的用户方案。</p><label id="cloudNameLabel" hidden>用户名称<input id="cloudName" autocomplete="nickname" maxlength="60"></label><label>访问密码<input id="cloudPassword" type="password" autocomplete="current-password" minlength="12" maxlength="128" required></label><label id="cloudConfirmLabel" hidden>再次输入密码<input id="cloudConfirm" type="password" autocomplete="new-password" minlength="12" maxlength="128"></label><p id="cloudLoginError" role="alert"></p><button id="cloudSubmit" class="btn primary" type="submit">登录</button><button id="cloudToggleMode" class="btn" type="button">创建新用户</button><p class="cloud-caption">一个密码对应一个独立空间。密码至少 12 个字符，请妥善保管；不提供找回功能。</p></form>`;
  document.body.appendChild(dialog);
  const bar=document.createElement('div');bar.id='cloudAccount';bar.className='grp';
  bar.innerHTML='<span id="cloudUser"></span><span id="cloudStatus" role="status" aria-live="polite">等待登录</span><button class="btn" id="cloudSave" type="button">保存到云端</button><button class="btn" id="cloudImportLocal" type="button" hidden>导入旧本机方案</button><button class="btn" id="cloudLogout" type="button">退出登录</button>';
  document.querySelector('header').appendChild(bar);
  const alert=document.createElement('div');alert.id='cloudSaveAlert';alert.hidden=true;
  alert.innerHTML='<span id="cloudSaveError" role="alert"></span><button class="btn" id="cloudRetry">重试保存</button><button class="btn" id="cloudExport">导出当前改动</button><button class="btn" id="cloudReload">载入云端版本</button>';
  document.body.appendChild(alert);
  const q=id=>document.getElementById(id);
  const message=(text,error=false)=>{q('cloudStatus').textContent=text;q('cloudStatus').dataset.error=String(error);};
  function storage(){try{if(user)sessionStorage.setItem(draftPrefix+user.id,JSON.stringify({state,revision,pending:pending>acked}));}catch{toast('本机备份空间不足，请导出 JSON 备份');}}
  async function request(path,{method='GET',body,anonymous=false}={}){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch(api+path,{method,mode:'cors',cache:'no-store',signal:controller.signal,headers:{...(body?{'Content-Type':'application/json'}:{}),...(!anonymous&&token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
      let data;try{data=await response.json();}catch{throw new Error('接口未返回有效数据，请稍后重试');}
      if(!response.ok){const e=new Error(data.error||'云端操作失败');e.status=response.status;throw e;}
      return data;
    }catch(e){if(e.name==='AbortError')throw new Error('连接超时，当前改动仍在页面中，请重试');throw e;}finally{clearTimeout(timeout);}
  }
  function lock(text=''){
    document.body.classList.add('cloud-locked');document.querySelector('.app').inert=true;
    q('cloudLoginError').textContent=text;if(!dialog.open)dialog.showModal();
    q('cloudPassword').focus();
  }
  function unlock(){if(dialog.open)dialog.close();document.querySelector('.app').inert=false;document.body.classList.remove('cloud-locked');}
  function notifyFailure(e){
    conflict=e.status===409;message(conflict?'存在版本冲突':'尚未保存',true);
    q('cloudSaveError').textContent=e.message||'网络连接失败，当前改动仍在本页，请重试';alert.hidden=false;q('cloudRetry').disabled=conflict;
    if(e.status===401)lock('登录已过期，请重新输入密码；未上传的改动会保留');
  }
  function changed(){
    if(!user||loading)return;
    pending++;storage();message('修改待保存');
    clearTimeout(timer);if(!conflict)timer=setTimeout(()=>flush().catch(()=>{}),5000);
  }
  async function flush(){
    clearTimeout(timer);if(!user||!token)throw new Error('请先登录');
    if(conflict)throw new Error('请先处理版本冲突');
    if(inflight){await inflight;return pending>acked?flush():undefined;}
    if(pending<=acked)return;
    const sequence=pending,snapshot=JSON.parse(JSON.stringify(state));message('正在保存…');q('cloudSave').disabled=true;
    inflight=(async()=>{
      try{
        const result=await request('/api/plan',{method:'PUT',body:{baseRevision:revision,state:snapshot}});
        revision=result.revision;acked=sequence;storage();alert.hidden=true;
        message('云端已保存 '+new Date(result.updatedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}));
      }catch(e){notifyFailure(e);throw e;}
      finally{inflight=null;q('cloudSave').disabled=false;}
    })();
    await inflight;
    if(pending>acked&&!conflict)timer=setTimeout(()=>flush().catch(()=>{}),1500);
  }
  function installPlan(plan){
    loading=true;
    try{state=plan?fixState(plan):defaultState();ui.sel=null;undoStack.length=redoStack.length=0;renderAll();fitView();}finally{loading=false;}
  }
  async function loadPlan(allowDraft=true){
    const remote=await request('/api/plan');revision=remote.revision;pending=acked=0;conflict=false;
    let draft=null;if(allowDraft){try{draft=JSON.parse(sessionStorage.getItem(draftPrefix+user.id));}catch{}}
    if(draft?.pending){
      installPlan(draft.state);pending=1;
      if(draft.revision!==remote.revision){conflict=true;notifyFailure(Object.assign(new Error('另一设备已更新，已保留本页未上传的改动。请先导出，再载入云端版本。'),{status:409}));}
      else{message('恢复了待保存改动');timer=setTimeout(()=>flush().catch(()=>{}),300);}
    }else{installPlan(remote.state);alert.hidden=true;message(remote.state?'已载入云端方案':'新用户，尚无云端方案');}
    q('cloudUser').textContent=user.label;q('geometryNotice').textContent='当前用户：'+user.label+' · 修改自动保存到云端 · 文件 → 导出方案可备份';
    try{q('cloudImportLocal').hidden=!(localStorage.getItem(STORE)||localStorage.getItem('501-geometry-v1-20261026'));}catch{}
  }
  async function signedIn(data){
    token=data.token||token;user=data.user;
    try{sessionStorage.setItem(sessionKey,JSON.stringify({token,user,expiresAt:data.expiresAt}));}catch{}
    await loadPlan();setAuthMode('login');unlock();q('cloudPassword').value=q('cloudConfirm').value='';
  }
  function setAuthMode(mode){
    authMode=mode;const registering=authMode==='register';
    q('cloudNameLabel').hidden=q('cloudConfirmLabel').hidden=!registering;q('cloudName').required=q('cloudConfirm').required=registering;
    q('cloudPassword').autocomplete=registering?'new-password':'current-password';q('cloudSubmit').textContent=registering?'创建用户并登录':'登录';q('cloudToggleMode').textContent=registering?'返回登录':'创建新用户';q('cloudLoginError').textContent='';
  }
  q('cloudToggleMode').onclick=()=>setAuthMode(authMode==='login'?'register':'login');
  q('cloudLoginForm').onsubmit=async e=>{
    e.preventDefault();if(authMode==='register'&&q('cloudConfirm').value!==q('cloudPassword').value){q('cloudLoginError').textContent='两次输入的密码不一致';return;}
    q('cloudSubmit').disabled=q('cloudToggleMode').disabled=true;q('cloudLoginError').textContent='正在连接…';
    try{const data=await request(authMode==='register'?'/api/register':'/api/login',{method:'POST',anonymous:true,body:{password:q('cloudPassword').value,...(authMode==='register'?{label:q('cloudName').value.trim()}:{})}});await signedIn(data);}
    catch(e){q('cloudLoginError').textContent=e.message||'连接失败，请检查网络后重试';}
    finally{q('cloudSubmit').disabled=q('cloudToggleMode').disabled=false;}
  };
  dialog.addEventListener('cancel',e=>e.preventDefault());
  q('cloudSave').onclick=async()=>{try{if(pending<=acked){if(revision!==null)return;changed();}await flush();}catch(e){if(!alert.hidden) return;toast(e.message);}};
  q('cloudRetry').onclick=()=>flush().catch(()=>{});
  q('cloudExport').onclick=()=>document.querySelector('#exportJson').click();
  q('cloudImportLocal').onclick=()=>{
    if(!confirm('将此浏览器原有的本机方案导入到当前用户“'+user.label+'”并同步云端？当前方案可通过撤销恢复。'))return;
    try{const old=fixState(JSON.parse(localStorage.getItem(STORE)||localStorage.getItem('501-geometry-v1-20261026'))),before=snap();state=old;ui.sel=null;commit(before);renderAll();fitView();}catch(e){toast('无法导入：'+e.message);}
  };
  q('cloudReload').onclick=async()=>{
    if(pending>acked&&!confirm('载入云端版本会替换本页未上传的改动。建议先导出当前改动。确定继续？'))return;
    try{await loadPlan(false);storage();}catch(e){notifyFailure(e);}
  };
  q('cloudLogout').onclick=async()=>{
    try{await flush();await request('/api/logout',{method:'POST'});}
    catch(e){notifyFailure(e);if(!confirm('云端尚未完成保存或退出。请先取消并导出备份。仍要丢弃本页未上传改动并退出吗？'))return;try{await request('/api/logout',{method:'POST'});}catch{}}
    clearTimeout(timer);try{sessionStorage.removeItem(sessionKey);sessionStorage.removeItem(draftPrefix+user.id);}catch{}
    user=token=revision=null;pending=acked=0;installPlan(null);q('cloudUser').textContent='';message('已退出');setAuthMode('login');lock();
  };
  window.addEventListener('beforeunload',e=>{if(pending>acked){e.preventDefault();e.returnValue='';}});
  window.addEventListener('online',()=>{if(user&&pending>acked&&!conflict)flush().catch(()=>{});});
  window.CloudSync={enabled:true,changed,flush};
  lock();
  (async()=>{
    let saved=null;try{saved=JSON.parse(sessionStorage.getItem(sessionKey));}catch{}
    if(!saved?.token||saved.expiresAt<Date.now())return;
    token=saved.token;
    try{await signedIn(await request('/api/session'));}catch(e){lock(e.status===401?'请重新输入访问密码':e.message);}
  })();
})();
