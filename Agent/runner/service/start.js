const { ChromeRunnerService } = require("./chrome-runner");

async function main() {
  const host = process.env.AGENT_RUNNER_HOST || "127.0.0.1";
  const port = Number(process.env.AGENT_RUNNER_PORT) || 17373;
  const service = new ChromeRunnerService({ host, port });

  await service.start();
  console.log(`[AgentRunner] listening on http://${host}:${port}`);

  const shutdown = async () => {
    try {
      await service.stop();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(error => {
  console.error("[AgentRunner] failed to start:", error && error.stack ? error.stack : error);
  process.exit(1);
});
