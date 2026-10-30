import {test} from 'node:test';
import assert from 'node:assert/strict';
import profile from '../../config/goal-navigation.json';
import {GoalNavigationSchema} from '../../shared/goal_navigation';

test('goal navigation: shipped profile accepts internal hyphenated routes but rejects external targets',()=>{
  const parsed=GoalNavigationSchema.parse(profile);
  assert.ok(parsed.goals.some(g=>g.href==='/source-access'));
  for(const href of ['//example.org','https://example.org','javascript:alert(1)','/../admin','/source-access?redirect=external']) {
    assert.equal(GoalNavigationSchema.safeParse({...profile,goals:[{...profile.goals[0],href}]}).success,false);
  }
});

test('goal navigation: every goal has its wording in both interface languages',()=>{
  const parsed=GoalNavigationSchema.parse(profile);
  assert.equal(new Set(parsed.goals.map(g=>g.id)).size,parsed.goals.length);
  for(const g of parsed.goals) for(const lang of ['pl','en'] as const) {
    assert.ok(g.text[lang].label.trim()&&g.text[lang].description.trim(),`${g.id}: ${lang} wording`);
    assert.ok(g.text[lang].contexts.length>0,`${g.id}: ${lang} search words`);
  }
  assert.equal(GoalNavigationSchema.safeParse({...profile,goals:[{...profile.goals[0],text:{pl:profile.goals[0].text.pl}}]}).success,false);
});
