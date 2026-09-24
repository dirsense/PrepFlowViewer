/* Display-only formatting. Never rewrite a literal, reference, or comment. */
function formatFormula(source, maxWidth=100) {
  const original=String(source??'');
  const scan=typeof module!=='undefined'&&module.exports?require('./formula.js').tokenizeFormula:tokenizeFormula;
  const lexical=scan(original), tokens=[];
  for(let i=0;i<lexical.length;i++){
    const token=lexical[i];
    if(/^\s+$/.test(token.text)&&token.kind==='plain')continue;
    const next=lexical[i+1];
    if(token.kind==='op'&&next?.kind==='op'&&['<=','>=','!=','==','<>','&&','||'].includes(token.text+next.text)){
      tokens.push({...token,text:token.text+next.text});i++;
    }else tokens.push({...token});
  }
  const pairs=new Map(), stack=[];
  for(let i=0;i<tokens.length;i++){
    const t=tokens[i];
    if(t.kind!=='plain')continue;
    if(['(','{'].includes(t.text))stack.push(i);
    if([')','}'].includes(t.text)){
      const start=stack.pop();
      if(start===undefined||tokens[start].text!==({')':'(','}':'{'})[t.text])return original;
      pairs.set(start,i);
    }
  }
  if(stack.length)return original;
  // Incomplete edits are more useful verbatim than with guessed block boundaries.
  let blocks=0;
  for(const t of tokens){
    if(t.kind==='kw'&&['IF','CASE'].includes(t.text.toUpperCase()))blocks++;
    if(t.kind==='kw'&&t.text.toUpperCase()==='END'&&--blocks<0)return original;
  }
  if(blocks)return original;
  let output='',column=0,indent=0,pendingSpace=false,lineStart=true,lineIndent=null;
  const groups=[], controls=[];
  const space=()=>{if(!lineStart)pendingSpace=true;};
  const emit=text=>{
    if(lineStart){const pad='  '.repeat(Math.min(40,lineIndent??indent));output+=pad;column=pad.length;lineStart=false;lineIndent=null;}
    if(pendingSpace){output+=' ';column++;pendingSpace=false;}
    output+=text;
    const parts=text.split('\n');column=parts.length>1?parts.at(-1).length:column+text.length;
    if(text.endsWith('\n'))lineStart=true;
  };
  const newline=(hanging=null)=>{
    pendingSpace=false;
    if(output&&!output.endsWith('\n'))output+='\n';
    lineStart=true;column=0;lineIndent=hanging;
  };
  const word=t=>t&&(['ref','str','date','num','fn','kw'].includes(t.kind)||/^[\p{L}_]/u.test(t.text));
  const operand=t=>word(t)||[')',']','}'].includes(t?.text);
  for(let i=0;i<tokens.length;i++){
    const t=tokens[i],prev=tokens[i-1],next=tokens[i+1],value=t.text,upper=value.toUpperCase();
    if(t.kind==='comment'){
      space();emit(value);
      if(value.startsWith('//')||value.includes('\n'))newline();else space();
      continue;
    }
    if(t.kind==='kw'&&['IF','CASE'].includes(upper)){
      if(operand(prev))space();
      controls.push({indent});emit(value);space();continue;
    }
    if(t.kind==='kw'&&['THEN','ELSE','ELSEIF','WHEN','END'].includes(upper)){
      const control=controls.at(-1);
      if(!control)return original;
      if(upper==='THEN'){space();emit(value);indent=control.indent+1;newline();}
      else if(upper==='END'){indent=control.indent;newline();emit(value);controls.pop();}
      else{
        indent=control.indent;newline();emit(value);
        if(upper==='ELSE'){indent++;newline();}else space();
      }
      continue;
    }
    if(t.kind==='plain'&&pairs.has(i)){
      const end=pairs.get(i),inside=tokens.slice(i+1,end);
      const length=inside.reduce((sum,x)=>sum+x.text.length+1,0);
      const multiline=!(value==='{'&&next?.text==='{')&&(inside.some(x=>x.kind==='comment'||(x.kind==='kw'&&['IF','CASE'].includes(x.text.toUpperCase())))||column+length+2>maxWidth);
      if(value==='{'&&operand(prev))space();
      if(value==='('&&prev?.kind==='kw')space();
      emit(value);groups.push({end,indent,multiline,open:value});
      if(multiline){indent++;newline();}else if(value==='{'&&next?.text!=='{')space();
      continue;
    }
    if(t.kind==='plain'&&[')', '}'].includes(value)){
      const group=groups.pop();
      if(group?.multiline){indent=group.indent;newline();}
      else {pendingSpace=false;if(value==='}'&&prev?.text!=='{'&&prev?.text!=='}')space();}
      emit(value);continue;
    }
    if(value===','&&t.kind==='plain'){
      pendingSpace=false;emit(value);
      if(groups.at(-1)?.multiline||column>maxWidth-20)newline();else space();
      continue;
    }
    if(value===':'&&t.kind==='plain'){
      pendingSpace=false;emit(value);
      if(groups.at(-1)?.multiline)newline();else space();
      continue;
    }
    if(t.kind==='op'||(t.kind==='kw'&&['AND','OR','IN','IS','AS'].includes(upper))){
      const unary=['-','+'].includes(value)&&(!prev||prev.kind==='op'||['(',',',':','THEN','ELSE','AND','OR','NOT'].includes(prev.text.toUpperCase()));
      if(!unary){
        if(column+value.length+(next?.text.length||0)+2>maxWidth)newline(indent+1);
        else space();
      }
      else if(prev?.kind==='op')space();
      emit(value);if(!unary)space();continue;
    }
    if(word(t)&&operand(prev))space();
    emit(value);
  }
  const result=output.replace(/\n+$/,'');
  // Guard every formatting rule with lexical equivalence, including comment boundaries.
  const significant=text=>scan(text).filter(t=>!(t.kind==='plain'&&/^\s+$/.test(t.text))).map(t=>[t.kind,t.text]);
  return JSON.stringify(significant(original))===JSON.stringify(significant(result))?result:original;
}
function formulaBracketPairs(source){
  const scan=typeof module!=='undefined'&&module.exports?require('./formula.js').tokenizeFormula:tokenizeFormula;
  const pairs=new Map(),stack=[];
  let offset=0;
  for(const token of scan(source)){
    if(token.kind==='ref'&&token.text.startsWith('[')&&token.text.endsWith(']')){
      pairs.set(offset,offset+token.text.length-1);pairs.set(offset+token.text.length-1,offset);
    }else if(token.kind==='plain'){
      for(let i=0;i<token.text.length;i++){
        const ch=token.text[i],position=offset+i;
        if(ch==='('||ch==='{')stack.push({ch,position});
        else if(ch===')'||ch==='}'){
          const open=stack.at(-1);
          if(open?.ch===({')':'(','}':'{'})[ch]){
            stack.pop();pairs.set(open.position,position);pairs.set(position,open.position);
          }else stack.length=0;
        }
      }
    }
    offset+=token.text.length;
  }
  return pairs;
}
if(typeof module!=='undefined'&&module.exports)module.exports={formatFormula,formulaBracketPairs};
