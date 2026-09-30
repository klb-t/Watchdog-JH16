import {readFileSync} from 'node:fs';
import path from 'node:path';
import {canonicalHash} from '../domain/canonical';
import type {AutomationProfile} from './automation';
import {SourceAccessProfileSchema,type SourceEntry,type SourceSnapshot} from '../../../shared/source_access';

export function loadSourceAccessProfile(filename=path.join(process.cwd(),'config/source-access.json')){
  const body=SourceAccessProfileSchema.parse(JSON.parse(readFileSync(filename,'utf8')));
  if(new Set(body.sources.map(s=>s.id)).size!==body.sources.length)throw new Error('Duplicate source access entry');
  return {...body,contentHash:canonicalHash(body)};
}
/** Implementation is derived from the existing runtime adapter profile, never from a catalog checkbox. */
export function sourceSnapshot(entry:SourceEntry,automation:AutomationProfile):SourceSnapshot{
  const adapter=automation.sources.find(s=>s.id===entry.id);
  return {entry,adapter:adapter?{id:adapter.id,implemented:adapter.implemented,keyRequired:adapter.keyRequired,
    documentation:adapter.documentation,license:adapter.license,purpose:adapter.purpose,
    ...(adapter.origin?{origin:adapter.origin}:{}),...(adapter.pathPrefix?{pathPrefix:adapter.pathPrefix}:{}),
    ...(adapter.minIntervalMs?{minIntervalMs:adapter.minIntervalMs}:{})}:null};
}
