const assert=require('node:assert/strict');
const {commentLayout,wrapStepComment}=require('../web/comment-layout.js');
const measure=s=>Array.from(s).length*12;
const node=(id,x,y,description='',height=1)=>({id,position:{x,y},description,display:{size:{height}}});
const nodes=[node('a',1,0,'あ'.repeat(30),2),node('a-input',0,0),node('b',1,2,'い'.repeat(16),2),node('c',5,4,'う'.repeat(200),4),node('last',5,8)];
const open=new Set(['a','b','c']);
const initial=commentLayout(nodes,open,measure);
assert.equal(initial.positions.get('last').y,70+8*134.55);
const closed=commentLayout(nodes,new Set(),measure);
assert.deepEqual(closed.positions,initial.positions,'Closing comments must preserve saved positions');
assert.deepEqual(closed.bounds,initial.bounds,'Comment visibility must not change fit bounds');
const one=commentLayout(nodes,new Set(['a']),measure);
assert.deepEqual(one.positions,initial.positions,'Opening one comment must not move other rows');
assert.equal(one.positions.get('a').y,one.positions.get('a-input').y);
assert.equal(initial.positions.get('last').x,closed.positions.get('last').x);
assert.deepEqual(commentLayout(nodes,open,measure),initial,'Repeated toggles must not accumulate drift');
const plain=[node('p',0,0),node('q',1,5)];
assert.equal(commentLayout(plain,new Set(),measure).positions.get('q').y,70+5*134.55,'Keep unrelated saved gaps');
const shared=[node('a',0,0,'あ'.repeat(30),2),node('b',1,0,'い'.repeat(30),2),node('c',1,2)];
assert.equal(commentLayout(shared,new Set(['a','b']),measure).positions.get('c').y,70+2*134.55,'Shared row reserves space once');
assert.equal(commentLayout(shared,new Set(['b']),measure).positions.get('c').y,70+2*134.55,'Other open comments keep their space');
assert.deepEqual(wrapStepComment('one\r\n\n三😀',measure),['one','','三😀']);
assert.equal(wrapStepComment('<script> & '+ 'あ'.repeat(200),measure).join(''),'<script> & '+'あ'.repeat(200));
const bottom=commentLayout([nodes[2]],new Set(['b']),measure);
assert.equal(bottom.bounds.height,bottom.positions.get('b').y+150);
const lengthy=nodes.map(n=>({...n,description:'長いコメント'.repeat(1000)}));
const largeFont=commentLayout(lengthy,open,s=>measure(s)*2,{top:140,lineHeight:30});
assert.deepEqual(largeFont.positions,initial.positions,'Long comments and larger fonts must not stretch the map');
assert.deepEqual(largeFont.bounds,initial.bounds,'Invisible comment overflow must not shrink the fitted map');
const negative=commentLayout([node('a',-2,-3),node('b',0,1)],new Set(),measure);
assert.equal(negative.positions.get('b').y-negative.positions.get('a').y,4*134.55);
assert.deepEqual(commentLayout([],new Set(),measure).bounds,{width:300,height:150});
console.log('Comment layout: saved positions, stable fit bounds, negative coordinates and long comments passed.');
const {graphTextArea,fitGraphText}=require('../web/comment-layout.js');
const longComment=Array.from({length:12},(_,i)=>`Line ${i+1}`).join('\n');
const textMeasure=text=>Array.from(text).length*6;
assert.equal(fitGraphText(longComment,textMeasure,140).length,12,'No fixed three-line cap when space is free');
const points=new Map([['a',{x:0,y:0}],['b',{x:0,y:400}],['side',{x:170,y:0}]]);
const area=graphTextArea('a',points,.5),top=100,lineHeight=22;
const allowed=Math.max(0,Math.floor((area.bottom-top)/lineHeight)+1);
const visible=fitGraphText(longComment,textMeasure,area.width,allowed);
assert.ok(visible.length>3,'Use the available space for more than three lines');
assert.ok(top+(visible.length-1)*lineHeight<=area.bottom,'Stop before the lower step');
assert.ok(visible.at(-1).endsWith('…'),'Mark truncated text');
assert.equal(graphTextArea('b',points,.5).bottom,Infinity,'Last step can show its whole comment');
const lastArea=graphTextArea('b',points,.5,520);
assert.equal(lastArea.bottom,120,'Last row captions stop at the map boundary');
assert.equal(graphTextArea('a',points,.5,520).bottom,area.bottom,'Nearby steps still limit comments first');
for(const stepLineHeight of [17,22,41]){
  const extendedArea=graphTextArea('b',points,.5,520+10*stepLineHeight);
  const count=bottom=>Math.max(0,Math.floor((bottom-100)/stepLineHeight)+1);
  assert.equal(count(extendedArea.bottom)-count(lastArea.bottom),10,'Allow ten extra lines below the map at each font size');
  assert.equal(graphTextArea('a',points,.5,520+10*stepLineHeight).bottom,area.bottom,'Extra lines must not overlap a lower step');
}
assert.equal(fitGraphText('😀',s=>s==='…'?6:20,10,2).join(''),'…');
assert.equal(fitGraphText('abc',textMeasure,4).length,0,'Do not spill into a neighbouring column');
console.log('Comment visibility: available-space line count, lower-step clearance and measured ellipsis passed.');

