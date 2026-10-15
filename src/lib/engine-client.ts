"use client";

/**
 * Main-thread handle to the engine worker. The worker starts on first use,
 * not at page load, and is a module worker so it can import the engine
 * directly. Every call returns a Promise; callbacks passed to it must be
 * wrapped with Comlink.proxy() (Comlink is re-exported for that). Results
 * are structured-cloned copies, so mutating them never affects the engine.
 */
import * as Comlink from "comlink";
import type { EngineApi } from "@/workers/engine.worker";

let worker: Worker | null = null;
let remote: Comlink.Remote<EngineApi> | null = null;

/**
 * Lazily starts the engine worker (one per tab).
 * The `new URL(..., import.meta.url)` form is what lets the bundler emit the
 * worker as its own chunk; keep it literal.
 */
export function engine(): Comlink.Remote<EngineApi> {
  if (!remote) {
    worker = new Worker(new URL("../workers/engine.worker.ts", import.meta.url), {
      type: "module",
      name: "loupe-engine",
    });
    remote = Comlink.wrap<EngineApi>(worker);
  }
  return remote;
}

/**
 * Terminates the worker, freeing all dataset memory (used by "Start over").
 * Calls still in flight on the old worker never settle (a terminated worker
 * sends no reply), so callers must not await them. The next engine() call
 * starts a fresh worker with an empty session.
 */
export function resetEngine(): void {
  worker?.terminate();
  worker = null;
  remote = null;
}

export { Comlink };
