import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";
import { expect, test, type Page } from "./fixtures";

async function inspectViewport(page: Page, name: string, width: number, outputPath: (name: string) => string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${name} overflows at ${width}px`).toBeLessThanOrEqual(1);
  const centering = await page.evaluate(() => {
    const container = document.querySelector('[data-slot="page-container"]');
    const main = container?.closest("main");
    if (!container || !main) return 0;
    const content = container.getBoundingClientRect();
    const available = main.getBoundingClientRect();
    return Math.abs(content.left + content.width / 2 - available.left - available.width / 2);
  });
  expect(centering, `${name} is centered at ${width}px`).toBeLessThanOrEqual(1);
  if (width === 390 || width === 1440) {
    // Axe can leave the skip link focused; remove that instrumentation-only overlay from visual captures.
    await page.evaluate(() => { if (document.activeElement?.classList.contains("skip-link")) (document.activeElement as HTMLElement).blur(); });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    const filename = `${name}-${width}.png`;
    await page.screenshot({ path: process.env.UI_REDESIGN_ARTIFACT_DIR ? resolve(process.env.UI_REDESIGN_ARTIFACT_DIR, filename) : outputPath(filename), fullPage: true, animations: "disabled" });
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? "")), `${name} accessibility at ${width}px`).toEqual([]);
  }
}

test("approved Dashboard has responsive grouped panels and accessible navigation @critical", async ({ page }, testInfo) => {
  for (const width of [360, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/dashboard");
    await expect(page.getByText("Spending Trend", { exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Select month" }).click();
    await page.getByRole("option", { name: "August 2026", exact: true }).click();
    await expect(page.getByRole("img", { name: /Daily spending bar chart/ })).toBeVisible();
    await expect(page.getByRole("img", { name: /Payment Mix for/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page.getByRole("group", { name: /Active household members:/ })).toBeVisible();
    const dashboardGeometry = await page.evaluate(() => {
      const group = document.querySelector(".journey-dashboard-summary")!.getBoundingClientRect();
      const tray = document.querySelector(".journey-avatar-tray")!.getBoundingClientRect();
      const avatars = Array.from(document.querySelectorAll('.journey-avatar-tray > [data-slot="avatar"]')).map((avatar) => avatar.getBoundingClientRect());
      const panels = Array.from(document.querySelector(".journey-summary-grid")!.children).map((panel) => panel.getBoundingClientRect());
      const title = document.querySelector(".journey-dashboard-title")!.getBoundingClientRect();
      const notch = document.querySelector(".journey-dashboard-summary .journey-avatar-notch")!.getBoundingClientRect();
      return { offset: Math.abs(group.left + group.width / 2 - tray.left - tray.width / 2), gaps: avatars.slice(1).map((avatar, index) => avatar.left - avatars[index].right), panelGap: panels[2].left - panels[1].right, titleGap: notch.top - title.bottom };
    });
    expect(dashboardGeometry.offset).toBeLessThanOrEqual(1);
    expect(dashboardGeometry.gaps.every((gap) => gap >= 4)).toBe(true);
    if (width < 640) expect(dashboardGeometry.titleGap).toBeGreaterThanOrEqual(4);
    if (width >= 1400) expect(dashboardGeometry.panelGap).toBe(16);
    await expect(page.locator("header").getByRole("button", { name: /^Notifications/ })).toHaveCount(1);
    await expect(page.locator("main").getByRole("button", { name: /^Notifications/ })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: width < 1024 ? "Mobile navigation" : "Header navigation", exact: true })).toBeVisible();
    const name = `dashboard-${width}.png`;
    await page.evaluate(() => { if (document.activeElement?.classList.contains("skip-link")) (document.activeElement as HTMLElement).blur(); });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: process.env.UI_REDESIGN_ARTIFACT_DIR ? resolve(process.env.UI_REDESIGN_ARTIFACT_DIR, name) : testInfo.outputPath(name), fullPage: true, animations: "disabled" });
  }
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});

for (const [name, route, heading] of [
  ["expenses", "/expenses?month=2026-08", "Expenses"],
  ["add-expense", "/expenses/new", "Add Expense"],
  ["expense-details", "/expenses/expense-groceries", "Groceries"],
  ["edit-expense", "/expenses/expense-groceries/edit", "Edit Expense"],
  ["settlements", "/settlements", "Settlements"],
  ["cards", "/cards", "My Cards"],
  ["household-leader", "/household", "Household"],
  ["profile", "/profile", "Profile"],
  ["notifications", "/notifications", "Notifications"],
  ["monthly-report", "/reports/monthly?month=2026-08", "Monthly Report"],
  ["login", "/login", "Sign In"],
  ["signup", "/signup", "Create Account"],
  ["forgot-password", "/forgot-password", "Forgot password"],
  ["reset-password", "/reset-password?userId=visual-fixture&secret=visual-fixture", "Choose a new password"],
] as const) {
  test(`${name} matches the responsive visual system with accessible controls`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const width of [360, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(route);
      await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
      if (name === "monthly-report") await expect(page.getByRole("img", { name: /day 1 through day 31/ })).toBeVisible();
      if (name === "add-expense" || name === "edit-expense") await expect(page.getByLabel("Expense Name")).toBeVisible();
      await inspectViewport(page, name, width, (file) => testInfo.outputPath(file));
    }
    expect(errors).toEqual([]);
  });
}

test("Household access variants and onboarding preserve privacy at desktop and mobile sizes", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/household");
    async function identity(name: "john" | "alex" | "raiyan") {
      if (width < 1024) {
        await page.getByRole("button", { name: /^More(?:,|$)/ }).click();
        await page.getByTestId(`mobile-development-identity-user-${name}`).click();
        await page.keyboard.press("Escape");
      } else {
        await page.getByTestId("development-tools-trigger").click();
        await page.getByTestId(`development-identity-user-${name}`).click();
      }
    }
    await identity("john");
    await expect(page.getByRole("button", { name: "Rename", exact: true })).toHaveCount(0);
    await inspectViewport(page, "household-member", width, (file) => testInfo.outputPath(file));
    await identity("alex");
    // Cancellation and the later join request are existing commands in this isolated fixture.
    {
      await expect(page.getByText("Pending", { exact: true })).toBeVisible();
      await expect(page.locator("main").getByText(/Groceries|John|Sarah|balance|expense/i)).toHaveCount(0);
      await inspectViewport(page, "household-pending", width, (file) => testInfo.outputPath(file));
      await page.getByRole("button", { name: "Cancel Request", exact: true }).click();
      await page.getByRole("button", { name: "Cancel request", exact: true }).click();
    }
    await expect(page.getByText("You aren't part of a household yet.")).toBeVisible();
    await inspectViewport(page, "household-no-membership", width, (file) => testInfo.outputPath(file));
    await page.getByRole("link", { name: /Create a Household/ }).click();
    await expect(page.getByLabel("House Name*")).toBeVisible();
    await inspectViewport(page, "household-create", width, (file) => testInfo.outputPath(file));
    await page.goto("/household/join");
    await page.getByLabel("House Code*").fill("012345678");
    await page.getByRole("button", { name: "Find Household" }).click();
    await expect(page.getByText("Household found", { exact: true })).toBeVisible();
    await inspectViewport(page, "household-join", width, (file) => testInfo.outputPath(file));
    await page.getByRole("button", { name: "Send Join Request", exact: true }).click();
    await expect(page).toHaveURL(/\/household$/);
    await expect(page.getByText("Pending", { exact: true })).toBeVisible();
    await identity("raiyan");
  }
});

test("Card dialogs remain readable, responsive and keyboard dismissible", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/cards");
    await page.getByRole("button", { name: "Add Card", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Add Card" })).toBeVisible();
    await page.getByLabel("Card Name").fill("Everyday");
    await inspectViewport(page, "add-card-dialog", width, (file) => testInfo.outputPath(file));
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /actions for daily debit/i }).click();
    await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Edit Card" })).toBeVisible();
    await inspectViewport(page, "edit-card-dialog", width, (file) => testInfo.outputPath(file));
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  }
});

test("navigation motion preserves form drafts during shell interaction and respects reduced motion @critical", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/expenses/new");
  const name = page.getByLabel("Expense Name");
  await name.fill("Unsaved draft survives header interaction");
  await page.locator("#desktop-sidebar").hover({ position: { x: 30, y: 20 } });
  await expect(page.getByRole("button", { name: /(?:Expand|Collapse) sidebar/ })).toHaveCount(0);
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(name).toHaveValue("Unsaved draft survives header interaction");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("link", { name: "Navigate to Expenses", exact: true }).click();
  await expect(page).toHaveURL(/\/expenses$/);
  await expect(page.getByRole("heading", { name: "Expenses", exact: true })).toBeVisible();
  expect(await page.locator('[data-slot="route-surface"]').evaluate((element) => element.getAnimations().length)).toBe(0);
  await expect(page.locator('[data-slot="navigation-indicator"]')).toHaveCount(0);
  const clearFilters = page.getByLabel("Expense filters").getByRole("button", { name: /clear filters/i });
  await clearFilters.focus();
  await page.keyboard.press("Enter");
  await expect(clearFilters).toHaveCSS("transition-duration", "0.001s");
});

test("header and rail navigation open the arriving page without blue selection outlines @critical", async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as typeof window & { pageMotionDurations?: number[] };
    target.pageMotionDurations = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (this.getAttribute("data-slot") === "route-surface") target.pageMotionDurations!.push(Number(typeof options === "object" ? options.duration : options));
      return animate.call(this, frames, options);
    };
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/dashboard");
  await expect(page.getByText("Spending Trend", { exact: true })).toBeVisible();
  const before = await page.evaluate(() => (window as typeof window & { pageMotionDurations: number[] }).pageMotionDurations.length);
  await page.getByRole("link", { name: "Navigate to Expenses", exact: true }).click();
  await expect(page).toHaveURL(/\/expenses$/);
  await expect(page.getByRole("heading", { name: "Expenses", exact: true })).toBeVisible();
  await page.locator("#desktop-sidebar").getByRole("link", { name: "Cards", exact: true }).click();
  await expect(page).toHaveURL(/\/cards$/);
  await expect(page.getByRole("heading", { name: "My Cards" })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => (window as typeof window & { pageMotionDurations: number[] }).pageMotionDurations.length)).toBeGreaterThanOrEqual(before + 2);
  expect(await page.evaluate(() => (window as typeof window & { pageMotionDurations: number[] }).pageMotionDurations.every((duration) => duration === 320))).toBe(true);
  await expect(page.locator('[data-slot="navigation-indicator"]')).toHaveCount(0);
  for (const name of ["Header navigation", "Primary navigation"]) {
    await expect(page.getByRole("navigation", { name, exact: true }).locator('a[aria-current="page"]')).toHaveAttribute("href", "/cards");
  }
});

test("large balances and long household names reflow without hiding controls", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.evaluate(async () => {
    const opening = indexedDB.open("house-finance-tracker-local");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const transaction = database.transaction(["expenses", "households"], "readwrite");
    const expenses = transaction.objectStore("expenses");
    const expenseRead = expenses.get("expense-groceries");
    expenseRead.onsuccess = () => expenses.put({ ...expenseRead.result, amountPoisha: 100000000, allocations: expenseRead.result.allocations.map((allocation: { participantId: string }, index: number) => ({ ...allocation, sharePoisha: index === 0 ? 33333334 : 33333333 })) });
    const households = transaction.objectStore("households");
    const householdRead = households.getAll();
    householdRead.onsuccess = () => households.put({ ...householdRead.result[0], name: "A household with a deliberately long name for responsive layout verification" });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  });
  // 720 CSS pixels also exercises the reflow width of a 1440px desktop at 200% zoom.
  for (const width of [360, 720, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/dashboard");
    await expect(page.getByText("Spending Trend", { exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Select month" }).click();
    await page.getByRole("option", { name: "August 2026", exact: true }).click();
    await expect(page.getByRole("img", { name: /Payment Mix for/ })).toBeVisible();
    await expect(page.locator('[data-slot="surface"]').filter({ hasText: /^Spent/ })).toContainText("৳10,00,150.00");
    await inspectViewport(page, "large-balances", width, (file) => testInfo.outputPath(file));
    await page.goto("/household");
    await expect(page.getByText("A household with a deliberately long name for responsive layout verification", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /show house code/i })).toBeVisible();
    await inspectViewport(page, "long-household-name", width, (file) => testInfo.outputPath(file));
  }
});

test("U2 compact Cards and clean Profile remain responsive and accessible @critical", async ({ page }, testInfo) => {
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/cards");
    const cards = page.getByRole("list", { name: "Your active Cards" });
    await expect(cards).toBeVisible();
    const bounds = await cards.locator(".journey-card-tile").first().boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(344);
    expect(bounds!.height).toBeLessThan(350);
    await inspectViewport(page, "u2-cards", width, (file) => testInfo.outputPath(file));
    await page.goto("/profile");
    await expect(page.getByRole("textbox", { name: "Display Name", exact: true })).toBeVisible();
    await expect(page.locator("main").getByRole("heading", { name: "Icon Credits" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "House Finance Tracker dashboard" })).toHaveCount(0);
    await inspectViewport(page, "u2-profile", width, (file) => testInfo.outputPath(file));
  }
});

test("U2 scrollbar geometry stays stable across navigation and scroll-locked dialogs @critical", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/dashboard");
  await expect(page.getByText("Spending Trend", { exact: true })).toBeVisible();
  const geometry = () => page.locator(".journey-header").evaluate((element) => ({ width: element.getBoundingClientRect().width, gutter: window.innerWidth - document.documentElement.clientWidth }));
  const baseline = await geometry();
  await page.getByRole("link", { name: "Navigate to Cards", exact: true }).click();
  await expect(page.getByRole("list", { name: "Your active Cards" })).toBeVisible();
  expect(await geometry()).toEqual(baseline);
  const panel = page.locator('[data-slot="page-container"]');
  const before = await panel.boundingBox();
  await page.getByRole("button", { name: "Add Card", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add Card" })).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-scroll-locked", /[1-9]/);
  expect(await geometry()).toEqual(baseline);
  expect((await panel.boundingBox())!.x).toBe(before!.x);
  const y = await page.evaluate(() => window.scrollY);
  await page.mouse.move(12, 12);
  await page.mouse.wheel(0, 400);
  // Let the browser deliver the wheel event; the backdrop must remain locked.
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.scrollY)).toBe(y);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(await geometry()).toEqual(baseline);
  await page.getByRole("link", { name: "Your profile", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Display Name", exact: true })).toBeVisible();
  expect(await geometry()).toEqual(baseline);
  await expect(page.locator("html")).toHaveCSS("overflow-y", "scroll");
});

test("U8 Dashboard centers its month controls and shows signed balance pills @critical", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.goto("/dashboard");
  const month = page.getByRole("combobox", { name: "Select month", exact: true });
  await expect(month).toContainText("September 2026");
  const balances = page.getByRole("list", { name: "Housemate balances" });
  await expect(balances.locator('[data-balance-state="gets-back"]')).toHaveText("+৳200.00");
  await expect(balances.locator('[data-balance-state="gets-back"]')).toHaveCSS("color", "rgb(21, 128, 61)");
  await expect(balances.locator('[data-balance-state="owes"]')).toHaveText(["-৳175.00", "-৳25.00"]);
  for (const pill of await balances.locator('[data-balance-state="owes"]').all()) await expect(pill).toHaveCSS("color", "rgb(185, 28, 28)");
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = await month.evaluate((trigger) => {
      const controls = trigger.parentElement!;
      const previous = controls.firstElementChild!.getBoundingClientRect();
      const next = controls.lastElementChild!.getBoundingClientRect();
      const icons = trigger.querySelectorAll(":scope > svg");
      const calendar = icons[0].getBoundingClientRect();
      const arrow = icons[1].getBoundingClientRect();
      const label = trigger.querySelector('[data-slot="select-value"]')!;
      const text = label.getBoundingClientRect();
      return {
        centerError: (calendar.left + arrow.right) / 2 - (previous.right + next.left) / 2,
        labelError: text.left + text.width / 2 - (previous.right + next.left) / 2,
        verticalError: calendar.top + calendar.height / 2 - (text.top + text.height / 2),
        calendarWidth: calendar.width,
        clipped: label.scrollWidth > label.clientWidth,
      };
    });
    for (const error of [geometry.centerError, geometry.labelError, geometry.verticalError]) expect(Math.abs(error), `Month contents centered at ${width}px`).toBeLessThanOrEqual(1);
    // The optional page-entry scale can still be finishing during the first measurement.
    expect(Math.abs(geometry.calendarWidth - 16)).toBeLessThanOrEqual(0.5);
    expect(geometry.clipped).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`u8-dashboard-${width}.png`), animations: "disabled" });
    if (width === 390) {
      await balances.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("u8-balance-pills-mobile.png"), animations: "disabled" });
      const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    }
  }
  const anchor = page.locator('[data-slot="month-selector"] [data-slot="select-trigger"]');
  const anchorBox = await anchor.boundingBox();
  await page.mouse.move(anchorBox!.x + anchorBox!.width / 2, anchorBox!.y + anchorBox!.height / 2);
  await page.mouse.down();
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(anchor).toHaveCSS("scale", "none");
  await expect(anchor).toHaveCSS("translate", "none");
  expect(await anchor.boundingBox()).toEqual(anchorBox);
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  const previous = page.getByRole("button", { name: "Previous month", exact: true });
  const button = await previous.boundingBox();
  await page.mouse.move(button!.x + button!.width / 2, button!.y + button!.height / 2);
  await page.mouse.down();
  await expect.poll(() => previous.evaluate((element) => Number.parseFloat(getComputedStyle(element).scale))).toBeLessThan(1);
  await expect(month).toContainText("September 2026");
  await page.mouse.up();
  await expect(month).toContainText("August 2026");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const next = page.getByRole("button", { name: "Next month", exact: true });
  await expect(next).toHaveAttribute("aria-disabled", "false");
  const nextButton = await next.boundingBox();
  await page.mouse.move(nextButton!.x + nextButton!.width / 2, nextButton!.y + nextButton!.height / 2);
  await page.mouse.down();
  await expect(next).toHaveCSS("scale", "none");
  await expect(next).toHaveCSS("translate", "none");
  await page.mouse.up();
  await expect(month).toContainText("September 2026");
});

test("U8 Expense column headers and rows share aligned proportional tracks @critical", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.goto("/expenses?month=2026-08");
  const header = page.locator(".journey-expense-columns.table-label");
  const rows = page.locator(".journey-expense-row .journey-expense-columns");
  await expect(rows).toHaveCount(2);
  for (const width of [390, 768, 900, 1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    if (width >= 900) {
      await expect(header).toBeVisible();
      const columns = await header.evaluate((element) => Array.from(element.children, (child) => ({ x: child.getBoundingClientRect().x, width: child.getBoundingClientRect().width })));
      for (const row of await rows.all()) {
        const cells = await row.evaluate((element) => Array.from(element.children, (child) => ({ x: child.getBoundingClientRect().x, width: child.getBoundingClientRect().width })));
        expect(cells).toHaveLength(8);
        for (let index = 1; index < 8; index++) {
          expect(Math.abs(cells[index].x - columns[index].x), `Column ${index + 1} at ${width}px`).toBeLessThanOrEqual(1);
          expect(Math.abs(cells[index].width - columns[index].width)).toBeLessThanOrEqual(1);
        }
      }
      await page.getByRole("link", { name: /Open Groceries expense details/ }).focus();
      const firstColumnX = await rows.first().evaluate((element) => element.children[1].getBoundingClientRect().x);
      expect(Math.abs(firstColumnX - columns[1].x)).toBeLessThanOrEqual(1);
    } else await expect(header).toBeHidden();
    if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`u8-expenses-${width}.png`), animations: "disabled" });
  }
});

test("U7 Dashboard month arrows and dropdown agree and September fits at responsive widths @critical", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.clock.setFixedTime(new Date("2026-10-12T12:00:00.000Z"));
  await page.goto("/dashboard");
  const trigger = page.getByRole("combobox", { name: "Select month", exact: true });
  await expect(trigger).toContainText("October 2026");
  await expect(page.getByRole("img", { name: /Daily spending bar chart for October 2026/ })).toBeVisible();
  await trigger.click();
  await expect(page.getByRole("option")).toHaveText(["October 2026", "September 2026", "August 2026"]);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Previous month", exact: true }).click();
  await expect(trigger).toContainText("September 2026");
  await expect(page.getByRole("img", { name: /Daily spending bar chart for September 2026/ })).toBeVisible();
  await expect(page.getByText("No expenses this month", { exact: true })).toBeVisible();
  await trigger.click();
  await expect(page.getByRole("option", { name: "September 2026", exact: true })).toHaveAttribute("data-state", "checked");
  await page.getByRole("option", { name: "October 2026", exact: true }).click();
  await expect(page.getByRole("img", { name: /Daily spending bar chart for October 2026/ })).toBeVisible();
  await trigger.click();
  await page.getByRole("option", { name: "September 2026", exact: true }).click();
  await expect(page.getByRole("img", { name: /Daily spending bar chart for September 2026/ })).toBeVisible();

  for (const width of [320, 360, 390, 640, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(trigger).toContainText("September 2026");
    const label = trigger.locator('[data-slot="select-value"]');
    const geometry = await label.evaluate((element) => ({ visible: element.clientWidth, needed: element.scrollWidth }));
    expect(geometry.needed, `September label fits at ${width}px`).toBeLessThanOrEqual(geometry.visible);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `No overflow at ${width}px`).toBeLessThanOrEqual(1);
    if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`u7-september-${width}.png`), animations: "disabled" });
  }
  await page.getByRole("button", { name: "Previous month", exact: true }).click();
  await expect(trigger).toContainText("August 2026");
  await expect(page.getByRole("img", { name: /Daily spending bar chart for August 2026/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous month", exact: true })).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(trigger).toContainText("September 2026");
  await expect(page.getByRole("img", { name: /Daily spending bar chart for September 2026/ })).toBeVisible();
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(trigger).toContainText("October 2026");
  await expect(page.getByRole("img", { name: /Daily spending bar chart for October 2026/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next month", exact: true })).toHaveAttribute("aria-disabled", "true");
});

test("U5 dropdowns dismiss without an exit wait and Household keeps only its header Profile @critical", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const exits: string[] = [];
    Object.assign(window, { dropdownExitAnimations: exits });
    document.addEventListener("animationstart", (event) => {
      const target = event.target;
      if (event.animationName === "exit" && target instanceof Element && ["menu", "listbox", "dialog"].includes(target.getAttribute("role") ?? "")) exits.push(target.getAttribute("role")!);
    });
  });
  const dismissRepeatedly = async (trigger: ReturnType<Page["getByRole"]>, content: ReturnType<Page["getByRole"]>) => {
    const original = await trigger.innerText();
    for (const method of ["trigger", "escape", "outside"] as const) {
      const popupType = await trigger.getAttribute("aria-haspopup");
      const button = await trigger.boundingBox();
      await trigger.click();
      await expect(content).toBeVisible();
      const opening = await content.evaluate((element) => ({ name: getComputedStyle(element).animationName, duration: getComputedStyle(element).animationDuration }));
      expect(opening.name).toBe("enter");
      expect(opening.duration).toBe("0.15s");
      if (method === "escape") await page.keyboard.press("Escape");
      else if (method === "trigger") {
        if (popupType === "dialog") await trigger.click();
        else {
          // Native pointer input exercises modal dropdown dismissal on the original trigger.
          await page.mouse.click(button!.x + button!.width / 2, button!.y + button!.height / 2);
        }
      } else await page.mouse.click(4, 4);
      await expect(content).toHaveCount(0);
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(trigger).toHaveText(original);
      if (method !== "outside") await expect(trigger).toBeFocused();
      expect(await page.evaluate(() => Reflect.get(window, "dropdownExitAnimations"))).toEqual([]);
    }
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard");
  await expect(page.locator(".journey-avatar-notch")).toBeVisible();
  await dismissRepeatedly(page.getByRole("button", { name: /^Notifications/ }), page.getByRole("menu"));
  await dismissRepeatedly(page.getByRole("combobox", { name: "Select month" }), page.getByRole("listbox"));
  await page.getByRole("link", { name: /Navigate to Household/ }).click();
  await expect(page.getByRole("heading", { name: "House Leader", exact: true })).toBeVisible();
  await expect(page.locator(".journey-avatar-notch")).toHaveCount(0);
  await expect(page.locator("header [data-slot='avatar']")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Your profile", exact: true })).toBeVisible();
  await dismissRepeatedly(page.getByRole("button", { name: /^Manage John,/ }), page.getByRole("menu"));
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: testInfo.outputPath("u5-household-desktop.png"), animations: "disabled" });

  await page.goto("/expenses");
  for (const name of ["Month", "Paid By", "Payment Method", "Sort"]) await dismissRepeatedly(page.getByRole("combobox", { name, exact: true }), page.getByRole("listbox"));
  await page.goto("/expenses/new");
  await dismissRepeatedly(page.locator('[data-slot="date-picker-trigger"]'), page.getByRole("dialog"));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/household");
  await expect(page.getByRole("heading", { name: "House Leader", exact: true })).toBeVisible();
  await expect(page.locator(".journey-avatar-notch")).toHaveCount(0);
  await expect(page.locator("header [data-slot='avatar']")).toHaveCount(1);
  await dismissRepeatedly(page.getByRole("button", { name: /^Notifications/ }), page.getByRole("menu"));
  await page.screenshot({ path: testInfo.outputPath("u5-household-mobile.png"), animations: "disabled" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const bell = page.getByRole("button", { name: /^Notifications/ });
  await bell.click();
  await expect(page.getByRole("menu")).toHaveCSS("animation-duration", "0.001s");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(bell).toBeFocused();
});

test("U4 desktop rail stays fixed through page scrolling and shared decoration is removed @critical", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  for (const viewport of [{ width: 1024, height: 600 }, { width: 1440, height: 900 }, { width: 1920, height: 1000 }]) {
    await page.setViewportSize(viewport);
    for (const path of ["/household", "/dashboard", "/expenses", "/settlements", "/cards", "/profile", "/notifications", "/reports/monthly"]) {
      await page.goto(path);
      await expect(page.locator('[data-slot="app-shell"]')).toHaveAttribute("data-runtime-state", "ready");
      await expect(page.getByRole("link", { name: "Credits", exact: true })).toHaveCount(0);
      if (path === "/household") {
        await expect(page.getByRole("heading", { name: "House Leader", exact: true })).toBeVisible();
        await expect(page.locator(".journey-household-leader [data-slot='avatar']")).toHaveCount(1);
        await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
        await expect(page.locator(".journey-household-grid > .journey-avatar-notch")).toHaveCount(0);
      }
      // Short routes must exercise the same real document scroll as long ones.
      await page.locator("#main-content").evaluate((main) => { main.style.minHeight = `${window.innerHeight * 3}px`; });
      const sidebar = page.locator("#desktop-sidebar");
      await expect(sidebar).toHaveCSS("position", "fixed");
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      const baseline = await sidebar.boundingBox();
      const stack = await page.locator(".journey-rail-stack").boundingBox();
      expect(baseline!.x).toBe(0);
      expect(baseline!.y).toBe(88);
      expect(baseline!.width).toBe(72);
      const bottom = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      for (const target of [viewport.height, bottom, 0]) {
        await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), target);
        expect(await page.evaluate(() => window.scrollY)).toBe(target);
        expect(await sidebar.boundingBox(), `${path} rail at ${target}, ${viewport.width}px`).toEqual(baseline);
        expect(await page.locator(".journey-rail-stack").boundingBox()).toEqual(stack);
      }
      await expect(sidebar.getByRole("button", { name: "Log Out" })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await page.locator("#main-content").evaluate((main) => { main.style.minHeight = ""; });
      if (viewport.width === 1440 && path === "/household") await page.screenshot({ path: testInfo.outputPath("u4-household-desktop.png"), animations: "disabled" });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/household");
  await expect(page.getByRole("heading", { name: "House Leader", exact: true })).toBeVisible();
  await expect(page.locator("#desktop-sidebar")).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
  await expect(page.locator(".journey-household-grid > .journey-avatar-notch")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Credits", exact: true })).toHaveCount(0);
  await inspectViewport(page, "u4-household-mobile", 390, (file) => testInfo.outputPath(file));
});

test("U2 404 and attribution page use the new design without accessing household data @critical", async ({ page }, testInfo) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const response = await page.goto("/missing-u2-fixture-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to Dashboard" })).toHaveAttribute("href", "/dashboard");
    await inspectViewport(page, "u2-not-found", width, (file) => testInfo.outputPath(file));
    await expect(page.getByRole("link", { name: "Credits", exact: true })).toHaveCount(0);
    await page.goto("/credits");
    await expect(page.getByRole("heading", { name: "Icon Credits" })).toBeVisible();
    await expect(page.locator(".journey-credits-list a")).toHaveCount(12);
    await expect(page.locator("main")).not.toContainText("Raiyan House");
    await inspectViewport(page, "u2-credits", width, (file) => testInfo.outputPath(file));
  }
});

test("U2 early interaction interrupts page motion without dropping its action @critical", async ({ page }) => {
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      // Hold the real entry transform until interaction, independent of machine speed.
      if (this.getAttribute("data-slot") === "route-surface") animation.pause();
      return animation;
    };
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/household");
  await expect(page.getByLabel("House Code hidden")).toBeVisible();
  await page.getByRole("button", { name: "Show House Code", exact: true }).click();
  await expect(page.getByLabel("House Code 012345678")).toHaveText("012345678");
  expect(await page.locator('[data-slot="route-surface"]').evaluate((element) => element.getAnimations().length)).toBe(0);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "Accept Alex into Raiyan House?" })).toBeVisible();
  await page.keyboard.press("Escape");
});
