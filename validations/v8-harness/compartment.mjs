// A semantic conformance harness for the fresh Compartments proposal.
//
// This is NOT a V8-native implementation. It implements the normative
// operations of proposal-compartments spec.emu (Compartment source keys,
// GetCompartmentExportsNamespace, GetOrCreateCompartmentModule, the
// constructor, exports, and import) on top of Node's vm.SourceTextModule,
// which supplies the ordinary Module Record Load/Link/Evaluate lifecycle and,
// with no explicit context, the surrounding realm's global object.
//
// Its purpose is to prove the proposal's operation surface is executable and
// self-consistent, and to serve as a behavioral oracle for a real V8 port.

import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// --- Compartment source keys -------------------------------------------------
//
// A source key is a source-phase module source object. Here it is an opaque
// object carrying an emulated [[ModuleSourceRecord]] internal slot (membership
// in this WeakSet). Two source keys are the same key only if they are the same
// object; source-phase import supplies a stable object per resolved specifier,
// so we memoize keys by resolved absolute path.

const moduleSourceRecordBrand = new WeakSet();
const pathBySourceKey = new WeakMap();
const sourceKeyByPath = new Map();

// A minimal stand-in for %AbstractModuleSource%.prototype so an inheriting
// object has a plausible prototype yet still lacks the internal slot.
const AbstractModuleSourceProto = Object.freeze(Object.create(null));

function acquireSourceKey(resolvedPath) {
  let key = sourceKeyByPath.get(resolvedPath);
  if (key === undefined) {
    key = Object.create(AbstractModuleSourceProto);
    moduleSourceRecordBrand.add(key); // the [[ModuleSourceRecord]] slot
    Object.freeze(key);
    pathBySourceKey.set(key, resolvedPath);
    sourceKeyByPath.set(resolvedPath, key);
  }
  return key;
}

// RequireCompartmentSourceKey ( source )
function requireCompartmentSourceKey(source) {
  if (source === null || (typeof source !== "object" && typeof source !== "function")) {
    throw new TypeError("Compartment source key must be an Object");
  }
  if (!moduleSourceRecordBrand.has(source)) {
    throw new TypeError("value lacks a [[ModuleSourceRecord]] internal slot");
  }
}

// Resolve a specifier that a fixture (or a test) mentions, relative to a
// referrer path, into the canonical absolute path used to key its source.
//
// COMPARTMENT_FIXTURES_DIR, when set, redirects any `…/fixtures/NAME` specifier
// to that single staging fixtures directory. This works around a defect in the
// staged suite (nested tests write `./fixtures/…` where the shared directory is
// one level up at `../fixtures/…`) so the harness can still exercise the
// proposal semantics; the defect itself is reported separately.
function resolveSpecifier(specifier, referrerPath) {
  const fixturesDir = process.env.COMPARTMENT_FIXTURES_DIR;
  if (fixturesDir) {
    const m = specifier.match(/(?:^|\/)fixtures\/([^/]+)$/);
    if (m) return fileURLToPath(pathToFileURL(fixturesDir + "/" + m[1]));
  }
  const base = pathToFileURL(referrerPath);
  const url = new URL(specifier, base);
  return fileURLToPath(url);
}

// --- The deferred Compartment exports namespace ------------------------------
//
// Per spec this is a plain identity object (explicitly not an import-defer
// namespace and not a real module namespace exotic object). Before its
// [[Module]] is set it exposes no bindings; once linked and evaluated it
// exposes the module's exported names as live getters and keeps its identity.

function makeDeferredNamespace() {
  return Object.create(null);
}

function populateNamespace(namespace, moduleNamespace) {
  for (const name of Object.keys(moduleNamespace)) {
    if (Object.prototype.hasOwnProperty.call(namespace, name)) continue;
    Object.defineProperty(namespace, name, {
      get() {
        return moduleNamespace[name];
      },
      enumerable: true,
      configurable: true,
    });
  }
}

function loadSourceText(sourceKey) {
  return readFileSync(pathBySourceKey.get(sourceKey), "utf8");
}

// --- The Compartment ---------------------------------------------------------

export class Compartment {
  #realm;
  #globalObject;
  #moduleInstances = new Map(); // source key -> { module, namespace, promise }
  #exportsNamespaces = new Map(); // source key -> deferred namespace

  constructor() {
    // Records the current Realm and its global object. No new realm, global,
    // or evaluator is created.
    this.#realm = globalThis;
    this.#globalObject = globalThis;
  }

  #getCompartmentExportsNamespace(source) {
    let namespace = this.#exportsNamespaces.get(source);
    if (namespace === undefined) {
      namespace = makeDeferredNamespace();
      this.#exportsNamespaces.set(source, namespace);
    }
    return namespace;
  }

  #linker = async (specifier, referencingModule) => {
    const resolved = resolveSpecifier(specifier, referencingModule.identifier);
    const depSource = acquireSourceKey(resolved);
    const rec = this.#getOrCreateCompartmentModule(depSource);
    return rec.module;
  };

  #getOrCreateCompartmentModule(source) {
    let rec = this.#moduleInstances.get(source);
    if (rec !== undefined) return rec;
    const file = pathBySourceKey.get(source);
    const text = loadSourceText(source);
    const module = new vm.SourceTextModule(text, {
      identifier: file,
      initializeImportMeta(meta) {
        meta.url = pathToFileURL(file).href;
      },
    });
    rec = { module, namespace: this.#getCompartmentExportsNamespace(source) };
    // Store before loading requested modules so a cycle finds this instance.
    this.#moduleInstances.set(source, rec);
    return rec;
  }

  exports(source) {
    if (!this.#moduleInstances) throw new TypeError("not a Compartment");
    requireCompartmentSourceKey(source);
    return this.#getCompartmentExportsNamespace(source);
  }

  import(source) {
    if (!this.#moduleInstances) throw new TypeError("not a Compartment");
    requireCompartmentSourceKey(source); // synchronous API error for a bad key
    const namespace = this.#getCompartmentExportsNamespace(source);
    const rec = this.#getOrCreateCompartmentModule(source);
    if (rec.promise === undefined) {
      rec.promise = (async () => {
        if (rec.module.status === "unlinked") {
          await rec.module.link(this.#linker);
        }
        await rec.module.evaluate();
        populateNamespace(namespace, rec.module.namespace);
        return namespace;
      })();
    }
    return rec.promise;
  }
}

// --- Source-phase acquisition exposed to transformed tests -------------------

export function sourceKeyForSpecifier(specifier, referrerPath) {
  return acquireSourceKey(resolveSpecifier(specifier, referrerPath));
}

export function importSourceExpression(specifier, referrerPath) {
  // import.source(specifier): a Promise for the same stable source object.
  return Promise.resolve(sourceKeyForSpecifier(specifier, referrerPath));
}
