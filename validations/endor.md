# Endor validation front

Validation of the fresh Compartments operation surface on **endor**, one of the
four parallel implementation fronts (v8, JSC, XS, endor). This report records
what was measured with real command output, what blocks an implementation, and
the next bounded increment. Semantics are reconciled against the charter
(`journal/projects/proposal-compartments/README.md`) and the spec at
`spec.emu` (`d23d7de`), not SES legacy.

Inputs: staging suite `kriscendobot/test262@e6dbe36` (`test/staging/Compartments/`,
10 tests), spec `kriscendobot/proposal-compartments@d23d7de`.

## What endor is

`endor` is the unified Rust daemon (`rust/endo/`) whose JavaScript engine is
**Moddable XS**, embedded through the `xsnap` crate (`rust/endo/xsnap/`), pinned
via the `c/moddable` git submodule (`5516726`). The engine seen by any endor
worker is that XS build; endor adds a Rust host module loader
(`xsnap/src/powers/modules.rs`, `host_load_module_source` / `host_resolve_module`)
and compartment-map ZIP archive execution (`endor run bundle.zip`). Endor has no
raw `test262` entry point; the only test262 runner over this engine is bare
`xst`, whose verdict therefore bounds what endor can pass.

## Measured baseline (real execution)

Engine: `xst -v` reports `XS 17.9.1, slot 32 bytes, ID 4 bytes`.

### The proposal syntax does not parse

Direct module probes through `xst -m`:

| Construct | Result |
|---|---|
| `await Promise.resolve()` (top-level await) | runs |
| `typeof Compartment` | `function` (the **legacy** global, see below) |
| `import source s from "./dep.mjs"` | `SyntaxError: missing from` |
| `await import.source("./dep.mjs")` | `SyntaxError: invalid import.` |
| `import defer * as ns from "./dep.mjs"` | `SyntaxError: missing from` |

Every one of the 10 staging tests acquires its source key through
`import source` or `import.source` (feature tag `source-phase-imports`), and one
also uses `import defer`. None of that syntax parses on XS 17.9.1.

### The existing `Compartment` is the retired SES-legacy surface

`new Compartment()` succeeds but is not the proposal object:

- prototype own names: `globalThis, evaluate, import, importNow, constructor`
- `compartment.exports` is `undefined` (the proposal's deferred-namespace method
  is absent)
- `compartment.import` is the legacy **specifier**-keyed import driven by
  load/resolve hooks (`modules.rs`), not the proposal's opaque-source-key
  `import(source)`
- `compartment.globalThis === globalThis` is **false** — the legacy Compartment
  stands up a **fresh** global, the opposite of the charter's binding
  root-realm-global-reuse requirement

This matches the staging README's reconciliation note: the legacy XS/endor
fixtures depend on the retired module-descriptor and hook protocol and a
fresh-global behavior, so none were carried into the suite.

### Suite verdict

Running the staging suite through `xst -t staging/Compartments` (harness from the
same test262 fork):

```
0.00% (100.00%)   0/10
```

All 10 proposal tests fail; `xst` lists `source-phase-imports` (10) and
`import-defer` (1) among the features it does not support. This is the honest
red baseline. The build is **not** green and must not be reported as green.

## Blocking prerequisites (in dependency order)

1. **Engine parser + source reification (shared with the XS front).** XS must
   parse `import source`/`import.source` and reify a `ModuleSource` object
   carrying a `[[ModuleSourceRecord]]` internal slot — the opaque source key the
   whole surface indexes on (`RequireCompartmentSourceKey`,
   `sec-compartment-source-keys`). Also `import defer`. This lives in the
   Moddable XS C sources (`c/moddable/xs/sources/`), not in endor's Rust host or
   a JS shim: no host-side polyfill can add syntax the parser rejects. It is the
   gating dependency for the endor front and is the same work the XS front must
   land first.
2. **Proposal `Compartment` object.** A `Compartment` whose constructor takes no
   arguments, records the current Realm and its global object, and exposes
   `exports(source)` (synchronous brand check, deferred namespace, no
   instantiate/link/evaluate) and `import(source)` (async, returns the same
   namespace, ordinary link + TLA evaluation). Per-Compartment
   `[[ModuleInstances]]` and `[[ExportsNamespaces]]` Maps keyed on the opaque
   source key give one instance per source key per Compartment and distinct
   instances across Compartments. This replaces, not extends, the legacy
   fresh-global hook Compartment.
3. **Endor host wiring.** Once 1–2 exist in the engine, endor's module powers
   (`modules.rs`, `archive.rs`) must (a) instantiate Compartment module code
   against the **surrounding realm's global** rather than a fresh compartment
   global, and (b) key its instance/exports lookup on the opaque `ModuleSource`
   rather than specifier strings, so cross-Compartment links and cycles resolve
   through the deferred exports namespace installed before dependency traversal
   (`sec-compartment-cross-compartment-linking`).

## Toolchain notes

- No endor build was attempted for this report. The gardener container has a
  Rust toolchain reachable through `RUSTUP_HOME=/home/kris/garden2/.rustup`
  (`cargo 1.97.1`), but the `c/moddable` submodule is uninitialized in a fresh
  checkout (~180 MB) and no `prebuilt/libxs.a` is present, so a build starts
  from a full XS C compile. A build would not change the verdict: the surface is
  absent at the engine parser, which a Rust rebuild of the current pin cannot
  add.

## Next bounded increment

The whole surface is too large for one increment and its first prerequisite is
engine-level and shared with the XS front, so the endor front cannot proceed
independently until that lands. The smallest useful endor-owned increment, to be
started **once XS reifies `ModuleSource` and parses `import source`**:

> On the XS branch that carries `ModuleSource` reification, add the proposal
> `Compartment` constructor + `Compartment.prototype.exports(source)` +
> `Compartment.prototype.import(source)` with per-Compartment source-keyed
> `[[ModuleInstances]]`/`[[ExportsNamespaces]]` Maps, and make endor's
> `modules.rs`/`archive.rs` instantiate against the surrounding realm global.
> Gate it on the four non-TLA, non-defer staging tests first
> (`constructor/shared-realm-global`, `source-key/brand-and-identity`,
> `instance-memoization/{same,separate}-compartments`,
> `import/async-namespace-and-errors`, `cross-compartment/*`), then the TLA and
> import-defer intersection tests.

Until then the endor front's honest status is **blocked on the XS-front engine
prerequisite**, baseline 0/10, evidence above.
