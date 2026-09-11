import express from 'express';
import { buildDiagnosticRouter } from './backend/watchdog_api/api/diagnostic_routes';
import { AuditRepository } from './backend/watchdog_api/db/repositories/audit';
import { WorkbenchRepository } from './backend/watchdog_api/db/repositories/workbench';
import { WorkbenchService } from './backend/watchdog_api/workbench/service';
import { loadWorkbenchProfile } from './backend/watchdog_api/config/workbench';
import { buildWorkbenchRouter } from './backend/watchdog_api/api/workbench_routes';
import path from 'path';
import url from 'node:url';
import { buildApiRouter } from './backend/watchdog_api/api/routes';
import { traceMiddleware, errorHandler } from './backend/watchdog_api/api/middleware';
import { buildIdentity, assertAuthSafeForEnvironment, readAuthConfig } from './backend/watchdog_api/identity';
import { buildAuthRouter, principalMiddleware } from './backend/watchdog_api/api/auth_routes';
import { PrincipalRepository } from './backend/watchdog_api/db/repositories/principals';
import { db, sqlite, dbPath } from './backend/watchdog_api/db/client';
import { assertStorageSafeForEnvironment } from './backend/watchdog_api/storage/durability';
import { storeBackend, storePath } from './backend/watchdog_api/storage/client';
import { store } from './backend/watchdog_api/storage/client';
import { FieldReferenceRepository } from './backend/watchdog_api/db/repositories/field_reference';
import { FieldService } from './backend/watchdog_api/field/service';
import { loadFieldProfile } from './backend/watchdog_api/config/field';
import { buildFieldRouter } from './backend/watchdog_api/api/field_routes';
import { AutomationRepository } from './backend/watchdog_api/db/repositories/automation';
import { AutomationService } from './backend/watchdog_api/services/automation';
import { loadAutomationProfile } from './backend/watchdog_api/config/automation';
import { buildAutomationRouter, buildMemoryRouter } from './backend/watchdog_api/api/automation_routes';

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

app.use(express.json({ limit: '2mb' }));
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
  // Both checked before anything is mounted. An instance that becomes
  // reachable before its access rules are known, or before its data is known
  // to survive a restart, is what this ordering prevents.
  assertAuthSafeForEnvironment(readAuthConfig());
  assertStorageSafeForEnvironment({ env: process.env, dbPath, storeBackend, storePath });

  const identity = await buildIdentity();
  const authDeps = {
    identity,
    principals: new PrincipalRepository(sqlite),
    secureCookies: IS_PRODUCTION,
  };

  app.use(principalMiddleware(authDeps));
  app.use('/api/auth', buildAuthRouter(authDeps));
  const fieldRepository = new FieldReferenceRepository(sqlite, store);
  const fieldService = new FieldService(fieldRepository, loadFieldProfile());
  app.use('/api/field', buildFieldRouter(fieldRepository, fieldService));
  const workbench = new WorkbenchRepository(sqlite, store);
  app.use('/api/workbench', buildWorkbenchRouter(workbench, new WorkbenchService(workbench, loadWorkbenchProfile())));
  const automationRepository = new AutomationRepository(sqlite, store);
  const automation = new AutomationService(automationRepository, loadAutomationProfile());
  app.use('/api/automation', buildAutomationRouter(automationRepository, automation));
  app.use('/api/memory', buildMemoryRouter(automationRepository));
  app.use('/api/diagnostics', buildDiagnosticRouter(new AuditRepository(sqlite)));
  app.use('/api', buildApiRouter(db, store, new AuditRepository(sqlite)));
  app.use(errorHandler);

  return { app, identity, automation };
}

async function startServer() {
  const { identity, automation } = await configureApp();
  automation.start();
  console.log(`Authentication: ${identity.mode} — ${identity.config.reason}`);
  console.log(`Blob store: ${storeBackend}${storeBackend === 'gcs' ? ` (${process.env.GCS_BUCKET})` : ` (${storePath})`}`);
  console.log(`Database:   ${dbPath}`);

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
