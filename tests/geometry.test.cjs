const {test}=require('node:test');
const assert=require('node:assert/strict');
const G=require('../geometry-core.js');
const geometry=()=>G.normalize({WALLS:[[0,0,4000,240,'u']],WINS:[[1000,0,2200,240]],DOORS:[],SLIDES:[],ROOMS:[{id:'room',name:'房间',mat:'tile800',poly:[[0,240],[4000,240],[4000,4000],[0,4000]],at:[2000,2000]}]});

test('building facilities support old plans, movement, resize and removal',()=>{
 const g=geometry();assert.deepEqual(g.FACILITIES,[]);
 g.FACILITIES.push({type:'flue',name:'厨房烟道',rect:[100,200,700,700],height:2500});
 const moved=G.replaceRect(g,'facility',0,[200,300,1000,900]);
 assert.deepEqual(moved.FACILITIES[0],{type:'flue',name:'厨房烟道',rect:[200,300,1000,900],height:2500});
 assert.deepEqual(G.remove(moved,'facility',0).FACILITIES,[]);
 assert.throws(()=>G.normalize({...g,FACILITIES:[{...g.FACILITIES[0],type:'unknown'}]}),/建筑设施/);
});

test('room edge drag resizes only its two endpoints and follows the edge normal',()=>{
 const g=geometry(),next=G.moveRoomEdge(g,0,1,500,800);
 assert.deepEqual(next.ROOMS[0].poly,[[0,240],[4500,240],[4500,4000],[0,4000]]);
 assert.deepEqual(g.ROOMS[0].poly,geometry().ROOMS[0].poly);
 assert.deepEqual(next.ROOMS[0].at,[2250,2120]);
 assert.deepEqual(G.normalize(JSON.parse(JSON.stringify(next))),next);
});
test('diagonal room edges move perpendicular to themselves',()=>{
 const g=geometry();g.ROOMS[0].poly=[[0,1000],[1000,0],[2000,1000],[1000,2000]];
 const next=G.moveRoomEdge(g,0,0,100,100);
 assert.deepEqual(next.ROOMS[0].poly,[[100,1100],[1100,100],[2000,1000],[1000,2000]]);
});
test('invalid edge drag leaves the original room intact',()=>{
 const g=geometry(),before=G.clone(g);
 assert.throws(()=>G.moveRoomEdge(g,0,1,-4500,0),/边界/);
 assert.deepEqual(g,before);
 assert.throws(()=>G.moveRoomEdge(g,0,4,100,100),/边界不存在/);
});

