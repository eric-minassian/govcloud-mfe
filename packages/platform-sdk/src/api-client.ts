/** Thrown for any non-2xx response from the frontend API. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * The ALB session is gone. The ALB either answered 401 (the `/api/*` rule uses
 * `OnUnauthenticatedRequest: deny`) or tried to redirect us to the identity provider.
 */
export class SessionExpiredError extends Error {
  constructor() {
    super('Your session has expired');
    this.name = 'SessionExpiredError';
  }
}

/**
 * `fetch` for the same-origin frontend API.
 *
 * Authentication is entirely the ALB's job: the browser sends the ALB session cookie and the ALB
 * forwards a signed identity header to the API. There are no tokens to manage in the browser.
 *
 * `redirect: 'manual'` matters: when a session expires the ALB may answer with a 302 to the IdP.
 * Following that cross-origin redirect from `fetch` fails with an opaque CORS error, so instead we
 * detect it and restart the login with a full-page navigation.
 */
export async function apiFetch<T>(path: `/api/${string}`, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    redirect: 'manual',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (response.status === 401 || response.type === 'opaqueredirect') {
    restartLogin();
    throw new SessionExpiredError();
  }
  if (!response.ok) {
    throw new ApiError(
      response.status,
      `${init.method ?? 'GET'} ${path} failed: ${response.status}`,
    );
  }
  if (response.status === 202 || response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

let loginRestarted = false;

/** A full-page load goes through the ALB's authenticate action, which sends the user to the IdP. */
function restartLogin() {
  if (loginRestarted) return;
  loginRestarted = true;
  window.location.reload();
}
