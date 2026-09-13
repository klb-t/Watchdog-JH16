import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareJson, SourceHistoryProfileSchema } from '../../shared/source_history';
import { loadSourceHistoryProfile } from '../../backend/watchdog_api/config/source_history';

const limits = {changes:100,nodes:1000,depth:20};
test('source comparison distinguishes missing, null, zero, exact decimal text and escaped JSON paths', () => {
  const before = {'a/b':{'~key':'1.00'},keep:0,missing:null,removed:'x',type:'0'};
  const after = {'a/b':{'~key':'1.0'},keep:0,added:null,type:0};
  const result = compareJson(before,after,limits);
  assert.equal(result.truncated,false);
  assert.deepEqual(result.changes,[
    {path:'/a~1b/~0key',kind:'changed',before:{present:true,value:'1.00'},after:{present:true,value:'1.0'}},
    {path:'/added',kind:'added',before:{present:false},after:{present:true,value:null}},
    {path:'/missing',kind:'removed',before:{present:true,value:null},after:{present:false}},
    {path:'/removed',kind:'removed',before:{present:true,value:'x'},after:{present:false}},
    {path:'/type',kind:'changed',before:{present:true,value:'0'},after:{present:true,value:0}},
  ]);
});
test('source comparison is key-order invariant but treats arrays positionally and preserves hostile-looking keys as data', () => {
  assert.deepEqual(compareJson({b:2,a:[null,0]},{a:[null,0],b:2},limits).changes,[]);
  assert.deepEqual(compareJson(['a','b'],['b','a','c'],limits).changes.map(c=>[c.path,c.kind]),[['/0','changed'],['/1','changed'],['/2','added']]);
  assert.equal(compareJson({},[],limits).changes[0].path,'');
  const a = JSON.parse('{"__proto__":{"polluted":"before"}}'), b = JSON.parse('{"__proto__":{"polluted":"after"}}');
  assert.equal(compareJson(a,b,limits).changes[0].path,'/__proto__/polluted');
  assert.equal(({} as any).polluted,undefined);
});
test('bounded source comparison reports partial traversal without manufacturing unchanged or zero values', () => {
  assert.deepEqual(compareJson({a:0,b:null},{a:1,b:2},{...limits,changes:1}).changes.map(c=>c.path),['/a']);
  assert.equal(compareJson({a:0,b:null},{a:1,b:2},{...limits,changes:1}).limitReached,'changes');
  assert.equal(compareJson({a:0},{a:1},{...limits,changes:1}).truncated,false);
  assert.equal(compareJson({a:0},{a:1},{...limits,nodes:1}).limitReached,'nodes');
  assert.equal(compareJson({a:{b:0}},{a:{b:1}},{...limits,depth:1}).limitReached,'depth');
  assert.throws(()=>compareJson(null,0,{...limits,nodes:0}),/limit/);
});
test('source-history presentation uses a complete validated profile with bounded tools', () => {
  const {contentHash,...profile}=loadSourceHistoryProfile(); assert.match(contentHash,/^[a-f0-9]{64}$/);
  assert.equal(SourceHistoryProfileSchema.safeParse({...profile,limits:{...profile.limits,nodes:Infinity}}).success,false);
  const broken=structuredClone(profile);delete (broken.labels as any).legacy;
  assert.equal(SourceHistoryProfileSchema.safeParse(broken).success,false);
});
