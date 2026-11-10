import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const result=spawnSync(process.execPath,['--test','--test-timeout=120000',fileURLToPath(new URL('./shared-doc-integration.test.mjs',import.meta.url)),fileURLToPath(new URL('./shared-doc-host.test.mjs',import.meta.url))],{stdio:'inherit'});
if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status??1);
console.log('shared documents smoke passed: real localhost HTTP/store/Host and fixed-version context; not physical-device/model acceptance');
