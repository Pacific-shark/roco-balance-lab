import { readFile } from 'node:fs/promises';
import { pilotAdmission } from '../src/pilot-admission.mjs';
const manifest = JSON.parse(await readFile(new URL('../public/data/pilot-manifest.json',import.meta.url),'utf8'));
const result = pilotAdmission(manifest);
console.log(JSON.stringify(result,null,2));
if (!result.trainingAllowed) process.exitCode = 2;
