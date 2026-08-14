import express from "express";
import { pool, runMigrations } from "./db";
import { healthRouter, readiness } from "./routes/health";
import { logsRouter } from "./routes/logs";

const app = express();
app.use(express.json({ limit: "10mb" }));

app.use(healthRouter);
app.use(logsRouter);

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;

async function start() {
  await pool.query("SELECT 1");
  console.log("Database connection established");

  await runMigrations();
  console.log("Migrations applied");

  app.listen(PORT, () => {
    readiness.isReady = true;
    console.log(`Log service listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});