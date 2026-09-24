// Keep the serialized literals intact: null and the string "null" differ.
function filterValueText(value){
  if(value===null)return 'null';
  if(value==='')return '""';
  return typeof value==='object'?JSON.stringify(value):String(value);
}
function filterRangeText(range){
  const lo=range.startValue,hi=range.endValue;
  if(lo===null&&hi===null)return 'null';
  if(lo!=null&&lo===hi&&range.includeStart&&range.includeEnd)return filterValueText(lo);
  return [lo!=null?(range.includeStart?'≥ ':'> ')+filterValueText(lo):'',hi!=null?(range.includeEnd?'≤ ':'< ')+filterValueText(hi):''].filter(Boolean).join(' かつ ')||'範囲指定なし';
}
function filterDisplayRows(raw,type){
  const label=raw.exclude?'除外':'保持';
  const source=type==='RangeFilter'?raw.ranges:raw.values;
  return Object.entries(source||{}).map(([field,values])=>({field,summary:label+'：'+values.map(type==='RangeFilter'?filterRangeText:filterValueText).join('、')}));
}
if(typeof module!=='undefined')module.exports={filterValueText,filterRangeText,filterDisplayRows};
