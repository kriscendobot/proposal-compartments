# Compartments

**Stage**: 1 (revised design track)

Compartments give a host a way to assemble and evaluate a module graph under
host-controlled loading rules. A Compartment has its own index of module
instances, but it need not create another realm or another global object. That
distinction matters for applications that need several instances of a package
graph and for hosts, notably Node.js, that need to extend a graph in the root
realm.

You can browse the [ecmarkup output](https://kriscendobot.github.io/proposal-compartments/)
or browse the [source](https://github.com/kriscendobot/proposal-compartments/blob/HEAD/spec.emu).

## The problem

Module behavior has an important host-specific portion. A browser resolves URLs
and gives `import.meta` URL-shaped information. Node.js recognizes built-ins,
packages, and file URLs. An embedded host may use a different naming system
entirely. Tools such as package sandboxes, import-map runtimes, loaders, and
bundlers need to control that behavior while preserving the language's module
linking and evaluation rules.

Creating a realm for every graph is often too costly or changes object identity
in ways the application cannot accept. It is also the wrong fit for a Node.js
loader that wants to extend modules in the existing global context. Compartments
need a separate module-instance memo without making a second global runtime
context the price of admission.

The earlier proposal, preserved under [`archive/`](archive/ARCHIVE.md), explored
a larger stack of module-loader features. This document draws on its motivating
cases, but is derived from that work rather than a restatement of it. The
normative proposal is [`spec.emu`](spec.emu).

## The approach

The fresh proposal takes the intersection of the module-harmony proposals. It
uses their source phase, source phase import expression, and deferred-evaluation
machinery where those proposals already define a phase or an identity. It should
not grow a parallel module system that happens to share some names with them.

The central rule is small:

> A `ModuleSource` is an opaque key for a module instance in a Compartment. A
> Compartment has at most one instance for each `ModuleSource` key.

Source-phase imports and the source phase import expression produce
`ModuleSource` values. A Compartment consumes such a value as an identity, not
as a record it interprets. Importing the same source in two Compartments therefore
creates two instances. Reusing it in one Compartment finds the existing instance.

This is a deliberate departure from the earlier module-descriptor design. The
proposal no longer asks a Compartment to interpret a descriptor carrying source,
metadata, aliases, and linkage instructions. Host resolution and module-harmony
source machinery supply the information each owns.

The same boundary applies to isolation. Compartments must work without SES
lockdown. Lockdown-compatible behavior can be useful to a host, but it is not a
precondition for creating or using a Compartment.

### Sharing the realm global

Compartment identity and global-object identity are separate choices. A
Compartment must be able to evaluate its modules against the surrounding realm's
global object. That is the normal Node.js path: a root-realm module graph can be
extended without a second context. A later layer may offer a distinct global
when a host needs one, but this minimal surface cannot require it.

Sharing a global does not erase the need for a Compartment's instance index. Two
Compartments over the same realm can still instantiate the same `ModuleSource`
separately. Their difference is in module-instance identity and host loading
policy, not necessarily in `globalThis`.

### Preserving module phases

Linking and evaluation remain ordinary module operations. In particular,
top-level await must preserve the usual dependency ordering and error behavior,
including when a dependency edge crosses Compartments. `import defer` retains
its own deferred namespace semantics; a Compartment must not recast deferral as
a separate loading protocol. Similarly, source-phase imports retain ownership of
how a source is obtained and represented.

## The Compartment surface

The specification scaffold names a `Compartment` constructor, its asynchronous
`import` entry point, the per-Compartment `ModuleSource` index, global-object
selection, and the loading and resolution boundary. It intentionally leaves the
precise constructor and loader signatures open while the intersection settles.
The surface is meant to be understood in these terms:

- A host supplies or resolves `ModuleSource` values through its existing module
  facilities.
- A Compartment indexes its instances by those opaque source keys.
- `Compartment.prototype.import` links and evaluates an entry module using that
  index and returns the module's exports result through the ordinary asynchronous
  module path.
- Source phase imports, the source phase import expression, and `import defer`
  keep their respective syntax and semantics. Compartments compose with them.

Resolution is still a host concern. The point of the Compartment boundary is not
to standardize browser URLs, Node package lookup, or every loader hook. It is to
give those environments a shared way to place a source in a particular
module-instance graph.

## Motivating examples and rationales

### Multiple instantiation

Consider a plugin host that receives one `ModuleSource` for a plugin and starts
it once per tenant. Each tenant can receive a Compartment keyed by the same
source. The source is shared compilation or source identity; the instances and
their exported state are separate.

```js
const first = new Compartment();
const second = new Compartment();

// Illustrative: the final import signature is specified in spec.emu.
await first.import(pluginSource);
await second.import(pluginSource);
```

This separation is the purpose of using `ModuleSource` as a per-Compartment key.
Caching the source does not accidentally make a plugin singleton across its
consumers.

### A virtualized web compartment

A web-oriented host can resolve an import relative to its referrer URL, fetch
the resource, and obtain its `ModuleSource` through the source phase. The host
can carry the final response URL as host-owned `import.meta` information and can
canonicalize redirected requests before it selects a source key. The Compartment
then supplies a fresh instance memo for that source graph.

The old explainer expressed this as a descriptor returned from a `loadHook`.
That mechanism is not part of this proposal. What remains useful is the
separation of responsibilities: URL resolution and redirects belong to the web
host, source identity belongs to module harmony, and instance identity belongs
to the Compartment.

### A virtualized Node.js compartment

Node.js distinguishes relative paths, packages, and `node:` built-ins. Its
loader can make those distinctions while a Compartment gives the resulting
sources a separate instance index. Crucially, this may happen in Node's existing
realm global. A package graph can be extended in the root realm without putting
its values behind a new context boundary.

This framing also leaves room for Node's loader registration and lower-level
hooks. Compartments must coexist with those mechanisms, rather than requiring a
separate loader registration for every module or requiring a fresh realm for
every graph.

### Bundling and archiving

A bundler can traverse a graph through source-phase information without running
the graph. It records the resources and their host resolution data, then packages
them for a later host to resolve and instantiate. Evaluation happens only when a
Compartment imports an entry.

This keeps a useful lesson from the archived design: graph capture and graph
execution are different jobs. The exact packaging format, and whether a
particular non-JavaScript source is transferable, remain host or follow-on-layer
questions. A compiled `ModuleSource` is the opaque key here, not a substitute
for every bundle manifest.

### Inter-compartment linkage

Package isolation is not useful if every package boundary turns a dependency
into a copy. A module in one Compartment must be able to link to an instance in
another Compartment, including in a cycle that crosses the boundary. For example,
an `even` module in one package graph and an `odd` module in another can depend
on each other without either side creating a duplicate local instance.

That requirement creates an identity problem. Importing a `ModuleSource` into
the local Compartment correctly creates a local instance, which is precisely the
wrong operation for an edge intended to reach a farther Compartment. The design
therefore needs a reusable deferred module-exports namespace identity, keyed by
the target Compartment and a specifier or equivalent source key, available before
the source has been constructed. That placeholder can support cyclic links while
the eventual instance keeps the same identity.

SES explored `compartment.module(specifier)` for this purpose. The fresh design
does not adopt its descriptor vocabulary, but it must state the replacement
identity and lifecycle with equal precision. This is an open specification task,
not an API promised by the current scaffold.

### Linking a virtual module source

The old proposal used a virtual module source to expose JSON as a module: its
declared binding was `default`, and its execution initialized that binding from
parsed JSON. The example still identifies a valuable boundary. A module graph
may include sources not written as JavaScript, and their linking must look like
module linking to importers.

The minimal proposal does not yet adopt a virtual-source protocol. That work can
remain with the module-harmony virtual module source layer, where binding
reflection and execution hooks can be specified together. A Compartment should
remain compatible with that layer without treating a user-defined virtual source
as though every such source were a `ModuleSource` or universally transferable.

### Export aliases and the module-imports namespace

Virtual sources make the distinction between a module's internal bindings and
its exported names visible. A source may initialize `internal` while exporting
it as `external`. Linkers need the imports-side namespace that reflects the
exported names and live bindings, not an object assembled by copying values.

This is a rationale for keeping the virtual-source binding model aligned with
ordinary module linkage. It is not a request for the Compartment core to invent
a second namespace object or a second export-alias mechanism.

### Virtual-source reexports

A virtual source can also reexport another source without an executor of its
own. A JSON adapter, a CommonJS adapter, or a host-defined source can therefore
participate in `export *`-style linkage. The Compartment's job is to preserve the
link between instances. The syntax and binding protocol for a virtual reexport
belong to the virtual-source layer.

### The thenable module hazard

An ordinary dynamic import resolves through a promise. If the resulting module
namespace exports a callable binding named `then`, promise resolution treats the
namespace as a thenable. Code expecting a namespace can receive the value chosen
by that exported `then` instead.

```js
// thenable.js
export function then(resolve) {
  resolve(42);
}

// The callback receives 42, not the namespace object.
import('./thenable.js').then(value => {
  // value === 42
});
```

Compartments should not silently change this behavior. The compatibility cost of
having one kind of dynamic import avoid the hazard would be larger than the
surprise. If the broader module surface supplies a direct namespace or deferred
namespace operation, it can provide a deliberate way to avoid promise adoption;
the Compartment core should preserve ordinary dynamic-import behavior.

## Design questions

- What exact deferred module-exports namespace mechanism represents a link to a
  different Compartment before its source is constructed, and how is it keyed?
- How are cycles spanning Compartments linked and evaluated so their
  top-level-await dependency and error behavior matches ordinary cyclic modules?
- Which global-object choices does the initial constructor expose, and how does
  a shared-root-realm Compartment coexist with a host that permits only one
  loader registration per context?
- Where is the boundary between the minimal `ModuleSource`-keyed core and the
  virtual module source protocol for JSON, CommonJS, WebAssembly, and other
  non-JavaScript modules?
- Does a host need an explicit synchronous evaluation entry point? If so, how
  can it preserve the ordinary rule that a graph containing top-level await
  cannot complete synchronously?
- Can the high-level Compartment surface be expressed in user code with the
  lower-level module-harmony machinery, or do embedded hosts and small bundler
  runtimes justify a native implementation?

## What changed from earlier iterations

The archive remains valuable for its use cases and linkage questions. The fresh
design drops module descriptors, descriptor-returning loader hooks, and any
assumption that SES lockdown or a fresh per-Compartment global is required. It
also defers machinery already being developed in module harmony instead of
repeating it under a Compartment-specific vocabulary.

## Documents and links

- [`spec.emu`](spec.emu) is the normative specification scaffold.
- [`archive/`](archive/ARCHIVE.md) preserves the earlier proposal iterations.
- The project charter records the binding completion criteria, including the
  Node.js viability checklist and the four-engine test requirement.

## Building the spec

`spec.emu` uses [ecmarkup](https://github.com/tc39/ecmarkup). To render it:

```sh
npm install
npm run build   # writes build/index.html
```

## Champions

* Mark S. Miller, Agoric
* Caridy Patiño, Salesforce
* Patrick Soquet, Moddable
* Kris Kowal, Agoric
* Jack Works, Sujitech
* Guy Bedford, OpenJS Foundation

## License

This proposal is licensed under the terms in [LICENSE](LICENSE).
