import { z } from 'zod';

export const CollectionPurposeSchema = z.enum(['baseline','research','monitoring']);
export const CollectionIntentSchema = z.object({ version:z.literal('collection-purpose-1'),purpose:CollectionPurposeSchema }).strict();
export type CollectionIntent = z.infer<typeof CollectionIntentSchema>;
export const CollectionContextSchema = z.object({ version:z.literal('collection-context-1'),purpose:CollectionPurposeSchema,
  acquisitionHash:z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type CollectionContext = z.infer<typeof CollectionContextSchema>;
export const CollectionProfileSchema = z.object({ version:z.literal('collection-ui-1'),
  label:z.string().min(1),explanation:z.string().min(1),scopeNote:z.string().min(1),
  purposes:z.record(z.enum(['unspecified','baseline','research','monitoring']),z.object({label:z.string().min(1),description:z.string().min(1)}).strict()),
}).strict();
export type CollectionProfile = z.infer<typeof CollectionProfileSchema> & {contentHash:string};

/** Removing intent removes the property, preserving legacy serialized requests and hashes. */
export function withCollectionPurpose<T extends {kind:string;collection?:CollectionIntent}>(request:T,purpose:z.infer<typeof CollectionPurposeSchema>|'unspecified'):T {
  const {collection,...rest}=request;
  if(purpose==='unspecified')return rest as T;
  if(!['substance_refresh','paper_scan'].includes(request.kind))throw new Error('Collection purpose applies to public acquisition jobs');
  return {...rest,collection:CollectionIntentSchema.parse({version:'collection-purpose-1',purpose})} as T;
}
