import {readFileSync} from 'node:fs';
import {canonicalHash} from '../domain/canonical';
import {SourceWatchProfileSchema} from '../../../shared/source_watch';
export function loadSourceWatchProfile(){
  const profile=SourceWatchProfileSchema.parse(JSON.parse(readFileSync('config/source-watch-ui.json','utf8')));
  return {...profile,contentHash:canonicalHash(profile)};
}
