/* Browser interaction layer for the 501 floor-plan editor. */
(() => {
  'use strict';
  const G=FloorGeometry, key={wall:'WALLS',window:'WINS',door:'DOORS',room:'ROOMS'};
  const names={wall:'墙体',window:'窗户',door:'门',room:'房间'};
  let mode='select', gesture=null, linkRoomFaces=false;
  const round=n=>Math.round(n/10)*10;
  function current(){
    if(ui.sel?.kind==='geometry') return {kind:ui.sel.geoKind,index:ui.sel.index};
    if(ui.sel?.kind==='room') return {kind:'room',index:state.geometry.ROOMS.findIndex(r=>r.id===ui.sel.id)};
    return null;
  }
  function valueOf(sel,g=state.geometry){return sel && g[key[sel.kind]]?.[sel.index];}
  function rectOf(sel,g=state.geometry){const o=valueOf(sel,g);return !o?null:sel.kind==='door'?o.rect:sel.kind==='room'?bbox(o.poly):o;}
  function pick(kind,index){
    select({kind:'geometry',geoKind:kind,index});
    if(!narrow())drawer('panel',true);
  }
  function error(message){const el=$('#geometryError');if(el)el.textContent=message;else toast(message);}
  function change(geometry,fn){
    try {
      const next=fixState({...state,geometry}),before=snap();
      state=next;if(fn)fn();commit(before);renderAll();return true;
    }catch(e){error(e.message);return false;}
  }
  function options(sel){
    return Object.entries(key).flatMap(([kind,k])=>state.geometry[k].map((o,i)=>{
      const label=kind==='room'?(state.rooms[o.id]?.name||o.name):kind==='door'?o.name:`${names[kind]} ${String(i+1).padStart(2,'0')}`;
      return `<option value="${kind}:${i}" ${sel?.kind===kind&&sel.index===i?'selected':''}>${esc(label)}</option>`;
    })).join('');
  }
  function field(name,label,val,min,max){return `<label>${label}<input name="${name}" type="number" value="${val}" step="1" ${min!==undefined?`min="${min}"`:''} ${max!==undefined?`max="${max}"`:''} required></label>`;}
  function renderGeometryPanel(panel){
    if(ui.tool!=='geometry')return false;
    const sel=current(),obj=valueOf(sel);
    let content=`<section><h3>编辑户型 <small>单位 mm</small></h3><p class="geometry-help">点选墙、窗或门，输入尺寸，或拖动橙色端点。新建对象时，在画布上按住拖出长度。</p>
      <label for="geometryPicker">选择对象</label><select id="geometryPicker" class="geometry-picker"><option value="">请选择墙、窗、门或房间</option>${options(sel)}</select>
      <div class="geometry-count">${WALLS.length} 段墙 · ${WINS.length} 扇窗 · ${DOORS.length} 扇门 · ${ROOMS.length} 个分区</div></section>`;
    if(obj){
      if(sel.kind==='room'){
        content+=`<section><h3>房间边界</h3><form id="geometryForm" class="geometry-form"><label class="full">房间名称<input name="name" value="${esc(state.rooms[obj.id]?.name||obj.name)}" maxlength="80" required></label>
          <label class="full">顶点坐标：每行 X, Y<textarea name="points" spellcheck="false" required>${obj.poly.map(p=>p.join(', ')).join('\n')}</textarea></label>
          <p class="full geometry-help">也可拖动画布上的顶点。边界不可交叉；面积由此边界计算。</p>
          <div class="actions full"><button class="btn primary" type="submit">应用边界</button><button class="btn danger" type="button" id="geometryDelete">删除房间</button></div></form></section>`;
      }else{
        const r=rectOf(sel),d=G.dimensions(r),h=state.geometry.windowHeights[sel.index];
        content+=`<section><h3>${names[sel.kind]} ${String(sel.index+1).padStart(2,'0')}</h3><form id="geometryForm" class="geometry-form">
          ${field('length',sel.kind==='wall'?'墙长':sel.kind==='window'?'窗宽（沿墙）':'门洞净宽',d.length,50,50000)}
          ${field('thickness',sel.kind==='wall'?'墙厚':'洞口深度',d.thickness,10,10000)}
          ${field('x','左上角 X',d.x,-200000,200000)}${field('y','左上角 Y',d.y,-200000,200000)}
          <label class="full">方向<select name="direction"><option value="h" ${!d.vertical?'selected':''}>水平</option><option value="v" ${d.vertical?'selected':''}>垂直</option></select></label>
          ${sel.kind==='window'?field('sill','窗台高度',h.sill,0,2799)+field('height','窗高',h.head-h.sill,1,2800):''}
          ${sel.kind==='wall'?`<label class="full">墙段标识<select name="wallType"><option value="u" ${obj[4]!=='s'?'selected':''}>一般墙段 · 性质待核</option><option value="s" ${obj[4]==='s'?'selected':''}>原图深色 / 疑似结构段 · 待核</option></select></label>
            <label class="full check"><input type="checkbox" name="link" ${linkRoomFaces?'checked':''}>侧移时联动同线房间边界</label>`:''}
          <div class="actions full"><button class="btn primary" type="submit">应用尺寸</button><button class="btn" type="button" id="geometryDuplicate">复制</button><button class="btn danger" type="button" id="geometryDelete">删除</button></div>
          ${sel.kind==='door'?'<div class="actions full"><button class="btn" type="button" id="doorHinge">换铰链侧</button><button class="btn" type="button" id="doorSwing">反向开启</button></div>':''}
          ${sel.kind==='window'||sel.kind==='door'?'<div class="actions full"><button class="btn" type="button" id="geometryAttach">贴合附近墙体</button></div>':''}
          </form><p class="geometry-help">墙与窗的位置可独立调整。房间边界可单独编辑；新门窗与墙相交时自动留洞。</p></section>`;
      }
    }else content+=`<section><h3>从上方工具开始</h3><p class="geometry-help">「画墙」「画窗」「画门」沿水平或垂直方向绘制。「画房间」拖出矩形，之后可编辑任意顶点。</p><p class="geometry-help">窗和门从已有墙上起笔时，自动匹配墙的方向与厚度。</p></section>`;
    content+=`<section><p id="geometryError" class="geometry-error" role="alert"></p><div class="actions"><button class="btn" id="geometryExport">导出户型备份</button><button class="btn" id="geometryImport">导入方案</button></div><p class="geometry-help">修改自动保存在此浏览器。跨设备请导出 JSON。编辑的是数字模型，墙体性质仍待核验。</p><button class="btn" id="geometryDone">退出户型编辑</button></section>`;
    panel.innerHTML=content;
    $('#geometryPicker').onchange=e=>{if(!e.target.value){ui.sel=null;renderAll();return;}const [kind,i]=e.target.value.split(':');pick(kind,+i);};
    $('#geometryExport').onclick=()=>$('#exportJson').click();
    $('#geometryImport').onclick=()=>$('#importJson').click();
    $('#geometryDone').onclick=()=>{select(null);setTool('select');};
    if(obj){
      $('#geometryForm').onsubmit=e=>{e.preventDefault();applyForm(sel,e.target);};
      $('#geometryDelete').onclick=removeSelected;
      if($('#geometryDuplicate'))$('#geometryDuplicate').onclick=duplicate;
      if($('#geometryAttach'))$('#geometryAttach').onclick=attach;
      if($('#doorSwing'))$('#doorSwing').onclick=()=>{const g=G.clone(state.geometry),d=g.DOORS[sel.index];d.o=d.o.map(v=>-v);change(g);};
      if($('#doorHinge'))$('#doorHinge').onclick=()=>{
        const g=G.clone(state.geometry),d=g.DOORS[sel.index];
        d.h=[d.h[0]+d.c[0]*d.len,d.h[1]+d.c[1]*d.len];d.c=d.c.map(v=>-v);change(g);
      };
    }
    return true;
  }
  function applyForm(sel,form){
    try{
      const fields=new FormData(form),get=k=>Number(fields.get(k));
      let g=G.clone(state.geometry);
      if(sel.kind==='room'){
        const text=String(fields.get('points')).trim(),lines=text.split(/\r?\n/).filter(s=>s.trim());
        if(lines.some(s=>!/^\s*-?\d+(?:\.\d+)?\s*[,，]\s*-?\d+(?:\.\d+)?\s*$/.test(s)))throw new Error('坐标格式应为每行两个数字，例如 1200, 3600');
        const points=lines.map(line=>line.split(/[,，]/).map(Number)),r=g.ROOMS[sel.index];
        r.poly=points;r.name=String(fields.get('name')).trim()||r.name;
        r.at=[points.reduce((s,p)=>s+p[0],0)/points.length,points.reduce((s,p)=>s+p[1],0)/points.length];
        change(g,()=>state.rooms[r.id].name=r.name);
      }else{
        const rect=G.makeRect({x:get('x'),y:get('y'),length:get('length'),thickness:get('thickness'),vertical:fields.get('direction')==='v'});
        linkRoomFaces=fields.has('link');
        g=G.replaceRect(g,sel.kind,sel.index,rect,linkRoomFaces);
        if(sel.kind==='wall')g.WALLS[sel.index][4]=fields.get('wallType');
        if(sel.kind==='window')g.windowHeights[sel.index]={sill:get('sill'),head:get('sill')+get('height')};
        change(g);
      }
    }catch(e){error(e.message);}
  }
  function removeSelected(){
    const sel=current();if(!valueOf(sel))return;
    try{
      const g=G.remove(state.geometry,sel.kind,sel.index);
      change(g,()=>{
        if(sel.kind==='wall')state.demolished=state.demolished.filter(id=>+id.slice(1)!==sel.index).map(id=>'w'+(+id.slice(1)>sel.index?+id.slice(1)-1:+id.slice(1)));
        ui.sel=null;
      });
    }catch(e){error(e.message);}
  }
  function duplicate(){
    const sel=current();if(!sel||sel.kind==='room')return;
    const g=G.clone(state.geometry),r=G.moveRect(rectOf(sel),400,400),obj=valueOf(sel,g);
    g[key[sel.kind]].push(sel.kind==='door'?G.resizeDoor(obj,r):r.slice(0,4).concat(obj.slice(4)));
    if(sel.kind==='window')g.windowHeights.push(G.clone(g.windowHeights[sel.index]));
    change(g,()=>ui.sel={kind:'geometry',geoKind:sel.kind,index:g[key[sel.kind]].length-1});
  }
  function nearestWall(p,maxDistance){
    let best=null,distance=maxDistance;
    state.geometry.WALLS.forEach((w,i)=>{
      if(state.demolished.includes('w'+i))return;
      const dx=Math.max(w[0]-p.x,0,p.x-w[2]),dy=Math.max(w[1]-p.y,0,p.y-w[3]),dist=Math.hypot(dx,dy);
      if(dist<distance){distance=dist;best=w;}
    });return best;
  }
  function attach(){
    const sel=current(),r=rectOf(sel),wall=nearestWall({x:(r[0]+r[2])/2,y:(r[1]+r[3])/2},1500);
    if(!wall)return error('1500 mm 内未找到墙体，请先移动到墙边');
    const d=G.dimensions(wall),len=G.dimensions(r).length;
    const rect=d.vertical?[wall[0],r[1],wall[2],r[1]+len]:[r[0],wall[1],r[0]+len,wall[3]];
    try{change(G.replaceRect(state.geometry,sel.kind,sel.index,rect));}catch(e){error(e.message);}
  }
  function toolChanged(){
    $('#geometryTools').hidden=ui.tool!=='geometry';
    if(ui.tool!=='geometry'){mode='select';cancelGesture();}
    renderSel();renderPanel();
  }
  function setMode(next){
    mode=next;
    document.querySelectorAll('[data-geommode]').forEach(b=>b.classList.toggle('on',b.dataset.geommode===next));
    $('#modehint').textContent=next==='select'?'点选对象改尺寸；拖动橙色端点伸缩':'按住拖动绘制'+names[next]+'，松开完成；Esc 返回选择';
  }
  function renderSelection(){
    const overlay=$('#gGeometryOverlay');if(!overlay)return;
    if(ui.tool!=='geometry'){overlay.innerHTML='';return;}
    const k=1/view.s;
    let s='';
    for(const kind of ['wall','window','door'])state.geometry[key[kind]].forEach((obj,index)=>{
      const r=kind==='door'?obj.rect:obj;
      s+=`<rect class="geo-hit" data-geokind="${kind}" data-index="${index}" x="${r[0]}" y="${r[1]}" width="${r[2]-r[0]}" height="${r[3]-r[1]}" fill="transparent" stroke="transparent" stroke-width="${Math.max(6*k,30)}" pointer-events="all"/>`;
    });
    const sel=current(),obj=valueOf(sel);
    if(obj){
      if(sel.kind==='room'){
        s+=`<polygon points="${obj.poly.map(p=>p.join(',')).join(' ')}" fill="rgba(181,101,58,.08)" stroke="#b5653a" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
        obj.poly.forEach(([x,y],i)=>s+=`<circle class="geo-vertex" data-geo-handle="vertex" data-vertex="${i}" cx="${x}" cy="${y}" r="${6*k}" fill="#fff" stroke="#b5653a" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
      }else{
        const r=rectOf(sel),d=G.dimensions(r),a=d.vertical?[(r[0]+r[2])/2,r[1]]:[r[0],(r[1]+r[3])/2],b=d.vertical?[a[0],r[3]]:[r[2],a[1]];
        s+=`<rect x="${r[0]}" y="${r[1]}" width="${r[2]-r[0]}" height="${r[3]-r[1]}" fill="rgba(181,101,58,.12)" stroke="#b5653a" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
        [a,b].forEach(([x,y],i)=>s+=`<circle class="geo-handle ${d.vertical?'vertical':''}" data-geo-handle="${i?'end':'start'}" cx="${x}" cy="${y}" r="${7*k}" fill="#b5653a" stroke="white" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
        s+=`<text x="${(r[0]+r[2])/2}" y="${r[1]-12*k}" font-size="${12*k}" fill="#88411f" text-anchor="middle" stroke="white" stroke-width="${3*k}" paint-order="stroke" pointer-events="none">${Math.round(d.length)} × ${Math.round(d.thickness)} mm</text>`;
      }
    }
    if(gesture?.draft){const r=gesture.draft;s+=`<rect x="${r[0]}" y="${r[1]}" width="${r[2]-r[0]}" height="${r[3]-r[1]}" fill="rgba(47,93,98,.12)" stroke="#2f5d62" stroke-width="2" stroke-dasharray="5 3" vector-effect="non-scaling-stroke" pointer-events="none"/>`;}
    overlay.innerHTML=s;
  }
  function draftRect(start,p){
    let vertical=Math.abs(p.y-start.y)>Math.abs(p.x-start.x),thickness=240;
    if(gesture.host){const d=G.dimensions(gesture.host);vertical=d.vertical;thickness=d.thickness;}
    if(mode==='room')return [Math.min(start.x,p.x),Math.min(start.y,p.y),Math.max(start.x,p.x),Math.max(start.y,p.y)];
    const w=gesture.host;
    if(vertical){const x=w?w[0]:start.x;return [x,Math.min(start.y,p.y),x+thickness,Math.max(start.y,p.y)];}
    const y=w?w[1]:start.y;return [Math.min(start.x,p.x),y,Math.max(start.x,p.x),y+thickness];
  }
  function cancelGesture(){
    if(!gesture)return;const before=gesture.before;gesture=null;
    if(before){state=JSON.parse(before);renderAll();}
  }
  svg.addEventListener('pointerdown',e=>{
    if(ui.tool!=='geometry'||e.button!==0||e.isPrimary===false)return;
    const p=toMM(e),pos={x:round(p.x),y:round(p.y)},handle=e.target.closest('[data-geo-handle]'),hit=e.target.closest('[data-geokind]'),room=e.target.closest('[data-room]');
    if(mode!=='select'){
      e.stopImmediatePropagation();e.preventDefault();closeDrawers();
      gesture={type:'draw',start:pos,sx:e.clientX,sy:e.clientY,before:snap(),host:mode==='window'||mode==='door'?nearestWall(p,12/view.s):null};
    }else if(handle||hit||room){
      e.stopImmediatePropagation();e.preventDefault();closeDrawers();
      if(hit)pick(hit.dataset.geokind,+hit.dataset.index);
      else if(room&&!handle)pick('room',state.geometry.ROOMS.findIndex(r=>r.id===room.dataset.room));
      const sel=current();if(!sel)return;
      gesture={type:handle?.dataset.geoHandle||'move',vertex:+handle?.dataset.vertex,sel,start:pos,sx:e.clientX,sy:e.clientY,before:snap(),base:G.clone(state),moved:false};
    }else return;
    svg.setPointerCapture(e.pointerId);renderSelection();
  },true);
  svg.addEventListener('pointermove',e=>{
    if(!gesture)return;e.stopImmediatePropagation();
    const q=toMM(e),p={x:round(q.x),y:round(q.y)},d=gesture;
    if(Math.hypot(e.clientX-d.sx,e.clientY-d.sy)<4&&!d.moved)return;
    d.moved=true;
    if(d.type==='draw'){d.draft=draftRect(d.start,p);renderSelection();return;}
    try{
      let g=G.clone(d.base.geometry);
      if(d.sel.kind==='room'){
        const r=g.ROOMS[d.sel.index];
        if(d.type==='vertex')r.poly[d.vertex]=[p.x,p.y];
        else{const dx=p.x-d.start.x,dy=p.y-d.start.y;r.poly=r.poly.map(([x,y])=>[x+dx,y+dy]);if(r.at)r.at=[r.at[0]+dx,r.at[1]+dy];}
        g=G.normalize(g);
      }else{
        const r=rectOf(d.sel,g),vertical=G.dimensions(r).vertical;
        let next=r.slice(0,4);
        if(d.type==='move')next=G.moveRect(next,p.x-d.start.x,p.y-d.start.y);
        else if(d.type==='start')next[vertical?1:0]=Math.min(p[vertical?'y':'x'],next[vertical?3:2]-50);
        else if(d.type==='end')next[vertical?3:2]=Math.max(p[vertical?'y':'x'],next[vertical?1:0]+50);
        g=G.replaceRect(g,d.sel.kind,d.sel.index,next,linkRoomFaces);
      }
      state={...d.base,geometry:g};renderAll();
    }catch(err){d.error=err.message;}
  },true);
  function pointerEnd(e){
    if(!gesture)return;e.stopImmediatePropagation();
    const d=gesture;
    if(e.type==='pointercancel'){cancelGesture();return;}
    gesture=null;
    if(d.type==='draw'){
      if(d.moved&&d.draft&&G.rectangle(d.draft)){
        try{
          const r=d.draft,g=G.clone(state.geometry);let index;
          if(mode==='wall'){index=g.WALLS.push([...r,'u'])-1;}
          else if(mode==='window'){index=g.WINS.push(r)-1;g.windowHeights.push({sill:900,head:2400});}
          else if(mode==='door'){
            const v=G.dimensions(r).vertical;index=g.DOORS.push({name:'新门',rect:r,h:r.slice(0,2),c:v?[0,1]:[1,0],o:v?[1,0]:[0,1],len:Math.max(r[2]-r[0],r[3]-r[1])})-1;
          }else{
            index=g.ROOMS.push({id:'room_'+Date.now().toString(36),name:'新房间',mat:'tile800',poly:[[r[0],r[1]],[r[2],r[1]],[r[2],r[3]],[r[0],r[3]]],at:[(r[0]+r[2])/2,(r[1]+r[3])/2]})-1;
          }
          const kind=mode;
          if(change(g,()=>ui.sel={kind:'geometry',geoKind:kind,index})){setMode('select');if(narrow())drawer('panel',true);}
        }catch(err){error(err.message);}
      }else toast('请按住拖出一段长度，再松开完成绘制');
    }else if(d.moved){
      if(snap()!==d.before){commit(d.before);renderAll();}
      if(d.error)toast(d.error);
    }else if(narrow())drawer('panel',true);
    renderSelection();
  }
  svg.addEventListener('pointerup',pointerEnd,true);
  svg.addEventListener('pointercancel',pointerEnd,true);
  document.addEventListener('keydown',e=>{
    if(e.target.matches('input,textarea,select')||is3D())return;
    if(e.key.toLowerCase()==='e'&&!e.metaKey&&!e.ctrlKey){e.preventDefault();e.stopImmediatePropagation();setTool(ui.tool==='geometry'?'select':'geometry');return;}
    if(ui.tool!=='geometry')return;
    if(e.key==='Escape'){cancelGesture();setMode('select');return;}
    if((e.key==='Delete'||e.key==='Backspace')&&current()){e.preventDefault();e.stopImmediatePropagation();removeSelected();}
    if(e.key.startsWith('Arrow')&&current()){
      e.preventDefault();e.stopImmediatePropagation();
      const step=e.shiftKey?100:10,dx=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,dy=e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0,sel=current();
      try{
        if(sel.kind==='room'){const g=G.clone(state.geometry),r=g.ROOMS[sel.index];r.poly=r.poly.map(([x,y])=>[x+dx,y+dy]);if(r.at)r.at=[r.at[0]+dx,r.at[1]+dy];change(g);}
        else change(G.replaceRect(state.geometry,sel.kind,sel.index,G.moveRect(rectOf(sel),dx,dy),linkRoomFaces));
      }catch(err){error(err.message);}
    }
  },true);
  document.querySelectorAll('[data-geommode]').forEach(b=>b.onclick=()=>setMode(b.dataset.geommode));
  window.GeometryEditor={renderPanel:renderGeometryPanel,renderSelection,toolChanged};
  renderAll();
})();
