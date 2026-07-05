// Keep server.json's version + npm package version in lockstep with package.json.
import { readFileSync, writeFileSync } from 'node:fs';
const v = JSON.parse(readFileSync('package.json', 'utf8')).version;
const s = JSON.parse(readFileSync('server.json', 'utf8'));
s.version = v;
s.packages[0].version = v;
writeFileSync('server.json', JSON.stringify(s, null, 2) + '\n');
console.log('synced server.json →', v);
