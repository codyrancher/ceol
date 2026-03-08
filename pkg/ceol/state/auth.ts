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

  const principalId: string = store.getters['auth/principalId'] || '';

  if (principalId) {
    // Kick off async resolution (non-blocking)
    if (!resolvePromise) {
      resolvePromise = resolveFromPrincipal(store, principalId);
    }

    // Return short fallback while resolving
    const fallback = principalId.split('://')[1] || principalId;

    return resolvedUsername || fallback;
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
    if (!resolvePromise) {
      resolvePromise = resolveFromPrincipal(store, principalId);
    }

    return await resolvePromise;
  }

  return '';
}

/**
 * Look up the principal to get the login/display name, then fall back to
 * the user record if the principal is local.
 */
async function resolveFromPrincipal(store: any, principalId: string): Promise<string> {
  const fallback = principalId.split('://')[1] || principalId;

  // Try the principal endpoint first — works for all auth providers
  try {
    const resp = await store.dispatch('management/request', {
      opt: { url: `/v3/principals/${ encodeURIComponent(principalId) }`, method: 'GET' },
    });

    const name = resp?.loginName || resp?.name || resp?.displayName;

    if (name) {
      resolvedUsername = name;

      return name;
    }
  } catch {
    // Principal lookup failed, try user lookup below
  }

  // For local principals (local://user-xxxxx), try the users API
  if (principalId.startsWith('local://')) {
    try {
      const resp = await store.dispatch('management/request', {
        opt: { url: `/v3/users/${ fallback }`, method: 'GET' },
      });

      const name = resp?.username || resp?.name;

      if (name) {
        resolvedUsername = name;

        return name;
      }
    } catch {
      // User lookup also failed
    }
  }

  resolvedUsername = fallback;

  return fallback;
}
