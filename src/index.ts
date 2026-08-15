import express from "express";
import { pool, runMigrations } from "./db";
import { healthRouter, readiness } from "./routes/health";
import { logsRouter } from "./routes/logs";
import { startRetentionJob } from "./retention";

const app = express();
app.use(express.json({ limit: "10mb" }));

app.use(healthRouter);
app.use(logsRouter);

// Global error handler — must be registered LAST, after all routes
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({ error: "malformed JSON in request body" });
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "internal server error" });
});

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;

async function start() {
  await pool.query("SELECT 1");
  console.log("Database connection established");

  await runMigrations();
  console.log("Migrations applied");

  app.listen(PORT, () => {
    readiness.isReady = true;
    console.log(`Log service listening on port ${PORT}`);
    startRetentionJob();
  });
}

start().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});