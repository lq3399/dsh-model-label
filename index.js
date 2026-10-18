/**
 * dsh-model-label — plugin entry (Host half).
 *
 * The whole feature lives in the browser half (`./client.js`), which shadows the
 * composer's model seat to print `{provider}/{model} · {effort}`. The Host half
 * therefore does nothing but exist: the module-loader graph binds a package's
 * browser half to the Loader entry whose `name` is the bare package name, so the
 * entry must be mounted even though it registers no Host service.
 *
 * Exports only `apply`, the same shape every shipped pure-UI Host half uses;
 * the browser half declares its own service injections.
 *
 * @module index.js
 */

/**
 * Host-half body. Intentionally empty.
 * @returns {void}
 */
export function apply() {}
