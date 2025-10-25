import assert from 'node:assert';

const BASE_URL = process.env.BLIKK_BASE_URL || 'https://publicapi.blikk.com';

let cachedToken: { token: string; expires: number } | null = null;
let inFlightTokenPromise: Promise<void> | null = null;

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
    // Reuse valid token (keep 30s buffer)
    if (cachedToken && cachedToken.expires - 30_000 > now) return cachedToken.token;
    // If a fetch is already in progress, await it
    if (inFlightTokenPromise) {
      await inFlightTokenPromise;
      if (cachedToken) return cachedToken.token; // after wait
    }
    // Start a new token fetch
    inFlightTokenPromise = (async () => {
      try {
        const basic = Buffer.from(`${this.appId}:${this.appSecret}`).toString('base64');
        const res = await fetch(`${BASE_URL}/v1/Auth/Token`, {
          method: 'POST',
          headers: { Authorization: `Basic ${basic}` },
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Failed to get token: ${res.status} ${res.statusText} - ${text}`);
        }
        const json = (await res.json()) as { accessToken: string; expires: string };
        const expiresMs = new Date(json.expires).getTime();
        cachedToken = { token: json.accessToken, expires: expiresMs };
      } finally {
        inFlightTokenPromise = null;
      }
    })();
    await inFlightTokenPromise;
    if (!cachedToken) throw new Error('Token fetch failed (no token set)');
    return cachedToken.token;
  }

  private async request<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
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
      const retryAfter = Number(res.headers.get('Retry-After') || '1');
      await new Promise((r) => setTimeout(r, Math.min(retryAfter, 5) * 1000));
      return this.request<T>(path, init, attempt);
    }

    if (res.status === 401 && attempt === 0) {
      // Token likely expired early; clear cache and retry once.
      cachedToken = null;
      return this.request<T>(path, init, attempt + 1);
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
    const target = String(orderNumber).trim();
    if (!target) return null;
    // We attempt several param variants & endpoints similarly to listProjects heuristics.
    const bases = [process.env.BLIKK_PROJECTS_PATH || '/v1/Core/Projects', '/v1/Projects'];
    const pageSize = 50;
    const queryKeys = ['filter.query', 'query', 'q'];
    const numberKeys = ['filter.orderNumber', 'orderNumber', 'projectNumber', 'number'];
    const pagingVariants: Array<Record<string,string>> = [
      { page: '1', pageSize: String(pageSize) },
      { page: '1', limit: String(pageSize) },
    ];
    const attempts: string[] = [];
    let lastErr: any = null;
    for (const base of bases) {
      for (const paging of pagingVariants) {
        // 1. Put number into dedicated number fields if accepted
        for (const nk of numberKeys) {
          const qs = new URLSearchParams(paging);
          qs.set(nk, target);
          const url = `${base}?${qs.toString()}`;
          attempts.push(url);
          try {
            const data: any = await this.request(url);
            const items = data.items || data.data || data || [];
            const arr = Array.isArray(items) ? items : (items.items || []);
            const found = arr.find((p: any) => [p.orderNumber, p.projectNumber, p.number].some((v: any) => String(v) === target));
            if (found) return found;
          } catch (e: any) {
            lastErr = e;
          }
        }
        // 2. Fallback: broad query search then filter client side
        for (const qk of queryKeys) {
          const qs = new URLSearchParams(paging);
          qs.set(qk, target);
          const url = `${base}?${qs.toString()}`;
          attempts.push(url);
          try {
            const data: any = await this.request(url);
            const items = data.items || data.data || data || [];
            const arr = Array.isArray(items) ? items : (items.items || []);
            const found = arr.find((p: any) => [p.orderNumber, p.projectNumber, p.number].some((v: any) => String(v) === target));
            if (found) return found;
          } catch (e: any) {
            lastErr = e;
          }
        }
      }
    }
    if (lastErr) console.warn('getProjectByOrderNumber attempts failed', { target, attempts, error: String(lastErr?.message || lastErr) });
    return null;
  }

  // List latest projects (heuristic with env override & multiple param variants)
  async listProjects(opts?: {
    page?: number;
    pageSize?: number;
    query?: string;
    createdFrom?: string; // ISO date
    sortDesc?: boolean; // default true
  }) {
    const { data } = await this.listProjectsWithMeta(opts);
    return data;
  }

  // Same but returns meta about which URL/params worked. Prioritizes official documented params first.
  async listProjectsWithMeta(opts?: {
    page?: number;
    pageSize?: number;
    query?: string;
    createdFrom?: string;
    sortDesc?: boolean;
  }): Promise<{ data: any; usedUrl: string; attempts: string[]; officialTried: boolean }> {
    const page = opts?.page ?? 1;
    const pageSize = opts?.pageSize ?? 25;
    const envPath = process.env.BLIKK_PROJECTS_PATH || null;
  const enableLegacy = process.env.BLIKK_ENABLE_LEGACY_PROJECTS === '1';
  const bases = envPath ? [envPath] : enableLegacy ? ['/v1/Core/Projects', '/v1/Projects'] : ['/v1/Core/Projects'];
    const sortDesc = opts?.sortDesc ?? true;
    const direction = sortDesc ? 'descending' : 'ascending';
    const queryKeys = ['filter.query', 'query', 'q'];
    const createdFromKeys = ['filter.createdDateFrom', 'filter.createdFrom', 'createdFrom'];

    // Official documented first attempt
    const officialSortParam = { sortBy: 'createdDate', sortOrder: direction };

    // Legacy/fallback heuristics we used before
    const legacySortParamSets: Array<Record<string, string>> = sortDesc ? [
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

    const pagingVariants: Array<Record<string, string>> = [
      { page: String(page), pageSize: String(pageSize) },
      { page: String(page), limit: String(pageSize) },
    ];

    const attempts: string[] = [];
  let lastErr: any = null;
  let sawAuthError = false;
    let officialTried = false;

    for (const base of bases) {
      for (const basePaging of pagingVariants) {
        const baseQs = new URLSearchParams(basePaging);
        if (opts?.query) for (const k of queryKeys) baseQs.set(k, opts.query);
        if (opts?.createdFrom) for (const k of createdFromKeys) baseQs.set(k, opts.createdFrom);

        // 1. Official
        const officialQs = new URLSearchParams(baseQs);
        for (const [k, v] of Object.entries(officialSortParam)) officialQs.set(k, v);
        const officialUrl = `${base}?${officialQs.toString()}`;
        attempts.push(officialUrl);
        officialTried = true;
        try {
          const data = await this.request(officialUrl);
          return { data, usedUrl: officialUrl, attempts, officialTried };
        } catch (e: any) {
          lastErr = e;
          if (/ 401: /.test(String(e?.message))) {
            sawAuthError = true;
            // Stop cycling sort variants on auth issues; break to next base (will likely also fail once)
          }
          console.warn('Blikk listProjects official params failed, falling back', { officialUrl, error: String(e?.message || e) });
          if (sawAuthError) break; // break legacy sort attempts for this base
        }

        // 2. Legacy sets
        if (!sawAuthError) for (const sp of legacySortParamSets) {
          const qs = new URLSearchParams(baseQs);
            for (const [k, v] of Object.entries(sp)) qs.set(k, v);
          const url = `${base}?${qs.toString()}`;
          attempts.push(url);
          try {
            const data = await this.request(url);
            return { data, usedUrl: url, attempts, officialTried };
          } catch (e: any) {
            lastErr = e;
            if (/ 401: /.test(String(e?.message))) {
              sawAuthError = true;
              console.warn('Blikk listProjects legacy attempt auth failed', { url });
              break; // stop more legacy attempts
            }
            console.warn('Blikk listProjects legacy attempt failed', { url, error: String(e?.message || e) });
          }
        }

        if (!sawAuthError) {
          // 3. No sort
          const plainUrl = `${base}?${baseQs.toString()}`;
          attempts.push(plainUrl);
          try {
            const data = await this.request(plainUrl);
            return { data, usedUrl: plainUrl, attempts, officialTried };
          } catch (e: any) {
            lastErr = e;
            console.warn('Blikk listProjects plain attempt failed', { plainUrl, error: String(e?.message || e) });
          }
        }
        if (sawAuthError) break; // auth issue likely global, stop bases loop early
      }
    }
    if (lastErr) {
      const authHint = sawAuthError ? ' (authentication failed – check BLIKK_APP_ID / BLIKK_APP_SECRET or tenant access)' : '';
      throw new Error((lastErr as Error).message + authHint);
    }
    throw new Error('Failed to list projects');
  }

  // Articles (Admin Resources) listing with tolerant params/paths
  async listArticlesWithMeta(opts?: { page?: number; pageSize?: number; query?: string }): Promise<{ data: any; usedUrl: string; attempts: string[] }>
  {
    const page = opts?.page ?? 1;
    const pageSize = opts?.pageSize ?? 25;
    const query = opts?.query ?? '';

    // Allow env override for articles path
    const envPath = process.env.BLIKK_ARTICLES_PATH || null; // e.g. '/v1/Admin/Resources/Articles'
    const bases = envPath ? [envPath] : [
      '/v1/Admin/Articles',

    ];
    const queryKeys = ['filter.query', 'query', 'q', 'filter.name'];
    const pagingVariants: Array<Record<string, string>> = [
      { page: String(page), pageSize: String(pageSize) },
      { page: String(page), limit: String(pageSize) },
    ];

    const attempts: string[] = [];
    let lastErr: any = null;
    for (const base of bases) {
      for (const paging of pagingVariants) {
        // Try official style first: filter.query
        const officialQs = new URLSearchParams(paging);
        if (query) officialQs.set('filter.query', query);
        const officialUrl = `${base}?${officialQs.toString()}`;
        attempts.push(officialUrl);
        try {
          const data = await this.request(officialUrl);
          return { data, usedUrl: officialUrl, attempts };
        } catch (e: any) {
          lastErr = e;
        }
        // Try other keys
        for (const qk of queryKeys) {
          if (qk === 'filter.query') continue;
          const qs = new URLSearchParams(paging);
          if (query) qs.set(qk, query);
          const url = `${base}?${qs.toString()}`;
          attempts.push(url);
          try {
            const data = await this.request(url);
            return { data, usedUrl: url, attempts };
          } catch (e: any) {
            lastErr = e;
          }
        }
        // No query
        const plain = `${base}?${new URLSearchParams(paging).toString()}`;
        attempts.push(plain);
        try {
          const data = await this.request(plain);
          return { data, usedUrl: plain, attempts };
        } catch (e: any) {
          lastErr = e;
        }
      }
    }
    if (lastErr) throw lastErr;
    throw new Error('Failed to list articles');
  }

  async listArticles(opts?: { page?: number; pageSize?: number; query?: string }) {
    const { data } = await this.listArticlesWithMeta(opts);
    return data;
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

  // Minimal contact fetch by id (kept lean for current enrichment need)
  async getContactById(id: number, opts?: { debug?: boolean }) {
    if (!Number.isFinite(id)) throw new Error('Invalid contact id');
    const envPath = process.env.BLIKK_CONTACTS_PATH || null;
    // Build explicit candidate full paths (detail variants first) to maximize chance of retrieving full contact including email
    const baseFamilies = envPath ? [envPath] : [
      '/v1/Core/Contacts',
      '/v1/Contacts',
      '/v1/Core/Customers',
      '/v1/Customers',
    ];
    const paths: string[] = [];
    for (const b of baseFamilies) {
      const clean = b.replace(/\/$/, '');
      paths.push(`${clean}/${id}/Details`); // potential detail endpoint
      paths.push(`${clean}/${id}`);         // base endpoint
    }
    // Remove duplicates while preserving order
    const seenPath = new Set<string>();
    const uniquePaths = paths.filter(p => { if (seenPath.has(p)) return false; seenPath.add(p); return true; });
    type Attempt = { path: string; ok: boolean; status?: number; error?: string };
    const attempts: Attempt[] = [];
    const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
    const extractEmailCandidates = (obj: any, limit = 8): string[] => {
      const out: string[] = [];
      const visit = (val: any, depth: number) => {
        if (out.length >= limit) return;
        if (!val || depth > 4) return;
        if (typeof val === 'string') {
          if (emailRegex.test(val) && !out.includes(val)) out.push(val);
          return;
        }
        if (Array.isArray(val)) {
          for (const v of val) visit(v, depth + 1);
          return;
        }
        if (typeof val === 'object') {
          for (const k of Object.keys(val)) {
            const v = val[k];
            if (/mail/i.test(k) && typeof v === 'string' && emailRegex.test(v) && !out.includes(v)) out.push(v);
            visit(v, depth + 1);
            if (out.length >= limit) break;
          }
        }
      };
      visit(obj, 0);
      return out;
    };
    let lastErr: any = null;
    for (const path of uniquePaths) {
      try {
        let attemptRes: Response | null = null;
        let rateRetryCount = 0;
        // Inline loop to transparently handle 429 without counting as separate base attempts
        let authRetried = false;
        while (true) {
          attemptRes = await fetch(`${BASE_URL}${path}`, {
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await this.getToken()}` },
            cache: 'no-store'
          });
          if (attemptRes.status === 401 && !authRetried) {
            // Clear token & retry once immediately
            cachedToken = null;
            authRetried = true;
            continue;
          }
          if (attemptRes.status !== 429) break;
          // Parse wait seconds from header or body
          let waitSec = Number(attemptRes.headers.get('Retry-After') || '0');
          if (!waitSec) {
            try {
              const clone = await attemptRes.clone().json();
              if (clone && typeof clone.waitInSeconds === 'number') waitSec = clone.waitInSeconds;
            } catch {/* ignore parse */}
          }
            if (!waitSec || waitSec < 0) waitSec = 1;
          attempts.push({ path, ok: false, status: attemptRes.status, error: `rate_limited_wait_${waitSec}s` });
          rateRetryCount++;
          if (rateRetryCount > 5) break; // safeguard
          await new Promise(r => setTimeout(r, Math.min(waitSec, 5) * 1000));
        }
        const res = attemptRes!;
        if (!res.ok) {
          attempts.push({ path, ok: false, status: res.status, error: res.statusText });
          if (res.status === 404) {
            continue; // try next base
          }
          const text = await res.text();
            lastErr = new Error(`Blikk GET ${path} -> ${res.status}: ${text}`);
          break;
        }
        const data: any = await res.json();
        attempts.push({ path, ok: true, status: 200 });
        const name = data.name || data.fullName || [data.firstName, data.lastName].filter(Boolean).join(' ').trim() || data.contactName || null;
        const primaryEmail = data.email || data.Email || data.contactEmail || (data.contact && data.contact.email) || null;
        const candidates = extractEmailCandidates(data);
        const email = primaryEmail || candidates[0] || null;
        if (!email && opts?.debug) {
          // Provide some diagnostic keys to help see where email might hide
          const topKeys = Object.keys(data || {});
          console.warn('Contact email not found', { id, path, topKeys, candidateCount: candidates.length });
        }
        return { contact: { raw: data, id, email, name, emailCandidates: candidates }, usedPath: path, attempts };
      } catch (e: any) {
        lastErr = e;
        attempts.push({ path, ok: false, error: String(e?.message || e) });
        if (!/ 404: /.test(String(e?.message || e))) break; // non-404 break
      }
    }
    if (lastErr) {
      (lastErr as any).attempts = attempts;
      throw lastErr;
    }
    const nf = new Error('Contact not found');
    (nf as any).attempts = attempts;
    throw nf;
  }
}

export function getBlikk() {
  return new BlikkClient();
}
