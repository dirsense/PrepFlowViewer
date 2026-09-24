// Keep saved positions independent of comment length and display size.
function wrapStepComment(text, measure, width=140){
  const lines=[];
  for(const paragraph of String(text).replace(/\r\n?/g,'\n').split('\n')){
    let line='';
    for(const char of Array.from(paragraph)){
      if(line&&measure(line+char)>width){lines.push(line);line='';}
      line+=char;
    }
    lines.push(line);
  }
  return lines;
}
function commentLayout(nodes,expanded,measure,metrics={top:65,lineHeight:15}){
  const comments=new Map(),positions=new Map();
  const minX=Math.min(0,...nodes.map(n=>n.position.x));
  const minY=Math.min(0,...nodes.map(n=>n.position.y));
  for(const n of nodes){
    positions.set(n.id,{x:95+(n.position.x-minX)*195.5,y:70+(n.position.y-minY)*134.55});
    if(n.description?.trim()&&expanded.has(n.id)){
      const lines=wrapStepComment(n.description,measure);
      comments.set(n.id,{lines,bottom:metrics.top+(lines.length-1)*metrics.lineHeight});
    }
  }
  // Leave a caption area below the last row, but never fit the map to full comments.
  const bounds={width:Math.max(300,...[...positions.values()].map(p=>p.x+95)),height:Math.max(150,...[...positions.values()].map(p=>p.y+150))};
  return {positions,comments,bounds};
}
// Caption bounds are based on neighbouring steps, never a fixed comment line count.
function graphTextArea(id,positions,zoom,mapBottom=Infinity){
  const p=positions.get(id);let width=140,bottom=mapBottom-p.y;
  for(const [other,q] of positions){
    if(other===id)continue;
    if(Math.abs(q.y-p.y)<1&&q.x!==p.x)width=Math.min(width,Math.abs(q.x-p.x)-8/zoom);
    if(q.y>p.y&&Math.abs(q.x-p.x)<150)bottom=Math.min(bottom,q.y-p.y-Math.max(48,42/zoom));
  }
  return {width:Math.max(0,width),bottom};
}
function fitGraphText(text,measure,width,maxLines=Infinity){
  if(maxLines<1||width<measure('…'))return [];
  const all=wrapStepComment(text,measure,width),lines=all.slice(0,maxLines);
  return lines.map((line,i)=>{
    if(measure(line)<=width&&!(i===lines.length-1&&all.length>lines.length))return line;
    const chars=Array.from(line);
    while(chars.length&&measure(chars.join('')+'…')>width)chars.pop();
    return chars.join('')+'…';
  });
}
function fitGraphComment(text,measure,width,maxLines=Infinity){
  // Use the current font's measured full-width glyphs, not the text's character count.
  if(width<measure('あ'.repeat(8)))return [];
  return fitGraphText(text,measure,width,maxLines);
}
// Flatten the same cubic curve used by the SVG renderer, within half a screen pixel.
function graphCurveSegments(x1,y1,x2,y2,bend,tolerance){
  const segments=[],mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  function distance(p,a,b){
    const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
    const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
    return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
  }
  function split(a,b,c,d,depth){
    if(depth>=12||Math.max(distance(b,a,d),distance(c,a,d))<=tolerance){segments.push([a,d]);return;}
    const ab=mid(a,b),bc=mid(b,c),cd=mid(c,d),abc=mid(ab,bc),bcd=mid(bc,cd),center=mid(abc,bcd);
    split(a,ab,abc,center,depth+1);split(center,bcd,cd,d,depth+1);
  }
  split({x:x1,y:y1},{x:x1+bend,y:y1},{x:x2-bend,y:y2},{x:x2,y:y2},0);
  return segments;
}
function graphSegmentHitsRect(a,b,rect){
  let start=0,end=1;
  for(const [v,delta,low,high] of [[a.x,b.x-a.x,rect.left,rect.right],[a.y,b.y-a.y,rect.top,rect.bottom]]){
    if(Math.abs(delta)<1e-9){if(v<low||v>high)return false;continue;}
    const t1=(low-v)/delta,t2=(high-v)/delta;
    start=Math.max(start,Math.min(t1,t2));end=Math.min(end,Math.max(t1,t2));
    if(start>end)return false;
  }
  return true;
}
function avoidGraphCommentOverlaps(text,measure,width,maxLines,geometry){
  let lines=fitGraphComment(text,measure,width,maxLines);
  const {x,y,fontSize,lineHeight,padding,segments,rectangles}=geometry;
  while(lines.length){
    const collision=lines.findIndex((line,i)=>{
      const baseline=y+i*lineHeight;
      const rect={left:x-padding,right:x+measure(line)+padding,top:baseline-fontSize-padding,bottom:baseline+fontSize*.25+padding};
      return rectangles.some(r=>r.left<=rect.right&&r.right>=rect.left&&r.top<=rect.bottom&&r.bottom>=rect.top)
        ||segments.some(([a,b])=>graphSegmentHitsRect(a,b,rect));
    });
    if(collision<0)return lines;
    // Refit so the last safe line includes an ellipsis; check that ellipsis too.
    lines=fitGraphComment(text,measure,width,collision);
  }
  return lines;
}
function placeGraphComment(text,measure,width,maxLines,geometry,maxShift,shiftStep){
  const original=avoidGraphCommentOverlaps(text,measure,width,maxLines,geometry);
  if(original.length||!fitGraphComment(text,measure,width,maxLines).length)return {x:geometry.x,lines:original};
  // Rescue a blocked first line locally. Keep the width, baseline and font unchanged.
  // Prefer the nearest safe position; the same collision checks still apply.
  for(let distance=Math.min(shiftStep,maxShift);distance>0;distance=Math.min(distance+shiftStep,maxShift)){
    for(const direction of [1,-1]){
      const x=geometry.x+direction*distance;
      const lines=avoidGraphCommentOverlaps(text,measure,width,maxLines,{...geometry,x});
      if(lines.length)return {x,lines};
    }
    if(distance===maxShift)break;
  }
  return {x:geometry.x,lines:[]};
}
if(typeof module!=='undefined')module.exports={wrapStepComment,commentLayout,graphTextArea,fitGraphText,fitGraphComment,graphCurveSegments,graphSegmentHitsRect,avoidGraphCommentOverlaps,placeGraphComment};
