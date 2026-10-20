import { chromium } from "playwright";
import { load } from "cheerio";
export async function render(page, fetcher) {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
    args: ["--disable-background-networking"],
  });
  let blocked = 0,
    requests = 0;
  try {
    const context = await browser.newContext({
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    await context.routeWebSocket("**/*", (socket) => {
      blocked++;
      socket.close();
    });
    await context.route("**/*", async (route) => {
      try {
        const req = route.request(),
          url = new URL(req.url());
        if (
          ++requests > 30 ||
          req.method() !== "GET" ||
          url.origin !== new URL(page.url).origin ||
          !["document", "script", "stylesheet", "xhr", "fetch"].includes(
            req.resourceType(),
          )
        ) {
          blocked++;
          return route.abort();
        }
        const response =
          req.url() === page.url && req.isNavigationRequest()
            ? page
            : await fetcher(req.url());
        if (response.redirect) {
          blocked++;
          return route.abort();
        }
        await route.fulfill({
          status: response.status,
          contentType: response.headers["content-type"] || "text/plain",
          body: response.body,
        });
      } catch {
        blocked++;
        await route.abort().catch(() => {});
      }
    });
    const tab = await context.newPage();
    await tab.goto(page.url, { waitUntil: "networkidle", timeout: 25000 });
    const result = await tab.locator("body").innerText({ timeout: 3000 });
    const $ = load(page.body);
    $("script,style,noscript").remove();
    const original = $("body").text().replace(/\s+/g, " ").trim();
    return {
      status: blocked ? "partial" : "completed",
      htmlTextLength: original.length,
      renderedTextLength: result.trim().length,
      contentDependsOnRendering: result.trim().length > original.length + 120,
      blockedRequests: blocked,
      method:
        "Isolated browser; GET only; same-origin robots-authorized resources; public DNS pinned by fetcher. Third-party resources blocked.",
    };
  } finally {
    await browser.close();
  }
}