const {fitGraphComment}=require('../web/comment-layout.js');
const mixedMeasure=s=>Array.from(s).reduce((w,c)=>w+(c.charCodeAt(0)<128?6:12),0);
for(const text of ['あいうえおかきくけこ','abc123日本語DEF','ASCII letters only']){
  assert.deepEqual(fitGraphComment(text,mixedMeasure,95),[],'Hide below eight full-width glyphs');
  assert.ok(fitGraphComment(text,mixedMeasure,96).length>0,'Show at the measured width threshold');
}
assert.deepEqual(fitGraphComment('コメント',s=>mixedMeasure(s)*2,72),[],'Larger font needs more width');
assert.ok(fitGraphComment(longComment,mixedMeasure,140).length>3,'Available height still controls the line count');
console.log('Narrow comments: full-width measurement, mixed text, zoom and no fixed line cap passed.');

const {graphCurveSegments,graphSegmentHitsRect,avoidGraphCommentOverlaps}=require('../web/comment-layout.js');
const collisionText=Array.from({length:20},()=> 'abcdefgh').join('\n');
const geometry={x:0,y:20,fontSize:12,lineHeight:20,padding:3,segments:[],rectangles:[]};
const fitObstacles=changes=>avoidGraphCommentOverlaps(collisionText,mixedMeasure,140,20,{...geometry,...changes});
assert.equal(fitObstacles({}).length,20,'Free space still shows more than three lines');
assert.equal(fitObstacles({segments:[[{x:-20,y:72},{x:100,y:72}]]}).length,3,'Stop before a horizontal edge');
assert.ok(fitObstacles({segments:[[{x:-20,y:72},{x:100,y:72}]]}).at(-1).endsWith('…'));
assert.equal(fitObstacles({segments:[[{x:100,y:0},{x:100,y:500}]]}).length,20,'An edge outside the actual text width must not hide it');
assert.equal(fitObstacles({rectangles:[{left:0,right:60,top:70,bottom:90}]}).length,3,'Stop before another step title or icon');
assert.deepEqual(fitObstacles({rectangles:[{left:0,right:60,top:10,bottom:30}]}),[],'Keep only the bubble when even the first line overlaps');
const curve=graphCurveSegments(-100,0,100,120,90,.5);
assert.deepEqual(curve[0][0],{x:-100,y:0});
assert.deepEqual(curve.at(-1)[1],{x:100,y:120});
assert.ok(curve.some(([a,b])=>graphSegmentHitsRect(a,b,{left:-2,right:2,top:58,bottom:62})),'Curved connections pass through their true midpoint');
assert.ok(fitObstacles({segments:curve}).length<20,'Curved connections limit comments too');
const reverse=graphCurveSegments(100,0,0,0,100,.5);
assert.ok(reverse.some(([a,b])=>Math.max(a.x,b.x)>100),'Backtracking curves retain their outward bend');
assert.equal(graphSegmentHitsRect({x:0,y:0},{x:100,y:100},{left:0,right:10,top:80,bottom:90}),false,'Bounding-box overlap alone is not a collision');
const ellipsisMeasure=s=>s.includes('…')?80:mixedMeasure(s);
assert.deepEqual(avoidGraphCommentOverlaps('x\ny',ellipsisMeasure,140,2,{...geometry,segments:[[{x:0,y:35},{x:50,y:35}],[{x:75,y:10},{x:75,y:25}]]}),[],'Recheck the ellipsis when shortening a line');
console.log('Comment obstacles: straight and curved edges, steps, safe whitespace and ellipsis passed.');

