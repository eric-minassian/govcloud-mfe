import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, SessionExpiredError } from '../src/api-client';

function mockFetch(response: Partial<Response>) {
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, type: 'basic', ...response });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('apiFetch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends same-origin credentials and never follows redirects', async () => {
    const fetch = mockFetch({ json: async () => ({ sub: 'u1' }) });

    await expect(apiFetch('/api/me')).resolves.toEqual({ sub: 'u1' });
    expect(fetch).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({ credentials: 'same-origin', redirect: 'manual' }),
    );
  });

  it('treats a 401 as an expired session and restarts the login', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    mockFetch({ ok: false, status: 401 });

    await expect(apiFetch('/api/me')).rejects.toBeInstanceOf(SessionExpiredError);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('treats an ALB redirect to the IdP as an expired session', async () => {
    vi.stubGlobal('location', { reload: vi.fn() });
    mockFetch({ ok: false, status: 0, type: 'opaqueredirect' });

    await expect(apiFetch('/api/me')).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it('surfaces other failures as ApiError with the status code', async () => {
    mockFetch({ ok: false, status: 503 });

    await expect(apiFetch('/api/modules')).rejects.toMatchObject(
      new ApiError(503, 'GET /api/modules failed: 503'),
    );
  });
});
