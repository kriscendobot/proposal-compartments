# Compartments explainer

This is the working explainer for a fresh Compartments proposal. It restarts the
design from the TC39 proposal template and aims for a small surface that composes
with the rest of module harmony. It is a stub that will grow section by section;
the normative text lives in [`spec.emu`](spec.emu).

## The problem

Hosts and libraries need to load and evaluate modules under their own control: a
private module graph, a substituted set of built-ins, or an isolated evaluation
context. The earlier Compartments iterations (preserved in [`archive/`](archive/ARCHIVE.md))
grew a layered module system with its own descriptor vocabulary. Module harmony
has since introduced first-class module machinery of its own: the source phase, a
`ModuleSource` value, deferred evaluation, and dynamic source imports. A fresh
Compartment can lean on that machinery instead of duplicating it.

## Approach: intersection, not addition

The design takes the *intersection* of the related module-harmony proposals rather
than adding a parallel system beside them. Concretely:

- **`ModuleSource` as an opaque key.** A Compartment maps a `ModuleSource` value to
  at most one module instance. The source is a key, not a descriptor to be
  interpreted. The SES-era module descriptor concept is abandoned.
- **Source phase imports.** The static `import source` form and the dynamic source
  phase import expression already yield `ModuleSource` values. A Compartment
  consumes those values; it does not introduce a second way to name a source.
- **Import defer.** Deferred evaluation composes with a Compartment's source-key
  indexing rather than defining its own deferral.

The goal of the intersection framing is to keep the specification minimal and to
minimize the cost of an additional global runtime context.

## Node.js viability: sharing the surrounding global

A Compartment must be able to evaluate modules against the *surrounding realm's*
global object, not only against a freshly created one. Without this, a host such
as Node.js would have to stand up a second global context to use Compartments,
which defeats the minimality goal.

The requirements pulled from the Node.js discussion at
<https://github.com/nodejs/node/issues/62720> are tracked as a checklist in the
project charter (in the garden journal at
`journal/projects/proposal-compartments/README.md`). Each requirement is a place
where this proposal must either satisfy the constraint or record the shortfall as
a work item.

## Grounding

- The specification as written is the ground truth.
- The XS reference implementation is the guide for behavior.
- SES details are incorporated only where necessary.

## Validation

The design is validated by implementation in v8 and JSC (new), alongside the
existing endor and XS validations, and by test262 tests consolidated and
reconciled from hardened262, XS, and endor.

## Status and open sections

The `spec.emu` scaffold names the intersection surface: the ModuleSource key, the
Compartment object and its `import` entry point, global-object sharing, and the
intersections with source phase imports, the source phase import expression, and
import defer. Each is currently a placeholder to be filled in.
