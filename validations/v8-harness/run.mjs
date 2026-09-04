// Drive every staged Compartments test262 file through the semantic harness,
// one child process per test. Reports a table and an exit code.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const stagingDir = process.argv[2];
const harnessDir = process.argv[3];

// Tests the harness runs natively (ordinary ESM + the Compartment surface).
const RUN = [
  "constructor/shared-realm-global.js",
  "source-key/brand-and-identity.js",
  "instance-memoization/same-compartment.js",
  "instance-memoization/separate-compartments.js",
  "import/async-namespace-and-errors.js",
  "tla/dependency-and-error-propagation.js",
  "cross-compartment/deferred-exports-identity.js",
  "cross-compartment/cyclic-linking.js",
  "intersection/source-phase-static-and-expression.js",
];

// Blocked on a genuine engine feature the available V8 lacks, documented in
// the report rather than emulated at low fidelity.
const BLOCKED = {
  "intersection/import-defer-and-tla.js":
    "needs native `import defer` with synchronous deferred evaluation on access",
};

let pass = 0;
let fail = 0;
const rows = [];
for (const rel of RUN) {
  const file = path.join(stagingDir, rel);
  const res = spawnSync(
    process.execPath,
    ["--experimental-vm-modules", "--no-warnings", path.join(here, "runone.mjs"), file, harnessDir],
    {
      encoding: "utf8",
      // Give the harness a stable fixture root. The staged suite uses the
      // matching `../fixtures/` paths.
      env: { ...process.env, COMPARTMENT_FIXTURES_DIR: path.join(stagingDir, "fixtures") },
    }
  );
  const out = (res.stdout || "").trim();
  const ok = res.status === 0 && out.startsWith("PASS");
  rows.push([ok ? "PASS" : "FAIL", rel, ok ? "" : out || (res.stderr || "").trim()]);
  if (ok) pass++;
  else fail++;
}

for (const [rel, why] of Object.entries(BLOCKED)) {
  rows.push(["BLOCK", rel, why]);
}

console.log("");
for (const [status, rel, note] of rows) {
  console.log(`  ${status}  ${rel}${note ? "\n         " + note.replace(/\n/g, "\n         ") : ""}`);
}
console.log("");
console.log(`  ${pass} passed, ${fail} failed, ${Object.keys(BLOCKED).length} blocked (of ${RUN.length + Object.keys(BLOCKED).length} staged families)`);
process.exit(fail === 0 ? 0 : 1);
