import assert from 'node:assert';

const BASE_URL = process.env.BLIKK_BASE_URL || 'https://publicapi.blikk.com';

let cachedToken: { token: string; expires: number } | null = null;

export class BlikkClient {
  private appId: string;
  private appSecret: string;

  constructor() {
    assert(process.env.BLIKK_APP_ID, 'Missing BLIKK_APP_ID');
    assert(process.env.BLIKK_APP_SECRET, 'Missing BLIKK_APP_SECRET');
    this.appId = process.env.BLIKK_APP_ID!;
    this.appSecret = process.env.BLIKK_APP_SECRET!;
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (cachedToken && cachedToken.expires - 30_000 > now) {
      return cachedToken.token;
    }
    const basic = Buffer.from(`${this.appId}:${this.appSecret}`).toString('base64');
    const res = await fetch(`${BASE_URL}/v1/Auth/Token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
      },
      // body not required by docs
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to get token: ${res.status} ${res.statusText} - ${text}`);
    }
    const json = (await res.json()) as { accessToken: string; expires: string };
    const expiresMs = new Date(json.expires).getTime();
    cachedToken = { token: json.accessToken, expires: expiresMs };
    return json.accessToken;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.getToken();
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
      cache: 'no-store',
    });

    if (res.status === 429) {
      // retry once using Retry-After
      const retryAfter = Number(res.headers.get('Retry-After') || '1');
      await new Promise((r) => setTimeout(r, Math.min(retryAfter, 5) * 1000));
      return this.request<T>(path, init);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Blikk ${init.method || 'GET'} ${path} -> ${res.status}: ${text}`);
    }

    if (res.status === 204) return undefined as unknown as T;
    return (await res.json()) as T;
  }

  // NOTE: Removed contacts/users/create endpoints for now to keep the project lean.
  // We keep only project lookup functionality used by the UI.

  // Get single project by id
  getProjectById(id: number) {
    return this.request(`/v1/Core/Projects/${id}`);
  }

  // Convenience: try to get a project by exact order number
  async getProjectByOrderNumber(orderNumber: string) {
    // Direct filtering via query; if API requires broader search, we still fetch the list here.
    const page = 1, pageSize = 25;
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    qs.set('filter.query', orderNumber);
    const list: any = await this.request(`/v1/Core/Projects?${qs.toString()}`);
    const exact = (list.items || []).find((p: any) => String(p.orderNumber) === String(orderNumber));
    return exact ?? (list.items && list.items[0]) ?? null;
  }
}

export function getBlikk() {
  return new BlikkClient();
}
