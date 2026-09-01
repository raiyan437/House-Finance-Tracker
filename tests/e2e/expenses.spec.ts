import AxeBuilder from "@axe-core/playwright";
import { expect, selectExpenseDate, test, type Page } from "./fixtures";

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.byteLength);
  chunk.writeUInt32BE(data.byteLength, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.byteLength);
  return chunk;
}

function structurallyValidUndecodablePng(): Buffer {
  const header = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", Buffer.from([0x78, 0x9c, 0xff, 0xff, 0xff, 0xff])),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const browserReceiptFormats = [
  {
    label: "JPEG",
    extension: "jpg",
    mimeType: "image/jpeg",
  },
  {
    label: "WebP",
    extension: "webp",
    mimeType: "image/webp",
  },
] as const;

async function chooseSelectOption(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function setSeedReceiptTerminalState(
  page: Page,
  status: "user-deleted" | "retention-expired",
): Promise<void> {
  await page.evaluate(async (terminalStatus) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("house-finance-tracker-local", 5);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(
          ["receiptMetadata", "receiptBlobs"],
          "readwrite",
        );
        const metadataStore = transaction.objectStore("receiptMetadata");
        const read = metadataStore.get("receipt-groceries");
        read.onerror = () => reject(read.error);
        read.onsuccess = () => {
          const current = read.result;
          if (!current) {
            transaction.abort();
            reject(new Error("The seeded receipt metadata is missing."));
            return;
          }
          metadataStore.put({
            ...current,
            contentStatus: terminalStatus,
            contentRemovedAt: "2026-08-22T10:00:00.000Z",
            ...(terminalStatus === "user-deleted"
              ? { contentRemovedByUserId: "user-raiyan" }
              : {}),
          });
          transaction.objectStore("receiptBlobs").delete("receipt-groceries");
        };
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error);
        };
        transaction.onabort = () => database.close();
      };
    });
  }, status);
}

async function insertConfirmedSettlement(
  page: Page,
  id: string,
  resolvedAt = "2026-08-13T01:00:00.000Z",
): Promise<void> {
  await page.evaluate(
    async ({ settlementId, confirmedAt }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("house-finance-tracker-local", 5);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("settlements", "readwrite");
          transaction.objectStore("settlements").add({
            recordVersion: 1,
            id: settlementId,
            householdId: "household-main",
            senderId: "user-sarah",
            receiverId: "user-raiyan",
            amountPoisha: 500,
            recommendationHouseholdId: "household-main",
            recommendationSenderId: "user-sarah",
            recommendationReceiverId: "user-raiyan",
            recommendationAmountPoisha: 500,
            createdAt: "2026-08-13T00:30:00.000Z",
            status: "confirmed",
            resolvedAt: confirmedAt,
          });
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => {
            database.close();
            reject(transaction.error);
          };
          transaction.onabort = () => database.close();
        };
      });
    },
    { settlementId: id, confirmedAt: resolvedAt },
  );
}

