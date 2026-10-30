import {z} from 'zod';
import {CAPABILITIES,type Capability} from './authorization';

// One language's wording of a goal: what the card shows and the words the search matches.
const GoalText=z.object({label:z.string().min(1),description:z.string().min(1),contexts:z.array(z.string())}).strict();

// Internal route slugs may contain hyphens; external/protocol-relative links may not.
export const GoalNavigationSchema=z.object({
  version:z.literal('goal-navigation-2'),
  _note:z.string().optional(),
  goals:z.array(z.object({id:z.string(),
    href:z.string().regex(/^\/[a-z]+(?:-[a-z]+)*$/),
    capability:z.string().refine(s=>s.split('|').every(c=>CAPABILITIES.includes(c as Capability))),
    text:z.object({pl:GoalText,en:GoalText}).strict(),
  }).strict()),
}).strict();
