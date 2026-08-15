import express from 'express';
import path from 'path';
import url from 'node:url';
import { apiRouter } from './backend/watchdog_api/api/routes';
import { traceMiddleware, errorHandler } from './backend/watchdog_api/api/middleware';

const app = express();
const PORT = 3000;

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

app.use('/api', apiRouter);

app.use(errorHandler);

// Vite middleware / SPA fallback
async function startServer() {
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
