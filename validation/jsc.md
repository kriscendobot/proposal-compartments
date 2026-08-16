# JavaScriptCore validation

Validation front for the Compartments proposal on JavaScriptCore. This note
records what a real JSC build supports today, where the proposal's operation
surface lands on JSC's existing module machinery, the one prerequisite that
blocks a runnable implementation, and the next bounded increment. Findings come
from running commands against a released JSC, not from reading source alone.

Charter: the proposal `README.md` and `spec.emu` at commit `d23d7de`. Staging
suite: `kriscendobot/test262` branch `proposal-compartments`, `test/staging/Compartments/`.

## Harness

No JSC source build was required to establish a runnable baseline. The WebKitGTK
package ships a real JavaScriptCore command-line interpreter:

```
sudo apt-get install -y libjavascriptcoregtk-bin      # provides /usr/bin/jsc
jsc --help                                            # WebKitGTK 2.52.3-0ubuntu0.24.04.1
```

`jsc` runs modules with `-m` / `--module-file=`, runs the test262 async protocol
with `--test262-async` (it checks for a `Test262:AsyncTestComplete` print), and
takes VM option flags as `--<option>=<value>`. The staging tests are ordinary
test262 module-and-async tests, so the harness is: the test262 harness scripts
(`sta.js`, `assert.js`, `doneprintHandle.js`, `asyncHelpers.js`) evaluated as
scripts, then the test evaluated with `--module-file`, under `--test262-async`.

A source build of JSC is available as a fallback for engine changes (WebKit tree,
C++), but nothing below needed it. The released interpreter is enough to fix the
baseline exactly and to find the blocker.

## Feature baseline (measured)

Each row is a command run against `/usr/bin/jsc` (WebKitGTK 2.52.3) and its
observed result.

| Capability the proposal needs | JSC 2.52.3 | Evidence |
| --- | --- | --- |
| ES modules, `import.meta` | yes | `jsc -m` runs; `typeof import.meta` is `object` |
| Top-level await | yes | `const x = await Promise.resolve(42)` prints `42` |
| Dynamic `import()` | yes | `await import("./dep.mjs")` resolves |
| Import attributes (`with { type: "json" }`) | yes | JSON module import returns the parsed value |
| `import defer * as ns` | yes, flag-gated | parses and evaluates under `--useImportDefer=1`; `SyntaxError` without it |
| `Compartment` global | no | `typeof Compartment` is `undefined` |
| `ModuleSource` global | no | `typeof ModuleSource` is `undefined` |
| Static source phase `import source x from "..."` | no | `SyntaxError: Unexpected identifier ... Expected 'from'`; no VM flag exists |
| Source phase expression `import.source("...")` | no | `SyntaxError: "import." can only be followed with meta` |

Two of these matter most. Import defer, one of the intersection dependencies,
already exists in JSC behind `--useImportDefer=1`. Source phase imports, the
mechanism every staging test uses to obtain a `ModuleSource` key, do not exist in
JSC at all and have no runtime flag.

## Running the staging suite

All ten staging tests were run against stock JSC with the test262 harness. Every
one fails identically at parse time, on its first `import source` line, before any
`Compartment` reference is reached:

```
jsc --test262-async harness/sta.js harness/assert.js harness/doneprintHandle.js \
    harness/asyncHelpers.js --module-file=test/staging/Compartments/<test>.js
# Exception: SyntaxError: Unexpected identifier '<name>'. Expected 'from' before imported module name.
# [exit 3]   (identical for all 10 files)
```

The failure is not "Compartment is undefined." It is one level earlier: JSC cannot
parse the source phase import statement that names the source key. That single gap
gates the entire suite. This build is not green and must not be called green.

## Where the proposal lands on JSC's module machinery

JSC exposes its internal module loader for inspection with
`--exposeInternalModuleLoader=1`. Its surface is exactly the ordinary Module
Record machinery the proposal says linking and evaluation should reuse:

```
registry (a Map keyed by module key), getModuleNamespaceObject, parseModule,
resolve, fetch, moduleDeclarationInstantiation (Link), link,
moduleEvaluation / asyncModuleEvaluation (Evaluate, including TLA),
linkAndEvaluateModule, requestImportModule, dependencyKeysIfEvaluated
```

The proposal's `spec.emu` (`d23d7de`) adds a small memo layer over this substrate.
Its Compartment-specific operations and slots:

- Slots `[[Realm]]`, `[[GlobalObject]]`, `[[ModuleInstances]]`,
  `[[ExportsNamespaces]]` on a Compartment; `[[ModuleSourceRecord]]` on a source
  key; `[[Compartment]]`, `[[SourceKey]]`, `[[Module]]` on a deferred exports
  namespace.
- `RequireCompartmentSourceKey` (brand check for the `[[ModuleSourceRecord]]`
  slot).
- `GetCompartmentExportsNamespace` (`compartment.exports(source)`): a deferred
  namespace keyed by source-object identity, created before any module instance.