test('wall resize is immutable and survives a JSON round trip',()=>{
 const original=geometry(),next=G.replaceRect(original,'wall',0,[0,0,5000,240]);
 assert.equal(original.WALLS[0][2],4000);assert.equal(next.WALLS[0][2],5000);
 assert.deepEqual(G.normalize(JSON.parse(JSON.stringify(next))),next);
});
test('opening cuts remove wall solids, shrinking the opening restores infill',()=>{
 const g=geometry(),a=G.solidRects(g);
 assert.deepEqual(a.map(x=>x.rect),[[0,0,1000,240,'u'],[2200,0,4000,240,'u']]);
 const next=G.replaceRect(g,'window',0,[1000,0,1600,240]);
 assert.equal(G.solidRects(next).reduce((s,x)=>s+(x.rect[2]-x.rect[0])*(x.rect[3]-x.rect[1]),0),(4000-600)*240);
});
test('deleting a window restores its wall and keeps height metadata aligned',()=>{
 const g=geometry();g.WINS.push([2500,0,3200,240]);g.windowHeights.push({sill:450,head:2300});
 const next=G.remove(g,'window',0);
 assert.equal(next.WINS.length,1);assert.deepEqual(next.windowHeights,[{sill:450,head:2300}]);
 assert.equal(G.remove(next,'window',0).WINS.length,0);
 assert.deepEqual(G.solidRects(G.remove(next,'window',0)).map(x=>x.rect),[[0,0,4000,240,'u']]);
});
test('window height validation prevents inverted or out-of-storey windows',()=>{
 const g=geometry();g.windowHeights[0]={sill:1200,head:1000};assert.throws(()=>G.normalize(g),/窗台/);
 g.windowHeights[0]={sill:900,head:3000};assert.throws(()=>G.normalize(g),/2800/);
});
test('moving a wall face optionally moves the matching room edge',()=>{
 const g=geometry(),next=G.replaceRect(g,'wall',0,[0,300,4000,540],true);
 assert.deepEqual(next.ROOMS[0].poly,[[0,540],[4000,540],[4000,4000],[0,4000]]);
 assert.deepEqual(G.replaceRect(g,'wall',0,[0,300,4000,540],false).ROOMS[0].poly,g.ROOMS[0].poly);
});
test('door resize carries hinge, width and opening vectors together',()=>{
 const g=geometry();g.DOORS=[{name:'门',rect:[0,1000,240,1900],h:[0,1900],c:[0,-1],o:[-1,0],len:900}];
 const next=G.replaceRect(g,'door',0,[400,1000,640,2200]);
 assert.deepEqual(next.DOORS[0].h,[400,2200]);assert.equal(next.DOORS[0].len,1200);assert.deepEqual(next.DOORS[0].c,[0,-1]);
 const rotated=G.replaceRect(next,'door',0,[400,1000,1600,1240]);
 assert.deepEqual(rotated.DOORS[0].c,[1,0]);assert.deepEqual(rotated.DOORS[0].h,[400,1000]);
});
test('room validation rejects bow ties, repeated vertices and duplicate ids',()=>{
 assert.equal(G.polygon([[0,0],[4000,4000],[0,4000],[4000,0]]),false);
 assert.equal(G.polygon([[0,0],[4000,0],[4000,0],[0,4000]]),false);
 const g=geometry();g.ROOMS.push(G.clone(g.ROOMS[0]));assert.throws(()=>G.normalize(g),/房间/);
});
test('invalid coordinates never mutate the existing model',()=>{
 const g=geometry(),before=JSON.stringify(g);
 assert.throws(()=>G.replaceRect(g,'wall',0,[NaN,0,3000,240]));
 assert.throws(()=>G.replaceRect(g,'wall',0,[1000,0,500,240]));
 assert.throws(()=>G.makeRect({x:0,y:0,length:-5,thickness:200,vertical:false}));
 assert.equal(JSON.stringify(g),before);
});
test('cuts preserve solid area for intersecting rectangular openings',()=>{
 const r=[0,0,1000,1000,'u'],cut=[200,300,800,700];
 const pieces=G.subtractRect(r,cut);
 assert.equal(pieces.reduce((s,p)=>s+(p[2]-p[0])*(p[3]-p[1]),0),1000000-600*400);
 assert.ok(pieces.every(G.rectangle));
});
test('demolition indices and dynamic bounds use current geometry',()=>{
 const g=geometry();assert.deepEqual(G.solidRects(g,['w0']),[]);
 g.WALLS.push([-5000,0,-4500,8000,'u']);const b=G.bounds(g);
 assert.ok(b.x<=-5000&&b.y<=0&&b.x+b.w>=4000&&b.y+b.h>=8000);
});
test('sliding doors can be resized, rotated, copied and deleted like other openings',()=>{
 const g=geometry();g.SLIDES=[{rect:[1000,0,2800,240],v:false,name:'推拉门',height:2300,panels:3}];
 const resized=G.replaceRect(g,'slide',0,[1000,500,1240,2900]);
 assert.equal(resized.SLIDES[0].v,true);assert.equal(resized.SLIDES[0].height,2300);assert.equal(resized.SLIDES[0].panels,3);
 assert.deepEqual(G.remove(resized,'slide',0).SLIDES,[]);
 assert.equal(g.SLIDES[0].v,false);
 const legacy=geometry();legacy.SLIDES=[{rect:[1000,0,2800,240],v:false}];
 assert.equal(G.normalize(legacy).SLIDES[0].height,2400);
 legacy.SLIDES[0].height=3000;assert.throws(()=>G.normalize(legacy),/推拉门高度/);
});
test('all visible opening presets insert real editable geometry and survive JSON export',()=>{
 assert.ok(G.openingPresets.length>=7);
 for(const preset of G.openingPresets){
  const g=G.insertOpening(geometry(),preset.id,[1000,0,2800,240]);
  const roundtrip=G.normalize(JSON.parse(JSON.stringify(g)));
  if(preset.kind==='slide')assert.equal(roundtrip.SLIDES.length,1);
  if(preset.kind==='door')assert.equal(roundtrip.DOORS.length,1);
  if(preset.kind==='window'){assert.equal(roundtrip.WINS.length,2);assert.equal(roundtrip.windowStyles[1].style,preset.style);}
 }
 const g=G.insertOpening(geometry(),'fixed-window',[2500,0,3500,240]);
 assert.equal(G.remove(g,'window',0).windowStyles[0].style,'fixed');
});
