import {readFileSync} from 'node:fs';
import {canonicalHash} from '../domain/canonical';
import {CollectionProfileSchema} from '../../../shared/collection';
export function loadCollectionProfile(){
  const profile=CollectionProfileSchema.parse(JSON.parse(readFileSync('config/collection-ui.json','utf8')));
  return {...profile,contentHash:canonicalHash(profile)};
}
