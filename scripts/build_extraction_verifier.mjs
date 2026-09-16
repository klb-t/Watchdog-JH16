import { build } from 'esbuild';
// The publication package replays the same versioned copy/conversion code,
// bundled with its schemas. Only Node built-ins are external at verification.
await build({entryPoints:['backend/watchdog_api/workbench/extraction_data.ts'],bundle:true,platform:'node',format:'cjs',
  target:'node22',outfile:'dist/extraction-replay.cjs',minify:true,legalComments:'inline'});
