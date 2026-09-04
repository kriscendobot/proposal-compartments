// Run one staged Compartments test262 file against the semantic harness.
//
// Usage: node --experimental-vm-modules runone.mjs <path-to-test.js> <harness-dir>
//
// Prints "PASS" or "FAIL: <reason>" and exits 0/1. Each test runs in its own
// process, so the surrounding realm's global object is fresh per test and the
// Compartment shim can share it exactly as the proposal requires.

import vm from "node:vm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  Compartment,
  sourceKeyForSpecifier,
  importSourceExpression,
} from "./compartment.mjs";

const testFile = path.resolve(process.argv[2]);
const harnessDir = path.resolve(process.argv[3]);

const source = readFileSync(testFile, "utf8");

// Parse the frontmatter YAML-ish block for includes and flags.
const meta = source.match(/\/\*---([\s\S]*?)---\*\//);
const metaText = meta ? meta[1] : "";
const includes = [];
const incMatch = metaText.match(/includes:\s*\[([^\]]*)\]/);
if (incMatch) {
  for (const name of incMatch[1].split(",")) {
    const n = name.trim();
    if (n) includes.push(n);
  }
}
const isAsync = /flags:\s*\[[^\]]*\basync\b/.test(metaText);

// Load test262 harness includes as global scripts (sta.js is always implied).
const alwaysInclude = ["sta.js", "assert.js"];
for (const inc of [...alwaysInclude, ...includes]) {
  const incPath = path.join(harnessDir, inc);
  const incSource = readFileSync(incPath, "utf8");
  vm.runInThisContext(incSource, { filename: incPath });
}

// Async completion bridge: test262 async tests call $DONE(err?).
let resolveDone, rejectDone;
const donePromise = new Promise((resolve, reject) => {
  resolveDone = resolve;
  rejectDone = reject;
});
globalThis.$DONE = function (err) {
  if (err) rejectDone(err);
  else resolveDone();
};

// Expose the harness surface to the transformed test.
globalThis.Compartment = Compartment;
const testDir = path.dirname(testFile);
globalThis.__sourceKey = (spec) => sourceKeyForSpecifier(spec, path.join(testDir, "x"));
globalThis.__importSource = (spec) => importSourceExpression(spec, path.join(testDir, "x"));

// Transform module syntax the available V8 cannot parse into harness calls.
// `import source NAME from "SPEC"`  ->  `const NAME = __sourceKey("SPEC")`
// `import.source("SPEC")`           ->  `__importSource("SPEC")`
let body = source
  .replace(
    /import\s+source\s+(\w+)\s+from\s*(["'])(.*?)\2\s*;?/g,
    (_m, name, _q, spec) => `const ${name} = globalThis.__sourceKey(${JSON.stringify(spec)});`
  )
  .replace(/import\.source\s*\(\s*(["'])(.*?)\1\s*\)/g,
    (_m, _q, spec) => `globalThis.__importSource(${JSON.stringify(spec)})`);

async function main() {
  // After transform the test has no static imports; run it as a module to
  // preserve module scope and strict mode.
  const testModule = new vm.SourceTextModule(body, {
    identifier: testFile,
    initializeImportMeta(m) {
      m.url = pathToFileURL(testFile).href;
    },
  });
  await testModule.link(async () => {
    throw new Error("transformed test should have no static imports");
  });
  await testModule.evaluate();
  if (isAsync) {
    await donePromise;
  }
}

main().then(
  () => {
    console.log("PASS");
    process.exit(0);
  },
  (err) => {
    const msg = err && err.stack ? err.stack : String(err);
    console.log("FAIL: " + msg.split("\n").slice(0, 6).join("\n"));
    process.exit(1);
  }
);
