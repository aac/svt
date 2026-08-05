/**
 * Surface manifest types — the libraries[] + wiring[] shape from the design
 * brief's worked example 1.
 *
 * A "manifest" is the JSON a managing agent writes to compose a surface page
 * from libraries. It names the libraries to mount (each with its config) and a
 * wiring array that glues them together without either library importing the
 * other.
 *
 * This file is pure data shape — it imports NEITHER library. The runtime
 * (runtime.ts) is the one place that knows how to interpret it.
 */

/**
 * The composition app's own domain item type. The cockpit ENGINE holds items
 * opaquely (it only reads `id`); the DISPLAY (@surface/cockpit-ui) learns what to
 * render via the app's `mapItem`. So title/body/accent are app-owned display data
 * here, not engine state. (Replaces the old `CockpitItem` import after the
 * engine/display split.)
 */
export interface TriageItem {
  id: string;
  title: string;
  body: string;
  /** Optional presentational accent (e.g. the voice go/wait rail). */
  accent?: string;
  /** Opaque domain metadata the managing app may carry (e.g. a photo URL). */
  meta?: Record<string, unknown>;
}

/** A library to mount, by name, with its library-defined config blob. */
export interface ManifestLibrary {
  /** Library name. The runtime resolves this to a mount function. */
  name: string;
  /** Library-defined config. Opaque to the manifest; each library documents its shape. */
  config: Record<string, unknown>;
}

/**
 * One wiring edge: when bus event `on` fires, call method `call`.
 *
 * `call` is a dotted path `"<library>.<method>"` — e.g. `"voice.setCorrelationId"`.
 * The runtime resolves the left side to a mounted library handle and the right
 * side to a method on it. The payload of the bus event is passed as the argument.
 *
 * This is the glue that substitutes for libraries importing each other. The
 * design brief's open question #3 considered alternatives (a self-wiring
 * `dependsOn` method, or no glue runtime at all); the manifest-interpreted
 * `wiring[]` array is the simplest and is what this runtime implements.
 */
export interface ManifestWiring {
  /** Bus event name to subscribe to (e.g. 'focused-item'). */
  on: string;
  /** Dotted "<library>.<method>" to invoke with the event payload. */
  call: string;
}

/** A full surface manifest. */
export interface SurfaceManifest {
  libraries: ManifestLibrary[];
  wiring?: ManifestWiring[];
}
