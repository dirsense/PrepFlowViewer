"use strict";
let DATA = JSON.parse(document.getElementById('flow-data').textContent);
const SERVER = JSON.parse(document.getElementById('server-config').textContent);
const CAN_EDIT = !!SERVER.token;
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json = value => JSON.stringify(value, null, 2);
const TYPE_NAMES = uiLabels({string:'文字列',integer:'整数',real:'小数',date:'日付',datetime:'日時',boolean:'真偽値',unknown:'未確定',spatial:'空間'});
const TYPE_SYMBOL = {string:'Abc',integer:'#',real:'#.0',date:'▦',datetime:'▦',boolean:'T/F',unknown:'?'};
const NS_NAMES = uiLabels({Left:'左入力',Right:'右入力',Default:'共通'});
let selected = null, activeTab = 'fields', fieldMode = 'all', changesMode = 'all';
let overviewTab = 'info';
let byId = new Map(), positions = new Map(), scale = 1, offset = {x:0,y:0}, bounds = {width:1000,height:500};
let autoFit = true;
let toastTimer, dragState, dropDepth = 0;
let recentFiles = [], loadingFlow = false, nativeDropReady = false;
const flowSessions=new Map();
let flowSession,flowEditBusy=false;
let publishBusy=false;
let expandedComments=new Set();
let commentFont=12.6;
const commentMeasure=document.createElement('canvas').getContext('2d');
commentMeasure.font='12px "Segoe UI", "Yu Gothic UI", Meiryo, sans-serif';

function joinRegions(type){
  return {left:['left','full','leftOnly','notInner'].includes(type),
    right:['right','full','rightOnly','notInner'].includes(type),
    overlap:['inner','left','right','full'].includes(type)};
}
function nodeJoinType(node){return node.raw?.actionNode?.joinType||node.raw?.joinType||node.actions?.find(a=>a.type==='SimpleJoin')?.raw?.joinType||'';}
function icon(kind, color='#499893', attributes='', pivotDirection='unpivot', joinType='') {
  const wrap = shape => `<svg viewBox="0 0 32 32" ${attributes} aria-hidden="true">${shape}</svg>`;
  const file = '<path d="M11 8h7l5 5v12H11z M18 8v6h5 M14 18h6 M14 21h6" fill="none" stroke="white" stroke-width="1.3" stroke-linejoin="round"/>';
  if(kind === 'input') return wrap(`<circle cx="16" cy="16" r="14" fill="${color}"/>${file}`);
  if(kind === 'output') return wrap(`<rect x="3" y="3" width="26" height="26" rx="2" fill="#697782"/>${file}`);
  if(kind === 'clean') return wrap(`<path d="M4 19h24" stroke="${color}" stroke-width="6" stroke-linecap="round"/><path d="M12 7h8M14 10h4" stroke="#87969d" stroke-width="1.5" stroke-linecap="round"/>`);
  if(kind === 'join') {
    const regions=joinRegions(joinType),fill=part=>regions[part]?color:'white';
    return wrap(`<circle data-join-region="left" cx="12" cy="16" r="9" fill="${fill('left')}"/><circle data-join-region="right" cx="21" cy="16" r="9" fill="${fill('right')}"/><path data-join-region="overlap" d="M16.5 8.206 A9 9 0 0 1 16.5 23.794 A9 9 0 0 1 16.5 8.206Z" fill="${fill('overlap')}"/><circle cx="12" cy="16" r="9" fill="none" stroke="#77858e" stroke-width="1.2"/><circle cx="21" cy="16" r="9" fill="none" stroke="#77858e" stroke-width="1.2"/>`);
  }
  if(kind === 'union') return wrap(`<path d="M3 5h18v7H3zM12 12h18v7H12zM3 19h18v7H3z" fill="${color}" stroke="#8f8a65" stroke-width=".8"/>`);
  if(kind === 'aggregate') return wrap(`<path d="M25 5H9l10 11L9 27h16" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round"/>`);
  if(kind === 'pivot') return `<svg viewBox="0 0 42 27" ${attributes} aria-hidden="true">${PREP_ICONS.steps[pivotDirection].map(p=>`<path d="${p.d}" fill="${p.fill||color}"${p.transform?` transform="${p.transform}"`:''}/>`).join('')}</svg>`;
  return wrap(`<rect x="5" y="5" width="22" height="22" rx="5" fill="${color}"/><text x="16" y="22" text-anchor="middle" fill="white" font-size="18">?</text>`);
}

function pivotDirection(n){return /unpivot/i.test(n.raw?.actionNode?.nodeType||n.nodeType||'')?'unpivot':'pivot';}
// Tableau flow annotations are distinct operation categories, not formula counts.
const ANNOTATIONS=uiLabels([
  {key:'calculate',label:'計算フィールド',types:['AddColumn','QuickCalcColumn','QuickDateNameCalcColumn','DuplicateColumn','MultiRowCalc']},
  {key:'filter',label:'フィルター',types:['Filter','FilterOperation','RangeFilter','ValueFilter','RichNullFilter','RichWildcardFilter','UniquenessFilter']},
  {key:'remove',label:'フィールドを削除',types:['RemoveColumns','RemoveColumn','KeepOnlyColumns']},
  {key:'group',label:'値のグループ化・置換',types:['Remap','MergeColumns']},
  {key:'rename',label:'フィールド名を変更',types:['RenameColumn','BulkRenameColumns']},
  {key:'type',label:'データ型を変更',types:['ChangeColumnType']}
]);
function annotationIcons(n){
  const items=ANNOTATIONS.filter(spec=>n.actions.some(a=>spec.types.includes(a.type)));
  return `<g class="flow-annotations" data-count="${items.length}">${items.map((spec,i)=>`<g class="flow-annotation" data-kind="${spec.key}" aria-label="${esc(spec.label)}" transform="translate(${i*16} 0)"><image href="${PREP_ICONS.annotations[spec.key]}" width="13" height="13"/></g>`).join('')}</g>`;
}

function toast(message) {
  uiBind($('toast'), 'textContent', () => uiMessage(message));
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').hidden = true, 4800);
}
function textMatch(value, query) {return !query || String(value ?? '').toLocaleLowerCase().includes(query.toLocaleLowerCase());}
function matchNode(n, q) {
  return textMatch(n.name,q) || n.fields.some(f=>textMatch(f.name,q)) || n.actions.some(a=>textMatch(a.name,q)) || n.calculations.some(c=>textMatch(c.field+' '+c.expression,q));
}

