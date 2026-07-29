# v8 validation front: semantic conformance harness

This directory holds the v8-front validation of the fresh Compartments
operation surface. It has two findings and one runnable artifact.

1. A **native v8 build is not green and is not called green.** The v8 the front
   could reach does not implement the proposal or the module-harmony syntax the
   staged tests parse against, and no v8 source checkout or build toolchain was
   present. The exact blockers and command output are below.
2. A **semantic conformance harness** implements the spec's normative operations
   on top of Node's `vm.SourceTextModule` and runs the staged test262 families.
   Nine of ten pass; the tenth is blocked on the same missing engine feature as
   native v8. This harness is a behavioral oracle for a real v8 port, not a
   substitute for one.

The harness runs against test262 staging commit `63b7e7c`, whose fixture imports
resolve from each family directory to the shared `fixtures/` directory.

## What the proposal requires of an engine

The staged tests (`test/staging/Compartments/` on `kriscendobot/test262` branch
`proposal-compartments`) exercise, per the charter and `spec.emu`:

- `new Compartment()` sharing the surrounding realm's global (no lockdown).
- A `ModuleSource`-keyed API: `compartment.exports(source)` and
  `compartment.import(source)`, keyed on an opaque source object with a
  `[[ModuleSourceRecord]]` internal-slot brand and object identity.
- One instance per source key per Compartment; distinct instances across
  Compartments; a stable deferred exports namespace usable before linking.
- Ordinary cross-Compartment linking including cycles.
- Top-level-await dependency waiting and error propagation.
- Source-phase static (`import source x from`) and expression
  (`import.source()`) acquisition, and `import defer` intersection.

## Finding 1: native v8 is blocked

The reachable engine was Node.js `v22.23.1`, V8 `12.4.254.21-node.56`. No `d8`,
standalone `v8`, `jsc`, or `xs` binary was present, and no V8 source checkout or
`depot_tools`/`gclient`/`ninja` toolchain was available to build one.

Every prerequisite the tests parse against is absent in that V8. Reproduced
directly:

```
$ node --input-type=module -e 'import source s from "./x.mjs";'
SyntaxError: Unexpected identifier 's'          # source-phase import: absent

$ node --input-type=module -e 'await import.source("./x.mjs");'
SyntaxError: Unexpected identifier 'source'     # source-phase import expression: absent

$ node --input-type=module -e 'import defer * as ns from "./x.mjs";'
SyntaxError: Unexpected token '*'               # import defer: absent

$ node -e 'console.log(typeof Compartment)'
undefined                                       # Compartment global: absent
```

`node --v8-options` on this build lists no `--js-source-phase-imports`,
`--harmony-import-defer`, or equivalent flag. The staged tests therefore cannot
run against this engine even before the `Compartment` global is considered.

### Smallest native v8 implementation path

A real v8 port depends, in order, on prerequisites v8 does not yet ship for JS
modules:

1. **Source-phase imports for JS** (`import source`) and the **source-phase
   import expression** (`import.source()`). V8 has Wasm source-phase support but
   not the JS-module source object these tests pass to a Compartment. This is
   the gating dependency: without it there is no source key to key the API on.
2. **`import defer`** for the one intersection family.
3. A **`Compartment` builtin** whose C++ maps directly onto the spec operations,
   which are deliberately thin over existing machinery:
   - constructor: record the current realm and its global object; two empty
     maps. No realm or global is created.
   - `[[ModuleInstances]]` / `[[ExportsNamespaces]]`: `Map`s keyed by the source
     object's identity.
   - `exports`: brand-check (`[[ModuleSourceRecord]]`), then get-or-create the
     deferred namespace. No load/link/evaluate.
   - `import`: brand-check synchronously, get-or-create the instance from the
     source, store it before `LoadRequestedModules`, then `Link`/`Evaluate` on
     the ordinary Module Record path, resolving the returned Promise with the
     (now populated) deferred namespace.
   - cross-Compartment edges reuse the host module-loading selection; no new
     resolver, loader, table, or descriptor protocol is added.

The bounded first increment for the native front, once v8 has source-phase JS
imports behind a flag, is item 3 alone: a `Compartment` builtin plus the
`%AbstractModuleSource%` brand check, wired to V8's existing
`SourceTextModule::Instantiate`/`Evaluate`. The harness in this directory is the
behavioral oracle for that increment; every operation it implements has a
one-to-one spec clause.

