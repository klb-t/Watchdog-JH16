import {JobRequestSchema} from '../../../shared/automation';
import {CollectionContextSchema,type CollectionContext} from '../../../shared/collection';
import {canonicalHash} from '../domain/canonical';

/** The signature covers actual parameters without publishing the owner's other query names. */
export function collectionContext(input:unknown):CollectionContext|undefined{
  const request=JobRequestSchema.parse(input);
  if(!('collection' in request)||!request.collection)return undefined;
  const {collection,...acquisition}=request;
  return {version:'collection-context-1',purpose:collection.purpose,
    acquisitionHash:canonicalHash({version:'collection-acquisition-1',request:acquisition})};
}
export function decodeCollectionContext(value:string|null|undefined):{collection?:CollectionContext}{
  return value ? {collection:CollectionContextSchema.parse(JSON.parse(value))} : {};
}
