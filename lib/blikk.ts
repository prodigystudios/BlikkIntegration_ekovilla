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
      console.error('Blikk API error', { method: init.method || 'GET', path, status: res.status, text });
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

  // Add a comment/note to a project (path customizable via env)
  async addProjectComment(projectId: number, text: string) {
    // Allow overriding path and body key via env to match Blikk API if it differs
    const envPath = process.env.BLIKK_COMMENTS_PATH_TEMPLATE || null;
    const envBodyKey = process.env.BLIKK_COMMENTS_BODY_KEY || null;

    const defaultPath = '/v1/Core/Projects/{id}/Comments';
    const altPath = '/v1/Core/Projects/{id}/Notes';
    const keys = envBodyKey ? [envBodyKey] : ['text', 'comment'];
    const paths = envPath ? [envPath] : [defaultPath, altPath];

    let lastErr: any = null;
    for (const pt of paths) {
      for (const key of keys) {
        const path = pt.replace('{id}', String(projectId));
        const body: Record<string, any> = {};
        body[key] = text;
        try {
          return await this.request(path, {
            method: 'POST',
            body: JSON.stringify(body),
          });
        } catch (e: any) {
          lastErr = e;
          console.warn('Blikk addProjectComment failed, trying next combination', { path, key, error: String(e?.message || e) });
        }
      }
    }
    throw lastErr || new Error('Failed to post comment');
  }

  // Add a comment to a task (path customizable via env and tolerant to resource family)
  async addTaskComment(taskId: number, text: string, basePath?: string): Promise<{ data: any; usedPath: string; usedKey: string }> {
    const envPath = process.env.BLIKK_TASK_COMMENTS_PATH_TEMPLATE || null; // e.g., '/v1/Core/Tasks/{id}/Comments'
    const envBodyKey = process.env.BLIKK_TASK_COMMENTS_BODY_KEY || null; // e.g., 'text' or 'comment'

  const keys = envBodyKey ? [envBodyKey] : ['text', 'comment', 'body', 'content', 'message', 'Text'];

    const makeBase = (p: string) => p.split('?')[0].replace(/\/?$/, '');
    const baseCandidates = [basePath ? makeBase(basePath) : null, process.env.BLIKK_TASKS_PATH || null].filter(Boolean) as string[];

    const paths: string[] = [];
    if (envPath) {
      paths.push(envPath.replace('{id}', String(taskId)));
    } else {
      // Prefer the same family used on creation if provided
      for (const b of baseCandidates) {
        paths.push(`${b}/${taskId}/Comments`);
        paths.push(`${b}/${taskId}/Notes`);
      }
      // Generic fallbacks across families
      paths.push(`/v1/Core/Tasks/${taskId}/Comments`);
      paths.push(`/v1/Core/Tasks/${taskId}/Notes`);
      paths.push(`/v1/Core/Todos/${taskId}/Comments`);
      paths.push(`/v1/Core/Todos/${taskId}/Notes`);
      paths.push(`/v1/Tasks/${taskId}/Comments`);
      paths.push(`/v1/Tasks/${taskId}/Notes`);
    }

    let lastErr: any = null;
    for (const path of paths) {
      for (const key of keys) {
        const body: Record<string, any> = {};
        body[key] = text;
        try {
          const data = await this.request(path, { method: 'POST', body: JSON.stringify(body) });
          return { data, usedPath: path, usedKey: key };
        } catch (e: any) {
          lastErr = e;
          console.warn('Blikk addTaskComment failed, trying next combination', { path, key, error: String(e?.message || e) });
        }
      }
    }
    throw lastErr || new Error('Failed to post task comment');
  }

  // Create a task (for "Beställning kläder" or similar). Allows env overrides and tolerant field names.
  async createTask(input: {
    title: string;
    description?: string;
    projectId?: number | null;
    assignedUserId?: number | null;
    dueDate?: string | null; // ISO date string
    preferredPath?: string | null; // allow forcing a specific create path
  }): Promise<{ data: any; usedPath: string; sentBody: any }> {
    const envCreate = process.env.BLIKK_TASKS_CREATE_PATH || null;
    const envPath = process.env.BLIKK_TASKS_PATH || null; // legacy
    const defaults = [
      '/v1/Core/Tasks',
    ];
    const order = [input.preferredPath, envCreate, envPath, ...defaults].filter(Boolean) as string[];
    const seen = new Set<string>();
    const paths = order.filter((p) => {
      const k = p.split('?')[0];
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const resolvedProjectId = input.projectId ?? (process.env.BLIKK_DEFAULT_PROJECT_ID ? Number(process.env.BLIKK_DEFAULT_PROJECT_ID) : undefined);
    const resolvedAssignee = input.assignedUserId ?? (process.env.BLIKK_DEFAULT_ASSIGNEE_ID ? Number(process.env.BLIKK_DEFAULT_ASSIGNEE_ID) : undefined);

    const body: Record<string, any> = {
      // Title/name
      title: input.title,
      name: input.title,
      // Description/text
      description: input.description ?? '',
      text: input.description ?? '',
    };
    if (resolvedProjectId != null) {
      body.projectId = resolvedProjectId;
      body.project = { id: resolvedProjectId };
    }
    if (resolvedAssignee != null) {
      // cover various field names Blikk might accept
      body.assignedUserId = resolvedAssignee;
      body.assignedToUserId = resolvedAssignee;
      body.assignedTo = { id: resolvedAssignee };
      body.responsibleUserId = resolvedAssignee;
      body.assigneeId = resolvedAssignee;
      body.userId = resolvedAssignee;
    }
    if (input.dueDate != null) {
      body.dueDate = input.dueDate;
      body.endDate = input.dueDate;
    }

    let lastErr: any = null;
    for (const path of paths) {
      try {
        const data = await this.request(path, { method: 'POST', body: JSON.stringify(body) });
        return { data, usedPath: path, sentBody: body };
      } catch (e: any) {
        lastErr = e;
        console.warn('Blikk createTask failed, trying next path', { path, error: String(e?.message || e) });
      }
    }
    throw lastErr || new Error('Failed to create task');
  }

  // Fetch a single task by id. Prefer using the same base path as creation (usedPath).
  async getTaskById(id: number, basePath?: string) {
    const envPath = process.env.BLIKK_TASKS_PATH || null;
    const envListPath = process.env.BLIKK_TASKS_LIST_PATH || null;
    const defaults = [
      '/v1/Core/Tasks',
    ];
    // Combine basePath and env overrides with defaults, removing duplicates
    const all = [basePath, envListPath, envPath, ...defaults].filter(Boolean) as string[];
    const seen = new Set<string>();
    const candidates = all.filter((p) => {
      const k = p.split('?')[0];
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const toCleanBase = (p: string) => p.split('?')[0].replace(/\/?$/, '');

    let lastErr: any = null;
    for (const p of candidates) {
      const base = toCleanBase(p);
      const path = `${base}/${id}`;
      try {
        return await this.request(path);
      } catch (e: any) {
        lastErr = e;
        console.warn('Blikk getTaskById failed, trying next', { path, error: String(e?.message || e) });
      }
    }
    throw lastErr || new Error('Failed to fetch task by id');
  }

  // Best-effort assignment fallback: some tenants require a separate call to add assignees.
  async assignTaskUsers(taskId: number, userIds: number[], basePath?: string) {
    if (!userIds.length) return { ok: false, tried: [], error: 'No userIds provided' };
    const envPath = process.env.BLIKK_TASKS_PATH || null;
    const defaults = [
      '/v1/Core/Tasks',
    ];
    const allBases = [basePath, envPath, ...defaults].filter(Boolean) as string[];
    const clean = (p: string) => p.split('?')[0].replace(/\/?$/, '');
    const bases = Array.from(new Set(allBases.map(clean)));

    const bodies: Array<{ method: string; pathTmpl: string; body: any }> = [];
  for (const b of bases) {
      // Relation endpoints: Assignees / ResponsibleUsers / Assign
      bodies.push({ method: 'POST', pathTmpl: `${b}/{id}/Assignees`, body: { userIds } });
      bodies.push({ method: 'POST', pathTmpl: `${b}/{id}/Assignees`, body: { users: userIds.map((id) => ({ id })) } });
      bodies.push({ method: 'POST', pathTmpl: `${b}/{id}/ResponsibleUsers`, body: { userIds } });
      bodies.push({ method: 'POST', pathTmpl: `${b}/{id}/ResponsibleUsers`, body: { users: userIds.map((id) => ({ id })) } });
      bodies.push({ method: 'POST', pathTmpl: `${b}/{id}/Assign`, body: { userId: userIds[0] } });
      bodies.push({ method: 'POST', pathTmpl: `${b}/{id}/Assign`, body: { userIds } });
  bodies.push({ method: 'POST', pathTmpl: `${b}/{id}/Users`, body: { userIds } });
  bodies.push({ method: 'POST', pathTmpl: `${b}/{id}/Members`, body: { userIds } });
      // Direct PATCH on task resource with various accepted shapes
      bodies.push({ method: 'PATCH', pathTmpl: `${b}/{id}`, body: { assigneeId: userIds[0] } });
      bodies.push({ method: 'PATCH', pathTmpl: `${b}/{id}`, body: { assignedUserId: userIds[0] } });
      bodies.push({ method: 'PATCH', pathTmpl: `${b}/{id}`, body: { responsibleUserId: userIds[0] } });
      bodies.push({ method: 'PATCH', pathTmpl: `${b}/{id}`, body: { assignedToUserId: userIds[0] } });
      bodies.push({ method: 'PATCH', pathTmpl: `${b}/{id}`, body: { assignedUsers: userIds } });
      bodies.push({ method: 'PATCH', pathTmpl: `${b}/{id}`, body: { responsibleUserIds: userIds } });
      bodies.push({ method: 'PATCH', pathTmpl: `${b}/{id}`, body: { assignees: userIds.map((id) => ({ id })) } });
    }

    const tried: Array<{ method: string; path: string; body: any; error?: string }> = [];
    for (const attempt of bodies) {
      const path = attempt.pathTmpl.replace('{id}', String(taskId));
      try {
        const res = await this.request(path, { method: attempt.method as any, body: JSON.stringify(attempt.body) });
        return { ok: true, method: attempt.method, path, body: attempt.body, res };
      } catch (e: any) {
        tried.push({ method: attempt.method, path, body: attempt.body, error: String(e?.message || e) });
      }
    }
    return { ok: false, tried };
  }

  // List tasks for verification/debug purposes. Allows pinning the basePath (same as creation),
  // optional sorting and createdFrom filtering with multiple param variants.
  async listTasks(opts?: {
    basePath?: string;
    query?: string;
    assignedUserId?: number;
    page?: number;
    pageSize?: number;
    createdFrom?: string; // ISO date
    sortDesc?: boolean; // default true
  }) {
    const envPath = process.env.BLIKK_TASKS_PATH || null;
    const envListPath = process.env.BLIKK_TASKS_LIST_PATH || null;
    const defaults = [
      '/v1/Core/Tasks',
      '/v1/Core/Todos',
      '/v1/Tasks',
    ];
    // Combine basePath and env overrides with defaults, removing duplicates
  const all = [envListPath, opts?.basePath, envPath, ...defaults].filter(Boolean) as string[];
    const seen = new Set<string>();
    const candidates = all.filter((p) => {
      const k = p.split('?')[0];
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const page = opts?.page ?? 1;
    const pageSize = opts?.pageSize ?? 25;
    const sortDesc = opts?.sortDesc ?? true;
    const queryKeys = ['filter.query', 'query', 'q'];
    const assigneeKeys = ['filter.assignedUserId', 'assignedUserId', 'assigneeId'];
    const createdFromKeys = ['filter.createdFrom', 'createdFrom', 'from', 'startDate', 'createdSince'];

    // Different ways APIs sometimes specify sorting
    const sortParamSets: Array<Record<string, string>> = sortDesc ? [
      { sort: 'createdAt:desc' },
      { sort: 'created:desc' },
      { orderBy: 'createdAt', orderDirection: 'desc' },
      { sortBy: 'createdAt', direction: 'desc' },
      { order: 'desc' },
    ] : [
      { sort: 'createdAt:asc' },
      { sort: 'created:asc' },
      { orderBy: 'createdAt', orderDirection: 'asc' },
      { sortBy: 'createdAt', direction: 'asc' },
      { order: 'asc' },
    ];

    let lastErr: any = null;
    for (const path of candidates) {
      const baseQs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (opts?.query) for (const k of queryKeys) baseQs.set(k, opts.query);
      if (opts?.assignedUserId != null) for (const k of assigneeKeys) baseQs.set(k, String(opts.assignedUserId));
      if (opts?.createdFrom) for (const k of createdFromKeys) baseQs.set(k, opts.createdFrom);

      // Try with different sort param combos; fall back to no sort if all fail
      const attempts: Array<URLSearchParams> = [
        ...sortParamSets.map((sp) => {
          const qs = new URLSearchParams(baseQs);
          for (const [k, v] of Object.entries(sp)) qs.set(k, v);
          return qs;
        }),
        baseQs,
      ];

      for (const qs of attempts) {
        try {
          const url = `${path}?${qs.toString()}`;
          return await this.request(url);
        } catch (e: any) {
          lastErr = e;
          console.warn('Blikk listTasks failed, trying next', { path, params: Object.fromEntries((qs as any).entries ? (qs as any).entries() : []), error: String(e?.message || e) });
        }
      }
    }
    throw lastErr || new Error('Failed to list tasks');
  }

  // Same as listTasks but returns the usedPath and query params for debugging.
  async listTasksWithMeta(opts?: {
    basePath?: string;
    query?: string;
    assignedUserId?: number;
    page?: number;
    pageSize?: number;
    createdFrom?: string;
    sortDesc?: boolean;
    preferBasePath?: boolean; // if true, try basePath before env overrides
  }): Promise<{ data: any; usedPath: string; params: Record<string, string> }> {
    const envPath = process.env.BLIKK_TASKS_PATH || null;
    const envListPath = process.env.BLIKK_TASKS_LIST_PATH || null;
    const defaults = [
      '/v1/Core/Tasks',
      '/v1/Core/Todos',
      '/v1/Tasks',
    ];
    const order = opts?.preferBasePath
      ? [opts?.basePath, envListPath, envPath, ...defaults]
      : [envListPath, opts?.basePath, envPath, ...defaults];
    const all = order.filter(Boolean) as string[];
    const seen = new Set<string>();
    const candidates = all.filter((p) => {
      const k = p.split('?')[0];
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const page = opts?.page ?? 1;
    const pageSize = opts?.pageSize ?? 25;
    const sortDesc = opts?.sortDesc ?? true;
    const queryKeys = ['filter.query', 'query', 'q'];
    const assigneeKeys = ['filter.assignedUserId', 'assignedUserId', 'assigneeId'];
    const createdFromKeys = ['filter.createdFrom', 'createdFrom', 'from', 'startDate', 'createdSince'];
    const sortParamSets: Array<Record<string, string>> = sortDesc ? [
      { sort: 'createdAt:desc' },
      { sort: 'created:desc' },
      { orderBy: 'createdAt', orderDirection: 'desc' },
      { sortBy: 'createdAt', direction: 'desc' },
      { order: 'desc' },
    ] : [
      { sort: 'createdAt:asc' },
      { sort: 'created:asc' },
      { orderBy: 'createdAt', orderDirection: 'asc' },
      { sortBy: 'createdAt', direction: 'asc' },
      { order: 'asc' },
    ];

    let lastErr: any = null;
    for (const path of candidates) {
      const baseQs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (opts?.query) for (const k of queryKeys) baseQs.set(k, opts.query);
      if (opts?.assignedUserId != null) for (const k of assigneeKeys) baseQs.set(k, String(opts.assignedUserId));
      if (opts?.createdFrom) for (const k of createdFromKeys) baseQs.set(k, opts.createdFrom);

      const attempts: Array<URLSearchParams> = [
        ...sortParamSets.map((sp) => {
          const qs = new URLSearchParams(baseQs);
          for (const [k, v] of Object.entries(sp)) qs.set(k, v);
          return qs;
        }),
        baseQs,
      ];

      for (const qs of attempts) {
        try {
          const url = `${path}?${qs.toString()}`;
          const data = await this.request(url);
          const paramsObj = Object.fromEntries((qs as any).entries ? (qs as any).entries() : []);
          return { data, usedPath: path, params: paramsObj };
        } catch (e: any) {
          lastErr = e;
          console.warn('Blikk listTasksWithMeta failed, trying next', { path, error: String(e?.message || e) });
        }
      }
    }
    throw lastErr || new Error('Failed to list tasks');
  }

  // List users to retrieve assignable user IDs
  async listUsers(opts?: { query?: string; page?: number; pageSize?: number }) {
    const page = opts?.page ?? 1;
    const pageSize = opts?.pageSize ?? 50;
    const envPath = process.env.BLIKK_USERS_PATH || null;
    const paths = envPath ? [envPath] : [
      '/v1/Core/Users',
      '/v1/Admin/Users',
      '/v1/Administration/Users',
      '/v1/Users',
    ];

    const paramVariants: Array<Record<string, string>> = [
      { page: String(page), pageSize: String(pageSize) },
      { page: String(page), limit: String(pageSize) },
    ];
    const queryKeys = ['filter.query', 'query', 'q'];

    let lastErr: any = null;
    for (const path of paths) {
      for (const baseParams of paramVariants) {
        const qs = new URLSearchParams(baseParams);
        if (opts?.query) {
          for (const k of queryKeys) qs.set(k, opts.query);
        }
        try {
          return await this.request(`${path}?${qs.toString()}`);
        } catch (e: any) {
          lastErr = e;
          // continue trying next combo
          console.warn('Blikk listUsers failed, trying next combination', { path, params: Object.fromEntries(qs.entries()), error: String(e?.message || e) });
        }
      }
    }
    throw lastErr || new Error('Failed to list users');
  }
}

export function getBlikk() {
  return new BlikkClient();
}
