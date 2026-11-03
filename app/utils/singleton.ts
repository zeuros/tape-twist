import { effectScope } from 'vue'

/**
 * A composable whose state is shared by every component that calls it (one instance per
 * page load; the app is client-only, `ssr: false`). Its watchers live in their own scope.
 *
 * Inside `setup`, other singletons may only be called from functions, not at setup time
 * (two singletons that need each other would otherwise build each other forever).
 */
export function defineSingleton<T>(setup: () => T): () => T {
  let state: T | undefined
  return () => {
    if (state === undefined) state = effectScope(true).run(setup)!
    return state
  }
}
