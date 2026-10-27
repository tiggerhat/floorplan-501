/* Geometry validation and transactions. No DOM or storage dependencies. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FloorGeometry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const keys = ['WALLS', 'WINS', 'DOORS', 'SLIDES', 'ROOMS'];
  const openingPresets = [
    {id:'door',kind:'door',name:'平开门',length:900,thickness:240,height:2100},
    {id:'slide',kind:'slide',name:'推拉门',length:1800,thickness:240,height:2400,panels:2},
    {id:'casement',kind:'window',name:'普通窗',style:'casement',length:1500,thickness:240,sill:900,head:2400,panels:2},
    {id:'sliding-window',kind:'window',name:'推拉窗',style:'sliding',length:1800,thickness:240,sill:900,head:2400,panels:2},
    {id:'fixed-window',kind:'window',name:'固定窗',style:'fixed',length:1500,thickness:240,sill:900,head:2400,panels:1},
    {id:'floor-window',kind:'window',name:'落地窗',style:'floor',length:2400,thickness:240,sill:0,head:2600,panels:3},
    {id:'bay-window',kind:'window',name:'深窗台窗',style:'bay',length:1800,thickness:600,sill:450,head:2400,panels:3}
  ];
  const facilityPresets = [
    {id:'flue',name:'厨房烟道',width:600,depth:500}, {id:'exhaust',name:'卫生间排气道',width:350,depth:350},
    {id:'plumbing',name:'给排水管井',width:600,depth:400}, {id:'power',name:'强电井',width:500,depth:400},
    {id:'data',name:'弱电井',width:400,depth:350}, {id:'ventshaft',name:'通风井',width:600,depth:500},
    {id:'column',name:'结构柱',width:400,depth:400}, {id:'pipebox',name:'包管',width:300,depth:300}
  ];
  const clone = value => JSON.parse(JSON.stringify(value));
  const finite = n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 200000;
  const fail = message => { throw new Error(message); };
  function point(p) { return Array.isArray(p) && p.length === 2 && p.every(finite); }
  function rectangle(r) { return Array.isArray(r) && r.length >= 4 && r.slice(0, 4).every(finite) && r[2] > r[0] && r[3] > r[1]; }
  function cross(a, b, c) { return (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]); }
  function onSegment(a,b,p) { return cross(a,b,p) === 0 && p[0] >= Math.min(a[0],b[0]) && p[0] <= Math.max(a[0],b[0]) && p[1] >= Math.min(a[1],b[1]) && p[1] <= Math.max(a[1],b[1]); }
  function intersects(a,b,c,d) {
    return cross(a,b,c)*cross(a,b,d) < 0 && cross(c,d,a)*cross(c,d,b) < 0 ||
      onSegment(a,b,c) || onSegment(a,b,d) || onSegment(c,d,a) || onSegment(c,d,b);
  }
  function polygon(poly) {
    if (!Array.isArray(poly) || poly.length < 3 || poly.length > 200 || !poly.every(point)) return false;
    const n = poly.length;
    let area = 0;
    for (let i=0; i<n; i++) {
      const a=poly[i], b=poly[(i+1)%n];
      if (a[0]===b[0] && a[1]===b[1]) return false;
      area += a[0]*b[1]-b[0]*a[1];
      for (let j=i+1;j<n;j++) {
        if (j===i+1 || i===0 && j===n-1) continue;
        if (intersects(a,b,poly[j],poly[(j+1)%n])) return false;
      }
    }
    return Math.abs(area) > 20000;
  }
  function normalize(input) {
    const g = clone(input);
    if (!g || keys.some(k => !Array.isArray(g[k]) || g[k].length > 2000)) fail('户型缺少墙、窗、门或房间数组，或数量超出上限');
    if(g.FACILITIES===undefined)g.FACILITIES=[];
    if(!Array.isArray(g.FACILITIES)||g.FACILITIES.length>2000)fail('建筑设施数据无效或数量超出上限');
    g.FACILITIES.forEach(f=>{
      if(!f||!facilityPresets.some(p=>p.id===f.type)||typeof f.name!=='string'||!f.name.trim()||f.name.length>100||!rectangle(f.rect)||!finite(f.height)||f.height<100||f.height>2800)fail('建筑设施类型、名称、坐标或高度无效');
      f.rect=f.rect.slice(0,4);
    });
    g.WALLS.forEach(w => { if (!rectangle(w) || !['s','u','b','e','n','low'].includes(w[4])) fail('墙体坐标或类型无效，墙长和墙厚必须大于 0'); });
    g.WINS.forEach(w => { if (!rectangle(w)) fail('窗户坐标无效，窗宽和窗框厚度必须大于 0'); });
    g.DOORS.forEach(d => {
      const unit = v => point(v) && Math.abs(v[0])+Math.abs(v[1])===1;
      if (!d || !rectangle(d.rect) || !point(d.h) || !unit(d.c) || !unit(d.o) || d.c[0]*d.o[0]+d.c[1]*d.o[1]!==0 || !finite(d.len) || d.len<50 || d.len>20000 || typeof d.name!=='string') fail('门洞、门宽或开启方向无效');
    });
    g.SLIDES.forEach(d => {
      if (!d || !rectangle(d.rect) || typeof d.v!=='boolean') fail('推拉门数据无效');
      d.name=typeof d.name==='string'?d.name:'推拉门';d.height=d.height??2400;d.panels=d.panels??2;
      if(!finite(d.height)||d.height<100||d.height>2800||![2,3,4].includes(d.panels))fail('推拉门高度须为 100–2800 mm，扇数可选 2、3、4');
      d.v=d.rect[3]-d.rect[1]>d.rect[2]-d.rect[0];
    });
    const ids = new Set();
    g.ROOMS.forEach(r => {
      if (!r || typeof r.id!=='string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(r.id) || ['__proto__','constructor','prototype'].includes(r.id) || ids.has(r.id) || typeof r.name!=='string' || !polygon(r.poly) || r.at && !point(r.at)) fail('房间边界无效：至少 3 个顶点，不可交叉、重叠或使用重复编号');
      ids.add(r.id);
    });
    g.windowHeights = g.WINS.map((_, i) => {
      const h = g.windowHeights?.[i] || {sill:900, head:2400};
      if (!finite(h.sill) || !finite(h.head) || h.sill<0 || h.head<=h.sill || h.head>2800) fail('窗台高度须 ≥ 0，窗顶须高于窗台且不超过 2800 mm');
      return {sill:h.sill,head:h.head};
    });
    g.windowStyles=g.WINS.map((_,i)=>{
      const st=g.windowStyles?.[i]||{style:'casement',panels:2};
      if(!['casement','sliding','fixed','floor','bay'].includes(st.style)||!Number.isInteger(st.panels)||st.panels<1||st.panels>6)fail('窗型或分扇数量无效');
      return {style:st.style,panels:st.panels};
    });
    return g;
  }
  function dimensions(rect) {
    const w = rect[2]-rect[0], h=rect[3]-rect[1];
    return {x:rect[0],y:rect[1],length:Math.max(w,h),thickness:Math.min(w,h),vertical:h>w};
  }
  function makeRect({x,y,length,thickness,vertical}) {
    if (![x,y,length,thickness].every(finite) || length<50 || thickness<10 || length>50000 || thickness>10000) fail('长度须为 50–50000 mm，厚度须为 10–10000 mm；坐标须为有效数字');
    return [x,y,x+(vertical?thickness:length),y+(vertical?length:thickness)];
  }
  function moveRect(rect,dx,dy) { return [rect[0]+dx,rect[1]+dy,rect[2]+dx,rect[3]+dy,...rect.slice(4)]; }
  function resizeDoor(door,rect) {
    const old=door.rect, sx=(rect[2]-rect[0])/(old[2]-old[0]), sy=(rect[3]-rect[1])/(old[3]-old[1]);
    const d=clone(door), vertical=rect[3]-rect[1]>rect[2]-rect[0];
    if (vertical !== (old[3]-old[1]>old[2]-old[0])) {
      d.c=vertical?[0,1]:[1,0]; d.o=vertical?[1,0]:[0,1]; d.h=rect.slice(0,2);
    } else d.h=[rect[0]+(d.h[0]-old[0])*sx,rect[1]+(d.h[1]-old[1])*sy];
    d.rect=rect; d.len=Math.max(rect[2]-rect[0],rect[3]-rect[1]); return d;
  }
  // Moving an inner wall face can optionally move matching collinear room edges.
  // Wall and opening topology stays explicit: this is not an automatic CAD constraint solver.
  function linkRooms(rooms,old,rect) {
    const vertical=old[3]-old[1]>old[2]-old[0];
    const axis=vertical?0:1, other=1-axis;
    for (const r of rooms) {
      const before=clone(r.poly);
      for (let i=0;i<before.length;i++) {
        const j=(i+1)%before.length,a=before[i],b=before[j];
        for (const edge of [axis,axis+2]) {
          if (a[axis]===old[edge] && b[axis]===old[edge] &&
              Math.max(a[other],b[other])>old[other] && Math.min(a[other],b[other])<old[other+2]) {
            r.poly[i][axis]=rect[edge]; r.poly[j][axis]=rect[edge];
          }
        }
      }
      if (r.at) {
        const dx=r.poly.reduce((s,p,i)=>s+p[0]-before[i][0],0)/r.poly.length;
        const dy=r.poly.reduce((s,p,i)=>s+p[1]-before[i][1],0)/r.poly.length;
        r.at=[r.at[0]+dx,r.at[1]+dy];
      }
    }
  }
  function replaceRect(input,kind,index,rect,link=false) {
    if (!rectangle(rect)) fail('长和厚须大于 0');
    const g=clone(input), key={wall:'WALLS',window:'WINS',door:'DOORS',slide:'SLIDES',facility:'FACILITIES'}[kind];
    if (!key || !g[key][index]) fail('未找到所选对象');
    if(kind==='door') g.DOORS[index]=resizeDoor(g.DOORS[index],rect);
    else if(kind==='slide')g.SLIDES[index]={...g.SLIDES[index],rect:rect.slice(0,4),v:rect[3]-rect[1]>rect[2]-rect[0]};
    else if(kind==='facility')g.FACILITIES[index]={...g.FACILITIES[index],rect:rect.slice(0,4)};
    else {
      const old=g[key][index];
      if(kind==='wall' && link) linkRooms(g.ROOMS,old,rect);
      g[key][index]=rect.slice(0,4).concat(old.slice(4));
    }
    return normalize(g);
  }
  function remove(input,kind,index) {
    const g=normalize(input),key={wall:'WALLS',window:'WINS',door:'DOORS',slide:'SLIDES',room:'ROOMS',facility:'FACILITIES'}[kind];
    if(!key || !g[key][index]) fail('未找到所选对象');
    g[key].splice(index,1); if(kind==='window'){g.windowHeights?.splice(index,1);g.windowStyles?.splice(index,1);}
    return normalize(g);
  }
  function insertOpening(input,presetId,rect){
    const p=openingPresets.find(p=>p.id===presetId);if(!p)fail('门窗组件不存在');
    if(!rectangle(rect))fail('门窗尺寸无效');
    const g=normalize(input),v=dimensions(rect).vertical;
    if(p.kind==='door')g.DOORS.push({name:p.name,rect,h:rect.slice(0,2),c:v?[0,1]:[1,0],o:v?[1,0]:[0,1],len:dimensions(rect).length});
    else if(p.kind==='slide')g.SLIDES.push({name:p.name,rect,v,height:p.height,panels:p.panels});
    else{g.WINS.push(rect);g.windowHeights.push({sill:p.sill,head:p.head});g.windowStyles.push({style:p.style,panels:p.panels});}
    return normalize(g);
  }
  function subtractRect(r,cut) {
    const a=Math.max(r[0],cut[0]),b=Math.max(r[1],cut[1]),c=Math.min(r[2],cut[2]),d=Math.min(r[3],cut[3]);
    if(a>=c||b>=d) return [r];
    const type=r.slice(4),pieces=[];
    if(r[1]<b) pieces.push([r[0],r[1],r[2],b,...type]);
    if(d<r[3]) pieces.push([r[0],d,r[2],r[3],...type]);
    if(r[0]<a) pieces.push([r[0],b,a,d,...type]);
    if(c<r[2]) pieces.push([c,b,r[2],d,...type]);
    return pieces;
  }
  function solidRects(geometry,demolished=[]) {
    const openings=[...geometry.WINS,...geometry.DOORS.map(d=>d.rect),...geometry.SLIDES.map(d=>d.rect)];
    const result=[];
    geometry.WALLS.forEach((wall,index)=>{
      if(demolished.includes('w'+index))return;
      let parts=[wall];
      for(const opening of openings) parts=parts.flatMap(r=>subtractRect(r,opening));
      result.push(...parts.map(rect=>({rect,index})));
    });
    return result;
  }
  function moveRoomEdge(input,index,edge,dx,dy) {
    const g=clone(input),room=g.ROOMS[index],poly=room?.poly;
    if(!poly||!Number.isInteger(edge)||edge<0||edge>=poly.length)fail('房间边界不存在');
    const next=(edge+1)%poly.length,a=poly[edge],b=poly[next],nx=-(b[1]-a[1]),ny=b[0]-a[0];
    const amount=(dx*nx+dy*ny)/(nx*nx+ny*ny),mx=Math.round(amount*nx),my=Math.round(amount*ny);
    const signed=points=>points.reduce((s,p,i)=>{const q=points[(i+1)%points.length];return s+p[0]*q[1]-q[0]*p[1];},0);
    const before=signed(poly);
    room.poly=poly.map((p,i)=>i===edge||i===next?[p[0]+mx,p[1]+my]:p);
    if(before*signed(room.poly)<=0)fail('房间边界不能越过对侧边界');
    room.at=[0,1].map(axis=>room.poly.reduce((s,p)=>s+p[axis],0)/poly.length);
    return normalize(g);
  }
  function bounds(g) {
    const pts=[...g.WALLS,...g.WINS,...g.DOORS.map(d=>d.rect),...g.SLIDES.map(d=>d.rect),...(g.FACILITIES||[]).map(f=>f.rect)].flatMap(r=>[r.slice(0,2),r.slice(2,4)]).concat(g.ROOMS.flatMap(r=>r.poly));
    if(!pts.length)return {x:-2000,y:-2000,w:16000,h:22000};
    const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),x=Math.min(...xs)-2000,y=Math.min(...ys)-1800;
    return {x,y,w:Math.max(5000,Math.max(...xs)-x+2000),h:Math.max(5000,Math.max(...ys)-y+2500)};
  }
  return {clone,normalize,rectangle,polygon,dimensions,makeRect,moveRect,resizeDoor,replaceRect,remove,insertOpening,openingPresets,facilityPresets,subtractRect,solidRects,moveRoomEdge,bounds,keys};
});
