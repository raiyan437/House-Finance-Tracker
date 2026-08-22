import AxeBuilder from "@axe-core/playwright";
import { expect, selectExpenseDate, test, type Page } from "./fixtures";

function collectBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return () => expect(errors).toEqual([]);
}

async function dashboardReady(page: Page) {
  await page.goto("/dashboard");
  await expect(page.getByText("Spending Trend", { exact: true })).toBeVisible();
}

async function expectDailyDayLabels(page: Page, dayCount: number) {
  const chart = page.locator('[data-slot="daily-spending-chart"]').first();
  const labels = chart.locator("svg text");
  await expect(labels).toHaveCount(dayCount);
  expect(await labels.allTextContents()).toEqual(Array.from({ length: dayCount }, (_, index) => String(index + 1)));
  return { chart, labels };
}

async function createJulyOnlyExpense(page: Page) {
  await page.goto("/expenses/new");
  await page.getByLabel("Expense Name").fill("July-only fixture expense");
  await page.getByLabel("Amount (BDT)").fill("0.01");
  await selectExpenseDate(page, "2026-07-15");
  await page.getByRole("checkbox", { name: "John", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "Sarah", exact: true }).uncheck();
  await page.getByRole("button", { name: "Create Expense" }).click();
  await expect(page.getByRole("heading", { name: "July-only fixture expense" })).toBeVisible();
}

test("Dashboard uses the selected Expense Date month while current financial state remains current", async ({ page }) => {
  const expectNoErrors = collectBrowserErrors(page);
  await dashboardReady(page);
  await createJulyOnlyExpense(page);
  await dashboardReady(page);

  await expect(page.getByRole("combobox", { name: "Select month" })).toContainText("August 2026");
  await expect(page.getByRole("group", { name: "Active household members: Raiyan, John, Sarah" })).toBeVisible();
  const spent = page.locator('[data-slot="surface"]').filter({ hasText: /^Spent/ });
  await expect(spent).toContainText("৳450.00");
  const outstanding = page.locator('[data-slot="surface"]').filter({ hasText: /^Outstanding/ });
  await expect(outstanding).toContainText("You Owe");
  await expect(outstanding).toContainText("You Are Owed");
  await expect(outstanding).toContainText("৳200.00");
  const health = page.locator('[data-slot="surface"]').filter({ hasText: /^Settlement Health/ });
  await expect(health).toContainText("1 outstanding");
  await expect(health).toContainText("1 pending");
  await expect(page.getByRole("img", { name: /day 1 through day 31/i })).toBeVisible();
  await expect(page.getByText("Cash").first()).toBeVisible();
  const paymentMix = page.locator('[data-slot="surface"]').filter({ hasText: /^Payment Mix/ });
  await expect(paymentMix.getByText("৳300.00", { exact: true })).toBeVisible();
  await expect(paymentMix.getByText("66.67%", { exact: true })).toBeVisible();
  await expect(paymentMix.getByText("৳150.00", { exact: true })).toBeVisible();
  await expect(paymentMix.getByText("33.33%", { exact: true })).toBeVisible();
  await expect(page.locator(".recharts-line")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open Internet expense details" })).toBeVisible();
  await expect(page.getByText("John Credit")).toHaveCount(0);

  const currentOutstandingText = await outstanding.textContent();
  const currentHealthText = await health.textContent();
  await page.getByRole("combobox", { name: "Select month" }).click();
  await page.getByRole("option", { name: "July 2026", exact: true }).click();
  await expect(spent).toContainText("৳0.01");
  await expect(page.getByText("July-only fixture expense", { exact: true })).toBeVisible();
  expect(await outstanding.textContent()).toBe(currentOutstandingText);
  expect(await health.textContent()).toBe(currentHealthText);
  expectNoErrors();
});

test("Monthly Report route validates month and exposes exact report semantics", async ({ page }) => {
  const expectNoErrors = collectBrowserErrors(page);
  await page.goto("/reports/monthly?month=2026-08");
  await expect(page.getByRole("heading", { name: "Monthly Report" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "August 2026" })).toBeVisible();
  await expect(page.getByText("No previous-month spending")).toBeVisible();
  await expect(page.getByText("Member Contributions and Expense Shares")).toBeVisible();
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Share", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Claims Created")).toBeVisible();
  await expect(page.getByText("Current Outstanding", { exact: true })).toBeVisible();
  await expect(page.getByText("Current position — not a month-end balance")).toBeVisible();
  await expect(page.getByRole("img", { name: /day 1 through day 31/i })).toBeVisible();
  await expect(page.getByText("John Credit")).toHaveCount(0);

  await page.goto("/reports/monthly?month=not-a-month");
  await expect(page.getByRole("combobox", { name: "Select Monthly Report month" })).toContainText("August 2026");
  await page.goto("/reports/monthly?month=2028-02");
  await expect(page).toHaveURL(/month=2028-02/);
  await expect(page.getByRole("heading", { name: "February 2028" })).toBeVisible();
  await expect(page.getByRole("img", { name: /day 1 through day 29/i })).toBeVisible();
  await expect(page.getByText("No spending in either month")).toBeVisible();
  expectNoErrors();
});

