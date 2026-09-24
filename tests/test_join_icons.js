const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../web/viewer.js'),'utf8');
function definition(name){
  const start=source.indexOf(`function ${name}(`),end=source.indexOf('\nfunction ',start+1);
  assert.ok(start>=0);return source.slice(start,end<0?undefined:end);
}
const context=vm.createContext({});
vm.runInContext(['joinRegions','nodeJoinType','icon'].map(definition).join('\n'),context);
const cases={inner:[false,false,true],left:[true,false,true],right:[false,true,true],full:[true,true,true],
  leftOnly:[true,false,false],rightOnly:[false,true,false],notInner:[true,true,false],unknown:[false,false,false]};
for(const [type,expected] of Object.entries(cases)){
  const svg=context.icon('join','#123456','','',type);
  for(const [i,part] of ['left','right','overlap'].entries()){
    const tag=svg.match(new RegExp(`<[^>]+data-join-region="${part}"[^>]+>`))[0];
    assert.match(tag,new RegExp(`fill="${expected[i]?'#123456':'white'}"`),`${type}/${part}`);
  }
  assert.ok(!svg.includes('clipPath'),'no duplicate SVG IDs across nodes');
}
assert.equal(context.nodeJoinType({raw:{actionNode:{joinType:'inner'}}}),'inner');
assert.equal(context.nodeJoinType({raw:{joinType:'left'}}),'left');
assert.equal(context.nodeJoinType({actions:[{type:'SimpleJoin',raw:{joinType:'full'}}]}),'full');
assert.equal(context.nodeJoinType({}),'');
console.log('Join icons: seven join regions, unknown types and source shapes passed.');
