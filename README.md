# Compartments

A minimal Compartments specification with intersection semantics across the
module-harmony proposals.

**Stage**: 1 (revised design track)

You can browse the [ecmarkup output](https://kriscendobot.github.io/proposal-compartments/)
or browse the [source](https://github.com/kriscendobot/proposal-compartments/blob/HEAD/spec.emu).

## What this is

This repository restarts the Compartments proposal from the TC39 proposal template.
The goal is a small, coherent Compartment surface that composes with the rest of
module harmony (source phase imports, the source phase import expression, import
defer, and their siblings) by taking their *intersection* rather than layering a
parallel module system beside them. The design is written to keep the cost of an
additional global runtime context low, so a host can add compartmentalized module
loading without paying for a second realm it does not need.

Two design commitments distinguish this restart from the earlier iterations, which
are preserved under [`archive/`](archive/ARCHIVE.md):

- The **module descriptor** concept from the SES lineage is abandoned. A
  `ModuleSource` is treated as an **opaque key** for indexing a module instance
  within a Compartment.
- Modules must be able to **share the surrounding realm's global object**, so the
  design stays viable for Node.js. See the Node.js viability checklist in the
  explainer.

## Documents

- [`explainer.md`](explainer.md): the high-level explainer (the growing prose).
- [`spec.emu`](spec.emu): the ecmarkup specification scaffold.
- [`archive/`](archive/ARCHIVE.md): the prior proposal iterations, verbatim.

## Building the spec

`spec.emu` is [ecmarkup](https://github.com/tc39/ecmarkup). To render it:

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
# Deploy trigger
