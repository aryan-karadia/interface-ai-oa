import * as readline from "readline";
import type { EscalationListener, TakeoverRequest, TakeoverResolution } from "./escalation.interface";

export class CliEscalationListener implements EscalationListener {
  async onRequest(request: TakeoverRequest): Promise<TakeoverResolution> {
    console.log("\n=======================================================");
    console.log(" 🚨 HUMAN INTERVENTION REQUIRED (SESSION ESCALATION)");
    console.log("=======================================================");
    console.log(` Request ID:  ${request.id}`);
    console.log(` Reason:      ${request.reason}`);
    console.log(` Current URL: ${request.currentUrl}`);
    if (request.stepId) console.log(` Step ID:     ${request.stepId}`);
    console.log(` Message:     ${request.message}`);
    if (request.suggestedAction) {
      console.log(` Action:      ${request.suggestedAction}`);
    }
    console.log("-------------------------------------------------------");
    console.log(" Browser session is active in HUMAN CONTROL mode.");
    console.log(" Please take control of the browser window, complete the task,");
    console.log(" then press ENTER in this terminal to hand control back to automation.");
    console.log("=======================================================\n");

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question("Press [ENTER] when ready to resume automation: ", (answer) => {
        rl.close();
        resolve({
          requestId: request.id,
          resolvedBy: "operator",
          notes: answer.trim() || "Resumed by operator via CLI",
          resumedAt: new Date().toISOString(),
        });
      });
    });
  }
}
