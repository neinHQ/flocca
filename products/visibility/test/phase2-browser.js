import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
export async function phase2Browser({
  base,
  password,
  brandId,
  studyId,
  promptId,
  tenants,
  baseline,
}) {
  const browser = await chromium.launch({ headless: true, timeout: 20000 });
  try {
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1100 },
      }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page.locator("#login [name=email]").fill("user0@example.test");
    await page.locator("#login [name=password]").fill(password);
    await page.locator("#login button").click();
    await page
      .locator("#workspace")
      .waitFor({ state: "visible", timeout: 10000 });
    await page.locator("#brand").selectOption(brandId);
    await page
      .locator("#study-select option")
      .first()
      .waitFor({ state: "attached" });
    await page.getByText("Create a frozen study", { exact: true }).click();
    await page
      .locator("#study-create [name=name]")
      .fill("Browser validation study");
    await page.locator(`#study-prompts input[value="${promptId}"]`).check();
    await page.locator("#study-create button").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#study-select option:checked")?.textContent ===
        "Browser validation study",
    );
    assert.match(
      await page.locator("#study-manifest").textContent(),
      /Edited current question/,
    );
    await page.locator("#study-select").selectOption(studyId);
    await page.waitForFunction(() =>
      document
        .querySelector("#study-status")
        ?.textContent.includes("evidence changed"),
    );
    await page.locator("#study-show-reviewed").check();
    await page
      .getByRole("button", { name: "Label", exact: true })
      .first()
      .waitFor();
    await page
      .getByRole("button", { name: "Label", exact: true })
      .first()
      .click();
    await page.locator("#study-review").waitFor({ state: "visible" });
    await page
      .locator("#study-review [name=citationUrls]")
      .fill("https://brand0.example/");
    await page
      .locator("#study-review [name=mentionDomains]")
      .fill("brand0.example");
    await page.locator("#study-review [name=reviewedRaw]").check();
    await page
      .locator("#study-review [name=notes]")
      .fill("Browser reviewer independently checked the raw fixture response.");
    await page.locator("#study-review button").click();
    await page.locator("#study-review").waitFor({ state: "hidden" });
    await page.waitForFunction(
      () =>
        document.querySelector("#notice").textContent ===
        "Human extraction labels recorded.",
    );
    assert.equal(
      await page.locator("#study-approve").evaluate((el) => el.disabled),
      true,
    );
    // The provider HTML is rendered in its own CSP-restricted document.
    const gemini = baseline.find((r) => r.data.provider === "gemini");
    const rawUrl = `${base}/api/search-suggestions?${new URLSearchParams({ tenant: tenants[0], brand: brandId, execution: gemini.id })}`;
    const suggestions = await context.newPage();
    await suggestions.goto(rawUrl);
    assert.ok(
      (await suggestions.locator("body").textContent()).includes(
        "Google Search Suggestions",
      ),
    );
    assert.equal(await suggestions.evaluate(() => window.bad), undefined);
    assert.equal(await page.evaluate(() => window.bad), undefined);
    await suggestions.close();
    const dir = process.env.VISIBILITY_SCREENSHOT_DIR || "/private/tmp";
    await mkdir(dir, { recursive: true });
    await page.locator("#study-raw").evaluate((el) => (el.hidden = true));
    await page
      .locator("#validation-panel")
      .screenshot({ path: `${dir}/flocca-phase2-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .locator("#validation-panel")
      .screenshot({ path: `${dir}/flocca-phase2-mobile.png` });
    assert.equal(
      await page
        .locator("body")
        .evaluate((el) => el.scrollWidth <= window.innerWidth),
      true,
    );
    await page.locator("#refresh").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#study-select option:checked")?.textContent ===
        "Six-provider internal validation",
    );
    assert.equal(await page.locator("#study-review").isHidden(), true);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}
