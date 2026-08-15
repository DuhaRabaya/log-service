const BASE_URL = process.env.TARGET_URL || "http://localhost:8080";
const DURATION_SECONDS = 15;
const BATCH_SIZE = 500;
const CONCURRENCY = 20;

function randomLog() {
  const levels = ["debug", "info", "warn", "error"];
  const services = ["checkout", "auth", "inventory", "shipping", "search"];
  return {
    timestamp: new Date().toISOString(),
    level: levels[Math.floor(Math.random() * levels.length)],
    service: services[Math.floor(Math.random() * services.length)],
    message: `event occurred ${Math.random().toString(36).slice(2)}`,
    attributes: {
      user_id: String(Math.floor(Math.random() * 10000)),
      region: Math.random() > 0.5 ? "eu-west" : "us-east",
    },
  };
}

function makeBatch() {
  const logs = [];
  for (let i = 0; i < BATCH_SIZE; i++) logs.push(randomLog());
  return { logs };
}

async function worker(stats: { sent: number; accepted: number; errors: number }, stopAt: number) {
  while (Date.now() < stopAt) {
    try {
      const res = await fetch(`${BASE_URL}/logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeBatch()),
      });
      const json: any = await res.json();
      stats.sent += BATCH_SIZE;
      stats.accepted += json.accepted || 0;
    } catch {
      stats.errors++;
    }
  }
}

async function main() {
  console.log(`Load testing ${BASE_URL} for ${DURATION_SECONDS}s with ${CONCURRENCY} concurrent workers, batch size ${BATCH_SIZE}...`);
  const stats = { sent: 0, accepted: 0, errors: 0 };
  const stopAt = Date.now() + DURATION_SECONDS * 1000;
  const startedAt = Date.now();

  const workers = Array.from({ length: CONCURRENCY }, () => worker(stats, stopAt));
  await Promise.all(workers);

  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  console.log("\n--- Results ---");
  console.log(`Duration: ${elapsedSeconds.toFixed(2)}s`);
  console.log(`Logs sent: ${stats.sent}`);
  console.log(`Logs accepted: ${stats.accepted}`);
  console.log(`Errors: ${stats.errors}`);
  console.log(`Throughput: ${(stats.accepted / elapsedSeconds).toFixed(0)} logs/sec`);
}

main();