const {placeGraphComment}=require('../web/comment-layout.js');
const zoomText='◆グループ化　車種名、年代、年月、データ元(STATUS)、性別、GRADE、販社コード、塗色コード、塗色名称 ◆カウント MITSUMORI_NO';
let reproducedDisappearance=false;
for(let tick=75;tick<=300;tick++){
  const zoom=tick/100,icon=Math.max(1,Math.min(1.8,.9/zoom)),title=Math.max(13*icon,14/zoom);
  const font=Math.max(13/zoom,Math.min(20,title*.924,Math.max(12.6,9.45/zoom)));
  const y=32.255*icon+title*.8+Math.max(10,6/zoom)+4/zoom+font;
  const x1=-170+56.715125,x2=-19.845*icon-7;
  const shape={x:-70,y,fontSize:font,lineHeight:Math.ceil(font*1.25),padding:3/zoom,
    segments:graphCurveSegments(x1,117,x2,0,Math.max(45,Math.abs(x2-x1)*.48),.5/zoom),rectangles:[]};
  const measured=s=>Array.from(s).reduce((n,c)=>n+(c.charCodeAt(0)<128?.53:1)*font,0);
  const original=avoidGraphCommentOverlaps(zoomText,measured,140,8,shape);
  const placed=placeGraphComment(zoomText,measured,140,8,shape,Math.min(35,24/zoom),2/zoom);
  if(!original.length)reproducedDisappearance=true;
  assert.ok(placed.lines.length,'An incoming curve must not make this comment disappear as zoom increases');
  assert.ok(Math.abs(placed.x-shape.x)<=Math.min(35,24/zoom),'Keep the comment close to its own step');
  assert.deepEqual(placed.lines,avoidGraphCommentOverlaps(zoomText,measured,140,8,{...shape,x:placed.x}),'Moved text and ellipsis must remain clear of edges');
  if(original.length)assert.deepEqual(placed,{x:shape.x,lines:original},'Do not move already visible comments');
}
assert.ok(reproducedDisappearance,'The regression fixture must reproduce the original bug');
const blocked={...geometry,segments:[[{x:0,y:0},{x:0,y:500}]]};
const rescued=placeGraphComment(collisionText,mixedMeasure,140,20,blocked,24,2);
assert.ok(rescued.x>0&&rescued.lines.length>0,'Move right of a curve along the left edge');
assert.deepEqual(placeGraphComment(collisionText,mixedMeasure,140,20,{...blocked,
  rectangles:[{left:-100,right:200,top:0,bottom:500}]},24,2).lines,[],'Do not move into a neighbouring step or reserved comment');
assert.deepEqual(placeGraphComment(collisionText,mixedMeasure,95,20,blocked,24,2).lines,[],'Moving must not bypass the eight-character minimum width');
assert.deepEqual(placeGraphComment(collisionText,mixedMeasure,140,0,blocked,24,2).lines,[],'Moving must not bypass available height');
assert.equal(placeGraphComment(collisionText,mixedMeasure,140,20,geometry,24,2).lines.length,20,'No new fixed line limit');
console.log('Comment placement: zoom regression, bounded offsets, neighbour protection and existing visibility rules passed.');