function renderGraph() {
  commentMeasure.font=`${commentFont}px "Segoe UI", "Yu Gothic UI", Meiryo, sans-serif`;
  const commentTop=140,commentLineHeight=Math.ceil(commentFont*1.25);
  const layout=commentLayout(DATA.nodes,expandedComments,text=>commentMeasure.measureText(text).width,{top:commentTop,lineHeight:commentLineHeight});
  positions=layout.positions;bounds=layout.bounds;
  $('edges').innerHTML=DATA.edges.map((e,i)=>{
    const a=positions.get(e.source),b=positions.get(e.target),source=byId.get(e.source),target=byId.get(e.target);
    const edgeGap=kind=>graphEdgeOffset(kind,graphTextSizes(scale,commentFont).icon);
    const x1=a.x+edgeGap(source.kind), x2=b.x-edgeGap(target.kind);
    const bend=Math.max(45,Math.abs(x2-x1)*.48);
    return `<path class="flow-edge" data-edge="${i}" d="M${x1} ${a.y} C${x1+bend} ${a.y},${x2-bend} ${b.y},${x2} ${b.y}" marker-end="url(#arrow)"/>`;
  }).join('');
  $('nodes').innerHTML=DATA.nodes.map(n=>{
    const p=positions.get(n.id),label=wrapLabel(n.name,14);
    const iconBounds=n.kind==='pivot'?'x="-28.11375" y="-18.7425" width="56.2275" height="37.485"':n.kind==='join'?'x="-24.255" y="-24.255" width="48.51" height="48.51"':'x="-19.845" y="-19.845" width="39.69" height="39.69"';
    const symbol=n.kind==='clean'?`<path d="M-44.1 0h88.2" stroke="${n.color}" stroke-width="8.93025" stroke-linecap="round"/>`:icon(n.kind,n.color,iconBounds,pivotDirection(n),nodeJoinType(n)).replace('<svg ','<svg overflow="visible" ');
    return `<g class="flow-node" data-id="${esc(n.id)}" transform="translate(${p.x} ${p.y})" tabindex="0" role="button" aria-label="${esc(n.name+', '+ui(n.kindLabel))}"><rect class="node-backdrop" x="-75" y="-42" width="150" height="106" rx="7"/><g class="step-symbol">${symbol}</g>${annotationIcons(n)}<text class="node-name" text-anchor="middle" y="30">${label.map((line,i)=>`<tspan x="0" dy="${i?16:0}">${esc(line)}</tspan>`).join('')}</text></g>`;
  }).join('');
  $('step-comments').innerHTML=DATA.nodes.filter(n=>n.description?.trim()).map(n=>{
    const p=positions.get(n.id),comment=layout.comments.get(n.id),open=expandedComments.has(n.id);
    return `<g transform="translate(${p.x} ${p.y})"><g class="comment-toggle ${open?'expanded':''}" data-comment-toggle="${esc(n.id)}" role="button" tabindex="0" aria-label="${esc(n.name+ui('のコメントを')+(open?ui('非表示'):ui('表示')))}" aria-expanded="${open}" aria-controls="comment-${esc(n.id)}" transform="translate(56 23)"><rect x="-3" y="-3" width="23" height="23" rx="3"/><path d="M2 2h12v9H8l-4 4v-4H2Z"/></g><text id="comment-${esc(n.id)}" class="step-comment" style="font-size:${commentFont}px" x="-70" y="${commentTop}" ${open?'':'display="none"'}>${comment?comment.lines.map((line,i)=>`<tspan x="-70" dy="${i?commentLineHeight:0}">${esc(line)||'&#8203;'}</tspan>`).join(''):''}</text></g>`;
  }).join('');
  highlightGraph();
}
function toggleStepComment(id){
  const before=positions.get(id);if(!before)return;
  if(expandedComments.has(id))expandedComments.delete(id);else expandedComments.add(id);
  renderGraph();const after=positions.get(id);
  offset.x+=(before.x-after.x)*scale;offset.y+=(before.y-after.y)*scale;
  applyTransform();
  [...document.querySelectorAll('[data-comment-toggle]')].find(b=>b.dataset.commentToggle===id)?.focus({preventScroll:true});
}
function wrapLabel(name,max){const s=Array.from(name);return s.length>max?[s.slice(0,max).join(''),s.slice(max,max*2-1).join('')+(s.length>max*2-1?'…':'')]:[name];}
function highlightGraph(){
  const related=new Set();
  function trace(id,dir){const queue=[id],seen=new Set();while(queue.length){const k=queue.pop();if(seen.has(k))continue;seen.add(k);for(const next of byId.get(k)?.[dir]||[]){related.add(next);queue.push(next);}}}
  if(selected){related.add(selected);trace(selected,'upstream');trace(selected,'downstream');}
  document.querySelectorAll('.flow-node').forEach(g=>{g.classList.toggle('selected',g.dataset.id===selected);g.setAttribute('aria-pressed',String(g.dataset.id===selected));});
  document.querySelectorAll('.flow-edge').forEach(g=>{const e=DATA.edges[Number(g.dataset.edge)];g.classList.toggle('related',!!selected&&related.has(e.source)&&related.has(e.target));});
}
function graphTextSizes(zoom,layoutCommentFont){
  // Keep the current icon scaling; give captions independent minimum screen sizes.
  const icon=Math.max(1,Math.min(1.8,.9/zoom)),title=Math.max(13*icon,14/zoom);
  return {icon,title,comment:Math.max(13/zoom,Math.min(layoutCommentFont,title*.924,Math.max(12.6,9.45/zoom)))};
}
function graphEdgeOffset(kind,magnify){
  const half=kind==='clean'?48.565125:kind==='join'?24.255:kind==='pivot'?28.11375:19.845;
  return kind==='clean'?56.715125:half*magnify+7;
}
function applyTransform(){
  $('viewport').setAttribute('transform',`translate(${offset.x} ${offset.y}) scale(${scale})`);
  const sizes=graphTextSizes(scale,commentFont),font=sizes.title;
  const titleY=32.255*sizes.icon+font*.8,titleBottoms=new Map(),commentObstacles=[],edgeSegments=[];
  document.querySelectorAll('.flow-node').forEach(g=>{
    const n=byId.get(g.dataset.id),area=graphTextArea(n.id,positions,scale),label=g.querySelector('.node-name');
    commentMeasure.font=`${font}px "Segoe UI", "Yu Gothic UI", Meiryo, sans-serif`;
    const limit=Math.max(0,Math.min(2,Math.floor((area.bottom-titleY)/(font+2))+1));
    const lines=fitGraphText(n.name,text=>commentMeasure.measureText(text).width,area.width,limit);
    label.style.fontSize=font+'px';label.innerHTML=lines.map((line,i)=>`<tspan x="0" dy="${i?font+2:0}">${esc(line)}</tspan>`).join('');
    const oldTitle=g.querySelector(':scope > title');if(oldTitle)oldTitle.remove();
    if(lines.join('')!==n.name.replace(/\r?\n/g,'')){
      const tooltip=document.createElementNS('http://www.w3.org/2000/svg','title');
      tooltip.textContent=n.name;g.insertBefore(tooltip,g.firstChild);
    }
    label.setAttribute('y',titleY);
    titleBottoms.set(n.id,titleY+Math.max(0,lines.length-1)*(font+2));
    g.querySelector('.step-symbol').setAttribute('transform',`scale(${n.kind==='clean'?1:sizes.icon} ${sizes.icon})`);
    g.querySelector('.node-backdrop').setAttribute('height',Math.max(106,titleY+(lines.length-1)*(font+2)+10+42));
    const annotations=g.querySelector('.flow-annotations'), count=Number(annotations.dataset.count);
    // Keep processing glyphs at least 16 screen pixels when fitting a large flow.
    const magnify=Math.max(1,16/(13*scale)), width=Math.max(0,count*16-3)*magnify;
    const x=n.kind==='input'?-(19.845*sizes.icon+3)-width:-width/2;
    const y=n.kind==='input'?-6.5*magnify:-(n.kind==='clean'?8.415125:24.255)*sizes.icon-13*magnify;
    annotations.setAttribute('transform',`translate(${x} ${y}) scale(${magnify})`);
    const p=positions.get(n.id);
    const obstacle=(left,top,right,bottom)=>commentObstacles.push({id:n.id,left:p.x+left,top:p.y+top,right:p.x+right,bottom:p.y+bottom});
    const halfWidth=n.kind==='clean'?48.565125:(n.kind==='pivot'?28.11375:n.kind==='join'?24.255:19.845)*sizes.icon;
    const halfHeight=(n.kind==='clean'?4.465125:n.kind==='pivot'?18.7425:n.kind==='join'?24.255:19.845)*sizes.icon;
    obstacle(-halfWidth,-halfHeight,halfWidth,halfHeight);
    if(count)obstacle(x,y,x+width,y+13*magnify);
    if(lines.length){
      const titleWidth=Math.max(...lines.map(line=>commentMeasure.measureText(line).width));
      obstacle(-titleWidth/2,titleY-font,titleWidth/2,titleBottoms.get(n.id)+font*.25);
    }
    if(n.description?.trim()){
      const toggleScale=Math.max(1,.85/scale);
      obstacle(65-3*toggleScale,titleY-font-3*toggleScale,65+20*toggleScale,titleY-font+20*toggleScale);
    }
  });
  document.querySelectorAll('.flow-edge').forEach(path=>{
    const e=DATA.edges[Number(path.dataset.edge)],a=positions.get(e.source),b=positions.get(e.target);
    const x1=a.x+graphEdgeOffset(byId.get(e.source).kind,sizes.icon),x2=b.x-graphEdgeOffset(byId.get(e.target).kind,sizes.icon);
    const bend=Math.max(45,Math.abs(x2-x1)*.48);
    path.setAttribute('d',`M${x1} ${a.y} C${x1+bend} ${a.y},${x2-bend} ${b.y},${x2} ${b.y}`);
    edgeSegments.push(...graphCurveSegments(x1,a.y,x2,b.y,bend,.5/scale));
  });
  document.querySelectorAll('.comment-toggle').forEach(g=>{
    g.setAttribute('transform',`translate(65 ${titleY-font}) scale(${Math.max(1,.85/scale)})`);
    g.querySelector(':scope > title')?.remove();
  });
  // Allow ten extra lines below the map without changing layout or fit bounds.
  commentMeasure.font=`${sizes.comment}px "Segoe UI", "Yu Gothic UI", Meiryo, sans-serif`;
  const commentPlacements=[],commentRects=new Map();
  const measureComment=text=>commentMeasure.measureText(text).width;
  const reserveComment=(id,x,lines,geometry)=>commentRects.set(id,lines.map((line,i)=>({
    left:x,right:x+measureComment(line),top:geometry.y+i*geometry.lineHeight-geometry.fontSize,
    bottom:geometry.y+i*geometry.lineHeight+geometry.fontSize*.25
  })));
  document.querySelectorAll('.step-comment').forEach(label=>{
    const node=byId.get(label.id.slice('comment-'.length));
    if(!node||!expandedComments.has(node.id))return;
    const commentY=titleBottoms.get(node.id)+Math.max(10,6/scale)+4/scale+sizes.comment;
    label.style.fontSize=sizes.comment+'px';
    label.setAttribute('y',commentY);
    const lineHeight=Math.ceil(sizes.comment*1.25);
    const area=graphTextArea(node.id,positions,scale,bounds.height-30+10*lineHeight);
    const limit=Math.max(0,Math.floor((area.bottom-commentY)/lineHeight)+1);
    const p=positions.get(node.id);
    const geometry={
      x:p.x-area.width/2,y:p.y+commentY,fontSize:sizes.comment,lineHeight,padding:3/scale,
      segments:edgeSegments,rectangles:commentObstacles.filter(r=>r.id!==node.id)
    };
    const lines=avoidGraphCommentOverlaps(node.description,measureComment,area.width,limit,geometry);
    reserveComment(node.id,geometry.x,lines,geometry);
    commentPlacements.push({label,node,p,area,limit,geometry,lines});
  });
  // Reserve existing captions before moving any hidden one into nearby free space.
  for(const {label,node,p,area,limit,geometry,lines:original} of commentPlacements){
    const placed=original.length?{x:geometry.x,lines:original}:placeGraphComment(
      node.description,measureComment,area.width,limit,{
        ...geometry,rectangles:[...geometry.rectangles,...[...commentRects].filter(([id])=>id!==node.id).flatMap(([,rects])=>rects)]
      },Math.min(area.width*.25,24/scale),2/scale);
    const {lines}=placed,x=placed.x-p.x,lineHeight=geometry.lineHeight;
    reserveComment(node.id,placed.x,lines,geometry);
    label.setAttribute('x',x);
    const truncated=lines.join('')!==node.description.replace(/\r?\n/g,'');
    if(truncated){
      const toggle=label.parentElement.querySelector('.comment-toggle');
      if(toggle){
        const tooltip=document.createElementNS('http://www.w3.org/2000/svg','title');
        tooltip.textContent=node.description;toggle.insertBefore(tooltip,toggle.firstChild);
      }
    }
    label.innerHTML=(truncated?`<title>${esc(node.description)}</title>`:'')+lines.map((line,i)=>`<tspan x="${x}" dy="${i?lineHeight:0}">${esc(line)||'&#8203;'}</tspan>`).join('');
  }
}

function fit(){
  autoFit=true;
  const r=$('graph').getBoundingClientRect();if(!r.width||!r.height)return;
  const fitScale=()=>Math.max(.08,Math.min(1.4,(r.width-38)/bounds.width,(r.height-44)/bounds.height));
  // Fit with a readable comment size; cap growth for very large flows.
  commentFont=12.6;renderGraph();
  for(let i=0;i<3;i++){scale=fitScale();const font=Math.min(23.1,Math.max(12.6,9.45/scale));if(Math.abs(font-commentFont)<.1)break;commentFont=font;renderGraph();}
  scale=fitScale();offset={x:(r.width-bounds.width*scale)/2,y:(r.height-bounds.height*scale)/2-5};applyTransform();
}
function zoom(factor,x,y){autoFit=false;const r=$('graph').getBoundingClientRect();x??=r.width/2;y??=r.height/2;const next=Math.min(3,Math.max(.08,scale*factor));offset.x=x-(x-offset.x)*next/scale;offset.y=y-(y-offset.y)*next/scale;scale=next;applyTransform();}


