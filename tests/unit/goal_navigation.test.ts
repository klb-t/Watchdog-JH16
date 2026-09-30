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