## Finding 2: the semantic harness

`compartment.mjs` implements the `spec.emu` operations (Compartment source keys,
`RequireCompartmentSourceKey`, `GetCompartmentExportsNamespace`,
`GetOrCreateCompartmentModule`, the constructor, `exports`, and `import`) over
`vm.SourceTextModule`. `vm.SourceTextModule` supplies exactly the pieces the spec
delegates to ECMA-262: the Load/Link/Evaluate lifecycle, top-level-await Promise
timing, cyclic linking, and (with no explicit `context`) the surrounding
realm's global object (verified: a module compiled this way sees the outer
`globalThis`, which is what `constructor/shared-realm-global` asserts).

`runone.mjs` runs one staged file in its own process: it loads the test262
harness includes (`sta.js`, `assert.js`, and any declared `includes`), installs
the `Compartment` shim, transforms the two unparseable source-phase forms into
harness calls that hand back the same opaque source key, and drives the test262
async protocol. `run.mjs` runs the whole suite.

### Results

```
  PASS  constructor/shared-realm-global.js
  PASS  source-key/brand-and-identity.js
  PASS  instance-memoization/same-compartment.js
  PASS  instance-memoization/separate-compartments.js
  PASS  import/async-namespace-and-errors.js
  PASS  tla/dependency-and-error-propagation.js
  PASS  cross-compartment/deferred-exports-identity.js
  PASS  cross-compartment/cyclic-linking.js
  PASS  intersection/source-phase-static-and-expression.js
  BLOCK intersection/import-defer-and-tla.js
        needs native `import defer` with synchronous deferred evaluation on access

  9 passed, 0 failed, 1 blocked (of 10 staged families)
```

The results are not trivially green. The staged assertions are strong
(`notSameValue`, per-Compartment evaluation counts, an async `settled === false`
check before a TLA gate releases, and error-identity checks). A negative control
confirms the harness has teeth: removing memoization from
`GetOrCreateCompartmentModule` makes `instance-memoization/same-compartment` fail
with `Expected SameValue(«2», «1»)` and makes `cross-compartment/cyclic-linking`
diverge (the cycle no longer terminates), which is the expected consequence of
losing the store-before-load memoization the spec requires.

### The one blocked family

`intersection/import-defer-and-tla` needs genuine `import defer` with synchronous
deferred evaluation on first property access. `vm.SourceTextModule` evaluates
asynchronously, so a faithful `import defer` (whose observable is a *synchronous*
property read triggering evaluation and returning the value, with an evaluation
counter of `0` until then) cannot be emulated over it without changing the
observable the test asserts. Rather than ship a low-fidelity emulation, this
family is reported blocked on the same `import defer` prerequisite that blocks
native v8. It is the honest boundary of what this harness can validate.

### Fidelity notes and non-claims

- The deferred exports namespace here is a plain identity object with live
  getters installed after evaluation, which matches the spec's statement that it
  is neither an `import defer` namespace nor a module namespace exotic object and
  keeps its identity across linking. A native engine would likely back it with a
  module namespace exotic object; that is an implementation choice the spec
  leaves open and is not tested by these families.
- The source-phase transform in `runone.mjs` stands in for real
  `import source` / `import.source()` acquisition. It preserves the one property
  the tests depend on: the same resolved specifier yields the same opaque source
  object, so static and expression forms are `SameValue`.
- Cross-Compartment host *routing* is deliberately not a JavaScript operation, so
  the two `cross-compartment/*` families assert only the JavaScript-visible
  deferred-namespace identity and cycle consequences, which is what the harness
  runs. Host-routing integration remains an embedding-test concern for a native
  engine.

## Fixture resolution

The runner sets `COMPARTMENT_FIXTURES_DIR` to the staging suite's shared
`fixtures/` directory. At test262 staging commit `63b7e7c`, every family already
uses the corresponding `../fixtures/` path, so the harness and native runners
resolve the same fixtures.

## Running it

```
# against a kriscendobot/test262 checkout on branch proposal-compartments
node run.mjs /path/to/test262/test/staging/Compartments /path/to/test262/harness
```

Requires Node 20+ (`vm.SourceTextModule`, enabled with the built-in
`--experimental-vm-modules` flag that `run.mjs` passes to each child).
