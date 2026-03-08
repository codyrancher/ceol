// Cached resolved username so we only look it up once.
let resolvedUsername = '';
let resolvePromise: Promise<string> | null = null;

/**
 * Resolve the current username from the Rancher store (synchronous).
 * Returns the cached username immediately. On first call it kicks off
 * an async lookup and returns the principalId-based fallback until resolved.
 */
export function getUsername(store: any): string {
  if (resolvedUsername) {
    return resolvedUsername;
  }

  const v3User = store.getters['auth/v3User'];

  if (v3User?.username) {
    resolvedUsername = v3User.username;

    return resolvedUsername;
  }

  if (v3User?.name) {
    resolvedUsername = v3User.name;

    return resolvedUsername;
  }

  // External auth provider — principalId is like "local://user-s6tpt"
  const principalId: string = store.getters['auth/principalId'] || '';

  if (principalId) {
    const userId = principalId.split('://')[1] || '';

    if (userId) {
      // Kick off async resolution (non-blocking)
      if (!resolvePromise) {
        resolvePromise = resolveUsernameFromApi(store, userId);
      }

      // Return userId as temporary fallback
      return resolvedUsername || userId;
    }
  }

  return '';
}

/**
 * Async version — awaits the API lookup so the caller gets the real username.
 * Use this in async contexts (e.g. createApp, saveAppMeta) where accuracy matters.
 */
export async function resolveUsername(store: any): Promise<string> {
  if (resolvedUsername) {
    return resolvedUsername;
  }

  const v3User = store.getters['auth/v3User'];

  if (v3User?.username) {
    resolvedUsername = v3User.username;

    return resolvedUsername;
  }

  if (v3User?.name) {
    resolvedUsername = v3User.name;

    return resolvedUsername;
  }

  const principalId: string = store.getters['auth/principalId'] || '';

  if (principalId) {
    const userId = principalId.split('://')[1] || '';

    if (userId) {
      if (!resolvePromise) {
        resolvePromise = resolveUsernameFromApi(store, userId);
      }

      return await resolvePromise;
    }
  }

  return '';
}

async function resolveUsernameFromApi(store: any, userId: string): Promise<string> {
  try {
    const resp = await store.dispatch('management/request', {
      opt: { url: `/v3/users/${ userId }`, method: 'GET' },
    });

    const name = resp?.username || resp?.name || userId;

    resolvedUsername = name;

    return name;
  } catch {
    // API call failed — fall back to userId
    resolvedUsername = userId;

    return userId;
  }
}
