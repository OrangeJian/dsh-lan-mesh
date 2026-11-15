import { readFileSync,writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve,dirname } from 'node:path';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const blocks=[['model','ui/models/workbench-identity.mjs'],['components','ui/shell/workbench-header.mjs'],['project-model','ui/models/project-navigation.mjs'],['discovery','ui/shell/discover-projects.mjs'],['styles','ui/shell/workbench-shell.css'],['project-styles','ui/shell/project-navigation.css']];
let source=readFileSync(resolve(root,'client.js'),'utf8').replace(/\r\n/g,'\n');
for(const [name,file] of blocks){let value=readFileSync(resolve(root,file),'utf8').replace(/\r\n/g,'\n').trim();if(!name.endsWith('styles')){if(/^\s*import\s|export\s+(default|\*)/m.test(value))throw Error('UI fragment must be self-contained: '+file);value=value.replace(/^export (function|const) /gm,'$1 ');}const start=`/* @ux-shell:${name}:start */`,end=`/* @ux-shell:${name}:end */`;const at=source.indexOf(start),to=source.indexOf(end,at);if(at<0||to<at)throw Error('Missing client block '+name);source=source.slice(0,at)+start+'\n'+value+'\n    '+source.slice(to);}
if(process.argv.includes('--check')){if(source!==readFileSync(resolve(root,'client.js'),'utf8').replace(/\r\n/g,'\n'))throw Error('Client UI blocks are stale; run npm run build:client');console.log('client UI blocks match source');}else writeFileSync(resolve(root,'client.js'),source);