function init(model,{restored=false}={}){
  const openingOverview=model.nodes.length&&(byId.size>0||restored)?'info':'help';
  closeFormulaPopup();
  DATA=model;byId=new Map(DATA.nodes.map(n=>[n.id,n]));
  const sessionKey=DATA.exportKey||DATA.name;
  if(!flowSessions.has(sessionKey))flowSessions.set(sessionKey,{history:new FlowEditHistory(),model:DATA});
  flowSession=flowSessions.get(sessionKey);flowSession.model=DATA;updateFlowEditButtons();
  configureFormulaEditor();
  commentFont=12.6;
  expandedComments=new Set(DATA.nodes.filter(n=>n.description?.trim()&&(!n.display?.size||n.display.size.height>1)).map(n=>n.id));
  closeStepChoices();
  selected=null;
  activeTab='fields';fieldMode='all';changesMode='all';$('detail-search').value='';
  document.title=`${DATA.name||'PrepFlow'} — PrepFlow Viewer`;
  $('file-name').textContent=DATA.name||'PrepFlow Viewer';$('file-name').title=DATA.name||'';
  syncRecentPicker();
  uiBind($('status-text'), 'textContent', () => DATA.nodes.length?ui('ドラッグで移動 · ホイールで拡大／縮小 · ダブルクリックで全体表示'):ui('フローを開いてください'));
  uiBind($('stats-text'), 'textContent', () => SERVER.token?ui('データ接続なし · 計算式・出力先を編集できます'):ui('データ接続なし · HTMLプレビュー'));
  $('empty-state').hidden=!!DATA.nodes.length;$('export-button').disabled=false;$('open-button').hidden=!SERVER.token;
  renderGraph();selectNode(null,openingOverview);requestAnimationFrame(fit);
}
function adjacentSteps(direction){return [...new Set(byId.get(selected)?.[direction]||[])].filter(id=>byId.has(id));}
function closeStepChoices(restoreFocus=false){
  const trigger=document.querySelector('.step-arrow[aria-expanded="true"]');
  $('step-choices').hidden=true;$('step-choices').replaceChildren();
  document.querySelectorAll('.step-arrow').forEach(b=>b.setAttribute('aria-expanded','false'));
  if(restoreFocus)trigger?.focus();
}
function navigateStep(direction){
  const ids=adjacentSteps(direction),button=$(direction==='upstream'?'previous-step':'next-step');
  const wasOpen=button.getAttribute('aria-expanded')==='true';closeStepChoices();
  if(wasOpen||!ids.length)return;
  if(ids.length===1){selectNode(ids[0]);return;}
  $('step-choices').innerHTML=ui`<p>${direction==='upstream'?ui('前'):ui('次')}のステップを選択</p>${ids.map(id=>{const n=byId.get(id);return `<button data-select="${esc(id)}"><span class="step-choice-color" style="background:${esc(n.color)}"></span><span>${esc(n.name)}</span></button>`;}).join('')}`;
  $('step-choices').hidden=false;button.setAttribute('aria-expanded','true');
  $('step-choices').querySelector('button')?.focus();
}
function selectNode(id,defaultOverview=DATA.nodes.length?'info':'help'){
  closeStepChoices();
  $('previous-step').disabled=true;$('next-step').disabled=true;
  if(!id||!byId.has(id)){
    selected=null;activeTab='fields';overviewTab=defaultOverview;fieldMode='all';changesMode='all';
    $('detail-search').value='';$('selected-icon').innerHTML='';
    uiBind($('selected-name'), 'textContent', () => ui('ステップを選択してください'));$('selected-summary').textContent='';
    uiBind($('tab-settings'), 'textContent', () => ui('設定'));
    highlightGraph();renderDetail();return;
  }
  selected=id;fieldMode='all';changesMode='all';$('detail-search').value='';
  const n=byId.get(id);activeTab=n.kind==='input'?'fields':['output','join','pivot'].includes(n.kind)?'settings':'actions';
  $('previous-step').disabled=!adjacentSteps('upstream').length;$('next-step').disabled=!adjacentSteps('downstream').length;
  $('selected-icon').innerHTML=icon(n.kind,n.color,'',pivotDirection(n),nodeJoinType(n));uiBind($('selected-name'),'textContent',()=>n.name);
  uiBind($('selected-summary'),'textContent',()=>ui(n.kindLabel)+(n.description?' · '+n.description:''));
  uiBind($('tab-settings'), 'textContent', () => ({input:ui('設定・接続'),join:ui('結合設定'),union:ui('ユニオン設定'),aggregate:ui('集計設定'),pivot:ui('ピボット設定'),output:ui('出力設定')})[n.kind]||ui('設定'));
  highlightGraph();renderDetail();
}
function warningHtml(n){return n.warnings.length?ui`<details class="warning"><summary>ⓘ フィールド復元の注記 (${n.warnings.length})</summary><ul>${n.warnings.map(w=>`<li>${esc(uiMessage(w))}</li>`).join('')}</ul></details>`:'';}
const CHANGE_SYMBOLS={AddColumn:'ƒx',QuickCalcColumn:'ƒx',RemoveColumns:'⊠',RenameColumn:'✎',ChangeColumnType:'Ab',RangeFilter:'▼',Filter:'▼',Remap:'⇄',Aggregate:'Σ',SimpleJoin:'⋈',SimpleUnion:'⊞',Unpivot:'↳'};
function actionIcon(type,size=17){
  const spec=ANNOTATIONS.find(item=>item.types.includes(type));
  return spec?`<img class="action-icon" src="${PREP_ICONS.annotations[spec.key]}" width="${size}" height="${size}" alt="">`:esc(CHANGE_SYMBOLS[type]||'•');
}
function syntax(expr){return tokenizeFormula(expr).map(t=>t.kind==='plain'?esc(t.text):`<span class="${t.kind}">${esc(t.text)}</span>`).join('');}
function expressionHtml(expr,origin=null){return ui`<div class="formula-wrap"><button class="formula-unfold" title="計算式を展開" aria-label="計算式を展開" aria-expanded="false" hidden><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 7 6 6 6-6"/></svg></button><button class="formula-expand" data-formula="${esc(encodeURIComponent(expr))}" data-formula-origin="${esc(encodeURIComponent(JSON.stringify(origin)))}" title="計算式を拡大表示" aria-label="計算式を拡大表示" aria-haspopup="dialog"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11 3h6v6M17 3l-8 8M8 4H3v13h13v-5"/></svg></button><button class="copy-button" data-copy="${esc(encodeURIComponent(expr))}" title="計算式をコピー" aria-label="計算式をコピー"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 12H3V3h9v4M8 8h9v9H8z"/></svg></button><pre class="code"><span class="formula-preview-text">${syntax(expr)}</span></pre></div>`;}
function updateFormulaPreviews(){
  document.querySelectorAll('.changes-list .formula-wrap').forEach(wrap=>{
    const text=wrap.querySelector('.formula-preview-text'),button=wrap.querySelector('.formula-unfold');
    button.hidden=!wrap.classList.contains('full-formula')&&text.scrollHeight<=text.clientHeight+1;
  });
}
let formulaPopup={original:'',formatted:'',mode:'original'},formulaComposing=false;
const formulaDrafts=new Map();
function formulaPopupSyntax(source){
  const pairs=formulaBracketPairs(source);let offset=0;
  return tokenizeFormula(source).map(token=>{
    const start=offset;offset+=token.text.length;
    let text='',segment=0;
    for(let i=0;i<token.text.length;i++)if(pairs.has(start+i)){
      text+=esc(token.text.slice(segment,i))+ui`<span class="formula-bracket" data-bracket="${start+i}" data-match="${pairs.get(start+i)}" aria-label="${esc(token.text[i])}：対応する括弧を強調" aria-pressed="false">${esc(token.text[i])}</span>`;segment=i+1;
    }
    text+=esc(token.text.slice(segment));
    return token.kind==='plain'?text:`<span class="${token.kind}">${text}</span>`;
  }).join('');
}
function sizeFormulaPopup(){
  const dialog=$('formula-dialog');if(!dialog.open)return;
  const code=$('formula-full'),source=formulaPopup[formulaPopup.mode];
  const measure=document.createElement('canvas').getContext('2d');
  measure.font=getComputedStyle(code).font;
  const width=source.split(/\r?\n/).reduce((max,line)=>Math.max(max,measure.measureText(line.replace(/\t/g,'  ')).width),0);
  const maxWidth=Math.max(0,Math.min(1200,window.innerWidth-32));
  const headerHeight=document.querySelector('.app-header').getBoundingClientRect().height;
  document.documentElement.style.setProperty('--formula-header-height',headerHeight+'px');
  const maxHeight=Math.max(0,Math.min(850,window.innerHeight-headerHeight-32));
  dialog.style.width=Math.min(maxWidth,Math.max(formulaPopup.history?.started?580:420,Math.ceil(width)+62))+'px';
  // Measure the wrapped content at its final width before clamping the height.
  dialog.style.height='auto';code.style.flex='none';code.style.height='auto';
  const height=code.scrollHeight+dialog.querySelector('.formula-dialog-toolbar').getBoundingClientRect().height+$('formula-save-error').getBoundingClientRect().height+2;
  dialog.style.height=Math.min(maxHeight,Math.max(200,height))+'px';
  code.style.flex='1 1 auto';code.style.height='';
}
function renderFormulaPopup(){
  formulaPopup.original=formulaPopup.history.source;
  formulaPopup.formatted=formatFormula(formulaPopup.history.source);
  document.querySelectorAll('[data-formula-mode]').forEach(button=>{
    const active=button.dataset.formulaMode===formulaPopup.mode;
    button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
  });
  $('formula-full').innerHTML=formulaPopupSyntax(formulaPopup[formulaPopup.mode]);
  $('formula-full').scrollTop=0;updateFormulaEditButtons();sizeFormulaPopup();
}
function openFormulaPopup(source,origin){
  if(formulaPopup.key)formulaDrafts.delete(formulaPopup.key);
  formulaComposing=false;
  if(!origin){
    const candidates=DATA.nodes.flatMap(n=>n.actions.flatMap(a=>a.expressions.filter(e=>e.expression===source).map(e=>({stepId:n.id,actionId:a.id,field:e.field}))));
    if(candidates.length===1)origin=candidates[0];
  }
  const key=JSON.stringify([DATA.exportKey||DATA.name,origin||source]);
  const history=new FormulaEditHistory(source);formulaDrafts.set(key,history);
  formulaPopup={original:source,formatted:formatFormula(source),mode:'original',history,origin,key,saving:false};
  $('formula-save-error').hidden=true;configureFormulaEditor();
  renderFormulaPopup();if(!$('formula-dialog').open)$('formula-dialog').show();$('formula-backdrop').hidden=false;sizeFormulaPopup();$('formula-original-tab').focus();
}
function closeFormulaPopup(){
  if(flowEditBusy)return;
  // Drafts belong to the open editor only. Confirmed edits live in the flow history.
  if(formulaPopup.key)formulaDrafts.delete(formulaPopup.key);
  formulaPopup={original:'',formatted:'',mode:'original'};formulaComposing=false;
  $('formula-dialog').close();$('formula-backdrop').hidden=true;
  $('formula-full').textContent='';$('formula-save-error').hidden=true;
}
function configureFormulaEditor(){
  const editor=$('formula-full');
  editor.contentEditable=CAN_EDIT&&!flowEditBusy?'plaintext-only':'false';
  editor.setAttribute('role',CAN_EDIT?'textbox':'region');
  editor.setAttribute('aria-label',CAN_EDIT?ui('計算式を編集'):ui('計算式'));
  if(CAN_EDIT)editor.setAttribute('aria-multiline','true');else editor.removeAttribute('aria-multiline');
}
function updateFormulaEditButtons(){
  if(!CAN_EDIT)return;
  const history=formulaPopup.history;if(!history)return;
  $('save-formula').hidden=!history.dirty;
  $('save-formula').disabled=flowEditBusy||!SERVER.token||!formulaPopup.origin;
  $('save-formula').title=!SERVER.token?ui('ファイルに保存するにはローカルビューアーから開いてください'):!formulaPopup.origin?ui('この式の保存元を特定できません'):'';
  uiBind($('save-formula'), 'textContent', () => formulaPopup.saving?ui('確定中…'):ui('変更を確定'));
  $('close-formula').disabled=flowEditBusy;
  document.querySelectorAll('[data-formula-mode]').forEach(b=>b.disabled=flowEditBusy);
}
function formulaSelection(){
  const selection=window.getSelection(),editor=$('formula-full');
  if(!selection.rangeCount||!editor.contains(selection.anchorNode))return null;
  const range=selection.getRangeAt(0),before=range.cloneRange();before.selectNodeContents(editor);before.setEnd(range.startContainer,range.startOffset);
  return {start:before.toString().length,end:before.toString().length+range.toString().length};
}
function restoreFormulaSelection(selection){
  if(!selection)return;
  const editor=$('formula-full'),walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT),nodes=[];
  while(walker.nextNode())nodes.push(walker.currentNode);
  const point=offset=>{for(const node of nodes){if(offset<=node.length)return [node,offset];offset-=node.length;}return nodes.length?[nodes.at(-1),nodes.at(-1).length]:[editor,0];};
  const range=document.createRange();range.setStart(...point(selection.start));range.setEnd(...point(selection.end));
  const current=window.getSelection();current.removeAllRanges();current.addRange(range);
}
function recordFormulaInput(){
  if(!CAN_EDIT||!$('formula-dialog').open||!formulaPopup.history||formulaComposing||formulaPopup.saving)return;
  const editor=$('formula-full'),text=editor.innerText,selection=formulaSelection(),scroll=editor.scrollTop;
  if(text===formulaPopup[formulaPopup.mode])return;
  const baselineView=formulaPopup.mode==='formatted'?formatFormula(formulaPopup.history.baseline):formulaPopup.history.baseline;
  formulaPopup.history.push(text===baselineView?formulaPopup.history.baseline:text);
  formulaPopup.original=formulaPopup.history.source;formulaPopup.formatted=formulaPopup.mode==='formatted'?text:formatFormula(text);
  editor.innerHTML=formulaPopupSyntax(text);restoreFormulaSelection(selection);
  $('formula-save-error').hidden=true;updateFormulaEditButtons();sizeFormulaPopup();editor.scrollTop=scroll;
}
function moveFormulaHistory(direction){
  if(!CAN_EDIT||flowEditBusy)return;
  formulaPopup.history[direction]();renderFormulaPopup();$('formula-full').focus();
}
function updateFlowEditButtons(){
  if(!CAN_EDIT)return;
  const history=flowSession?.history;
  $('flow-edit-tools').hidden=false;
  $('undo-flow').disabled=flowEditBusy||!history?.canUndo;
  $('redo-flow').disabled=flowEditBusy||!history?.canRedo;
  $('save-flow').disabled=flowEditBusy||!history?.dirty;
  $('export-button').disabled=flowEditBusy||loadingFlow;
  $('recent-toggle').disabled=flowEditBusy||loadingFlow;
  $('open-button').disabled=flowEditBusy;
  if($('publish-button'))$('publish-button').disabled=flowEditBusy||loadingFlow;
  if($('run-button'))$('run-button').disabled=flowEditBusy||loadingFlow||!DATA.nodes.some(n=>n.kind==='output');
}
function setFlowEditBusy(busy){
  flowEditBusy=busy;configureFormulaEditor();
  updateFlowEditButtons();updateFormulaEditButtons();
}
async function requestFlowEdits(path,changes){
  let response;
  try{response=await uiFetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Viewer-Token':SERVER.token},body:JSON.stringify({exportKey:DATA.exportKey,revision:DATA.editRevision,changes})});}
  catch{throw new Error(ui('ローカルサーバーと通信できませんでした。編集内容は保持しています。画面を再読み込みせず、サーバーの起動状態を確認してください。'));}
  const result=await response.json();if(!response.ok)throw new Error(result.error||ui('変更を反映できませんでした。'));
  return result;
}
function applyEditedModel(result){
  const step=selected,tab=activeTab,mode=changesMode,scroll=$('detail-content').scrollTop;
  DATA=result;flowSession.model=DATA;byId=new Map(DATA.nodes.map(n=>[n.id,n]));
  selectNode(step);activeTab=tab;changesMode=mode;renderDetail();$('detail-content').scrollTop=scroll;
  renderGraph();highlightGraph();applyTransform();
  document.title=`${DATA.name} — PrepFlow Viewer`;
  $('file-name').textContent=DATA.name;$('file-name').title=DATA.name;syncRecentPicker();
}
async function confirmFormula(){
  if(!CAN_EDIT||flowEditBusy||!formulaPopup.history.dirty||!formulaPopup.origin)return;
  const source=$('formula-full').innerText,change={...formulaPopup.origin,before:formulaPopup.history.baseline,expression:source};
  formulaPopup.saving=true;setFlowEditBusy(true);$('formula-save-error').hidden=true;
  try{
    const result=await requestFlowEdits('/api/preview-edits',[...flowSession.history.changes,change]);
    flowSession.history.push(change);applyEditedModel(result);
    formulaPopup.history.reset(source);renderFormulaPopup();
    uiBind($('status-text'), 'textContent', () => ui('変更を確定しました · ファイルには未保存'));
  }catch(error){uiBind($('formula-save-error'), 'textContent', () => uiMessage(error.message));$('formula-save-error').hidden=false;sizeFormulaPopup();}
  finally{formulaPopup.saving=false;setFlowEditBusy(false);sizeFormulaPopup();}
}
async function moveFlowHistory(direction){
  if(!CAN_EDIT)return;
  const history=flowSession.history,undo=direction==='undo';
  if(flowEditBusy||!(undo?history.canUndo:history.canRedo))return;
  const index=history.index+(undo?-1:1),change=history.entries[undo?index:history.index];
  setFlowEditBusy(true);
  try{
    const result=await requestFlowEdits('/api/preview-edits',history.entries.slice(0,index));
    history.index=index;applyEditedModel(result);selectNode(change.stepId);activeTab='actions';renderDetail();
    if(change.kind==='output'){
      closeFormulaPopup();
      activeTab='settings';renderDetail();
      uiBind($('status-text'), 'textContent', () => undo?ui('出力先の変更を元に戻しました'):ui('出力先の変更をやり直しました'));
      return;
    }
    const origin={stepId:change.stepId,actionId:change.actionId,field:change.field};
    const key=JSON.stringify([DATA.exportKey||DATA.name,origin]);
    // Confirmed history is authoritative when returning to this formula.
    formulaDrafts.delete(key);openFormulaPopup(undo?change.before:change.expression,origin);
    uiBind($('status-text'), 'textContent', () => undo?ui('変更を元に戻しました'):ui('変更をやり直しました'));
  }catch(error){toast(error.message);}
  finally{setFlowEditBusy(false);}
}
async function saveFlow(){
  if(!CAN_EDIT||flowEditBusy||!flowSession.history.dirty)return;
  setFlowEditBusy(true);uiBind($('save-flow'), 'textContent', () => ui('保存先を選択中…'));
  try{
    const result=await requestFlowEdits('/api/save-flow',flowSession.history.changes);
    if(result.cancelled)return;
    flowSession.history.reset();applyEditedModel(result);refreshRecent();
    uiBind($('status-text'), 'textContent', () => ui`${DATA.name} を保存しました`);toast(ui`${DATA.name} を保存しました`);
  }catch(error){toast(error.message);}
  finally{uiBind($('save-flow'), 'textContent', () => ui('フローを保存'));setFlowEditBusy(false);}
}
function hoverFormulaBrackets(target){
  const editor=$('formula-full');
  const positions=target&&editor.contains(target)?[target.dataset.bracket,target.dataset.match]:[];
  editor.querySelectorAll('[data-bracket]').forEach(bracket=>{
    bracket.classList.toggle('hovered-bracket',positions.includes(bracket.dataset.bracket));
  });
}
function highlightFormulaBrackets(target){
  const positions=target&&!target.classList.contains('matched-bracket')?[target.dataset.bracket,target.dataset.match]:[];
  $('formula-full').querySelectorAll('[data-bracket]').forEach(bracket=>{
    const active=positions.includes(bracket.dataset.bracket);
    bracket.classList.toggle('matched-bracket',active);bracket.setAttribute('aria-pressed',String(active));
  });
}
function rawDetail(raw){return ui`<details class="raw-details"><summary>この処理の定義</summary><pre class="raw-pre">${esc(json(raw))}</pre></details>`;}
function fieldChanges(f){
  const unique=[...new Map((f.changes||[]).map(c=>[c.type,c])).values()];
  const isRemoval=c=>c.type==='RemoveColumn'||c.type==='RemoveColumns';
  if(f.deleted&&!unique.some(isRemoval))unique.push({type:'RemoveColumns',label:ui('削除')});
  return unique.map(c=>`<button class="change-icon ${isRemoval(c)?'removed':''}" data-action-id="${esc(c.actionId||'')}" title="${esc(ui(c.label))}" aria-label="${esc(f.name+': '+ui(c.label))}">${actionIcon(c.type,15)}${isRemoval(c)?ui('<span>削除</span>'):''}</button>`).join('');
}
function fieldDetailHtml(f){
  let html=keyValues({'データ型':(TYPE_NAMES[f.type]||f.type)+(f.typeSource!=='定義'?' ('+ui(f.typeSource)+')':''),'由来':f.origin,'状態':f.deleted?ui('このステップで削除'):ui('使用中')});
  if(f.expression)html+=expressionHtml(f.expression);
  if(f.expressionVariants?.some(v=>v.expression))html+=ui`<details class="raw-details"><summary>入力ごとの計算式</summary>${f.expressionVariants.map(v=>`<p class="field-origin">${esc(v.source)}</p>${v.expression?expressionHtml(v.expression):ui('<p>入力フィールドを継承</p>')}`).join('')}</details>`;
  if(f.changes?.length)html+=`<div class="field-changes">${f.changes.map(c=>`<button data-action-id="${esc(c.actionId)}">${actionIcon(c.type,15)} ${esc(ui(c.label))}${c.before?' : '+esc(c.before)+' → '+esc(c.after):''} ↗</button>`).join('')}</div>`;
  return html;
}
function renderFields(n,q){
  const inventory=n.fieldInventory||n.fields.map(f=>({...f,deleted:false}));
  const used=inventory.filter(f=>!f.deleted).length,deleted=inventory.length-used;
  const list=inventory.map((f,i)=>({f,i})).filter(({f})=>(fieldMode==='all'||(fieldMode==='used'?!f.deleted:f.deleted))&&textMatch(f.name+' '+f.type+' '+(f.expression||''),q));
  return ui`<div class="inventory-heading">含まれるフィールド: <strong>${inventory.length}</strong> のうち <strong>${used}</strong> を使用</div><div class="field-filters" aria-label="フィールドの表示対象">${[['all',ui('すべて'),inventory.length],['used',ui('使用中'),used],['deleted',ui('削除済み'),deleted]].map(([key,label,count])=>`<button data-field-mode="${key}" class="${key===fieldMode?'active':''}" aria-pressed="${key===fieldMode}">${label} <span>${count}</span></button>`).join('')}</div>${warningHtml(n)}<table class="field-table"><thead><tr><th>型</th><th>フィールド名</th><th>変更</th></tr></thead><tbody>${list.map(({f,i})=>ui`<tr class="${f.deleted?'deleted-row':''}"><td><span class="type-symbol" title="${esc((TYPE_NAMES[f.type]||f.type)+' / '+ui(f.typeSource))}">${esc(TYPE_SYMBOL[f.type]||'?')}</span></td><td><button class="field-name" data-field="${i}" aria-expanded="false" title="フィールドの詳細">${esc(f.name)}</button>${f.namespace&&f.namespace!=='Default'?`<span class="namespace">${esc(NS_NAMES[f.namespace]||f.namespace)}</span>`:''}</td><td><div class="change-icons">${fieldChanges(f)}</div></td></tr>`).join('')}</tbody></table>${list.length?'':ui('<div class="empty-note">該当するフィールドはありません。</div>')}`;
}
function changeCategory(action){
  if(ANNOTATIONS.find(spec=>spec.key==='filter').types.includes(action.type))return 'filters';
  if(action.type!=='ChangeColumnType'&&action.expressions?.length)return 'formulas';
  return 'other';
}
function renderDetail(){
  const hasSelection=byId.has(selected),content=$('detail-content');
  document.querySelector('.detail-tabs:not(.overview-tabs)').hidden=!hasSelection;
  $('overview-tabs').hidden=hasSelection;
  document.querySelector('.detail-section').setAttribute('aria-label',hasSelection?ui('ステップの詳細'):ui('フロー全体の情報'));
  document.querySelector('.detail-heading').hidden=!hasSelection;
  content.classList.toggle('flow-overview',!hasSelection);
  content.setAttribute('role','tabpanel');
  if(!hasSelection){
    document.querySelector('.detail-search').hidden=true;
    document.querySelectorAll('[data-overview-tab]').forEach(button=>{const on=button.dataset.overviewTab===overviewTab;button.classList.toggle('active',on);button.setAttribute('aria-selected',String(on));button.tabIndex=on?0:-1;});
    content.setAttribute('aria-labelledby','overview-'+overviewTab);
    if(overviewTab==='info')renderFlowInfo(content);
    else if(overviewTab==='connections')content.innerHTML=connectionsHtml();
    else content.innerHTML=overviewHelpHtml();
    content.scrollTop=0;return;
  }
  document.querySelectorAll('[data-tab]').forEach(b=>{const on=b.dataset.tab===activeTab;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;});
  $('detail-content').setAttribute('aria-labelledby','tab-'+activeTab);
  document.querySelector('.detail-search').hidden=!selected||activeTab==='settings';
  $('detail-search').placeholder=activeTab==='fields'?ui('フィールドを検索'):ui('変更内容・計算式を検索');
  const n=byId.get(selected),q=$('detail-search').value.trim();
  if(!n){$('detail-content').innerHTML=`<div class="empty-note">${DATA.nodes.length?ui('フローマップからステップを選択してください。'):ui('フローを開いて、ステップを選択してください。')}</div>`;return;}
  if(activeTab==='fields')$('detail-content').innerHTML=renderFields(n,q);
  else if(activeTab==='actions'){
    const counts={all:n.actions.length,formulas:0,filters:0,other:0};
    n.actions.forEach(a=>counts[changeCategory(a)]++);
    if(!counts[changesMode])changesMode='all';
    const tabs=[['all',ui('すべて')],['formulas',ui('計算式')],['filters',ui('フィルター')],['other',ui('その他')]].filter(([mode])=>counts[mode]);
    const list=n.actions.map((a,i)=>({a,i})).filter(({a})=>(changesMode==='all'||changeCategory(a)===changesMode)&&textMatch(json(a),q));
    $('detail-content').innerHTML=ui`<div class="changes-toolbar"><span>変更内容 <strong>${n.actions.length}</strong> 件</span>${tabs.length?ui`<div class="change-filters" role="group" aria-label="変更内容の種類">${tabs.map(([mode,label])=>`<button data-changes-mode="${mode}" class="${changesMode===mode?'active':''}" aria-pressed="${changesMode===mode}">${label}${mode==='all'?'':' '+counts[mode]}</button>`).join('')}</div>`:''}</div><div class="changes-list">${list.map(({a,i})=>actionHtml(a,i)).join('')}</div>${list.length?'':ui('<div class="empty-note">該当する変更内容はありません。</div>')}`;
  }else $('detail-content').innerHTML=settingsHtml(n);
  $('detail-content').scrollTop=0;
  requestAnimationFrame(updateFormulaPreviews);
}
function actionHtml(a,index){
  if(a.type==='SimpleUnion')return unionHtml(a.raw,byId.get(selected));
  const n=a.raw;let body='';
  const heading=({AddColumn:ui('計算フィールド'),RenameColumn:ui('フィールド名を変更'),RemoveColumn:ui('フィールドを削除'),RemoveColumns:ui('フィールドを削除')})[a.type]||ui(a.label);
  const chips=values=>`<div class="field-chips">${values.map(v=>`<span class="chip">${esc(v)}</span>`).join('')}</div>`;
  if(a.type==='SimpleJoin'){
    body=ui`<p class="change-context">${esc(JOIN_TYPE_LABELS[n.joinType]||n.joinType||ui('不明'))}結合 · 条件 ${(n.conditions||[]).length} 件</p>`;
  }else if(a.pivot){
    const p=a.pivot;
    const sources=new Set(p.groups.flatMap(g=>g.columns.flatMap(c=>c.fields.map(f=>f.name))));
    const outputs=new Set(p.groups.flatMap(g=>[g.name,...g.columns.map(c=>c.name)]).filter(Boolean));
    const summary=p.direction==='columnsToRows'?ui`対象 ${sources.size} フィールド · 出力 ${outputs.size} フィールド`:
      `${p.pivotField.name} → ${p.newColumns.length?p.newColumns.length+ui(' 列'):ui('列名未保存')} · ${p.aggregation||ui('未設定')}(${p.valueField.name})`;
    body=`<p class="change-context">${esc(summary)}</p>`;
  }else if(a.type==='ChangeColumnType'){
    const changes=a.typeChanges||Object.entries(n.fields||{}).map(([field,v])=>({field,before:'unknown',after:v.type||'unknown'}));
    body=changes.map(c=>chips([c.field])+`<p class="change-context">${esc(TYPE_NAMES[c.before]||c.before)} → <strong>${esc(TYPE_NAMES[c.after]||c.after)}</strong></p>`).join('');
  }else if(a.expressions.length){body=a.expressions.map(e=>`${e.field&&e.field!=='条件式'?chips([e.field]):e.references?.length?chips(e.references):''}${expressionHtml(e.expression,{stepId:selected,actionId:a.id,field:e.field})}`).join('');}
  else if(a.type==='RemoveColumn'){body=chips(n.columnName?[n.columnName]:[]);}
  else if(a.type==='RemoveColumns'){body=chips(n.columnNames||[]);}
  else if(a.type==='RenameColumn'){body=chips([n.rename])+`<p class="change-context">${esc(n.columnName)} → <strong>${esc(n.rename)}</strong></p>`;}
  else if(a.type==='MergeColumns'){body=chips(n.mergeColumnsList||[])+ui`<p class="change-context">統合先: <strong>${esc(n.mergedColumnName||ui('未設定'))}</strong></p>`;}
  else if(['RangeFilter','ValueFilter'].includes(a.type)){body=filterDisplayRows(n,a.type).map(row=>chips([row.field])+`<p class="change-context filter-context">${esc(row.summary)}</p>`).join('');}
  else if(a.type==='Remap'){body=chips([n.columnName])+ui`<table class="small-table"><thead><tr><th>元の値</th><th>置換後</th></tr></thead><tbody>${Object.entries(n.values||{}).map(([to,from])=>`<tr><td>${esc(Array.isArray(from)?from.join(' / '):json(from))}</td><td>${esc(to)}</td></tr>`).join('')}</tbody></table>`;}
  else if(a.type==='SimpleUnion')body=unionHtml(n,byId.get(selected));
  else if(a.type==='Aggregate')body=aggregateHtml(n);
  const phase=a.phase==='処理前'||a.phase==='処理後'?ui(a.phase)+(a.namespace!=='Default'?' · '+(NS_NAMES[a.namespace]||a.namespace):''):'';
  const symbol=actionIcon(a.type);
  return `<article class="change-entry" id="action-${index}" data-action="${esc(a.id)}"><div class="change-symbol" title="${esc(ui(a.label))}">${symbol}</div><div class="change-main"><div class="change-heading"><h3>${esc(heading)}</h3>${phase?`<span class="phase-badge">${esc(phase)}</span>`:''}<span class="change-order">${index+1}</span></div>${n.description?`<div class="action-comment">${esc(n.description)}</div>`:''}${body}</div></article>`;
}
const JOIN_TYPE_LABELS=uiLabels({inner:'内部',left:'左',right:'右',full:'完全外部',leftOnly:'左のみ',rightOnly:'右のみ',notInner:'内部を除外'});
function joinHtml(n,node=byId.get(selected)){
  const inputs=DATA.edges.filter(e=>e.target===node?.id);
  const left=byId.get(inputs.find(e=>e.namespace==='Left')?.source),right=byId.get(inputs.find(e=>e.namespace==='Right')?.source);
  const lc=left?.color||'#8395a0',rc=right?.color||'#8395a0',ln=left?.name||ui('左入力'),rn=right?.name||ui('右入力');
  const field=value=>/^\[[^\]]+\]$/.test(value||'')?value.slice(1,-1):value;
  const comparator=value=>({'==':'=','!=':'≠','<>':'≠','>=':'≥','<=':'≤'})[value]||value;
  const type=n.joinType,label=JOIN_TYPE_LABELS[type]||type||ui('不明'),clip='join-left-'+String(n.id||'settings').replace(/[^a-zA-Z0-9_-]/g,'');
  const regions=joinRegions(type),fill='#c8cdd0',leftFill=regions.left?fill:'white',rightFill=regions.right?fill:'white';
  const intersection=regions.overlap?fill:'white';
  const diagram=`<svg class="join-venn" viewBox="0 0 78 48" role="img" aria-label="${esc(ui('結合タイプ: ')+label)}"><defs><clipPath id="${clip}"><circle cx="29" cy="24" r="19"/></clipPath></defs><circle cx="29" cy="24" r="19" fill="${leftFill}"/><circle cx="49" cy="24" r="19" fill="${rightFill}"/><circle cx="49" cy="24" r="19" fill="${intersection}" clip-path="url(#${clip})"/><circle cx="29" cy="24" r="19" fill="none" stroke="${lc}" stroke-width="1.5"/><circle cx="49" cy="24" r="19" fill="none" stroke="${rc}" stroke-width="1.5"/></svg>`;
  return ui`<section class="join-settings" style="--join-left:${lc};--join-right:${rc}"><h3>適用した結合句</h3><table class="join-clauses"><thead><tr><th scope="col" class="join-left"><span>左</span>${esc(ln)}</th><th scope="col" class="join-comparator"><span class="sr-only">条件</span></th><th scope="col" class="join-right"><span>右</span>${esc(rn)}</th></tr></thead><tbody>${(n.conditions||[]).map(c=>`<tr><td class="join-left">${esc(field(c.leftExpression))}</td><td class="join-comparator">${esc(comparator(c.comparator))}</td><td class="join-right">${esc(field(c.rightExpression))}</td></tr>`).join('')}</tbody></table>${n.conditions?.length?'':ui('<p class="change-context">結合条件は保存されていません。</p>')}<h3 class="join-type-heading">結合タイプ: ${esc(label)}</h3><div class="join-type-preview"><span class="join-source-label" style="--source-color:${lc}">${esc(ln)}</span>${diagram}<span class="join-source-label" style="--source-color:${rc}">${esc(rn)}</span></div></section>`;
}
function aggregateHtml(n){return ui`<table class="small-table"><thead><tr><th>フィールド</th><th>役割 / 集計方法</th><th>出力フィールド</th></tr></thead><tbody>${[...(n.groupByFields||[]).map(x=>({...x,role:ui('グループ化')})),...(n.aggregateFields||[]).map(x=>({...x,role:x.function}))].map(x=>`<tr><td>${esc(x.columnName)}</td><td><span class="badge changed">${esc(x.role)}</span></td><td>${esc(x.newColumnName||x.columnName)}</td></tr>`).join('')}</tbody></table>`;}
function pivotHtml(pivot,node){
  if(!pivot)return ui('<p class="change-context">ピボット設定は保存されていません。</p>');
  const field=f=>`<span class="pivot-field"><span class="type-symbol" title="${esc(TYPE_NAMES[f.type]||ui('不明'))}">${esc(TYPE_SYMBOL[f.type]||'?')}</span><span>${esc(f.name)}</span></span>`;
  const patterns={'Contains':ui('を含む'),'Starts with':ui('で始まる'),'Ends with':ui('で終わる'),'Regular Expression':ui('（正規表現）'),'Date':ui('（日付）')};
  const retained=ui`<section class="pivot-retained"><h3>フィールド</h3>${pivot.retained.length?`<ul>${pivot.retained.map(f=>`<li>${field(f)}</li>`).join('')}</ul>`:ui('<p class="change-context">なし</p>')}</section>`;
  let content='';
  if(pivot.direction==='columnsToRows'){
    content=pivot.groups.map(group=>{
      const length=Math.max(group.values.length,...group.columns.map(c=>c.fields.length));
      return `<table class="pivot-columns"><thead><tr><th scope="col">${esc(group.name)}</th>${group.columns.map(c=>`<th scope="col">${esc(c.name)}${c.pattern?`<span class="pivot-pattern">「${esc(c.pattern.expression)}」${esc(patterns[c.pattern.type]||c.pattern.type)}</span>`:''}</th>`).join('')}</tr></thead><tbody>${Array.from({length},(_,i)=>`<tr><td>${esc(group.values[i]??'')}</td>${group.columns.map(c=>`<td>${c.fields[i]?field(c.fields[i]):'—'}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }).join('');
  }else{
    content=ui`<div class="pivot-row-field"><h4>${esc(pivot.pivotField.name)}</h4><ul>${pivot.newColumns.map(name=>`<li>${esc(name)}</li>`).join('')}</ul></div><section class="pivot-aggregate"><h3>新しい列の集計フィールド</h3><div><span class="pivot-aggregation">${esc(pivot.aggregation||ui('未設定'))}</span>${field(pivot.valueField)}</div></section>`;
  }
  return ui`<section class="pivot-settings" aria-label="ピボット設定" style="--pivot-color:${esc(node?.color||'#499893')}">${retained}<section class="pivot-transformed"><div class="pivot-section-heading"><h3>ピボットされたフィールド</h3><span class="pivot-direction">${pivot.direction==='columnsToRows'?ui('列から行'):ui('行から列')}</span></div>${content}</section>${pivot.notes.map(note=>`<p class="change-context">${esc(uiMessage(note))}</p>`).join('')}</section>`;
}
function unionHtml(n,node){
  const inputs=[...new Set(DATA.edges.filter(e=>e.target===node?.id).map(e=>e.source))].map(id=>byId.get(id)).filter(Boolean);
  return ui`<section class="union-inputs" aria-label="ユニオンの入力"><h3>入力</h3><ul>${inputs.map(input=>`<li><span class="union-input-color" style="background:${esc(input.color)}" aria-hidden="true"></span><span>${esc(input.name)}</span></li>`).join('')}</ul></section>`;
}
function keyValues(object){return `<dl class="kv">${Object.entries(object).filter(([,v])=>v!==null&&v!==undefined).map(([k,v])=>`<dt>${esc(ui(k))}</dt><dd>${esc(typeof v==='object'?json(v):v)}</dd>`).join('')}</dl>`;}
function outputSettingsHtml(n){
  const r=n.raw,type=(n.nodeType||'').split('.').pop();
  const formats={WriteToHyper:ui('Tableau データ抽出 (.hyper)'),WriteToCsv:'CSV (.csv)',WriteToExcel:'Microsoft Excel (.xlsx)',WriteToJson:'JSON (.json)',WriteToDatabase:ui('データベース'),PublishExtract:ui('パブリッシュされたデータソース')};
  const path=r.hyperOutputFile||r.csvOutputFile||r.excelOutputFile||r.jsonOutputFile||r.outputFile||'';
  const split=Math.max(path.lastIndexOf('/'),path.lastIndexOf('\\'));
  const filename=path.slice(split+1),folder=split<0?'':path.slice(0,split+1).replace(/([^:])[\\/]$/,'$1');
  const fileType=['WriteToHyper','WriteToCsv','WriteToExcel','WriteToJson'].includes(type);
  const row=(label,value)=>`<div class="output-row"><dt>${esc(label)}</dt><dd>${esc(value||ui('未設定'))}</dd></div>`;
  const props=Object.values(n.properties||{}).find(p=>p?.nodePropertyType==='.v2020_2_1.OutputRefreshOptions')||{};
  const defaults={WriteToHyper:'Create',WriteToCsv:'Create',WriteToJson:'Create',PublishExtract:'Create',WriteToDatabase:'Append',WriteToExcel:'Append'};
  const mode=props.outputOperationType||(defaults[type]?'outputOperationType'+defaults[type]:'');
  const modeLabels={outputOperationTypeCreate:ui('テーブルの作成'),outputOperationTypeAppend:ui('テーブルに追加'),outputOperationTypeTruncate:ui('データの置換'),outputOperationTypeUpsert:ui('データの更新と挿入')};
  let fields=row(ui('出力の保存先'),fileType||path?ui('ファイル'):type==='WriteToDatabase'?ui('データベース'):type==='PublishExtract'?ui('パブリッシュされたデータソース'):ui('保存先の情報なし'));
  if(type==='PublishExtract'){
    const connection=connectionInfo(n.connection);
    const text=value=>typeof value==='string'?value.trim():'';
    const server=text(r.serverUrl)||connection.server;
    const project=text(r.projectName)||connection.project;
    const siteKeys=['siteName','siteContentUrl','siteUrl'];
    const site=siteKeys.map(key=>text(r[key])).find(Boolean)||(siteKeys.some(key=>r[key]==='')?'Default':connection.site);
    fields+=row(ui('サーバー'),server||ui('フローに情報なし'));
    if(site)fields+=row(ui('サイト'),site);
    fields+=row(ui('プロジェクト'),project||ui('フローに情報なし'));
  }
  fields+=row(ui('名前'),filename?filename.replace(/\.(hyper|csv|xlsx|json)$/i,''):r.attributes?.tablename||r.datasourceName||n.name);
  if(fileType||path)fields+=row(ui('場所'),folder);
  fields+=row(ui('出力タイプ'),formats[type]||type||ui('不明'));
  let options=row(ui('完全更新'),modeLabels[mode]||mode||ui('設定情報なし'));
  if(props.incrementalOutputOperationType)options+=row(ui('増分更新'),modeLabels[props.incrementalOutputOperationType]||props.incrementalOutputOperationType);
  if(props.isIncrementalDefault)options+=row(ui('既定の更新方法'),ui('増分更新'));
  const edit=typeof CAN_EDIT!=='undefined'&&CAN_EDIT&&['WriteToHyper','WriteToCsv','WriteToExcel','PublishExtract'].includes(type)?ui`<button class="button" data-edit-output="${esc(n.id)}">出力先を編集</button>`:'';
  return ui`<section class="output-settings" aria-label="出力設定">${edit}<dl>${fields}</dl><h3>書き込みオプション</h3><dl>${options}</dl></section>`;
}
function settingsHtml(n){
  if(n.kind==='output')return outputSettingsHtml(n);
  if(n.kind==='join')return joinHtml(n.raw.actionNode||n.raw,n);
  if(n.kind==='union')return unionHtml(n.raw.actionNode||n.raw,n);
  if(n.kind==='pivot')return pivotHtml(n.actions.find(a=>a.pivot)?.pivot,n);
  let out='';const r=n.raw,action=r.actionNode;
  if(n.kind==='input'){
    const info=connectionInfo(n.connection,n);
    out=ui`<div class="settings-grid"><div class="settings-card"><h3>${info.tableau?'Tableau Server':ui('入力と接続')}</h3><div class="card-content">${info.tableau?tableauConnectionHtml(info):keyValues({'接続名':n.connection.name,'接続形式':n.connection.connectionAttributes?.class,'同梱データ':n.connection.isPackaged?ui('あり'):ui('なし / 不明'),'テーブル':r.relation?.table,'ファイル':n.connection.connectionAttributes?.filename,'入力の種類':n.nodeType})}</div></div><div class="settings-card"><h3>読み取り設定</h3><div class="card-content">${keyValues({'文字コード':r.charSet,'区切り文字':r.separator,'ロケール':r.locale,'ヘッダー':r.containsHeaders,'ファイルパターン':r.filePattern,'サブフォルダも対象':r.includeSubDirectory,'データ行数':ui('取得しません')})}</div></div></div>`;
    if(r.generatedInputs?.length)out+=ui`<div class="settings-card"><h3>ワイルドカード入力 · ${r.generatedInputs.length} ファイル</h3><div class="card-content">${r.generatedInputs.map(x=>`<p>${esc(x.filePath||x.inputNode?.name)}</p>`).join('')}</div></div>`;
    const extra={...r};['fields','actions','generatedInputs','nextNodes'].forEach(k=>delete extra[k]);out+=ui`<div class="settings-card"><h3>接続情報</h3><div class="card-content"><pre class="raw-pre">${esc(json(n.connection.connectionAttributes||n.connection))}</pre></div></div>`+rawDetail(extra);
  }else if(action){
    const content=n.kind==='join'?joinHtml(action):n.kind==='aggregate'?aggregateHtml(action):n.kind==='union'?unionHtml(action,n):n.kind==='pivot'?pivotHtml(action):rawDetail(action);
    const inputs=DATA.edges.filter(e=>e.target===n.id);
    out=ui`<div class="settings-card"><h3>${esc(ui(n.kindLabel))}の設定</h3><div class="card-content">${inputs.length>1?`<div class="field-chips">${inputs.map(e=>`<span class="chip">${esc(NS_NAMES[e.namespace]||ui('入力'))} : ${esc(byId.get(e.source)?.name)}</span>`).join('')}</div>`:''}${content}</div></div>${rawDetail(action)}`;
  }else out=ui`<div class="settings-card"><h3>クリーニングの概要</h3><div class="card-content">${keyValues({'ステップ名':n.name,'加工数':n.actions.length,'計算式数':n.calculations.length,'説明':n.description||ui('説明は保存されていません'),'加工内容':ui('「変更内容」タブで実行順に確認できます。')})}</div></div>`;
  return out + ui`<details class="raw-details"><summary>ステップの元の定義</summary><pre class="raw-pre">${esc(json(n.raw))}</pre></details><details class="raw-details"><summary>配置・色の定義</summary><pre class="raw-pre">${esc(json(n.display))}</pre></details>`;
}
function formatFileSize(bytes){
  if(!Number.isFinite(bytes)||bytes<0)return '—';
  if(bytes<1024)return ui`${Math.floor(bytes)} バイト`;
  const units=['B','KB','MB','GB','TB'];let index=1,value=bytes/1024;
  // Match Windows size formatting: three displayed digits, truncating the rest.
  while(value>=1000&&index<units.length-1){value/=1024;index++;}
  const digits=value<10?2:value<100?1:0,factor=10**digits;
  return `${(Math.floor(value*factor)/factor).toLocaleString(uiLanguage,{minimumFractionDigits:digits,maximumFractionDigits:digits})} ${units[index]}`;
}
function connectionInfo(connection={},node){
  // Connection-level server details and step-level data source details are stored separately.
  // Normalize before merging so projectName on a step overrides projectname on a connection.
  const attrs={};
  for(const source of [connection.connectionAttributes,node?.connection?.connectionAttributes,node?.raw?.connectionAttributes]){
    for(const [key,value] of Object.entries(source||{}))attrs[key.toLowerCase()]=value;
  }
  const value=(...keys)=>{for(const key of keys){const v=attrs[key];if(v!==undefined&&v!==null&&String(v).trim())return String(v);}return '';};
  const type=value('class')||connection.connectionType||ui('不明');
  const server=value('server','serverurl','serveraddress','hostname','host'),file=value('filename');
  const datasource=value('datasourcename'),project=value('projectname');
  const tableau=/tableau|sqlproxy/i.test(type)||!!datasource&&!!project;
  const siteKeys=['sitename','site','sitecontenturl','siteid'];
  const site=value(...siteKeys)||(siteKeys.some(key=>attrs[key]==='')?'Default':'');
  const ownerValue=attrs.datasourceownername??attrs.ownername??attrs.datasourceowner??attrs.owner;
  const owner=typeof ownerValue==='object'&&ownerValue?String(ownerValue.displayName||ownerValue.name||''):String(ownerValue??'');
  return {type,label:tableau?'Tableau Server':type,tableau,server,file,datasource,project,
    site,owner,port:value('port'),database:value('dbname','database'),name:connection.name||''};
}
function connectionGroups(model){
  const connections=(model.connections||[]).map((connection,index)=>({connection,key:connection.id||`connection-${index}`,nodes:[]}));
  for(const node of model.nodes||[]){
    if(node.kind!=='input')continue;
    const id=node.raw?.connectionId||node.connection?.id;
    let entry=connections.find(item=>id&&item.key===id);
    if(!entry){entry={connection:node.connection||{},key:id||`step-${node.id}`,nodes:[]};connections.push(entry);}
    entry.nodes.push(node);
  }
  const groups=new Map();
  for(const entry of connections){
    const info=connectionInfo(entry.connection,entry.nodes[0]);
    let address=info.server.trim().replace(/\/+$/,'');
    if(address){
      try{const url=new URL(address.includes('://')?address:`https://${address}`);address=url.host.toLowerCase();}
      catch{address=address.toLowerCase();}
    }
    const file=info.file.replace(/\\/g,'/');
    const key=address?JSON.stringify(['server',info.tableau?'tableau':info.type,address,info.port]):file?JSON.stringify(['file',/^(?:[a-z]:|\/\/)/i.test(file)?file.toLowerCase():file]):JSON.stringify(['connection',entry.key]);
    if(!groups.has(key))groups.set(key,{info,title:info.server||info.file||info.name||ui('接続元の情報なし'),entries:[],steps:0});
    const group=groups.get(key);group.entries.push({...entry,info});group.steps+=entry.nodes.length;
  }
  return [...groups.values()];
}
function connectionFields(info,node){
  if(info.tableau)return {'サーバー':info.server||ui('フローに情報なし'),'プロジェクト名':info.project||ui('フローに情報なし'),'データソース名':info.datasource||ui('フローに情報なし')};
  return {'データソース名':info.datasource||null,'プロジェクト名':info.project||null,
    'データベース':info.database||null,'テーブル':node?.raw?.relation?.table||node?.raw?.attributes?.tablename||null};
}
function tableauConnectionHtml(info){return `<div class="tableau-connection">${keyValues(connectionFields(info))}</div>`;}
function connectionsHtml(){
  const groups=connectionGroups(DATA);
  if(!groups.length)return ui('<p class="overview-note">接続情報はありません。</p>');
  return ui`<p class="overview-note">接続元を開くと、使用している入力ステップを確認できます。</p>${groups.map(group=>ui`<details class="connection-group"><summary><span class="connection-source"><strong>${esc(group.title)}</strong><small>${esc(group.info.label)} · 入力ステップ ${group.steps} 件</small></span></summary><div class="connection-steps">${group.entries.map(entry=>entry.nodes.length?entry.nodes.map(node=>ui`<section class="connection-step"><h3>${esc(node.name)}</h3>${keyValues(connectionFields(connectionInfo(entry.connection,node),node))}<button class="button" data-connection-step="${esc(node.id)}">ステップの接続設定を表示</button></section>`).join(''):ui`<section class="connection-step"><h3>${esc(entry.info.name||ui('接続定義'))}</h3>${keyValues(connectionFields(entry.info))}<p class="overview-note">使用している入力ステップはありません。</p></section>`).join('')}</div></details>`).join('')}`;
}
function overviewHelpHtml(){
  return ui`<div class="overview-help"><h3>フローを見る</h3><ul><li>ステップをクリックすると詳細を表示します。同じステップをもう一度押すか、マップの空白を押すとフロー情報へ戻ります。</li><li>ホイールで拡大・縮小、ドラッグで移動できます。</li><li>空白のダブルクリック、または上部の全体表示アイコンで、フロー全体を表示します。</li><li>全体表示中は右ペインの幅に合わせて自動調整します。手動で拡大・移動した後は倍率と位置を維持します。</li></ul><h3>処理・計算式を確認する</h3><ul><li>「フィールド一覧」「変更内容」「設定」を切り替えて確認します。検索でフィールドや加工を絞り込めます。</li><li>計算式は拡大表示で「原文」と「自動整形」を切り替えられます。コピーや対応する括弧の強調も使えます。</li></ul>${CAN_EDIT?ui('<h3>編集・保存・共有する</h3><ul><li>計算式を編集したら「変更を確定」。この段階ではViewer内だけに反映します。</li><li>上部のUndo / Redoで確定した変更を戻せます。ダウンロードアイコンの「フローを保存」でTFL / TFLXへ保存します。</li><li>「HTMLを保存」で対応言語を選び、「単一保存」または「一括保存」タブから書き出します。</li><li>上部のパブリッシュアイコンからTableau Serverへ公開できます。PC上のフロー保存とは別の操作です。</li><li>出力ステップの「出力先を編集」から、ファイル形式・名前・保存先、またはTableau Serverへの出力に変更できます。Serverは既定サイトのプロジェクトを認証して確認します。書き込みオプションは変更できません。×で閉じると未確定の変更を破棄します。</li><li>三角の実行アイコンから、出力名・保存先を確認して個別実行・すべて実行できます。実行にはTableau Prep Builderが必要で、出力先の実データを更新します。進捗は実行ログで確認できます。</li></ul>'):ui('<h3>このHTMLについて</h3><p>閲覧専用です。計算式の編集・フローの保存・ServerへのパブリッシュはViewer本体で行います。</p>')}<p class="overview-note">データソースには接続せず、フローに保存された定義を表示しています。</p></div>`;
}
function renderFlowInfo(container){
  const source=DATA.sourcePath||'',folder=source.slice(0,Math.max(source.lastIndexOf('/'),source.lastIndexOf('\\'))+1);
  container.innerHTML=ui`<div class="meta-stats">${[[ui('ステップ'),DATA.stats.steps],[ui('加工'),DATA.stats.actions],[ui('計算式'),DATA.stats.calculations]].map(([label,value])=>`<div class="meta-stat"><strong>${value||0}</strong><span>${label}</span></div>`).join('')}</div>${keyValues({'ファイル':DATA.name,'保存場所':CAN_EDIT?(folder||ui('未確定（フローを保存すると表示されます）')):null,'ファイルサイズ':formatFileSize(DATA.fileSizeBytes),'定義の解析時間':DATA.stats.parseMs+' ms','保存座標':DATA.stats.savedPositions+ui(' ステップ'),'フロー形式バージョン':DATA.formatVersion,'解析':ui('Python / 接続・実データの読込なし')})}<p>flow の処理定義と displaySettings の配置・色を表示しています。フィールド一覧は静的に復元したもので、実行結果ではありません。推定箇所や未対応の加工は各ステップに注記します。</p>${DATA.warnings.map(w=>`<p class="warning">${esc(uiMessage(w))}</p>`).join('')}<details class="raw-details"><summary>パッケージ内のファイル一覧（データは未読込）</summary><pre class="raw-pre">${esc(DATA.entries.map(e=>`${e.name}  (${e.bytes.toLocaleString()} bytes)`).join('\n'))}</pre></details><details class="raw-details"><summary>パラメーター</summary><pre class="raw-pre">${esc(json(DATA.parameters))}</pre></details><details class="raw-details"><summary>maestroMetadata</summary><pre class="raw-pre">${esc(json(DATA.metadata))}</pre></details>`;
  if(folder&&SERVER.token){
    const cell=container.querySelector('.kv dd:nth-of-type(2)'),button=document.createElement('button');
    cell.classList.add('flow-location');button.className='button folder-open';button.id='open-source-folder-panel';uiBind(button, 'textContent', () => ui('保存場所を開く'));
    button.onclick=async()=>{
      button.disabled=true;
      cell.querySelector('.folder-error')?.remove();
      try{
        const response=await uiFetch('/api/open-folder',{method:'POST',headers:{'Content-Type':'application/json','X-Viewer-Token':SERVER.token},body:JSON.stringify({exportKey:DATA.exportKey})});
        const result=await response.json();if(!response.ok)throw new Error(result.error||ui('保存場所を開けませんでした。'));
      }catch(error){const message=document.createElement('p');message.className='folder-error';message.setAttribute('role','alert');uiBind(message, 'textContent', () => uiMessage(error.message));cell.append(message);}
      finally{button.disabled=false;}
    };
    cell.append(button);
  }
}
async function copyText(text){
  try{await navigator.clipboard.writeText(text);toast(ui('コピーしました'));}
  catch{const t=document.createElement('textarea');t.value=text;document.body.append(t);t.select();const ok=document.execCommand('copy');t.remove();toast(ok?ui('コピーしました'):ui('コピーできませんでした。テキストを選択してコピーしてください。'));}
}
function syncRecentPicker(){
  $('recent-picker').hidden=!CAN_EDIT;$('file-name').hidden=CAN_EDIT;
  if(!CAN_EDIT)return;
  uiBind($('recent-name'), 'textContent', () => DATA.nodes.length?DATA.name:ui('フローを開いてください'));
  $('recent-path').textContent=DATA.sourcePath||'';
  $('recent-toggle').title=DATA.sourcePath||DATA.name;
  $('recent-menu').innerHTML=recentFiles.length?recentFiles.map(f=>`<button role="menuitem" data-recent-id="${esc(f.id)}" title="${esc(f.path)}"${f.id===DATA.recentId?' aria-current="true"':''}><span class="recent-item-name">${esc(f.name)}</span><span class="recent-path">${esc(f.path)}</span></button>`).join(''):ui('<p class="recent-empty">最近開いたフローはありません</p>');
}
function closeRecent(restore=false){$('recent-menu').hidden=true;$('recent-toggle').setAttribute('aria-expanded','false');if(restore)$('recent-toggle').focus();}
async function openRecent(){
  if(loadingFlow||flowEditBusy)return;
  if(!$('recent-menu').hidden){closeRecent();return;}
  await refreshRecent();
  $('recent-menu').hidden=false;$('recent-toggle').setAttribute('aria-expanded','true');
  $('recent-menu').querySelector('button')?.focus();
}
function showFileError(message){uiBind($('file-error-message'), 'textContent', () => uiMessage(message));if(!$('file-error-dialog').open)$('file-error-dialog').showModal();}
async function refreshRecent(){
  if(!SERVER.token)return;
  try{
    const response=await uiFetch('/api/recent',{headers:{'X-Viewer-Token':SERVER.token}});
    const result=await response.json();if(!response.ok)throw new Error(result.error);
    recentFiles=result.recent;syncRecentPicker();
  }catch{toast(ui('最近のフローを取得できませんでした。サーバーの起動状態を確認してください。'));}
}
function beginFlowLoad(){
  if(loadingFlow||flowEditBusy)return false;
  closeRecent();loadingFlow=true;$('busy-overlay').hidden=false;updateFlowEditButtons();return true;
}
function endFlowLoad(){loadingFlow=false;$('busy-overlay').hidden=true;updateFlowEditButtons();syncRecentPicker();refreshRecent();}
async function loadRecent(id){
  if(!id||!SERVER.token||!beginFlowLoad())return;
  try{
    const cached=[...flowSessions.values()].find(s=>s.model.recentId===id&&s.history.started);
    const response=await uiFetch('/api/recent/open',{method:'POST',headers:{'Content-Type':'application/json','X-Viewer-Token':SERVER.token},body:JSON.stringify({id})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||ui('フローを読み込めませんでした。'));
    init(cached?.model||result);toast(ui`${DATA.name} に切り替えました`);
  }catch(error){showFileError(error.message||ui('切り替えに失敗しました。'));}
  finally{endFlowLoad();}
}
async function loadFile(file){
  if(!file)return;
  if(!SERVER.token){toast(ui('別のフローは「start_viewer.cmd」から開いてください。'));return;}
  if(!/\.(tflx|tfl)$/i.test(file.name)){toast(ui('.tflx または .tfl ファイルを選択してください。'));return;}
  if(!beginFlowLoad())return;
  try{
    const res=await uiFetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Viewer-Token':SERVER.token,'X-File-Name':encodeURIComponent(file.name)},body:file});
    const data=await res.json();if(!res.ok)throw new Error(data.error||ui('ファイルを読み込めませんでした。'));
    init(data);toast(ui`${file.name} を読み込みました`);
  }catch(e){toast(e.message||ui('読み込みに失敗しました。'));}
  finally{endFlowLoad();$('file-input').value='';}
}
function beginNativeFlowDrop(){
  dropDepth=0;$('drop-overlay').hidden=true;
  if($('batch-dialog')?.open)return false;
  return CAN_EDIT&&beginFlowLoad();
}
function finishNativeFlowDrop(model,error){
  try{
    if(error){showFileError(error);return;}
    init(model);toast(ui`${model.name} を読み込みました`);
  }finally{endFlowLoad();}
}
function handleFileDrop(e){
  e.preventDefault();dropDepth=0;$('drop-overlay').hidden=true;
  // The desktop event supplies the original path on the Python side.
  if(!nativeDropReady)loadFile(e.dataTransfer.files[0]);
}
async function openFlowFile(){
  if(!SERVER.token||!beginFlowLoad())return;
  try{
    const response=await uiFetch('/api/open',{method:'POST',headers:{'Content-Type':'application/json','X-Viewer-Token':SERVER.token},body:'{}'});
    const result=await response.json();if(!response.ok)throw new Error(result.error||ui('フローを開けませんでした。'));
    if(!result.cancelled)init(result);
  }catch(error){toast(error.message);}
  finally{endFlowLoad();}
}
function publishLog(message,level='info'){
  const line=document.createElement('div');line.className=level;
  const time=new Date().toLocaleTimeString(); uiBind(line, 'textContent', () => `${time}  ${uiMessage(message)}`);
  $('publish-log').append(line);$('publish-log').scrollTop=$('publish-log').scrollHeight;
}
async function openPublish(){
  if(!CAN_EDIT||flowEditBusy||loadingFlow)return;
  if([...formulaDrafts.values()].some(d=>d.dirty)){toast(ui('編集中の計算式を「変更を確定」してから開いてください。'));return;}
  $('publish-log').replaceChildren();$('publish-form').reset();
  $('publish-name').value=(DATA.name||'').replace(/\.(tflx|tfl)$/i,'');
  $('publish-dialog').showModal();setPublishBusy(true);
  try{
    const response=await uiFetch('/api/publish/defaults',{method:'POST',headers:{'Content-Type':'application/json','X-Viewer-Token':SERVER.token},body:JSON.stringify({exportKey:DATA.exportKey})});
    const defaults=await response.json();if(!response.ok)throw new Error(defaults.error);
    for(const [id,key] of [['publish-server','server_url'],['publish-token-name','token_name'],['publish-token-value','token_value'],['publish-name','name'],['publish-project','project']])$(id).value=defaults[key]||'';
  }catch(error){publishLog(error.message,'error');}
  finally{setPublishBusy(false);}
}
function setPublishBusy(busy){
  publishBusy=busy;setFlowEditBusy(busy);
  $('publish-form').querySelectorAll('input,button').forEach(control=>control.disabled=busy);
  $('start-publish').disabled=busy||!DATA.exportKey;
  $('close-publish').disabled=busy;
}
async function executePublish(publish){
  if(publishBusy||!CAN_EDIT)return;
  if(!$('publish-form').reportValidity())return;
  if(publish&&(!$('publish-name').value.trim()||!$('publish-project').value.trim())){publishLog(ui('パブリッシュ名とパブリッシュ先を入力してください。'),'error');return;}
  const payload={server_url:$('publish-server').value,token_name:$('publish-token-name').value,token_value:$('publish-token-value').value,name:$('publish-name').value,project:$('publish-project').value,exportKey:DATA.exportKey,revision:DATA.editRevision,changes:flowSession?.history.changes||[]};
  setPublishBusy(true);publishLog(publish?ui('パブリッシュを開始します。'):ui('認証テストを開始します。'));
  let finished=false;
  try{
    const response=await uiFetch(publish?'/api/publish/start':'/api/publish/test-auth',{method:'POST',headers:{'Content-Type':'application/json','X-Viewer-Token':SERVER.token},body:JSON.stringify(payload)});
    if(!response.ok){const result=await response.json();throw new Error(result.error||ui('処理を開始できませんでした。'));}
    const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
    const receive=line=>{if(!line.trim())return;const event=JSON.parse(line);if(event.message)publishLog(event.message,event.level);if(event.done)finished=true;};
    while(true){const {value,done}=await reader.read();pending+=decoder.decode(value,{stream:!done});let end;while((end=pending.indexOf('\n'))>=0){receive(pending.slice(0,end));pending=pending.slice(end+1);}if(done)break;}
    if(pending)receive(pending);
    if(!finished)throw new Error(ui('通信が途切れました。公開結果をサーバーで確認してください。'));
  }catch(error){publishLog(error.message,'error');}
  finally{setPublishBusy(false);}
}
async function exportHtml(){
  if(!CAN_EDIT||flowEditBusy||loadingFlow||batchIsBusy()||!htmlExportState.source||!htmlExportState.languages.length)return;
  const source=htmlExportState.source;
  const payload={htmlOptions:htmlExportOptions(),...(source.sourceId?{sourceId:source.sourceId}:{exportKey:source.exportKey})};
  htmlExportState.busy=true;renderHtmlExport();setFlowEditBusy(true);
  $('html-single-error').hidden=true;
  uiBind($('html-single-status'), 'textContent', () => ui('保存先を選択中…'));
  try{
    const response=await uiFetch('/api/save-html',{method:'POST',headers:{'Content-Type':'application/json','X-Viewer-Token':SERVER.token},body:JSON.stringify(payload)});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||ui('HTMLを保存できませんでした。'));
    uiBind($('html-single-status'), 'textContent', () => result.cancelled?'':ui`${result.name} を保存しました`);
    if(!result.cancelled)toast(ui`${result.name} を保存しました`);
  }catch(error){$('html-single-status').textContent='';uiBind($('html-single-error'),'textContent',()=>uiMessage(error.message));$('html-single-error').hidden=false;}
  finally{htmlExportState.busy=false;setFlowEditBusy(false);renderHtmlExport();}
}


document.addEventListener('click',e=>{
  const overview=e.target.closest('[data-overview-tab]');if(overview){overviewTab=overview.dataset.overviewTab;renderDetail();return;}
  const connectionStep=e.target.closest('[data-connection-step]');if(connectionStep){selectNode(connectionStep.dataset.connectionStep);activeTab='settings';renderDetail();return;}
  const unfold=e.target.closest('.formula-unfold');if(unfold){const wrap=unfold.closest('.formula-wrap'),expanded=wrap.classList.toggle('full-formula');unfold.setAttribute('aria-expanded',String(expanded));unfold.title=expanded?ui('計算式を折りたたむ'):ui('計算式を展開');unfold.setAttribute('aria-label',unfold.title);updateFormulaPreviews();return;}
  const formula=e.target.closest('[data-formula]');if(formula){openFormulaPopup(decodeURIComponent(formula.dataset.formula),JSON.parse(decodeURIComponent(formula.dataset.formulaOrigin||'null')));return;}
  const formulaTab=e.target.closest('[data-formula-mode]');if(formulaTab){formulaPopup.mode=formulaTab.dataset.formulaMode;renderFormulaPopup();return;}
  const bracket=e.target.closest('[data-bracket]');if(bracket){highlightFormulaBrackets(bracket);return;}
  highlightFormulaBrackets(null);
  const select=e.target.closest('[data-select]');if(select){const trigger=document.querySelector('.step-arrow[aria-expanded="true"]');selectNode(select.dataset.select);if(trigger&&!trigger.disabled)trigger.focus();return;}
  if(!e.target.closest('.step-navigation'))closeStepChoices();
  const tab=e.target.closest('[data-tab]');if(tab){activeTab=tab.dataset.tab;$('detail-search').value='';renderDetail();return;}
  const mode=e.target.closest('[data-field-mode]');if(mode){fieldMode=mode.dataset.fieldMode;renderDetail();return;}
  const changes=e.target.closest('[data-changes-mode]');if(changes){changesMode=changes.dataset.changesMode;renderDetail();return;}
  const copy=e.target.closest('[data-copy]');if(copy){copyText(decodeURIComponent(copy.dataset.copy));return;}
  const action=e.target.closest('[data-action-id]');if(action){activeTab='actions';changesMode='all';$('detail-search').value='';renderDetail();const target=[...document.querySelectorAll('[data-action]')].find(a=>a.dataset.action===action.dataset.actionId);target?.scrollIntoView({block:'center'});target?.classList.add('flash');return;}
  const field=e.target.closest('[data-field]');if(field){const row=field.closest('tr'),expanded=field.getAttribute('aria-expanded')==='true';field.setAttribute('aria-expanded',String(!expanded));if(expanded){row.nextElementSibling?.remove();return;}const n=byId.get(selected),f=(n.fieldInventory||n.fields)[Number(field.dataset.field)],detail=document.createElement('tr');detail.className='field-detail-row';detail.innerHTML=`<td colspan="3">${fieldDetailHtml(f)}</td>`;row.after(detail);}
});
function handleGraphClick(e){
  if(dragState?.moved)return;
  const comment=e.target.closest('[data-comment-toggle]');if(comment){toggleStepComment(comment.dataset.commentToggle);return;}
  const n=e.target.closest('[data-id]');
  if(n)selectNode(n.dataset.id===selected?null:n.dataset.id);
  else if(!e.target.closest('.flow-edge,.step-comment'))selectNode(null);
}
$('flow-svg').addEventListener('click',handleGraphClick);
$('flow-svg').addEventListener('keydown',e=>{if(!['Enter',' '].includes(e.key))return;const comment=e.target.closest('[data-comment-toggle]');if(comment){e.preventDefault();toggleStepComment(comment.dataset.commentToggle);return;}const n=e.target.closest('[data-id]');if(n){e.preventDefault();selectNode(n.dataset.id===selected?null:n.dataset.id);}});
document.querySelector('.detail-tabs:not(.overview-tabs)').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...document.querySelectorAll('[data-tab]')],i=tabs.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3;activeTab=tabs[next].dataset.tab;tabs[next].focus();renderDetail();});
$('detail-search').addEventListener('input',renderDetail);
$('overview-tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...document.querySelectorAll('[data-overview-tab]')],i=tabs.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length;overviewTab=tabs[next].dataset.overviewTab;renderDetail();tabs[next].focus();});
$('fit-button').onclick=fit;
$('close-formula').onclick=closeFormulaPopup;
$('formula-backdrop').onclick=closeFormulaPopup;
$('copy-formula').onclick=()=>copyText($('formula-full').innerText);
$('formula-full').onpointerover=e=>hoverFormulaBrackets(e.target.closest?.('[data-bracket]'));
$('formula-full').onpointerout=e=>hoverFormulaBrackets(e.relatedTarget?.closest?.('[data-bracket]'));
if(CAN_EDIT){
  setupDownloadMenu();
  setupFlowRun();
  setupOutputEditor();
  $('publish-button').hidden=false;$('publish-button').onclick=openPublish;
  $('close-publish').onclick=()=>{if(!publishBusy){$('publish-dialog').close();$('publish-token-value').value='';}};
  $('publish-dialog').addEventListener('cancel',e=>{if(publishBusy)e.preventDefault();else $('publish-token-value').value='';});
  $('test-publish-auth').onclick=()=>executePublish(false);
  $('publish-form').onsubmit=e=>{e.preventDefault();executePublish(true);};
  $('undo-flow').onclick=()=>moveFlowHistory('undo');$('redo-flow').onclick=()=>moveFlowHistory('redo');$('save-formula').onclick=confirmFormula;$('save-flow').onclick=saveFlow;
}else{
  $('publish-button')?.remove();$('publish-dialog')?.remove();
  $('run-dialog')?.remove();$('run-progress-dialog')?.remove();
  $('output-dialog')?.remove();
  $('flow-edit-tools')?.remove();$('save-formula')?.remove();
}
$('formula-dialog').addEventListener('cancel',e=>{e.preventDefault();closeFormulaPopup();});
$('formula-dialog').addEventListener('click',e=>{if(e.target!==e.currentTarget||formulaPopup.saving)return;const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeFormulaPopup();});
if(CAN_EDIT){
$('formula-full').addEventListener('compositionstart',()=>formulaComposing=true);
$('formula-full').addEventListener('compositionend',()=>{formulaComposing=false;recordFormulaInput();});
$('formula-full').addEventListener('input',recordFormulaInput);
$('formula-full').addEventListener('paste',e=>{e.preventDefault();document.execCommand('insertText',false,e.clipboardData.getData('text/plain'));});
$('formula-full').addEventListener('beforeinput',e=>{if(['historyUndo','historyRedo'].includes(e.inputType)){e.preventDefault();moveFormulaHistory(e.inputType==='historyUndo'?'undo':'redo');}});
$('formula-full').addEventListener('keydown',e=>{
  if(formulaComposing)return;
  if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();moveFormulaHistory(e.key.toLowerCase()==='y'||e.shiftKey?'redo':'undo');}
  else if(e.key==='Tab'){e.preventDefault();document.execCommand('insertText',false,'  ');}
  else if(e.key==='Enter'){e.preventDefault();document.execCommand('insertText',false,'\n');}
});
}
document.querySelector('.formula-tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();formulaPopup.mode=e.key==='Home'?'original':e.key==='End'?'formatted':formulaPopup.mode==='original'?'formatted':'original';renderFormulaPopup();$(`formula-${formulaPopup.mode}-tab`).focus();});
$('previous-step').onclick=()=>navigateStep('upstream');$('next-step').onclick=()=>navigateStep('downstream');
$('step-choices').addEventListener('keydown',e=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();const items=[...$('step-choices').querySelectorAll('button')],i=items.indexOf(document.activeElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();});
document.querySelector('.step-navigation').addEventListener('focusout',e=>{if(!e.currentTarget.contains(e.relatedTarget))closeStepChoices();});
$('open-button').onclick=openFlowFile;$('empty-open').onclick=openFlowFile;
$('file-input').onchange=e=>loadFile(e.target.files[0]);
$('recent-toggle').onclick=openRecent;
$('recent-menu').onclick=e=>{const item=e.target.closest('[data-recent-id]');if(item)loadRecent(item.dataset.recentId);};
$('recent-picker').addEventListener('keydown',e=>{
  if(e.key==='Escape'){e.preventDefault();closeRecent(true);return;}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
  e.preventDefault();if($('recent-menu').hidden){openRecent();return;}
  const items=[...$('recent-menu').querySelectorAll('button')],i=items.indexOf(document.activeElement);
  items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();
});
$('recent-picker').addEventListener('focusout',e=>{if(!e.currentTarget.contains(e.relatedTarget))closeRecent();});
document.addEventListener('click',e=>{if(!e.target.closest('#recent-picker'))closeRecent();});
$('close-file-error').onclick=$('file-error-ok').onclick=()=>$('file-error-dialog').close();
window.addEventListener('focus',()=>{if(!loadingFlow&&$('recent-menu').hidden)refreshRecent();});
$('flow-svg').addEventListener('dblclick',e=>{if(!e.target.closest('[data-id],[data-comment-toggle]'))fit();});
$('flow-svg').addEventListener('wheel',e=>{e.preventDefault();const r=$('graph').getBoundingClientRect();zoom(Math.exp(-e.deltaY*.00075),e.clientX-r.left,e.clientY-r.top);},{passive:false});
$('flow-svg').addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('[data-comment-toggle]'))return;dragState={x:e.clientX,y:e.clientY,ox:offset.x,oy:offset.y,moved:false};if(!e.target.closest('[data-id]'))$('flow-svg').setPointerCapture(e.pointerId);});
$('flow-svg').addEventListener('pointermove',e=>{if(!dragState||!(e.buttons&1))return;const dx=e.clientX-dragState.x,dy=e.clientY-dragState.y;if(Math.abs(dx)+Math.abs(dy)>4)dragState.moved=true;if(dragState.moved){autoFit=false;offset={x:dragState.ox+dx,y:dragState.oy+dy};$('flow-svg').classList.add('dragging');applyTransform();}});
window.addEventListener('pointerup',()=>{$('flow-svg').classList.remove('dragging');setTimeout(()=>dragState=null,0);});
let splitDragging=false;
function resizePanel(width){const total=document.querySelector('.workspace').clientWidth;document.documentElement.style.setProperty('--detail-width',Math.max(320,Math.min(total-200,width))+'px');if(autoFit)fit();}
$('splitter').addEventListener('pointerdown',e=>{splitDragging=true;$('splitter').setPointerCapture(e.pointerId);});
$('splitter').addEventListener('pointermove',e=>{if(splitDragging)resizePanel(document.querySelector('.workspace').getBoundingClientRect().right-e.clientX);});
$('splitter').addEventListener('pointerup',()=>splitDragging=false);
$('splitter').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();resizePanel(document.querySelector('.detail-section').clientWidth+(e.key==='ArrowLeft'?25:-25));});
document.addEventListener('keydown',e=>{if(e.key==='/'&&selected&&!document.querySelector('dialog[open]')&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)&&activeTab!=='settings'){e.preventDefault();$('detail-search').focus();}if(e.key==='Escape'){closeStepChoices(true);$('drop-overlay').hidden=true;dropDepth=0;}});
document.addEventListener('dragenter',e=>{if([...e.dataTransfer.types].includes('Files')){e.preventDefault();dropDepth++;$('drop-overlay').hidden=false;}});
document.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('Files'))e.preventDefault();});
document.addEventListener('dragleave',e=>{if([...e.dataTransfer.types].includes('Files')){dropDepth--;if(dropDepth<=0)$('drop-overlay').hidden=true;}});
document.addEventListener('drop',handleFileDrop);
window.addEventListener('resize',()=>{if(autoFit)fit();});
window.addEventListener('resize',sizeFormulaPopup);
new ResizeObserver(()=>requestAnimationFrame(updateFormulaPreviews)).observe(document.querySelector('.detail-section'));
function viewerCloseState(){return {language:uiLanguage,dirty:CAN_EDIT&&([...formulaDrafts.values()].some(d=>d.dirty)||[...flowSessions.values()].some(s=>s.history.dirty)||(typeof outputDraftDirty==='function'&&outputDraftDirty())),busy:flowEditBusy||loadingFlow||(typeof batchIsBusy==='function'&&batchIsBusy())};}
window.addEventListener('beforeunload',e=>{if(viewerCloseState().dirty||viewerCloseState().busy){e.preventDefault();e.returnValue='';}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('formula-dialog').open){e.preventDefault();closeFormulaPopup();}});
init(DATA,{restored:!!SERVER.restoredFlow});
if(DATA.openingError)showFileError(DATA.openingError);
refreshRecent();

setupLanguageMenu();
document.addEventListener('viewer-language-change',()=>{
  // Rerender views only; session history, graph position and all form drafts survive.
  const scroll=$('detail-content').scrollTop;
  renderGraph(); applyTransform(); renderDetail(); syncRecentPicker();
  $('detail-content').scrollTop=scroll;
  if(CAN_EDIT){renderRun();renderBatch();if(outputEditor){renderOutputEditor();syncOutputDropdowns();}}
});
