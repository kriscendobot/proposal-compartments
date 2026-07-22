# Archived Compartments proposal iterations

This directory preserves the prior proposal-compartments material verbatim, moved
here unchanged when the repository was reset to a fresh TC39 proposal template. Git
history for every file is intact; `git log --follow archive/<file>` recovers it.

Contents at the time of archival:

- `README.md`: the Stage 1 Compartments explainer as it stood upstream.
- `0-module-and-module-source.{md,emu,html}`: the Module and ModuleSource layer.
- `1-static-analysis.md`: static analysis notes.
- `2-virtual-module-source.md`: the virtual module source layer.
- `3-evaluator.md`: the evaluator layer.
- `4-compartment.md`: the Compartment layer.
- `GRAPH.md`: the layering graph across the numbered documents.
- `index.html`: the rendered ecmarkup output for the archived spec.
- `package.json`: the build scripts that produced the archived renders.

The fresh design at the repository root starts from the TC39 proposal template and
pursues a minimal Compartments specification with intersection semantics across the
module-harmony proposals. See the root `README.md`.
