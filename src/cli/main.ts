import { readFileSync } from "fs";
import { resolve } from "path";
import { validateArtifact } from "../artifact/artifact.validator";
import { ReplayExecutor } from "../replay/replay-executor";
import { PlaywrightSurface } from "../surface/playwright-surface";
import { GuardrailService } from "../guardrail/guardrail.service";
import { SessionCoordinator } from "../escalation/session-coordinator";
import { CliEscalationListener } from "../escalation/human-prompt";
import { startLegacyPortalServer } from "../../fixtures/legacy-portal/server";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    console.log(`
Computer-Use Automation System CLI
Usage:
  bun run src/cli/main.ts <command> [options]

Commands:
  serve-proxy               Start the LegacyCore Portal fixture on localhost:3000
  validate <artifact.json>  Validate an artifact specification against the schema
  replay <artifact.json>    Replay an artifact against live surface without LLM
                            Options: --inputs '{"param":"val"}' --headed
    `);
    process.exit(0);
  }

  if (command === "serve-proxy") {
    startLegacyPortalServer();
    return;
  }

  if (command === "validate") {
    const filePath = args[1];
    if (!filePath) {
      console.error("Error: Path to artifact file is required");
      process.exit(1);
    }
    const content = JSON.parse(readFileSync(resolve(filePath), "utf-8"));
    const report = validateArtifact(content);
    if (report.valid) {
      console.log(`✅ Artifact is valid: "${report.artifact?.name}" (ID: ${report.artifact?.id})`);
    } else {
      console.error(`❌ Validation failed with ${report.errors.length} errors:`);
      report.errors.forEach((e) => console.error(`  - [${e.path}] ${e.message}`));
      process.exit(1);
    }
    return;
  }

  if (command === "replay") {
    const filePath = args[1];
    if (!filePath) {
      console.error("Error: Path to artifact file is required");
      process.exit(1);
    }

    const rawArtifact = JSON.parse(readFileSync(resolve(filePath), "utf-8"));
    const report = validateArtifact(rawArtifact);
    if (!report.valid || !report.artifact) {
      console.error("Error: Artifact failed validation before execution");
      process.exit(1);
    }

    const artifact = report.artifact;
    const isHeaded = args.includes("--headed");

    // Parse --inputs
    let inputs: Record<string, unknown> = {};
    const inputsIdx = args.indexOf("--inputs");
    if (inputsIdx !== -1 && args[inputsIdx + 1]) {
      inputs = JSON.parse(args[inputsIdx + 1]);
    }

    console.log(`Starting Replay for Artifact: ${artifact.name} (${artifact.id})`);
    console.log(`Target: ${artifact.target.entryUrl}`);

    const surface = new PlaywrightSurface({ headless: !isHeaded });
    await surface.initialize();

    const guardrail = new GuardrailService({
      allowedDomains: artifact.target.allowedDomains,
    });

    const coordinator = new SessionCoordinator(surface);
    coordinator.setListener(new CliEscalationListener());

    const executor = new ReplayExecutor(surface, guardrail, coordinator);

    try {
      const result = await executor.execute(artifact, { inputs });
      console.log("\nReplay Execution Result:");
      console.log(JSON.stringify(result, null, 2));
    } finally {
      await surface.close();
    }
    return;
  }

  console.error(`Unknown command: "${command}". Use --help for usage.`);
  process.exit(1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
