import {z} from 'zod';
import raw from '../../../config/access/policy.json';
import {hashConfig} from './canonicalize';

const positive=z.number().int().positive();
const rate=z.object({count:positive,windowMs:positive}).strict();
export const AccessPolicySchema=z.object({
  version:z.literal('admission-policy-1'),
  invitation:z.object({defaultExpiryDays:positive,maxExpiryDays:positive.max(30),maxOpenLinkUses:positive.max(50),noteMax:positive}).strict(),
  application:z.object({reasonMin:positive,reasonMax:positive,fieldMax:positive}).strict(),
  // The code wire format stays eight symbols; changing it requires a new protocol.
  signin:z.object({codeLength:z.literal(8),codeMinutes:positive.max(10),maxAttempts:positive.max(5),codesPerHour:positive.max(5),operatorLinkMinutes:positive.max(15)}).strict(),
  sessionTtlSeconds:positive.max(43200),
  rateLimits:z.object({signin:rate,preview:rate,application:rate}).strict(),
}).strict().refine(p=>p.invitation.defaultExpiryDays<=p.invitation.maxExpiryDays&&p.application.reasonMin<=p.application.reasonMax,'Inconsistent policy bounds');
export const accessPolicy=AccessPolicySchema.parse(raw);
export const accessPolicyHash=hashConfig(accessPolicy);
