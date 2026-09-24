// Reclaim only the extra rows reserved by saved step descriptions.
// Other saved gaps and the horizontal arrangement remain intact.
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
  const rows=[...new Set(nodes.map(n=>n.position.y))].sort((a,b)=>a-b);
  const rowY=new Map(),comments=new Map(),positions=new Map();
  let y=70+(Math.min(...rows,0)<0?0:(rows[0]||0)*117);
  for(let i=0;i<rows.length;i++){
    const row=rows[i],group=nodes.filter(n=>n.position.y===row);
    rowY.set(row,y);
    let savedExtra=0,openExtra=0;
    for(const n of group){
      if(!n.description?.trim())continue;
      const savedHeight=Math.max(1,Number(n.display?.size?.height)||1);
      savedExtra=Math.max(savedExtra,savedHeight-1);
      if(expanded.has(n.id)){
        const lines=wrapStepComment(n.description,measure);
        const bottom=metrics.top+(lines.length-1)*metrics.lineHeight;
        comments.set(n.id,{lines,bottom});
        openExtra=Math.max(openExtra,Math.ceil((bottom+48)/117)-1);
      }
    }
    if(i+1<rows.length){
      const gap=rows[i+1]-row;
      const reclaimed=Math.min(savedExtra,Math.max(0,gap-1));
      y+=(gap-reclaimed+openExtra)*117;
    }
  }
  const minX=Math.min(0,...nodes.map(n=>n.position.x));
  for(const n of nodes)positions.set(n.id,{x:95+(n.position.x-minX)*170,y:rowY.get(n.position.y)});
  const bounds={width:Math.max(300,...[...positions.values()].map(p=>p.x+95)),height:Math.max(150,...nodes.map(n=>positions.get(n.id).y+Math.max(80,(comments.get(n.id)?.bottom||0)+30)))};
  return {positions,comments,bounds};
}
// Caption bounds are based on neighbouring steps, never a fixed comment line count.
function graphTextArea(id,positions,zoom){
  const p=positions.get(id);let width=140,bottom=Infinity;
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
if(typeof module!=='undefined')module.exports={wrapStepComment,commentLayout,graphTextArea,fitGraphText};
