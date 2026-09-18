import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { validateArtifact } from "../artifact/artifact.validator";
import { ReplayExecutor } from "../replay/replay-executor";
import { PlaywrightSurface } from "../surface/playwright-surface";
import { GuardrailService } from "../guardrail/guardrail.service";
import { SessionCoordinator } from "../escalation/session-coordinator";
import { CliEscalationListener } from "../escalation/human-prompt";
import { startLegacyPortalServer } from "../../fixtures/legacy-portal/server";
import { DiscoveryAgent } from "../discovery/agent";
import { GeminiClient } from "../discovery/gemini-client";
import { MockLLMClient } from "../discovery/mock-llm-client";
import {
  ArtifactRepository,
  diffArtifacts,
  generateArtifactMarkdown,
} from "../artifact/repository";

function getArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("--")) {
    return args[idx + 1];
  }
  return undefined;
}

async function isServerRunning(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    console.log(`
===============================================================
🤖 Computer-Use Automation System CLI (Sprint 1)
===============================================================

Usage:
  bun run src/cli/main.ts <command> [options]

Commands:
  discover                  Run the LLM observe->decide->act discovery agent
                            Options:
                              --goal <text>       Natural language goal
                              --url <url>         Target app entry URL (default: http://localhost:3000/portal/search)
                              --headed            Show browser window live
                              --mock              Run with deterministic mock planner (no API key needed)
                              --api-key <key>     Provide Gemini API key directly
                              --evidence <dir>    Output folder for screenshots and artifacts
                              --max-steps <num>   Step limit (default: 8)

  replay <artifact.json>    Replay a compiled artifact deterministically (zero LLM)
                            Options:
                              --inputs '{"memberId":"10042"}'
                              --headed            Show browser window live

  validate <artifact.json>  Validate an artifact specification against the schema

  list-artifacts            List versioned capabilities in the repository
                            Options:
                              --app <appId>       Filter by target application

  inspect <file|appId/id>   Inspect capability contract, inputs, steps, and checkpoints
                            Options:
                              --version <semver>  Specify version (defaults to latest)

  diff <file1> <file2>      Show semantic diff between two capability versions

  serve-proxy               Start the LegacyCore Portal fixture manually on localhost:3000

Examples:
  # 1. Run live Gemini discovery (headed, watch Chrome interact)
  GEMINI_API_KEY=your_key bun run src/cli/main.ts discover --headed

  # 2. Run discovery offline with mock planner
  bun run src/cli/main.ts discover --mock --headed

  # 3. Deterministic replay without LLM
  bun run src/cli/main.ts replay fixtures/artifacts/lookup-member.json --headed
===============================================================
    `);
    process.exit(0);
  }

  if (command === "serve-proxy") {
    const port = Number(process.env.PORT || 3000);
    startLegacyPortalServer(port);
    return;
  }

  if (command === "validate") {
    const filePath = args[1];
    if (!filePath) {
      console.error("❌ Error: Path to artifact file is required");
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

  if (command === "list-artifacts") {
    const repo = new ArtifactRepository();
    const appFilter = getArgValue(args, "--app");
    const list = await repo.list(appFilter);
    if (list.length === 0) {
      console.log("No capabilities registered in artifacts repository.");
      return;
    }
    console.log("===============================================================");
    console.log("📦 Stored Capabilities (Artifacts Repository)");
    console.log("===============================================================");
    for (const cap of list) {
      console.log(`\n• [${cap.appId}] ${cap.name} (${cap.id})`);
      console.log(`  Description:    ${cap.description}`);
      console.log(`  Latest Version: v${cap.latestVersion}`);
      console.log(`  Versions:       ${cap.versions.map((v) => `v${v}`).join(", ")}`);
    }
    console.log("\n===============================================================");
    return;
  }

  if (command === "inspect") {
    const target = args[1];
    if (!target) {
      console.error("❌ Error: Target file path or appId/id is required");
      process.exit(1);
    }
    const repo = new ArtifactRepository();
    let artifact: any;
    let version = getArgValue(args, "--version");

    if (existsSync(resolve(target))) {
      artifact = JSON.parse(readFileSync(resolve(target), "utf-8"));
      version = version || artifact.schemaVersion || "1.0.0";
    } else if (target.includes("/")) {
      const [appId, capId] = target.split("/");
      artifact = await repo.load(appId, capId, version);
      version = version || "latest";
    } else {
      console.error(`❌ Error: Cannot find file or capability "${target}"`);
      process.exit(1);
    }

    const md = generateArtifactMarkdown(artifact, version);
    console.log("\n" + md);
    return;
  }

  if (command === "diff") {
    const fileA = args[1];
    const fileB = args[2];
    if (!fileA || !fileB) {
      console.error("❌ Error: Two artifact file paths are required for diff");
      process.exit(1);
    }
    const a = JSON.parse(readFileSync(resolve(fileA), "utf-8"));
    const b = JSON.parse(readFileSync(resolve(fileB), "utf-8"));
    console.log(diffArtifacts(a, b));
    return;
  }

  if (command === "discover") {
    const goal =
      getArgValue(args, "--goal") ||
      "Look up member 10042 in the Member Search portal and view account details";
    const entryUrl =
      getArgValue(args, "--url") || "http://localhost:3000/portal/search";
    const isHeaded = args.includes("--headed");
    const useMock = args.includes("--mock");
    const maxSteps = Number(getArgValue(args, "--max-steps") || 8);
    const evidenceDir = resolve(
      getArgValue(args, "--evidence") || "evidence/discovery"
    );
    const apiKey =
      getArgValue(args, "--api-key") ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY;

    console.log("===============================================================");
    console.log("🚀 Starting Discovery Run");
    console.log("===============================================================");
    console.log(` Goal:        ${goal}`);
    console.log(` Target URL:  ${entryUrl}`);
    console.log(` Browser:     ${isHeaded ? "Headed (Visible UI)" : "Headless"}`);
    console.log(` Evidence:    ${evidenceDir}`);

    // Auto-start fixture server if targeting localhost:3000 and not running
    let autoServer: ReturnType<typeof startLegacyPortalServer> | null = null;
    if (entryUrl.includes("localhost:3000") || entryUrl.includes("127.0.0.1:3000")) {
      const running = await isServerRunning(entryUrl);
      if (!running) {
        console.log("ℹ️  Local portal not detected; automatically starting fixture server on port 3000...");
        autoServer = startLegacyPortalServer(3000);
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    // Select LLM Client
    let llmClient: any;
    if (useMock) {
      console.log(" Provider:    MockLLMClient (Deterministic planner)");
      llmClient = new MockLLMClient([
        {
          thought: "I see the Member ID input field adjacent to 'Member ID:'. Let me fill it with member ID 10042.",
          action: { type: "fill", valueTemplate: "10042" },
          targeting: {
            anchor: { anchorText: "Member ID:", direction: "right", targetTag: "input" },
            structural: { css: "#ctl00_MainContent_tabSearch_txtMemberId_8912" },
          },
          goalMet: false,
        },
        {
          thought: "The member ID is entered. Now I will click the Search button.",
          action: { type: "click" },
          targeting: {
            semantic: { name: "Search" },
            structural: { css: "#ctl00_MainContent_btnSearch_329a" },
          },
          goalMet: false,
        },
        {
          thought: "The member record table (#ctl00_gridMemberDetails) is displayed showing Alice Henderson and balance $240.50. The goal is fulfilled.",
          goalMet: true,
        },
      ]);
    } else {
      if (!apiKey) {
        console.error("\n❌ Error: No Gemini API key provided!");
        console.error("Please set GEMINI_API_KEY in your .env file or environment, e.g.:");
        console.error("  export GEMINI_API_KEY=\"your_gemini_api_key\"");
        console.error("Or pass --api-key <key>, or run with --mock for an offline demonstration:\n");
        console.error("  bun run src/cli/main.ts discover --mock --headed\n");
        if (autoServer) autoServer.stop();
        process.exit(1);
      }
      const model =
        getArgValue(args, "--model") ||
        process.env.GEMINI_MODEL ||
        "gemini-3.6-flash";
      console.log(` Provider:    Google Gemini (${model})`);
      llmClient = new GeminiClient({ apiKey, modelName: model });
    }

    console.log("===============================================================\n");

    const surface = new PlaywrightSurface({ headless: !isHeaded });
    await surface.initialize();

    const guardrail = new GuardrailService({
      allowedDomains: ["localhost", "127.0.0.1"],
    });

    const agent = new DiscoveryAgent(surface, llmClient, guardrail);

    try {
      const result = await agent.discover({
        goal,
        appId: "legacy-core-portal",
        entryUrl,
        allowedDomains: ["localhost", "127.0.0.1"],
        maxSteps,
        evidenceDir,
      });

      console.log("\n===============================================================");
      if (result.success) {
        console.log("✅ DISCOVERY COMPLETED SUCCESSFULLY!");
        console.log("===============================================================");
        console.log(` Steps Taken: ${result.stepsTaken}`);
        console.log(` Artifact ID: ${result.artifact?.id}`);
        console.log("\nExecution Transcript:");
        result.transcript.forEach((t) => {
          console.log(`  [Step ${t.step}] ${t.action ? `[${t.action.toUpperCase()}] ` : ""}${t.thought}`);
        });

        console.log("\n📁 Evidence Captured in:", evidenceDir);
        console.log("  - transcript.json");
        console.log("  - synthesized-artifact.json");
        console.log("  - dom-snapshot-step-*.json");
        console.log("  - screenshot-step-*.jpeg");

        if (result.artifact && args.includes("--save")) {
          const repo = new ArtifactRepository();
          const saved = await repo.save(result.artifact);
          console.log("\n📦 Saved to Artifacts Repository:");
          console.log(`  Version:  v${saved.version}`);
          console.log(`  JSON:     ${saved.jsonPath}`);
          console.log(`  Markdown: ${saved.markdownPath}`);
        }
      } else {
        console.log("❌ DISCOVERY FAILED OR HALTED");
        console.log("===============================================================");
        console.log(` Error: ${result.error}`);
        console.log(` Steps taken before stop: ${result.stepsTaken}`);
      }
      console.log("===============================================================\n");
    } finally {
      await surface.close();
      if (autoServer) autoServer.stop();
    }
    return;
  }

  if (command === "replay") {
    const filePath = args[1];
    if (!filePath) {
      console.error("❌ Error: Path to artifact file is required");
      process.exit(1);
    }

    const rawArtifact = JSON.parse(readFileSync(resolve(filePath), "utf-8"));
    const report = validateArtifact(rawArtifact);
    if (!report.valid || !report.artifact) {
      console.error("❌ Error: Artifact failed validation before execution");
      process.exit(1);
    }

    const artifact = report.artifact;
    const isHeaded = args.includes("--headed");

    let inputs: Record<string, unknown> = {};
    const inputsIdx = args.indexOf("--inputs");
    if (inputsIdx !== -1 && args[inputsIdx + 1]) {
      inputs = JSON.parse(args[inputsIdx + 1]);
    }

    console.log("===============================================================");
    console.log(`▶️  Starting Deterministic Replay (NO LLM)`);
    console.log("===============================================================");
    console.log(` Capability:  ${artifact.name} (${artifact.id})`);
    console.log(` Target URL:  ${artifact.target.entryUrl}`);
    console.log(` Browser:     ${isHeaded ? "Headed (Visible UI)" : "Headless"}`);
    console.log(` Inputs:      ${JSON.stringify(inputs)}`);

    // Auto-start fixture server if targeting localhost:3000 and not running
    let autoServer: ReturnType<typeof startLegacyPortalServer> | null = null;
    if (artifact.target.entryUrl.includes("localhost:3000") || artifact.target.entryUrl.includes("127.0.0.1:3000")) {
      const running = await isServerRunning(artifact.target.entryUrl);
      if (!running) {
        console.log("ℹ️  Local portal not detected; automatically starting fixture server on port 3000...");
        autoServer = startLegacyPortalServer(3000);
        await new Promise((r) => setTimeout(r, 300));
      }
    }

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
      console.log("\n===============================================================");
      console.log(` Replay Result Status: ${result.status}`);
      console.log("===============================================================");
      console.log(JSON.stringify(result, null, 2));
      console.log("===============================================================\n");
    } finally {
      await surface.close();
      if (autoServer) autoServer.stop();
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