test("Dashboard reconstructs after Expense creation, Settlement confirmation, and identity switching", async ({ page }) => {
  await page.goto("/expenses/new");
  await page.getByLabel("Expense Name").fill("Dashboard refresh expense");
  await page.getByLabel("Amount (BDT)").fill("10");
  await selectExpenseDate(page, "2026-08-19");
  await page.getByRole("button", { name: "Create Expense" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard refresh expense" })).toBeVisible();
  await dashboardReady(page);
  await expect(page.locator('[data-slot="surface"]').filter({ hasText: /^Spent/ })).toContainText("৳460.00");

  await page.goto("/settlements");
  const johnClaim = page.getByRole("listitem").filter({ hasText: "John says they paid you" });
  await johnClaim.getByRole("button", { name: /confirm receipt of payment from john/i }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirm Received" }).click();
  await dashboardReady(page);
  const health = page.locator('[data-slot="surface"]').filter({ hasText: /^Settlement Health/ });
  await expect(health).toContainText("0 pending");

  await page.getByTestId("development-tools-trigger").click();
  await page.getByTestId("development-identity-user-john").click();
  await expect(page.getByRole("group", { name: "Active household members: Raiyan, John, Sarah" })).toBeVisible();
  const firstBalance = page.locator('[data-slot="surface"]').filter({ hasText: /^Housemate Balances/ }).locator("li").first();
  await expect(firstBalance).toContainText("John (You)");
});

test("Spending Trend shows every day and aligns endpoints across responsive widths", async ({ page }) => {
  for (const viewport of [
    { width: 360, height: 844 },
    { width: 390, height: 844 },
    { width: 430, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1280, height: 900 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await dashboardReady(page);
    const { chart, labels } = await expectDailyDayLabels(page, 31);
    const measurements = await chart.evaluate((element) => {
      const center = (node: Element | null) => {
        if (!node) return undefined;
        const box = node.getBoundingClientRect();
        return box.left + box.width / 2;
      };
      const canvas = element.querySelector<HTMLElement>('[data-slot="daily-spending-chart-canvas"]');
      const ticks = [...element.querySelectorAll("svg text")];
      const bars = [...element.querySelectorAll(".recharts-bar-rectangle")];
      const tickBoxes = ticks.map((tick) => tick.getBoundingClientRect());
      const tickCenters = ticks.map(center).filter((value): value is number => value !== undefined);
      const barCenters = bars.map(center).filter((value): value is number => value !== undefined);
      return {
        canvasScrollWidth: canvas?.scrollWidth ?? 0,
        scrollerClientWidth: (element as HTMLElement).clientWidth,
        barAlignmentDistances: barCenters.map((barCenter) => Math.min(...tickCenters.map((tickCenter) => Math.abs(barCenter - tickCenter)))),
        finalTickCenter: tickCenters.at(-1),
        firstTickCenter: tickCenters[0],
        tickStep: tickCenters[1] === undefined || tickCenters[0] === undefined ? 0 : tickCenters[1] - tickCenters[0],
        labelsOverlap: tickBoxes.some((box, index) => {
          const next = tickBoxes[index + 1];
          return next !== undefined && next.left < box.right - 0.5;
        }),
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

    expect(measurements.pageOverflow).toBeLessThanOrEqual(1);
    expect(measurements.canvasScrollWidth).toBeGreaterThanOrEqual(measurements.scrollerClientWidth);
    if (viewport.width < 390) {
      expect(measurements.canvasScrollWidth).toBeGreaterThan(measurements.scrollerClientWidth);
    } else {
      expect(measurements.canvasScrollWidth).toBeLessThanOrEqual(measurements.scrollerClientWidth + 1);
    }
    expect(Math.abs((measurements.finalTickCenter ?? 0) - (measurements.firstTickCenter ?? 0) - measurements.tickStep * 30)).toBeLessThanOrEqual(3);
    expect(measurements.barAlignmentDistances.every((distance) => distance <= 2)).toBe(true);
    expect(measurements.labelsOverlap, `date labels overlap at ${viewport.width}px`).toBe(false);
    await expect(labels.first()).toHaveText("1");
    await expect(labels.last()).toHaveText("31");
  }
});

test("Spending Trend uses the actual last day for every calendar month", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const month of [
    { value: "2026-02", dayCount: 28 },
    { value: "2028-02", dayCount: 29 },
    { value: "2026-04", dayCount: 30 },
    { value: "2026-08", dayCount: 31 },
  ]) {
    await page.goto(`/reports/monthly?month=${month.value}`);
    await expect(page.getByRole("img", { name: new RegExp(`day 1 through day ${month.dayCount}`) })).toBeVisible();
    const { chart } = await expectDailyDayLabels(page, month.dayCount);
    const overflow = await chart.evaluate((element) => {
      const canvas = element.querySelector<HTMLElement>('[data-slot="daily-spending-chart-canvas"]');
      return {
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        chartOverflow: (canvas?.scrollWidth ?? 0) - (element as HTMLElement).clientWidth,
      };
    });
    expect(overflow.pageOverflow).toBeLessThanOrEqual(1);
    expect(overflow.chartOverflow).toBeLessThanOrEqual(1);
  }
});

test("Dashboard gives Spending Trend the full analytics width and places support cards below it", async ({ page }) => {
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1280, height: 900 },
    { width: 1440, height: 1024 },
  ]) {
    await page.setViewportSize(viewport);
    await dashboardReady(page);
    const geometry = await page.evaluate(() => {
      const trend = document.querySelector('[data-slot="surface"]:has(h2:nth-of-type(1))');
      const trendChart = document.querySelector('[data-slot="daily-spending-chart"]');
      const trendCard = [...document.querySelectorAll('[data-slot="surface"]')].find((surface) => surface.textContent?.includes("Spending Trend"));
      const supportGrid = document.querySelector(".dashboard-bottom-grid");
      const payment = document.querySelector(".dashboard-payment-mix-card");
      const rect = (element: Element | null) => element?.getBoundingClientRect();
      return {
        trendCard: rect(trendCard ?? trend),
        trendChart: rect(trendChart),
        supportGrid: rect(supportGrid),
        payment: rect(payment),
        dashboardWidth: document.querySelector('[data-slot="page-container"]')?.getBoundingClientRect().width ?? 0,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        chartOverflow: trendChart ? (trendChart.querySelector<HTMLElement>('[data-slot="daily-spending-chart-canvas"]')?.scrollWidth ?? 0) - (trendChart as HTMLElement).clientWidth : 0,
      };
    });

    expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
    expect(geometry.chartOverflow).toBeLessThanOrEqual(1);
    expect(geometry.trendCard?.width ?? 0).toBeGreaterThan((geometry.dashboardWidth ?? 0) * 0.8);
    expect(geometry.supportGrid?.top ?? 0).toBeGreaterThan(geometry.trendCard?.bottom ?? 0);
    if (viewport.width >= 1280) {
      expect(geometry.payment?.top ?? 0).toBeCloseTo(geometry.supportGrid?.top ?? 0, 0);
    } else {
      expect(geometry.payment?.top ?? 0).toBeGreaterThan(geometry.supportGrid?.top ?? 0);
    }
  }
});

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
]) {
  test(`${viewport.name} analytics are responsive, reduced-motion safe, and accessible`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await dashboardReady(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const monthControl = await page.getByLabel("Select month").boundingBox();
    expect(monthControl?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(page.locator(".recharts-bar-rectangle").first()).toHaveCSS("transition-duration", "0.001s");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
  });
}