test("expense list composes filters and opens accessible desktop rows", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/expenses");
  await expect(page.getByRole("heading", { name: "Expenses" })).toBeVisible();
  const month = page.getByRole("combobox", { name: "Month", exact: true });
  await expect(month).toContainText("September 2026");
  await month.click();
  await page.getByRole("option", { name: "August 2026", exact: true }).click();
  const paymentMethod = page.getByRole("combobox", { name: "Payment Method", exact: true });
  await expect(paymentMethod).toContainText("Payment Method");
  await expect(paymentMethod).not.toContainText("All Payment Methods");
  await expect(page.getByText("Groceries", { exact: true })).toBeVisible();
  await expect(page.getByText("Internet", { exact: true })).toBeVisible();

  await page.getByLabel("Search expenses by name").fill(" inter ");
  await chooseSelectOption(page, "Paid By", "John");
  await chooseSelectOption(page, "Payment Method", "Card");
  await expect(paymentMethod).toContainText("Card");
  await expect(page.getByText("Internet", { exact: true })).toBeVisible();
  await expect(page.getByText("Groceries", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Clear Filters" }).click();
  await expect(paymentMethod).toContainText("Payment Method");
  await month.click();
  await page.getByRole("option", { name: "August 2026", exact: true }).click();

  await page.getByRole("link", { name: "Open Internet expense details" }).focus();
  await expect(page.getByRole("link", { name: "Open Internet expense details" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Internet" })).toBeVisible();
  await expect(page.getByText("Payment Method")).toBeVisible();
  await expect(page.getByText("John Credit")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("renders retention-expired receipt history without a broken image on Details and Edit", async ({ page }) => {
  await setSeedReceiptTerminalState(page, "retention-expired");
  await page.goto("/expenses/expense-groceries");

  await expect(page.getByRole("heading", { name: "Groceries" })).toBeVisible();
  await expect(page.getByText("Receipt no longer available")).toBeVisible();
  await expect(page.getByText("groceries.png")).toBeVisible();
  await expect(page.getByText("Receipt files are kept for the current month and the previous two calendar months.").first()).toBeVisible();
  await expect(page.getByRole("img", { name: "groceries.png" })).toHaveCount(0);
  await expect(page.getByText("Preview unavailable")).toHaveCount(0);

  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page.getByRole("heading", { name: "Edit Expense" })).toBeVisible();
  await expect(page.getByText("Receipt no longer available")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove", exact: true })).toHaveCount(0);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});

test("renders manually removed receipt history as a distinct terminal state", async ({ page }) => {
  await setSeedReceiptTerminalState(page, "user-deleted");
  await page.goto("/expenses/expense-groceries");

  await expect(page.getByRole("heading", { name: "Groceries" })).toBeVisible();
  await expect(page.getByText("Receipt removed")).toBeVisible();
  await expect(page.getByText("Receipt no longer available")).toHaveCount(0);
  await expect(page.getByRole("img", { name: "groceries.png" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove groceries.png" })).toHaveCount(0);
});

for (const viewport of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 900 },
  { width: 1440, height: 1024 },
] as const) {
  test(`expense controls stay usable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/expenses");
    const paymentMethod = page.getByRole("combobox", { name: "Payment Method", exact: true });
    await expect(paymentMethod).toContainText("Payment Method");
    const paymentMetrics = await paymentMethod.evaluate((element) => {
      const value = element.querySelector<HTMLElement>('[data-slot="select-value"]');
      return {
        triggerWidth: element.getBoundingClientRect().width,
        valueWidth: value?.getBoundingClientRect().width ?? 0,
        whiteSpace: value ? getComputedStyle(value).whiteSpace : "",
        valueClass: value?.className ?? "",
        valueText: value?.textContent ?? "",
      };
    });
    expect(paymentMetrics.triggerWidth).toBeGreaterThanOrEqual(144);
    expect(paymentMetrics.valueWidth).toBeGreaterThan(0);
    expect(paymentMetrics.whiteSpace).toBe("nowrap");

    await page.goto("/expenses/new");
    const dateTrigger = page.locator('[data-slot="date-picker-trigger"]');
    await expect(dateTrigger).toBeVisible();
    await expect(page.locator('input[type="date"]')).toHaveCount(0);
    await dateTrigger.click();
    const calendar = page.getByRole("dialog");
    await expect(calendar).toBeVisible();
    const calendarBox = await calendar.boundingBox();
    expect(calendarBox).not.toBeNull();
    expect(calendarBox!.x).toBeGreaterThanOrEqual(0);
    expect(calendarBox!.y).toBeGreaterThanOrEqual(0);
    expect(calendarBox!.x + calendarBox!.width).toBeLessThanOrEqual(viewport.width);
    expect(calendarBox!.y + calendarBox!.height).toBeLessThanOrEqual(viewport.height);
    const mobileNavigation = page.getByRole("navigation", { name: "Mobile navigation" });
    if (await mobileNavigation.isVisible()) {
      const navigationBox = await mobileNavigation.boundingBox();
      expect(navigationBox).not.toBeNull();
      expect(calendarBox!.y + calendarBox!.height <= navigationBox!.y || calendarBox!.y >= navigationBox!.y + navigationBox!.height).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dateTrigger).toBeFocused();
  });
}

test("Expense Date calendar disables dates and navigation outside the Dhaka entry window", async ({ page }) => {
  await page.goto("/expenses/new");
  await page.locator('[data-slot="date-picker-trigger"]').click();

  const calendar = page.locator("table[aria-label]");
  await expect(calendar).toBeVisible();
  await expect(page.getByRole("button", { name: "Next month" })).toBeDisabled();

  await page.getByRole("button", { name: "Previous month" }).click();
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.getByRole("button", { name: "Previous month" })).toBeDisabled();

  const earliestMonth = await calendar.getAttribute("aria-label");
  expect(earliestMonth).toMatch(/^\w+ \d{4}$/u);
  await expect(page.getByRole("button", { name: new RegExp(`^1 ${earliestMonth}(?:,|$)`, "u") })).toBeEnabled();

  const disabledVisibleDates = calendar.locator("button:disabled");
  expect(await disabledVisibleDates.count()).toBeGreaterThan(0);
  await expect(disabledVisibleDates.first()).toHaveAttribute("aria-label", /\d/u);

  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(axe.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});

test("Expense Date bounds stay server-authoritative across browser timezones", async ({ page }) => {
  const session = await page.context().newCDPSession(page);
  let authoritativeMonth: string | null = null;

  for (const timezoneId of ["UTC", "Asia/Dhaka", "America/Los_Angeles"]) {
    await session.send("Emulation.setTimezoneOverride", { timezoneId });
    await page.goto("/expenses/new");
    await page.locator('[data-slot="date-picker-trigger"]').click();
    const calendar = page.locator("table[aria-label]");
    const month = await calendar.getAttribute("aria-label");
    authoritativeMonth ??= month;
    expect(month).toBe(authoritativeMonth);
    await expect(page.getByRole("button", { name: "Next month" })).toBeDisabled();
    await page.keyboard.press("Escape");
  }
});

test("creates and reloads an exact percentage expense with a receipt", async ({ page }) => {
  await page.goto("/expenses/new");
  await expect(page.getByRole("heading", { name: "Add Expense" })).toBeVisible();
  await expect(page.getByText("You", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("radio", { name: "cash" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "You" })).toBeChecked();

  await page.getByLabel("Expense Name").fill("Percentage dinner");
  await page.getByLabel("Amount (BDT)").fill("100");
  await selectExpenseDate(page, "2026-08-18");
  await page.getByRole("radio", { name: "percentage" }).check();
  await page.getByLabel("Percentage share for Raiyan").fill("33.34");
  await page.getByLabel("Percentage share for John").fill("33.33");
  await page.getByLabel("Percentage share for Sarah").fill("33.33");
  await expect(page.getByText("Percentages must total exactly 100%.")).toHaveCount(0);

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: "dinner.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.getByText("dinner.png")).toBeVisible();
  await page.getByRole("button", { name: "Create Expense" }).click();

  await expect(page.getByRole("heading", { name: "Percentage dinner" })).toBeVisible();
  await expect(page.getByText("18 Aug 2026", { exact: true })).toBeVisible();
  await expect(page.getByText("33.34%", { exact: false })).toBeVisible();
  await expect(page.getByText("dinner.png")).toBeVisible();
  await expect(page.getByRole("img", { name: "dinner.png" })).toBeVisible();
  await expect(page.getByText("Preview unavailable")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Percentage dinner" })).toBeVisible();
  await expect(page.getByText("33.34%", { exact: false })).toBeVisible();
  await expect(page.getByRole("img", { name: "dinner.png" })).toBeVisible();
  await expect(page.getByText("Preview unavailable")).toHaveCount(0);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});

for (const format of browserReceiptFormats) {
  test(`decodes, persists, reloads, and previews a valid ${format.label} receipt`, async ({ page }) => {
    await page.goto("/expenses/new");
    await page.getByLabel("Expense Name").fill(`${format.label} receipt expense`);
    await page.getByLabel("Amount (BDT)").fill("1.01");
    await selectExpenseDate(page, "2026-08-18");
    const filename = `receipt.${format.extension}`;
    const imageBytes = await page.evaluate(async (mimeType) => {
      const canvas = document.createElement("canvas");
      canvas.width = 2;
      canvas.height = 2;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable.");
      context.fillStyle = "#b7ef46";
      context.fillRect(0, 0, 2, 2);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error(`Could not encode ${mimeType}.`)), mimeType, 0.9),
      );
      return [...new Uint8Array(await blob.arrayBuffer())];
    }, format.mimeType);
    await page.locator('input[type="file"]').setInputFiles({
      name: filename,
      mimeType: format.mimeType,
      buffer: Buffer.from(imageBytes),
    });
    await page.getByRole("button", { name: "Create Expense" }).click();

    await expect(page.getByRole("heading", { name: `${format.label} receipt expense` })).toBeVisible();
    await expect(page.getByRole("img", { name: filename })).toBeVisible();
    await expect(page.getByText("Preview unavailable")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("img", { name: filename })).toBeVisible();
    await expect(page.getByText("Preview unavailable")).toHaveCount(0);
  });
}

test("expense validation stays quiet until interaction and focuses invalid fields on submit", async ({ page }) => {
  await page.goto("/expenses/new");
  const name = page.getByLabel("Expense Name");
  const amount = page.getByLabel("Amount (BDT)");

  await expect(name).toHaveAttribute("aria-invalid", "false");
  await expect(amount).toHaveAttribute("aria-invalid", "false");
  await expect(page.getByText("Expense Name is required.", { exact: true })).toHaveCount(0);

  await name.focus();
  await amount.focus();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Expense Name is required.", { exact: true })).toBeVisible();

  await name.fill("Temporary");
  await name.fill("");
  await expect(name).toHaveAttribute("aria-invalid", "true");

  await page.getByRole("button", { name: "Create Expense" }).click();
  await expect(name).toBeFocused();
  await expect(amount).toHaveAttribute("aria-invalid", "true");

  await name.fill("Focused validation");
  await page.getByRole("button", { name: "Create Expense" }).click();
  await expect(amount).toBeFocused();
});

test("rejects structurally valid but undecodable receipt content before persistence", async ({ page }) => {
  await page.goto("/expenses/new");
  await page.getByLabel("Expense Name").fill("Malformed receipt expense");
  await page.getByLabel("Amount (BDT)").fill("10");
  await selectExpenseDate(page, "2026-08-18");
  await page.locator('input[type="file"]').setInputFiles({
    name: "malformed.png",
    mimeType: "image/png",
    buffer: structurallyValidUndecodablePng(),
  });
  await page.getByRole("button", { name: "Create Expense" }).click();

  await expect(page.getByText("Receipt content is not a valid supported image.", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/expenses\/new$/u);
  await page.goto("/expenses");
  await expect(page.getByText("Malformed receipt expense", { exact: true })).toHaveCount(0);
});

test("mobile expense cards and the one-page form remain clear of bottom navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/expenses");
  await page.getByRole("combobox", { name: "Month", exact: true }).click();
  await page.getByRole("option", { name: "August 2026", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open Groceries expense details" })).toBeVisible();
  await page.goto("/expenses/new");
  await expect(page.getByRole("heading", { name: "Add Expense" })).toBeVisible();
  const createButton = page.getByRole("button", { name: "Create Expense" });
  await createButton.scrollIntoViewIfNeeded();
  const [buttonBox, navigationBox] = await Promise.all([
    createButton.boundingBox(),
    page.locator('nav[aria-label="Mobile navigation"]').boundingBox(),
  ]);
  expect(buttonBox).not.toBeNull();
  expect(navigationBox).not.toBeNull();
  expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(navigationBox!.y);
});

test("leader Card editing stays opaque and normal members remain view-only", async ({ page }) => {
  await page.goto("/expenses/expense-internet");
  await expect(page.getByRole("heading", { name: "Internet" })).toBeVisible();
  await expect(page.getByText("11 Aug 2026", { exact: true })).toBeVisible();
  await expect(page.getByText("John Credit")).toHaveCount(0);
  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page.locator('[data-slot="date-picker-trigger"]')).toContainText("11 Aug 2026");
  await expect(page.getByText("The existing private Card association will be preserved opaquely.")).toBeVisible();
  await expect(page.getByText("John Credit")).toHaveCount(0);
  await page.getByRole("radio", { name: "cash" }).check();
  await page.getByText("Confirm changing the current Payment Method from Card to Cash.").click();
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByRole("heading", { name: "Internet" })).toBeVisible();
  await expect(page.getByText("cash", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("John Credit")).toHaveCount(0);

  await page.getByTestId("development-tools-trigger").click();
  await page.getByTestId("development-identity-user-sarah").click();
  await page.goto("/expenses/expense-groceries");
  await expect(page.getByRole("heading", { name: "Groceries" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
});

test("a stale Expense Save reloads the confirmed-settlement lock without committing", async ({ page }) => {
  await page.goto("/expenses/expense-groceries/edit");
  await expect(page.getByRole("heading", { name: "Edit Expense" })).toBeVisible();

  await page.getByLabel("Expense Name").fill("Preserved stale draft");
  await page.getByLabel("Amount (BDT)").fill("301");
  await page.locator('input[type="file"]').setInputFiles({
    name: "draft.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.getByText("draft.png", { exact: true })).toBeVisible();

  await insertConfirmedSettlement(page, "settlement-stale-edit");
  await page.getByRole("button", { name: "Save Changes" }).click();

  await expect(page.getByText(/Financial details are now locked/u)).toBeVisible();
  await expect(page.getByText("Financial details are locked", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Expense Name")).toHaveValue("Preserved stale draft");
  await expect(page.getByLabel("Amount (BDT)")).toHaveValue("300.00");
  await expect(page.getByLabel("Amount (BDT)")).toBeDisabled();
  await expect(page.getByText("draft.png", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/expenses\/expense-groceries\/edit$/u);

  const persisted = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("house-finance-tracker-local", 5);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction(
      ["expenses", "receiptMetadata", "auditEvents"],
      "readonly",
    );
    const expense = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = transaction.objectStore("expenses").get("expense-groceries");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const receipts = await new Promise<unknown[]>((resolve, reject) => {
      const request = transaction.objectStore("receiptMetadata").getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const audits = await new Promise<unknown[]>((resolve, reject) => {
      const request = transaction.objectStore("auditEvents").getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    database.close();
    return { expense, receiptCount: receipts.length, auditCount: audits.length };
  });

  expect(persisted.expense.name).toBe("Groceries");
  expect(persisted.expense.amountPoisha).toBe(30000);
  expect(persisted.receiptCount).toBe(1);
  expect(persisted.auditCount).toBe(3);
});

test("a stale Expense Delete reloads the lock and leaves the Expense active", async ({ page }) => {
  await page.goto("/expenses/expense-groceries");
  await expect(page.getByRole("heading", { name: "Groceries" })).toBeVisible();
  await page.getByRole("button", { name: "More expense actions" }).click();
  await page.getByRole("menuitem", { name: "Delete Expense" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();

  await insertConfirmedSettlement(page, "settlement-stale-delete");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete Expense" })
    .click();

  await expect(page.getByText("Financial details are locked", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "This expense is part of settled financial history and can no longer be deleted.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "More expense actions" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/expenses\/expense-groceries$/u);

  const persisted = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("house-finance-tracker-local", 5);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction(
      ["expenses", "auditEvents"],
      "readonly",
    );
    const expense = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = transaction.objectStore("expenses").get("expense-groceries");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const audits = await new Promise<unknown[]>((resolve, reject) => {
      const request = transaction.objectStore("auditEvents").getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    database.close();
    return { expense, auditCount: audits.length };
  });

  expect(persisted.expense.deletedAt).toBeUndefined();
  expect(persisted.auditCount).toBe(3);
});
