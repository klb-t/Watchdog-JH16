import express from 'express';
import path from 'path';
import url from 'node:url';
import { apiRouter } from './backend/watchdog_api/api/routes';
import { traceMiddleware, errorHandler } from './backend/watchdog_api/api/middleware';
import { buildIdentity, assertAuthSafeForEnvironment, readAuthConfig } from './backend/watchdog_api/identity';
import { buildAuthRouter, principalMiddleware } from './backend/watchdog_api/api/auth_routes';
import { PrincipalRepository } from './backend/watchdog_api/db/repositories/principals';
import { sqlite } from './backend/watchdog_api/db/client';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-Trace-Id');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());
app.use(traceMiddleware);

/**
 * Mounts identity and the API onto the app.
 *
 * Exported and called by both `startServer()` and the integration tests, so
 * there is exactly one wiring. When this lived inside `startServer()` the tests
 * imported an app with no routes and no principal on it — they were exercising
 * a different application from the one that ships, which is the failure mode a
 * test suite is least able to warn you about.
 */
export async function configureApp() {
  // Checked before anything is mounted. An instance that becomes reachable
  // before its access rules are known is what this ordering prevents.
  assertAuthSafeForEnvironment(readAuthConfig());

  const identity = await buildIdentity();
  const authDeps = {
    identity,
    principals: new PrincipalRepository(sqlite),
    secureCookies: IS_PRODUCTION,
  };

  app.use(principalMiddleware(authDeps));
  app.use('/api/auth', buildAuthRouter(authDeps));
  app.use('/api', apiRouter);
  app.use(errorHandler);

  return { app, identity };
}

async function startServer() {
  const { identity } = await configureApp();
  console.log(`Authentication: ${identity.mode} — ${identity.config.reason}`);

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Only start the server if this module is run directly
const isESMMain = typeof import.meta !== 'undefined' && 
                  import.meta.url?.startsWith('file:') && 
                  process.argv[1] === url.fileURLToPath(import.meta.url);

const isCJSMain = typeof require !== 'undefined' && require.main === module;

if (isESMMain || isCJSMain) {
  startServer();
}

export { app }; // Export for testing
