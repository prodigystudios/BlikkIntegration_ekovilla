import { cache as reactCache } from 'react';

// React's request-scoped cache() dedupes a server read across every caller in one request. It's a
// server-only API; in non-server contexts (e.g. unit tests that import a module using it) it may be
// absent — fall back to identity so importing never throws. The wrapped reads aren't called in
// those contexts anyway.
export const requestCache: typeof reactCache =
  typeof reactCache === 'function' ? reactCache : ((fn: any) => fn) as typeof reactCache;
