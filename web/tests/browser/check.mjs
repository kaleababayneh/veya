import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const out = process.env.VEYA_SCREENSHOTS ?? "/tmp/veya-ux-screenshots";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const mode of [
    { width: 1440, scheme: "light", lang: "en" },
    { width: 390, scheme: "light", lang: "en" },
    { width: 320, scheme: "dark", lang: "tr" },
    { width: 1440, scheme: "dark", lang: "tr" },
  ]) {
    const context = await browser.newContext({
      viewport: { width: mode.width, height: 900 },
      colorScheme: mode.scheme,
      reducedMotion: "reduce",
    });
    await context.addInitScript(
      (lang) => localStorage.setItem("zkotc-lang", lang),
      mode.lang,
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const [route, state] of [
      ["/market", ""],
      ["/ads/1", ""],
      ["/r/1", "paid"],
      ["/r/1", "expired"],
      ["/r/1", "bond"],
      ["/sell", ""],
      ["/me", ""],
      ["/how-it-works", ""],
      ["/anchor", ""],
    ]) {
      await page.goto(
        `http://127.0.0.1:3108/?page=${route}&state=${state}&amount=1000&bank=ziraat`,
      );
      await page.locator("h1").waitFor();
      if (route === "/market")
        await page
          .getByLabel(
            mode.lang === "en"
              ? "Amount in Turkish lira"
              : "Türk lirası tutarı",
          )
          .fill("1000");
      if (route === "/r/1")
        await page
          .getByRole("button", {
            name:
              mode.lang === "en"
                ? "Show payment details"
                : "Ödeme bilgilerini göster",
          })
          .click();
      await page.waitForTimeout(100);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      assert.ok(
        overflow <= 1,
        `${route}/${state} overflows ${overflow}px at ${mode.width}/${mode.lang}`,
      );
      assert.equal(await page.locator("h1").count(), 1);
      assert.equal(errors.length, 0, errors.join("\n"));
      const name = `${route.replaceAll("/", "-").slice(1)}-${state || "default"}-${mode.width}-${mode.scheme}-${mode.lang}`;
      await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
      results.push({ name, overflow });
    }
    // Exercise native keyboard bank selection and seller review with real controls.
    await page.goto("http://127.0.0.1:3108/?page=/sell");
    await page
      .getByLabel(
        mode.lang === "en"
          ? /Price in TRY per token/
          : /Token başına TL fiyatı/,
      )
      .fill("40");
    await page
      .getByRole("button", {
        name: mode.lang === "en" ? "Continue →" : "Devam et →",
      })
      .click();
    const bank = page.getByRole("combobox");
    await bank.focus();
    await page.keyboard.press("z");
    await page.keyboard.press("Tab");
    await page
      .getByLabel("IBAN", { exact: true })
      .fill("TR420001000000000000000001");
    await page
      .getByLabel(
        mode.lang === "en" ? /Account holder name/ : /Hesap sahibinin adı/,
      )
      .fill("TEST PERSON");
    await page
      .getByRole("button", {
        name: mode.lang === "en" ? "Continue →" : "Devam et →",
      })
      .click();
    await page.getByText("525 XLM", { exact: true }).waitFor();
    assert.equal(await page.getByRole("checkbox").isChecked(), false);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: `${out}/seller-review-${mode.width}-${mode.scheme}-${mode.lang}.png`,
      fullPage: true,
    });
    await context.close();
  }
  await fs.writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
  console.log(
    `${results.length} page/state/viewport checks plus 4 keyboard seller reviews passed. Screenshots: ${out}`,
  );
} finally {
  await browser.close();
}
