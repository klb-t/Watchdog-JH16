import {z} from 'zod';
import {CAPABILITIES,type Capability} from './authorization';

// Internal route slugs may contain hyphens; external/protocol-relative links may not.
export const GoalNavigationSchema=z.object({
  version:z.literal('goal-navigation-1'),
  goals:z.array(z.object({id:z.string(),label:z.string(),description:z.string(),
    href:z.string().regex(/^\/[a-z]+(?:-[a-z]+)*$/),
    capability:z.string().refine(s=>s.split('|').every(c=>CAPABILITIES.includes(c as Capability))),
    contexts:z.array(z.string()),
  }).strict()),
}).strict();