- `GetOrCreateCompartmentModule` and the memoization clause
  (`compartment.import(source)`): at most one instance per source key per
  Compartment, then ordinary load, link, and async evaluate.

The mapping is direct:

- `[[ModuleInstances]]` is a per-Compartment analog of the loader `registry`,
  keyed by `ModuleSource` object identity rather than a string module key. This
  is why separate Compartments produce separate instances for one source: they
  hold separate maps.
- `[[ExportsNamespaces]]` pre-creates a namespace object (the loader already has
  `getModuleNamespaceObject`) and holds its identity stable from before linking
  through after evaluation. This is the deferred-exports identity the
  cross-Compartment cycle test depends on.
- `compartment.import(source)` is `linkAndEvaluateModule` seeded from a source
  object instead of a resolved specifier, returning the namespace through the
  ordinary async module path.
- Top-level await, cyclic linking, and evaluation-error propagation are already
  carried by `asyncModuleEvaluation` and the existing Module Record algorithms.
  The proposal explicitly keeps these as ordinary module operations, so on JSC
  they come from the substrate rather than from new Compartment code.

The exposed loader is a debugging surface, not a JS-drivable API: calling
`parseModule` with JavaScript-shaped arguments aborts in native code, because the
builtins expect private, symbol-tagged source records and entry objects. A
faithful JavaScript-level Compartment prototype that could run the staging tests
is therefore not possible without engine changes. The memo layer is small, but it
has to be built in C++ against the real loader, not shimmed in script, and it
still cannot run the tests until the source phase syntax parses.

## Blocking prerequisite

**Source phase imports are not implemented in JSC and have no runtime flag.**
This is the single prerequisite that blocks every staging test and any runnable
Compartment implementation, because a `ModuleSource` key is only ever produced by
`import source x from "..."` or `import.source("...")`, and those are the entry
point of all ten tests and of the proposal's own examples.

Concretely, JSC would need:

1. Parser and bytecode support for the static `import source ... from` form and
   the `import.source(...)` expression (the source phase of `ModuleRequest`).
2. An `%AbstractModuleSource%` / `%ModuleSource%` intrinsic whose instances carry
   the `[[ModuleSourceRecord]]` internal slot that `RequireCompartmentSourceKey`
   brand-checks, with per-referrer source-phase cache identity so that the static
   and expression forms of the same request yield the same object (the
   `intersection/source-phase-static-and-expression.js` assertion).

Item 1 is a WebKit parser and module-loader change of the same class as the
import-defer work that already shipped behind `--useImportDefer`. Item 2 is the
object the Compartment API keys on. Until both exist, the Compartment surface has
nothing to accept as a key.

## Reconciliation against the charter

No semantic disagreement with the charter surfaced. The staging tests match the
`d23d7de` spec: source keys are object-identity brands, `exports` yields a
deferred namespace before instantiation, separate Compartments memoize
separately, and TLA and cycles ride ordinary module semantics. JSC's substrate is
a good fit for that model, which is consistent with the charter's requirement that
Compartments not grow a parallel module system beside module harmony. The only
gap is the missing source phase entry point, not a behavioral disagreement.

The shared-global requirement is also a good fit: `new Compartment()` records the
current realm and reuses its global, and JSC modules already evaluate against the
realm global, so the shared-global path needs no new global-object plumbing in
JSC. It is the default, not an exceptional mode.

## Next bounded increment

The implementation cannot land as one change. The next bounded, verifiable step is
engine-side and independent of the Compartment API:

**Land source phase imports in JSC behind a `--useSourcePhaseImports` flag,
mirroring the existing `--useImportDefer` staging.** Deliverable: `import source`
and `import.source(...)` parse and evaluate under the flag, producing a
`%ModuleSource%` object with the `[[ModuleSourceRecord]]` slot and stable
per-referrer source-phase cache identity. Acceptance: the upstream test262
`source-phase-imports` staging tests pass under the flag, and a minimal probe
shows the static and expression forms of one request return the same object.

That step is a prerequisite shared with the v8 front (both engines need the same
source phase entry point) and is the honest gate before any `Compartment` global
work. Only after it can the Compartment memo layer be added and measured against
this staging suite. No `Compartment` code should be reported as passing before the
source phase gate is real, since the tests cannot even parse until then.

## Reproduction

```
sudo apt-get install -y libjavascriptcoregtk-bin
# baseline capability probes
jsc -e 'print(typeof Compartment + " " + typeof ModuleSource)'          # undefined undefined
jsc -m tla.mjs                                                          # top-level await: ok
jsc --useImportDefer=1 -m import-defer.mjs                              # import defer: ok under flag
jsc -m import-source.mjs                                                # SyntaxError (no source phase)
# staging suite (all 10 fail identically at the import source line)
jsc --test262-async harness/sta.js harness/assert.js \
    harness/doneprintHandle.js harness/asyncHelpers.js \
    --module-file=test/staging/Compartments/<test>.js
```
