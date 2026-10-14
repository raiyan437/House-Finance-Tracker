import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";
import { expect, test, type Page } from "./fixtures";

async function installMotionRecorder(page: Page) {
  await page.addInitScript(() => {
    const records: { surface: string; frames: unknown; duration: unknown }[] = [];
    Reflect.set(window, "glassMotionRecords", records);
    const original = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (this.getAttribute("data-slot") === "glass-selection") records.push({ surface: this.parentElement?.getAttribute("aria-label") ?? "", frames, duration: typeof options === "object" ? options.duration : options });
      const animation = original.call(this, frames, options);
      const pauseAt = Reflect.get(window, "glassPauseAt");
      if (typeof pauseAt === "number" && this.closest('[data-slot="glass-selection"]')) {
        animation.pause();
        animation.currentTime = pauseAt;
      }
      return animation;
    };
  });
}

test("glass is bounded to navigation with stable desktop hover targets @critical", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const canHover = await page.evaluate(() => matchMedia("(hover:hover) and (pointer:fine)").matches);
  for (const width of [1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard");
    const top = page.getByRole("navigation", { name: "Header navigation", exact: true });
    await expect(top.locator('[data-slot="glass-selection"]')).toHaveAttribute("data-ready", "true");
    await expect(top.getByRole("link", { name: "Navigate to Settlements, 1 waiting for you", exact: true })).toBeVisible();
    await expect(top.getByRole("link", { name: "Navigate to Household, 1 waiting for review", exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const [glass, logo, accounts] = await Promise.all([top.boundingBox(), page.locator(".journey-wordmark").boundingBox(), page.locator(".journey-header-actions").boundingBox()]);
    expect(glass!.x).toBeGreaterThan(logo!.x + logo!.width);
    expect(glass!.x + glass!.width).toBeLessThan(accounts!.x);
    await expect(page.locator(".journey-header")).toHaveCSS("backdrop-filter", "none");
    await expect(top.getByRole("link")).toHaveCount(5);
    const expenses = top.getByRole("link", { name: "Navigate to Expenses", exact: true });
    const before = await expenses.boundingBox();
    await expenses.hover();
    if (canHover) await expect(expenses.locator(".journey-glass-visual")).not.toHaveCSS("transform", "none");
    else await expect(expenses.locator(".journey-glass-visual")).toHaveCSS("transform", "none");
    expect(await expenses.boundingBox()).toEqual(before);
    await expect(top.getByRole("link", { name: "Navigate to Dashboard", exact: true })).toHaveAttribute("aria-current", "page");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  }
  const rail = page.getByRole("navigation", { name: "Primary navigation", exact: true }).getByRole("link", { name: "Expenses", exact: true });
  const before = await rail.boundingBox();
  await rail.hover();
  if (canHover) await expect(rail.locator(".journey-glass-visual")).not.toHaveCSS("transform", "none");
  else await expect(rail.locator(".journey-glass-visual")).toHaveCSS("transform", "none");
  expect(await rail.boundingBox()).toEqual(before);
});

test("one glass lens follows tabs, rapid changes and browser Back @critical", async ({ page }) => {
  await installMotionRecorder(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard");
  const top = page.getByRole("navigation", { name: "Header navigation", exact: true });
  const lens = top.locator('[data-slot="glass-selection"]');
  await expect(page.locator('[data-slot="app-shell"]')).toHaveAttribute("data-runtime-state", "ready");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(lens).toHaveAttribute("data-ready", "true");
  const instance = await lens.elementHandle();
  for (const destination of ["Expenses", "Cards", "Household"]) {
    const tab = top.getByRole("link", { name: new RegExp(`^Navigate to ${destination}(?:,|$)`) });
    await tab.click();
    await expect(page).toHaveURL(new RegExp(`/${destination.toLowerCase()}$`));
    // URL can update before React commits the actual selected tab in WebKit.
    await expect(tab).toHaveAttribute("aria-current", "page");
  }
  // Back must interrupt visible travel. Immediately returning before the first
  // frame can legitimately leave the lens at Cards and need no fourth animation.
  const cards = top.getByRole("link", { name: "Navigate to Cards", exact: true });
  await expect.poll(async () => {
    const [visible, destination] = await Promise.all([lens.boundingBox(), cards.boundingBox()]);
    return Math.abs(visible!.x - destination!.x);
  }).toBeGreaterThan(4);
  await page.goBack();
  await expect(page).toHaveURL(/\/cards$/);
  await expect(cards).toHaveAttribute("aria-current", "page");
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, "glassMotionRecords") as { surface: string }[]).filter((entry) => entry.surface === "Header navigation").length)).toBeGreaterThanOrEqual(4);
  expect(await instance!.evaluate((element) => element.isConnected)).toBe(true);
  await expect(lens).toHaveAttribute("data-moving", "false");
  const [selected, settled] = await Promise.all([top.locator('[aria-current="page"]').boundingBox(), lens.boundingBox()]);
  expect(Math.abs(selected!.x - settled!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(selected!.width - settled!.width)).toBeLessThanOrEqual(1);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
});

test("phone tabs animate glass without hover or moving their hit areas @critical", async ({ page }) => {
  await installMotionRecorder(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  for (const width of [320, 390, 430, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/dashboard");
    const dock = page.getByRole("navigation", { name: "Mobile navigation", exact: true });
    const expenses = dock.getByRole("link", { name: "Expenses", exact: true });
    const before = await expenses.boundingBox();
    await expenses.hover();
    await expect(expenses.locator(".journey-mobile-icon")).toHaveCSS("transform", "none");
    expect(await expenses.boundingBox()).toEqual(before);
    await expenses.click();
    await expect(page).toHaveURL(/\/expenses$/);
    await expect.poll(() => page.evaluate(() => (Reflect.get(window, "glassMotionRecords") as { surface: string }[]).filter((entry) => entry.surface === "Mobile navigation").length)).toBeGreaterThanOrEqual(1);
    await expect(dock.locator('[data-slot="glass-selection"]')).toHaveAttribute("data-moving", "false");
    const [icon, lens] = await Promise.all([expenses.locator(".journey-mobile-icon").boundingBox(), dock.locator('[data-slot="glass-selection"]').boundingBox()]);
    expect(Math.abs(icon!.x - lens!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(icon!.width - lens!.width)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  }
});

test("reduced motion snaps glass to the actual tab and keeps hover stationary @critical", async ({ page }) => {
  await installMotionRecorder(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard");
  const top = page.getByRole("navigation", { name: "Header navigation", exact: true });
  const expenses = top.getByRole("link", { name: "Navigate to Expenses", exact: true });
  await expenses.hover();
  await expect(expenses.locator(".journey-glass-visual")).toHaveCSS("transform", "none");
  await expenses.click();
  await expect(page).toHaveURL(/\/expenses$/);
  await expect(top.locator('[data-slot="glass-selection"]')).toHaveAttribute("data-ready", "true");
  expect(await page.evaluate(() => Reflect.get(window, "glassMotionRecords"))).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("navigation", { name: "Mobile navigation", exact: true }).getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(await page.evaluate(() => Reflect.get(window, "glassMotionRecords"))).toEqual([]);
});

test("glass remains decorative through More and notification overlays on a dirty phone draft @critical", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/expenses/new");
  const name = page.getByLabel("Expense Name");
  await name.fill("Glass keeps the draft");
  const instance = await name.elementHandle();
  await page.getByLabel("Amount (BDT)").fill("300");
  await expect(page.getByLabel("Expense summary and actions")).toContainText("৳100.00");
  await page.getByRole("button", { name: /^More(?:,|$)/ }).click();
  await expect(page.getByRole("dialog", { name: "More", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  const bell = page.getByRole("button", { name: /^Notifications/ });
  await bell.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bell).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await instance!.evaluate((element) => element.isConnected)).toBe(true);
  await expect(name).toHaveValue("Glass keeps the draft");
  await expect(page.getByLabel("Amount (BDT)")).toHaveValue("300");
});

test("in-flight glass stays readable, cancels for reduced motion and clears unmatched tabs @critical", async ({ page }, testInfo) => {
  await installMotionRecorder(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard");
  const top = page.getByRole("navigation", { name: "Header navigation", exact: true });
  const lens = top.locator('[data-slot="glass-selection"]');
  await expect(lens).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => Reflect.set(window, "glassPauseAt", 160));
  await top.getByRole("link", { name: "Navigate to Expenses", exact: true }).click();
  await expect(page).toHaveURL(/\/expenses$/);
  await lens.evaluate(async (element) => {
    await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    const animations = element.getAnimations({ subtree: true });
    if (!element.getAnimations()[0]) throw new Error("Expected a real in-flight glass animation.");
    animations.forEach((animation) => { animation.pause(); animation.currentTime = 160; });
  });
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
  if (process.env.HFT_GLASS_ARTIFACT_DIR && testInfo.project.name === "chromium") {
    await page.screenshot({ path: resolve(process.env.HFT_GLASS_ARTIFACT_DIR, "topbar-in-flight.png") });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(lens).toHaveAttribute("data-moving", "false");
  await expect.poll(() => lens.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
  await page.getByRole("link", { name: "Your profile", exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(lens).toHaveAttribute("data-ready", "false");
  await top.getByRole("link", { name: "Navigate to Dashboard", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(lens).toHaveAttribute("data-ready", "true");
});

test("the single selected pill stretches, compresses and carries only clipped navigation ink @critical", async ({ page }) => {
  await installMotionRecorder(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard");
  const nav = page.getByRole("navigation", { name: "Header navigation", exact: true });
  const lens = nav.locator('[data-slot="glass-selection"]');
  await expect(lens).toHaveAttribute("data-ready", "true");
  await expect(nav.getByRole("link", { name: "Navigate to Settlements, 1 waiting for you", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Navigate to Household, 1 waiting for review", exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const tabs = nav.getByRole("link");
  const stable = await tabs.evaluateAll((nodes) => nodes.map((node) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
  const destination = nav.getByRole("link", { name: "Navigate to Expenses", exact: true });
  await page.evaluate(() => Reflect.set(window, "glassPauseAt", 0));
  await destination.click();
  await expect(destination).toHaveAttribute("aria-current", "page");
  await lens.evaluate((element) => element.getAnimations({ subtree: true }).forEach((animation) => animation.pause()));
  const destinationBox = await destination.boundingBox();
  const layoutSize = await lens.evaluate((element) => ({ width: (element as HTMLElement).offsetWidth, height: (element as HTMLElement).offsetHeight }));
  for (const [fraction, expansion] of [[.15, true], [.45, false]] as const) {
    await lens.evaluate(async (element, fraction) => {
      const duration = Number(element.getAnimations()[0].effect!.getTiming().duration);
      element.getAnimations({ subtree: true }).forEach((animation) => { animation.currentTime = duration * fraction; });
      await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    }, fraction);
    const current = await lens.boundingBox();
    // The visible shape deforms without changing its layout bounds each frame.
    expect(await lens.evaluate((element) => ({ width: (element as HTMLElement).offsetWidth, height: (element as HTMLElement).offsetHeight }))).toEqual(layoutSize);
    if (expansion) expect(current!.width).toBeGreaterThan(destinationBox!.width * 1.2);
    else expect(current!.width).toBeLessThan(destinationBox!.width * .95);
    await expect(destination).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(lens.locator("a,button,input,[tabindex],[id]")).toHaveCount(0);
    await expect(lens.locator(".journey-glass-ink-item")).toHaveCount(5);
    const alignment = await lens.locator(".journey-glass-ink-item").nth(1).evaluate((item) => {
      const original = document.querySelector('.journey-top-link[href="/expenses"] .journey-glass-visual')!;
      const a = item.getBoundingClientRect(), b = original.getBoundingClientRect();
      return { x: Math.abs(a.x + a.width / 2 - b.x - b.width / 2), y: Math.abs(a.y + a.height / 2 - b.y - b.height / 2) };
    });
    expect(alignment.x).toBeLessThan(1); expect(alignment.y).toBeLessThan(1);
    const material = await lens.locator(".journey-glass-fill").evaluate((node) => Number(getComputedStyle(node).opacity));
    expect(material).toBeGreaterThanOrEqual(.65);
    await expect(lens.locator(".journey-glass-ink")).toHaveCSS("color", "rgb(255, 255, 255)");
  }
  expect(await tabs.evaluateAll((nodes) => nodes.map((node) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }))).toEqual(stable);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(lens).toHaveAttribute("data-moving", "false");
  await expect.poll(() => lens.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
});

test("mobile interrupted glass motion retains its visible position and stationary icons @critical", async ({ page }) => {
  await installMotionRecorder(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  const nav = page.getByRole("navigation", { name: "Mobile navigation", exact: true });
  const lens = nav.locator('[data-slot="glass-selection"]');
  await expect(lens).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const dashboardInk = await lens.locator(".journey-glass-ink-item").first().elementHandle();
  await page.evaluate(() => Reflect.set(window, "glassPauseAt", 130));
  await nav.getByRole("link", { name: "Expenses", exact: true }).click();
  await expect(nav.getByRole("link", { name: "Expenses", exact: true })).toHaveAttribute("aria-current", "page");
  await lens.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  const interrupted = await lens.boundingBox();
  await page.evaluate(() => Reflect.set(window, "glassPauseAt", 0));
  await nav.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(nav.getByRole("link", { name: "Dashboard", exact: true })).toHaveAttribute("aria-current", "page");
  await lens.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  const resumed = await lens.boundingBox();
  for (const dimension of ["x", "y", "width", "height"] as const) expect(Math.abs(resumed![dimension] - interrupted![dimension])).toBeLessThan(1);
  expect(await dashboardInk!.evaluate((element) => element.isConnected)).toBe(true);
  for (const fraction of [.15, .45, .75]) {
    await lens.evaluate(async (element, fraction) => {
      const duration = Number(element.getAnimations()[0].effect!.getTiming().duration);
      element.getAnimations({ subtree: true }).forEach((effect) => { effect.currentTime = duration * fraction; });
      await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    }, fraction);
    const centerError = await lens.locator(".journey-glass-ink-item").first().evaluate((item) => {
      const original = document.querySelector('.journey-mobile-link[href="/dashboard"] .journey-mobile-icon')!;
      const a = item.getBoundingClientRect(), b = original.getBoundingClientRect();
      return { x: Math.abs(a.x + a.width / 2 - b.x - b.width / 2), y: Math.abs(a.y + a.height / 2 - b.y - b.height / 2) };
    });
    expect(centerError.x).toBeLessThan(1); expect(centerError.y).toBeLessThan(1);
  }
  await expect(lens).toHaveCSS("backdrop-filter", "none");
  await expect(lens.locator("a,button,input,[tabindex],[id]")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(lens).toHaveAttribute("data-moving", "false");
  await expect.poll(() => lens.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
});
