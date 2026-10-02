// Build/package validation for a plain-ESM Apify Actor (no compilation step).
// This is a REAL check, not a no-op: it
//   1. validates the .actor JSON schemas structurally, and
//   2. dynamically imports every library module to prove they load with no
//      missing exports or broken imports.
// main.js is intentionally excluded — importing it would execute the Actor.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let failures = 0;
const fail = (msg) => { failures++; console.error(`BUILD FAIL: ${msg}`); };

// 1. Validate .actor schemas + package metadata.
function readJson(p) { return JSON.parse(readFileSync(p, 'utf8')); }
try {
  const actor = readJson('.actor/actor.json');
  if (actor.actorSpecification !== 1) fail('.actor/actor.json: actorSpecification must be 1');
  if (!actor.name) fail('.actor/actor.json: missing name');
  if (!actor.input) fail('.actor/actor.json: missing input reference');

  const input = readJson('.actor/input_schema.json');
  if (input.schemaVersion !== 1) fail('input_schema.json: schemaVersion must be 1');
  if (!input.properties || typeof input.properties !== 'object') fail('input_schema.json: missing properties');
  if (!Array.isArray(input.required)) fail('input_schema.json: required must be an array');

  readJson('.actor/dataset_schema.json');       // must parse
  readJson('src/matching/programs.example.json'); // must parse
  readJson('package.json');
  console.log('OK: .actor schemas + package.json are structurally valid.');
} catch (err) {
  fail(`schema/package validation threw: ${err.message}`);
}

// 2. Import every src module except main.js (which has run-time side effects).
const modules = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith('.js') && full.replace(/\\/g, '/') !== 'src/main.js') modules.push(full);
  }
}
walk('src');

for (const m of modules) {
  try {
    await import(pathToFileURL(m).href);
  } catch (err) {
    fail(`import failed for ${m}: ${err.message}`);
  }
}
if (!failures) console.log(`OK: ${modules.length} library modules imported cleanly (main.js excluded by design).`);

if (failures) {
  console.error(`\nBuild validation failed with ${failures} problem(s).`);
  process.exit(1);
}
console.log('Build validation passed.');
