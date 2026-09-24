/* Lexical scanner: preserve exact text and distinguish comments from strings. */
function tokenizeFormula(source) {
  const text = String(source ?? ''), tokens = [];
  const keywords = new Set('IF THEN ELSEIF ELSE END CASE WHEN AND OR NOT TRUE FALSE NULL IN IS AS'.split(' '));
  let i = 0;
  const push = (kind, end) => {tokens.push({kind, text:text.slice(i,end)});i=end;};
  while(i < text.length) {
    if(text.startsWith('//',i)) {let end=text.indexOf('\n',i);push('comment',end<0?text.length:end);continue;}
    if(text.startsWith('/*',i)) {let end=text.indexOf('*/',i+2);push('comment',end<0?text.length:end+2);continue;}
    const ch=text[i];
    if(ch==='"'||ch==="'") {
      let end=i+1;
      while(end<text.length) {if(text[end]==='\\'){end=Math.min(text.length,end+2);continue;}if(text[end]===ch){if(text[end+1]===ch){end+=2;continue;}end++;break;}end++;}
      push('str',end);continue;
    }
    if(ch==='[') {
      let end=i+1;while(end<text.length){if(text[end]===']'){if(text[end+1]===']'){end+=2;continue;}end++;break;}end++;}
      push('ref',end);continue;
    }
    if(ch==='#') {const end=text.indexOf('#',i+1);if(end>=0){push('date',end+1);continue;}}
    const number=text.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if(number){push('num',i+number[0].length);continue;}
    const word=text.slice(i).match(/^[\p{L}_][\p{L}\p{N}_]*/u);
    if(word){const end=i+word[0].length;push(keywords.has(word[0].toUpperCase())?'kw':/^\s*\(/.test(text.slice(end))?'fn':'plain',end);continue;}
    push(/[+*/%=<>!^-]/.test(ch)?'op':'plain',i+1);
  }
  return tokens;
}
if(typeof module!=='undefined' && module.exports) module.exports={tokenizeFormula};
