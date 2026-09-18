import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { startLegacyPortalServer } from "../../fixtures/legacy-portal/server";

describe("T1.2: Proxy Target Standing & Goal Candidates", () => {
  const rootDir = resolve(import.meta.dir, "../..");
  const goalsDocPath = resolve(rootDir, "docs/target-proxy-goals.md");

  test("documentation defines candidate goals for the proxy target", () => {
    expect(existsSync(goalsDocPath)).toBe(true);
    const content = readFileSync(goalsDocPath, "utf-8");
    expect(content).toContain("Candidate Goals");
    expect(content).toContain("Goal 1");
    expect(content).toContain("Member Search");
    expect(content).toContain("99999"); // Non-existent member outcome
    expect(content).toContain("11111"); // Suspended member outcome
  });

  test("proxy target server is reachable locally and serves hostile legacy UI", async () => {
    const testPort = 3099;
    const server = startLegacyPortalServer(testPort);

    try {
      const response = await server.fetch(new Request(`http://localhost:${testPort}/portal/search`));
      expect(response.status).toBe(200);

      const html = await response.text();
      // Verifies hostile characteristics
      expect(html).toContain("table-layout"); // Table soup
      expect(html).toContain("ctl00_MainContent_"); // Obfuscated dynamic IDs
      expect(html).toContain("iframe"); // Embedded hostile iframe
      expect(html).not.toContain("data-testid"); // Zero test IDs
    } finally {
      server.stop();
    }
  });
});
