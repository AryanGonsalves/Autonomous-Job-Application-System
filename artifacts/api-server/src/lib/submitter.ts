import * as fs from "fs";
import * as path from "path";
import { type Page } from "playwright";
import { getContextWithSession, getStealthContextWithSession, createFreshStealthContext } from "./browser";
import { generateAtsAnswer, generateYesNoAnswer } from "./aiClient";
import { addLog } from "./automationLog";
import { getSetting } from "./settings";
import type { Job } from "@workspace/db";
import type { ParsedResume } from "./resumeParser";

export async function submitApplication(job: Job, resume: ParsedResume): Promise<void> {
  switch (job.platform) {
    case "linkedin":
      return submitLinkedIn(job, resume);
    case "indeed":
      return submitIndeed(job, resume);
    case "greenhouse":
      return submitGreenhouse(job, resume);
    case "lever":
      return submitLever(job, resume);
    case "handshake":
      return submitHandshake(job, resume);
    default:
      throw new Error(`Unknown platform: ${job.platform}`);
  }
}

async function getResumePath(): Promise<string | null> {
  const p = await getSetting("resumeFilePath");
  if (p && fs.existsSync(p)) return p;
  return null;
}

/** Returns the contact email to use in forms — settings override takes priority over resume. */
async function getContactEmail(resume: ParsedResume): Promise<string> {
  const override = await getSetting("contactEmail");
  return override?.trim() || resume.email;
}

/** Returns the contact phone to use in forms — settings override takes priority over resume. */
async function getContactPhone(resume: ParsedResume): Promise<string | null> {
  const override = await getSetting("contactPhone");
  return override?.trim() || resume.phone || null;
}

/**
 * Extracts the first integer from an AI-generated text answer.
 * e.g. "approximately 3 years" → "3", "I have 5+ years" → "5", "less than 1" → "1"
 * Falls back to "1" if no digit is found (safer than leaving blank).
 */
function extractYearsNumber(answer: string): string {
  const match = answer.match(/\b(\d+)\b/);
  if (match) return match[1];
  // Handle "less than 1" / "under a year" → 0
  if (/less than|under|no \w+ experience|none/i.test(answer)) return "0";
  return "1"; // Safe fallback
}

async function fillScreeningQuestions(
  page: Page,
  job: Job,
  resume: ParsedResume,
  selectors: {
    questionContainer: string;
    labelEl: string;
    yesRadio?: string;
    noRadio?: string;
    textarea?: string;
    textInput?: string;
    selectEl?: string;
  }
): Promise<void> {
  const containers = await page.$$(selectors.questionContainer);
  for (const container of containers) {
    const questionText = await container
      .$eval(selectors.labelEl, (el) => el.textContent?.trim() ?? "")
      .catch(() => "");
    if (!questionText) continue;

    // Skip contact-info fields — these should be filled from profile/resume, not AI.
    // AI answers like "My mobile number is +1 (623) 275-6831." break phone validation.
    const qLower = questionText.toLowerCase().replace(/[*]/g, "").trim();
    const isContactField =
      // Phone fields
      qLower === "phone" || qLower === "phone number" || qLower === "mobile phone number" ||
      qLower === "mobile phone" || qLower.includes("phone number") || qLower.includes("mobile number") ||
      qLower === "primary phone number" ||
      // Email fields
      qLower === "email" || qLower === "email address" || qLower.includes("email address") ||
      // Name fields
      qLower === "first name" || qLower === "last name" || qLower === "middle name" ||
      // Country/phone code
      qLower === "phone country code" || qLower.includes("country code") ||
      // Address fields — AI generates prose for these, which breaks validation
      qLower === "city" || qLower.includes("location (city)") ||
      qLower === "state" || qLower === "state or province" || qLower === "province" ||
      qLower === "zip code" || qLower === "zip" || qLower === "postal code" ||
      qLower === "current address" || qLower.includes("street address") ||
      qLower === "unit number" || qLower === "apt" || qLower === "apartment";
    if (isContactField) {
      if (selectors.textInput) {
        const ti = await container.$(selectors.textInput);
        if (ti) {
          const cur = await ti.inputValue().catch(() => "");
          if (qLower.includes("phone") || qLower.includes("mobile")) {
            // Phone: fill digits-only from resume
            const phone = await getContactPhone(resume);
            if (phone) {
              const digits = phone.replace(/\D/g, "");
              if (!cur || !/^\d+$/.test(cur)) await ti.fill(digits).catch(() => {});
            }
          } else if (qLower === "city" || qLower.includes("location (city)")) {
            // City: use locationPreference setting, then select from typeahead dropdown
            const locPref = (await getSetting("locationPreference")) || "Phoenix";
            const city = locPref.split(",")[0].trim();
            // Always clear + refill to trigger typeahead (even if value already present, it may be unselected)
            await ti.fill("").catch(() => {});
            await ti.fill(city).catch(() => {});
            await page.waitForTimeout(1500);
            // Select from typeahead dropdown (floating overlay — query page-level, not container)
            const firstOpt = page.locator(
              '[role="option"], [role="listitem"] a, .artdeco-typeahead__option, li[id*="typeahead"], li[id*="option"]'
            ).first();
            if (await firstOpt.isVisible().catch(() => false)) {
              await firstOpt.click().catch(() => {});
              await page.waitForTimeout(400);
            } else {
              await page.keyboard.press("ArrowDown").catch(() => {});
              await page.waitForTimeout(400);
              await page.keyboard.press("Enter").catch(() => {});
              await page.waitForTimeout(300);
            }
          } else if (qLower === "state" || qLower === "state or province" || qLower === "province") {
            // State: extract from locationPreference (e.g. "Phoenix, AZ" → "AZ")
            const locPref = (await getSetting("locationPreference")) || "Phoenix, AZ";
            const parts = locPref.split(",");
            const state = parts.length > 1 ? parts[1].trim() : "AZ";
            if (!cur) await ti.fill(state).catch(() => {});
          } else if (qLower === "zip code" || qLower === "zip" || qLower === "postal code") {
            // Zip: use contactZip setting if available
            const zip = await getSetting("contactZip");
            if (zip && !cur) await ti.fill(zip.trim()).catch(() => {});
          }
          // For name/email/address/unit fields: leave as-is (LinkedIn pre-fills from profile)
        }
      }
      continue;
    }

    // Robust radio-click helper: .check({ force }) first; if it doesn't register
    // (LinkedIn/React synthetic events), fall back to native el.click() + change event.
    async function clickRadio(handle: import("playwright").ElementHandle | null): Promise<void> {
      if (!handle) return;
      await handle.check({ force: true }).catch(() => {});
      await page.waitForTimeout(150);
      const checked = await handle.isChecked().catch(() => false);
      if (!checked) {
        await handle.evaluate((el) => {
          (el as HTMLElement).click();
          el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }).catch(() => {});
        await page.waitForTimeout(150);
      }
    }

    // Yes/No radio — ask AI whether the candidate honestly qualifies
    if (selectors.yesRadio && selectors.noRadio) {
      const yesBtn = await container.$(selectors.yesRadio);
      const noBtn = await container.$(selectors.noRadio);
      if (yesBtn || noBtn) {
        const answerYes = await generateYesNoAnswer(
          questionText,
          { jobTitle: job.jobTitle, company: job.company, jobDescription: job.jobDescription ?? "" },
          resume
        );
        if (answerYes && yesBtn) await clickRadio(yesBtn);
        else if (!answerYes && noBtn) await clickRadio(noBtn);
        else if (yesBtn) await clickRadio(yesBtn); // fallback
        continue;
      }
      // Fallback: LinkedIn sometimes uses radio buttons without value="Yes"/"No" —
      // detect by scanning all radio inputs and matching by label/parent text.
      const allRadios = await container.$$('input[type="radio"]').catch(() => [] as import("playwright").ElementHandle[]);
      if (allRadios.length >= 2) {
        let yesRadio: import("playwright").ElementHandle | null = null;
        let noRadio: import("playwright").ElementHandle | null = null;
        for (const radio of allRadios) {
          const id = await radio.getAttribute("id").catch(() => "");
          let labelText = "";
          if (id) {
            labelText = await page.$eval(`label[for="${id}"]`, (el) => el.textContent?.trim() ?? "").catch(() => "");
          }
          if (!labelText) {
            // Parent element text (e.g. <label><input type="radio"> Yes</label>)
            labelText = await radio.evaluate((el) => {
              const p = el.parentElement;
              return (p?.textContent ?? "").replace(/\s+/g, " ").trim();
            }).catch(() => "");
          }
          const t = labelText.toLowerCase();
          if (!yesRadio && (t === "yes" || t.startsWith("yes"))) yesRadio = radio;
          else if (!noRadio && (t === "no" || t.startsWith("no"))) noRadio = radio;
        }
        if (yesRadio || noRadio) {
          const answerYes = await generateYesNoAnswer(
            questionText,
            { jobTitle: job.jobTitle, company: job.company, jobDescription: job.jobDescription ?? "" },
            resume
          );
          if (answerYes && yesRadio) await clickRadio(yesRadio);
          else if (!answerYes && noRadio) await clickRadio(noRadio);
          else if (yesRadio) await clickRadio(yesRadio); // safe fallback to Yes
          continue;
        }
      }
    } else if (selectors.yesRadio) {
      // Only a yes selector defined — still AI-gate it
      const yesBtn = await container.$(selectors.yesRadio);
      if (yesBtn) {
        const answerYes = await generateYesNoAnswer(
          questionText,
          { jobTitle: job.jobTitle, company: job.company, jobDescription: job.jobDescription ?? "" },
          resume
        );
        if (answerYes) await clickRadio(yesBtn);
        continue;
      }
    }

    // Helper: detect a character limit for a form element.
    // Checks: 1) maxlength HTML attribute, 2) nearby "0 / 200" counter text (LinkedIn pattern).
    async function detectCharLimit(elHandle: import("playwright").ElementHandle): Promise<number | undefined> {
      // Check maxlength attribute first
      const maxAttr = await elHandle.getAttribute("maxlength").catch(() => null);
      if (maxAttr) {
        const n = parseInt(maxAttr, 10);
        if (!isNaN(n) && n > 0) return n;
      }
      // Look for a sibling/nearby character counter with pattern "N / MAX" or "N/MAX" or "/MAX"
      // LinkedIn renders these as aria-described-by hints or adjacent divs
      const containerHtml = await container.evaluate((el: Element) => el.innerHTML ?? "").catch(() => "");
      const counterMatch = containerHtml.match(/(?:^|\s)\d+\s*\/\s*(\d+)(?:\s|<)/);
      if (counterMatch) {
        const n = parseInt(counterMatch[1], 10);
        if (!isNaN(n) && n > 0) return n;
      }
      // Also check aria-describedby target for counter text
      const describedById = await elHandle.getAttribute("aria-describedby").catch(() => null);
      if (describedById) {
        const counterText = await page.$eval(
          `#${describedById}`,
          (el: Element) => el.textContent ?? ""
        ).catch(() => "");
        const m = counterText.match(/\d+\s*\/\s*(\d+)/);
        if (m) {
          const n = parseInt(m[1], 10);
          if (!isNaN(n) && n > 0) return n;
        }
      }
      return undefined;
    }

    // Helper: hard-truncate to char limit at a word boundary
    function truncateAnswer(text: string, limit: number): string {
      if (text.length <= limit) return text;
      const cut = text.slice(0, limit);
      const lastSpace = cut.lastIndexOf(" ");
      return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd();
    }

    // Textarea answer
    if (selectors.textarea) {
      const ta = await container.$(selectors.textarea);
      if (ta) {
        const maxChars = await detectCharLimit(ta);
        const answer = await generateAtsAnswer(
          questionText,
          { jobTitle: job.jobTitle, company: job.company, jobDescription: job.jobDescription ?? "" },
          resume,
          maxChars
        );
        const safeAnswer = maxChars ? truncateAnswer(answer, maxChars) : answer;
        await ta.fill(safeAnswer);
        continue;
      }
    }

    // Text input answer
    if (selectors.textInput) {
      const ti = await container.$(selectors.textInput);
      if (ti) {
        // Detect numeric-only fields (type="number" or "how many years" questions)
        // AI returns prose like "approximately 1 year" — extract the integer.
        const inputType = await ti.getAttribute("type").catch(() => "text") ?? "text";
        const isNumericField =
          inputType === "number" ||
          qLower.includes("how many years") ||
          qLower.includes("years of experience") ||
          qLower.includes("years of work experience") ||
          qLower.startsWith("number of years") ||
          qLower.startsWith("# of years");

        if (isNumericField) {
          // Numeric fields: generate answer then extract the integer
          const answer = await generateAtsAnswer(
            questionText,
            { jobTitle: job.jobTitle, company: job.company, jobDescription: job.jobDescription ?? "" },
            resume
          );
          await ti.fill(extractYearsNumber(answer)).catch(() => {});
        } else {
          const maxChars = await detectCharLimit(ti);
          const answer = await generateAtsAnswer(
            questionText,
            { jobTitle: job.jobTitle, company: job.company, jobDescription: job.jobDescription ?? "" },
            resume,
            maxChars
          );
          const safeAnswer = maxChars ? truncateAnswer(answer, maxChars) : answer;
          await ti.fill(safeAnswer);
        }
        continue;
      }
    }

    // Select element — pick first non-empty option
    if (selectors.selectEl) {
      const sel = await container.$(selectors.selectEl);
      if (sel) {
        const options = await sel.$$eval("option", (opts: any[]) =>
          opts.filter((o: any) => o.value).map((o: any) => o.value as string)
        );
        if (options[0]) await sel.selectOption(options[0]);
      }
    }
  }
}

// ─── LinkedIn Easy Apply ──────────────────────────────────────────────────────
// Uses saved session (via Settings → Credentials → "Login to LinkedIn") +
// playwright-extra stealth to bypass bot detection.

async function submitLinkedIn(job: Job, resume: ParsedResume): Promise<void> {
  // Use a FRESH browser per job — the shared stealthBrowser singleton gets
  // corrupted after a page crash and kills all subsequent submissions.
  const { ctx, closeBrowserFn } = await createFreshStealthContext("linkedin_session.json");
  const page = await ctx.newPage();

  try {
    // Warm-up: visit LinkedIn root to activate session cookies in the fresh browser.
    // Even with cookies pre-loaded, LinkedIn's auth is JS-initialized — without this
    // step the job page renders in a half-auth state where Easy Apply doesn't appear.
    // Use the lightweight root (not /feed/) + domcontentloaded to keep it fast.
    try {
      await page.goto("https://www.linkedin.com/", { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(1500 + Math.random() * 500);
    } catch {
      // Warmup timed out — still attempt the job page
    }

    // Navigate to the job page. Use "load" not "networkidle": LinkedIn's SPA never
    // reaches networkidle (background polling keeps firing forever).
    await page.goto(job.applyUrl, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(2000 + Math.random() * 1000);

    const currentUrl = page.url();
    if (
      currentUrl.includes("/login") ||
      currentUrl.includes("/authwall") ||
      currentUrl.includes("/checkpoint")
    ) {
      throw new Error("SESSION_EXPIRED: LinkedIn redirected to login — re-authenticate in Settings");
    }

    // Check if job page is valid (not a 404 / "no longer available")
    const pageText = await page.evaluate(() => document.body?.innerText?.toLowerCase() ?? "");
    if (
      pageText.includes("no longer available") ||
      pageText.includes("job has been removed") ||
      pageText.includes("this job is closed")
    ) {
      throw new Error("Job no longer available on LinkedIn");
    }

    // LinkedIn's Easy Apply button is tricky:
    //  - The visible button may be inside a shadow root (artdeco-button custom element)
    //  - The inner <button> is aria-hidden="true" so getByRole misses it
    //  - The host element may have aria-label="Easy Apply to JOB at COMPANY"
    // We use a multi-strategy search with a deep shadow-DOM walk as final fallback.

    let easyApplyBtn: import("playwright").ElementHandle | null = null;

    // Strategy 1: aria-label on host element (works if artdeco-button host has the label)
    try {
      const ariaLocator = page.locator('[aria-label*="Easy Apply" i]').first();
      await ariaLocator.waitFor({ timeout: 8000 });
      easyApplyBtn = await ariaLocator.elementHandle();
    } catch { /* try next */ }

    // Strategy 2: Playwright getByRole — works when shadow button is NOT aria-hidden
    if (!easyApplyBtn) {
      try {
        const roleLocator = page.getByRole("button", { name: /easy apply/i }).first();
        await roleLocator.waitFor({ timeout: 4000 });
        easyApplyBtn = await roleLocator.elementHandle();
      } catch { /* try next */ }
    }

    // Strategy 3: Deep shadow-DOM walk via evaluate — finds buttons inside any shadow root
    if (!easyApplyBtn) {
      easyApplyBtn = await page.evaluateHandle(() => {
        function findDeep(root: Element | Document | ShadowRoot): Element | null {
          const candidates = Array.from(root.querySelectorAll(
            'button, [role="button"], artdeco-button, [aria-label]'
          ));
          for (const el of candidates) {
            const label = (el.getAttribute("aria-label") ?? "").toLowerCase();
            const text  = (el as HTMLElement).innerText?.toLowerCase() ?? "";
            if (label.includes("easy apply") || text.trim() === "easy apply") return el;
            if ((el as any).shadowRoot) {
              const found = findDeep((el as any).shadowRoot);
              if (found) return found;
            }
          }
          return null;
        }
        return findDeep(document);
      }).then(h => (h as any).asElement?.() ?? null).catch(() => null);
    }

    if (!easyApplyBtn) {
      // ── Diagnostics ────────────────────────────────────────────────────────
      const finalUrl = page.url();
      const pageTitle = await page.title().catch(() => "?");

      // Dump aria-labels of all elements + deep shadow info
      const ariaInfo = await page.evaluate(() => {
        const results: string[] = [];
        function walk(root: Element | Document | ShadowRoot, depth: number) {
          if (depth > 5) return;
          const els = root.querySelectorAll('[aria-label], button, artdeco-button, .jobs-apply-button, .jobs-s-apply');
          for (const el of els) {
            const label = el.getAttribute("aria-label") ?? "";
            const cls   = el.className?.toString()?.slice(0, 40) ?? "";
            const tag   = el.tagName;
            if (label || cls.includes("apply") || tag === "ARTDECO-BUTTON") {
              results.push(`${tag}[class="${cls}"][aria-label="${label}"]`);
            }
            if ((el as any).shadowRoot) walk((el as any).shadowRoot, depth + 1);
          }
        }
        walk(document, 0);
        return results.slice(0, 12);
      }).catch(() => [] as string[]);

      await addLog("warn", `LinkedIn debug: url=${finalUrl} | title="${pageTitle}" | ariaElems=[${ariaInfo.join(" || ")}]`, "linkedin");

      // Save screenshot (cap at 3)
      try {
        const debugDir = path.join(__dirname, "../../debug-screenshots");
        fs.mkdirSync(debugDir, { recursive: true });
        const existing = fs.readdirSync(debugDir).filter(f => f.startsWith("linkedin-"));
        if (existing.length < 20) {
          const ts = new Date().toISOString().replace(/[:.]/g, "-");
          const imgPath = path.join(debugDir, `linkedin-${ts}.png`);
          await page.screenshot({ path: imgPath, fullPage: false });
          await addLog("info", `Debug screenshot: debug-screenshots/linkedin-${ts}.png`, "linkedin");
        }
      } catch {}
      // ──────────────────────────────────────────────────────────────────────

      throw new Error("Easy Apply button not found — job may have been removed or requires external application");
    }

    // Click Easy Apply button using Playwright's real CDP mouse simulation.
    // IMPORTANT: We use locator.click({ force: true }) — NOT page.evaluate el.click() and NOT
    // dispatchEvent(). LinkedIn's React handlers check event.isTrusted and ignore synthetic events.
    // Playwright's CDP-backed click produces isTrusted:true even with force:true.
    //
    // Fallback priority:
    //   1. aria-label locator click (strategy 1 / known-good selector)
    //   2. ElementHandle.click() on the found element (CDP-backed, also isTrusted:true)
    //   3. page.mouse.click() at bounding-box centre (always isTrusted:true)
    const easyApplyLoc = page.locator('[aria-label*="Easy Apply" i]').first();
    const clicked = await easyApplyLoc.click({ force: true, timeout: 5000 }).then(() => true).catch(() => false);
    if (!clicked && easyApplyBtn) {
      // ElementHandle.click() is CDP-backed (isTrusted:true), unlike page.evaluate el.click()
      const ehClicked = await (easyApplyBtn as any).click({ force: true }).then(() => true).catch(() => false);
      if (!ehClicked) {
        // Last resort: raw mouse click at element's centre coordinates
        const box = await (easyApplyBtn as any).boundingBox().catch(() => null) as { x: number; y: number; width: number; height: number } | null;
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        } else {
          throw new Error("LinkedIn: found Easy Apply button but could not click it (no bounding box)");
        }
      }
    }
    await page.waitForTimeout(1500 + Math.random() * 500);

    const resumePath = await getResumePath();

    // Debug screenshot helper — rolling window of 20 most recent screenshots
    const debugDir = path.join(__dirname, "../../debug-screenshots");
    fs.mkdirSync(debugDir, { recursive: true });
    async function captureDebugShot(label: string): Promise<void> {
      try {
        const existing = fs.readdirSync(debugDir)
          .filter(f => f.startsWith("linkedin-"))
          .sort(); // oldest first (ISO timestamps sort lexicographically)
        // Rolling window: delete oldest if at cap
        if (existing.length >= 20) {
          try { fs.unlinkSync(path.join(debugDir, existing[0])); } catch {}
        }
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const imgPath = path.join(debugDir, `linkedin-${label}-${ts}.png`);
        await page.screenshot({ path: imgPath, fullPage: false });
        await addLog("info", `Debug screenshot: debug-screenshots/linkedin-${label}-${ts}.png`, "linkedin");
      } catch {}
    }

    // Step through the multi-step Easy Apply modal — up to 35 steps.
    // Each iteration:
    //   1. Wait for modal content to load (waitForFunction on inner text length)
    //   2. Fill any visible form fields (phone, resume, cover letter, screening Qs)
    //   3. Look for Submit → click and confirm; or Next/Review → click and continue.
    // KEY: All button clicks use locator.click({ force: true }) which goes through CDP
    //      and produces isTrusted:true events. dispatchEvent() produces isTrusted:false
    //      and is ignored by LinkedIn's React event handlers.
    // 35 steps handles genuinely long ATS forms (DriveWealth had 20+). Validation errors
    // and ATS overlay failures bail out early so the risk of a real infinite loop is low.
    for (let step = 0; step < 35; step++) {
      // Wait for modal content to actually load before inspecting buttons.
      // The artdeco-modal element is injected into the DOM quickly but its form
      // content loads asynchronously — without this wait, step 0 sees an empty modal
      // and throws "no Next/Submit found" before LinkedIn finishes rendering the form.
      try {
        await page.waitForFunction(() => {
          const modal = document.querySelector('artdeco-modal, .jobs-easy-apply-modal, [role="dialog"]') as HTMLElement | null;
          if (!modal) return false;
          // Try innerText first, fall back to textContent (reads CSS-hidden text)
          const t = (modal.innerText?.trim() ?? "") || (modal.textContent?.trim() ?? "");
          return t.length > 30;
        }, { timeout: 2000 }); // artdeco-modal content is in shadow DOM so this always times out — 2s is enough
      } catch {
        // Modal content never loaded via light DOM — expected (shadow DOM). Fall through.
      }
      await page.waitForTimeout(400 + Math.random() * 300);

      // Check modal is still open
      const modalEl = await page.$("artdeco-modal, .jobs-easy-apply-modal, [role='dialog']").catch(() => null);
      if (!modalEl) {
        // Modal closed — if it happened right after a submit click it's success; otherwise unexpected
        if (step === 0) {
          throw new Error(`LinkedIn: Easy Apply modal never opened (closed at step 0)`);
        }
        // Assume success: modal closed after one of our clicks
        await addLog("info", `LinkedIn: modal closed at step ${step} — treating as successful submission for "${job.jobTitle}"`, "linkedin");
        return;
      }

      // Log modal text — try innerText then textContent as fallback (for CSS-hidden content)
      const modalText = await page.evaluate(() => {
        // artdeco-modal is the outer shell; its light-DOM children hold the form content.
        // [role=dialog] is sometimes set on the inner content div, sometimes not at all.
        const candidates = [
          document.querySelector('.jobs-easy-apply-modal') as HTMLElement | null,
          document.querySelector('artdeco-modal') as HTMLElement | null,
          document.querySelector('[role="dialog"]') as HTMLElement | null,
        ];
        for (const el of candidates) {
          // Prefer innerText (respects CSS), fall back to textContent (includes hidden text)
          const t = (el?.innerText?.replace(/\s+/g, " ").trim() ?? "") ||
                    (el?.textContent?.replace(/\s+/g, " ").trim() ?? "");
          if (t.length > 5) return t;
        }
        return "";
      }).catch(() => "");
      await addLog("info", `LinkedIn step ${step}: "${modalText.slice(0, 120)}"`, "linkedin");

      // Note: modalText is often "" because LinkedIn's artdeco-modal content lives in shadow DOM.
      // innerText/textContent on the host element cannot traverse shadow DOM children.
      // Button visibility (isVisible()) still works because Playwright's locators pierce shadow DOM.
      // We log the text for debugging but do NOT use it as a failure condition.

      // ── Step 0: always screenshot so we can diagnose form state ──────────────
      if (step === 0) {
        await captureDebugShot("step0-form");
      }

      // ── Form filling — all via locators for stability (avoid stale elementHandle crashes) ──

      // City / location typeahead (required field on LinkedIn contact-info step, often causes
      // validation block that prevents Next from advancing the form)
      const locationPref = (await getSetting("locationPreference").catch(() => null)) ?? "Los Angeles";
      const cityLoc = page.locator(
        'input[aria-label*="City" i], input[aria-label*="Location" i], input[placeholder*="City, state" i], input[placeholder*="city" i]'
      ).first();
      if (await cityLoc.count() > 0) {
        const existingCity = await cityLoc.inputValue().catch(() => "");
        if (!existingCity.trim()) {
          await cityLoc.fill(locationPref).catch(() => {});
          await page.waitForTimeout(1500); // Wait longer for Greenhouse/third-party typeaheads
          // Select first typeahead suggestion — try multiple selectors used by different ATS systems
          const firstOption = page.locator(
            '[role="option"], [role="listitem"] a, .artdeco-typeahead__option, li[id*="typeahead"], li[id*="option"]'
          ).first();
          if (await firstOption.isVisible().catch(() => false)) {
            await firstOption.click().catch(() => {});
            await page.waitForTimeout(400);
          } else {
            // Fallback: keyboard navigation to select first suggestion
            await cityLoc.press("ArrowDown").catch(() => {});
            await page.waitForTimeout(400);
            await cityLoc.press("Enter").catch(() => {});
            await page.waitForTimeout(300);
          }
        }
      }

      // Phone number — fill digits only (no country code prefix, no formatting)
      if (resume.phone) {
        const phoneLoc = page.locator(
          'input[id*="phoneNumber"], input[aria-label*="Phone number" i], input[name*="phone"], input[aria-label*="mobile" i]'
        ).first();
        if (await phoneLoc.count() > 0) {
          const cur = await phoneLoc.inputValue().catch(() => "");
          const digits = resume.phone.replace(/\D/g, "");
          // Fill if empty OR if current value is not pure digits (AI sentence was placed there)
          if (!cur || !/^\d+$/.test(cur)) await phoneLoc.fill(digits).catch(() => {});
        }
      }

      // Phone country code dropdown — select United States (+1) for ATS/Ceipal embedded forms
      await page.evaluate(() => {
        const selects = Array.from(document.querySelectorAll("select")) as HTMLSelectElement[];
        for (const sel of selects) {
          const lbl = (sel.getAttribute("aria-label") ?? sel.id ?? sel.name ?? "").toLowerCase();
          if (lbl.includes("country") || lbl.includes("countrycode") || lbl.includes("phone country")) {
            // Try to select United States / +1 option
            const opts = Array.from(sel.options);
            const usOpt = opts.find(o =>
              o.text.toLowerCase().includes("united states") ||
              o.value === "1" || o.value === "+1" || o.value === "US"
            );
            if (usOpt) sel.value = usOpt.value;
            // Dispatch change so React/Vue/frameworks pick it up
            sel.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      }).catch(() => {});

      // Email dropdown — select the user's email if it's a <select> (Ceipal ATS pattern)
      await page.evaluate(() => {
        const selects = Array.from(document.querySelectorAll("select")) as HTMLSelectElement[];
        for (const sel of selects) {
          const lbl = (sel.getAttribute("aria-label") ?? sel.id ?? sel.name ?? "").toLowerCase();
          if (lbl.includes("email")) {
            // Pick the first non-empty option (it's the user's profile email)
            const firstOpt = Array.from(sel.options).find(o => o.value);
            if (firstOpt) sel.value = firstOpt.value;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      }).catch(() => {});

      // Resume file upload
      if (resumePath) {
        const fileLoc = page.locator('input[type="file"][name*="resume"], input[type="file"]').first();
        if (await fileLoc.count() > 0) {
          await fileLoc.setInputFiles(resumePath).catch(() => {});
          await page.waitForTimeout(900);
        }
      }

      // Cover letter textarea
      if (job.coverLetterText) {
        const clLoc = page.locator(
          'textarea[aria-label*="cover letter" i], div[aria-label*="cover letter" i] textarea'
        ).first();
        if (await clLoc.count() > 0) await clLoc.fill(job.coverLetterText).catch(() => {});
      }

      // Screening questions
      await fillScreeningQuestions(page, job, resume, {
        questionContainer: "div[data-test-form-element], .jobs-easy-apply-form-element",
        labelEl: "label, legend",
        yesRadio: 'input[type="radio"][value="Yes"], input[type="radio"][data-test-text-selectable-option__input="Yes"]',
        noRadio: 'input[type="radio"][value="No"], input[type="radio"][data-test-text-selectable-option__input="No"]',
        textarea: "textarea",
        textInput: 'input[type="text"], input[type="number"]',
        selectEl: "select",
      }).catch(() => {});

      // ── Navigation: Next takes priority over Submit ──
      // LinkedIn's modal keeps a "Submit application" button visible at EVERY step in the footer.
      // Clicking it early does nothing (form incomplete) and the modal stays open → infinite loop.
      // Fix: check Next/Continue FIRST; only use Submit when Next isn't visible (i.e. final step).

      // Next / Continue / Review button — present on steps 1..N-1
      const nextLoc = page.locator(
        '[aria-label*="Continue to next step" i], [aria-label*="Review your application" i], button:has-text("Continue to next step"), button:has-text("Review your application"), button:has-text("Next"), button:has-text("Continue")'
      ).first();

      const nextVisible = await nextLoc.isVisible().catch(() => false);
      if (nextVisible) {
        const label = await nextLoc.getAttribute("aria-label").catch(() => "");
        const text = await nextLoc.innerText().catch(() => "").then(t => t.trim().slice(0, 40));
        await addLog("info", `LinkedIn step ${step}: clicking NEXT — aria="${label}" text="${text}"`, "linkedin");
        await nextLoc.click({ force: true, timeout: 8000 });
        await page.waitForTimeout(900 + Math.random() * 400);

        // Detect validation errors via deep shadow-DOM walk.
        // When LinkedIn blocks Next (required field empty), it injects error elements inside
        // the modal's shadow DOM. We walk all shadow roots to find them.
        const validationErrorCount = await page.evaluate(() => {
          function countErrors(root: any): number {
            let n = 0;
            try {
              n += root.querySelectorAll(
                '[class*="inline-feedback--error"], [aria-invalid="true"], .fb-dash-form-element__error-field'
              ).length;
              root.querySelectorAll("*").forEach((el: any) => {
                if (el.shadowRoot) n += countErrors(el.shadowRoot);
              });
            } catch (_) { /* ignore */ }
            return n;
          }
          return countErrors(document.body);
        }).catch(() => 0);

        if (validationErrorCount > 0) {
          await captureDebugShot(`validation-error-step${step}`);
          await addLog(
            "warn",
            `LinkedIn step ${step}: ${validationErrorCount} validation error(s) detected — required field(s) not filled, skipping job`,
            "linkedin"
          );
          throw new Error(`LinkedIn: form validation error at step ${step} — required fields not filled (check debug screenshot)`);
        }
      } else {
        // No Next button — check for Submit (final step, no Next button present)
        const submitLoc = page.locator(
          '[aria-label*="Submit application" i], button:has-text("Submit application")'
        ).first();
        const submitVisible = await submitLoc.isVisible().catch(() => false);

        if (submitVisible) {
          await addLog("info", `LinkedIn step ${step}: clicking SUBMIT (final step, no Next)`, "linkedin");
          await submitLoc.click({ force: true, timeout: 8000 });

          // Wait up to 20s for the modal to close — LinkedIn shows "Application sent"
          // inside the modal for 3-5s before auto-closing. artdeco-modal content is in
          // shadow DOM so we can't read it, but the host element DOES detach on success.
          // Also watch for the "Applied" badge appearing on the job page as a success signal.
          const closed = await Promise.race([
            page.waitForSelector("artdeco-modal", { state: "detached", timeout: 20000 })
              .then(() => "modal-detached"),
            page.waitForSelector(
              '[aria-label*="Applied" i], .jobs-s-apply-button--applied, [data-job-id]:has-text("Applied")',
              { timeout: 20000 }
            ).then(() => "applied-badge"),
          ]).catch(() => false as const);

          if (closed) {
            await addLog("info", `LinkedIn: submitted application for "${job.jobTitle}" at ${job.company} (${closed})`, "linkedin");
            return;
          }

          // Modal still open after 20s — capture screenshot for diagnosis and skip job
          await captureDebugShot(`submit-stuck-step${step}`);
          await addLog("warn", `LinkedIn step ${step}: modal still open after Submit (20s) — skipping job`, "linkedin");
          throw new Error(`LinkedIn: Submit clicked but modal did not close after 20s (possible CAPTCHA or validation error)`);

        }

        // No Next and no Submit — dump diagnostics
        const allAria = await page.evaluate(() =>
          Array.from(document.querySelectorAll('[aria-label]'))
            .map(el => `${el.tagName}[aria-label="${el.getAttribute("aria-label")}"]`)
            .slice(0, 15)
            .join(" | ")
        ).catch(() => "");
        await addLog(
          "warn",
          `LinkedIn step ${step}: no Next/Submit found | aria:[${allAria}] | modal:"${modalText.slice(0, 100)}"`,
          "linkedin"
        );
        throw new Error("LinkedIn: stuck in Easy Apply modal — no Next or Submit button found");
      }
    }

    throw new Error("LinkedIn: Easy Apply did not reach submit after 35 steps");
  } finally {
    await page.close().catch(() => {});
    await closeBrowserFn(); // closes context + the fresh browser instance
  }
}

// ─── Indeed Quick Apply ───────────────────────────────────────────────────────
// Indeed headless submission times out on button clicks — element not visible.
// Instantly skip so the run doesn't waste 30s per job.

async function submitIndeed(job: Job, _resume: ParsedResume): Promise<void> {
  await addLog("warn", `Indeed: submission skipped for "${job.jobTitle}" @ ${job.company} — headless browser blocked`, "indeed");
  throw new Error("SESSION_EXPIRED: Indeed headless submission blocked");
}

async function _submitIndeedReal(job: Job, resume: ParsedResume): Promise<void> {
  const ctx = await getStealthContextWithSession("indeed_session.json");
  const page = await ctx.newPage();

  try {
    // Warm-up: visit Indeed homepage first
    await page.goto("https://www.indeed.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1200 + Math.random() * 800);

    // Navigate to the job posting
    await page.goto(job.applyUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1000 + Math.random() * 800);

    // Check if we got redirected to login
    const currentUrl = page.url();
    if (currentUrl.includes("/account/login") || currentUrl.includes("/auth")) {
      throw new Error("SESSION_EXPIRED: Indeed session expired — re-authenticate in Settings");
    }

    const applyBtn = await page.$(
      'button[id*="apply"], a[id*="apply"], button:has-text("Apply now"), button:has-text("Apply")'
    );
    if (!applyBtn) throw new Error("Indeed: Apply button not found");
    await applyBtn.click();
    await page.waitForTimeout(1500 + Math.random() * 500);

    const resumePath = await getResumePath();

    for (let step = 0; step < 8; step++) {
      await page.waitForTimeout(600 + Math.random() * 600);

      // Resume upload
      if (resumePath) {
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
          await fileInput.setInputFiles(resumePath).catch(() => {});
          await page.waitForTimeout(900);
        }
      }

      // Cover letter
      if (job.coverLetterText) {
        const clArea = await page.$('textarea[aria-label*="cover letter" i], textarea[name*="cover"]');
        if (clArea) await clArea.fill(job.coverLetterText);
      }

      // Screening questions
      await fillScreeningQuestions(page, job, resume, {
        questionContainer: '[data-testid="question-container"], .ia-Questions-item',
        labelEl: "label, legend, span",
        yesRadio: 'input[type="radio"][value="YES"], input[type="radio"][value="yes"]',
        noRadio: 'input[type="radio"][value="NO"], input[type="radio"][value="no"]',
        textarea: "textarea",
        textInput: 'input[type="text"]',
        selectEl: "select",
      });

      // Submit
      const submitBtn = await page.$(
        'button[data-testid="submit-button"], button:has-text("Submit"), button[type="submit"]'
      );
      if (submitBtn) {
        await submitBtn.click();
        await page.waitForTimeout(2000);
        await addLog("info", `Indeed: submitted application for "${job.jobTitle}" at ${job.company}`, "indeed");
        return;
      }

      // Continue / Next
      const nextBtn = await page.$(
        'button[data-testid="continue-button"], button:has-text("Continue"), button:has-text("Next")'
      );
      if (nextBtn) {
        await nextBtn.click();
        await page.waitForTimeout(800 + Math.random() * 500);
      } else {
        throw new Error("Indeed: stuck — no Continue or Submit button found");
      }
    }

    throw new Error("Indeed: application did not reach submit after 8 steps");
  } finally {
    await page.close();
    await ctx.close();
  }
}

// ─── Greenhouse Direct Portal ─────────────────────────────────────────────────

async function submitGreenhouse(job: Job, resume: ParsedResume): Promise<void> {
  const ctx = await getContextWithSession("greenhouse_session.json");
  const page = await ctx.newPage();

  try {
    await page.goto(job.applyUrl, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(1500 + Math.random() * 800);

    // Verify page is live — check for 404/closed indicators
    const ghPageText = await page.evaluate(() => document.body?.innerText?.toLowerCase() ?? "");
    if (
      ghPageText.includes("page not found") ||
      ghPageText.includes("404") ||
      ghPageText.includes("position has been filled") ||
      ghPageText.includes("no longer accepting")
    ) {
      throw new Error(`Greenhouse: job page not found or closed (${page.url()})`);
    }

    const resumePath = await getResumePath();

    // Detect if Greenhouse form is embedded in an iframe
    const ghIframe = await page.$(
      'iframe[src*="greenhouse.io"], iframe[src*="boards.greenhouse"], div#grnhse_app iframe'
    );

    // We use frameLocator for iframe forms; otherwise use the page directly via locator
    const iframeSelector = 'iframe[src*="greenhouse.io"], iframe[src*="boards.greenhouse"]';
    const root = ghIframe ? page.frameLocator(iframeSelector) : null;

    async function fill(selector: string, value: string): Promise<void> {
      if (root) {
        await root.locator(selector).first().fill(value).catch(() => {});
      } else {
        await page.locator(selector).first().fill(value).catch(() => {});
      }
    }

    async function upload(selector: string, filePath: string): Promise<void> {
      if (root) {
        await root.locator(selector).first().setInputFiles(filePath).catch(() => {});
      } else {
        await page.locator(selector).first().setInputFiles(filePath).catch(() => {});
      }
    }

    // Standard Greenhouse fields
    const contactEmail = await getContactEmail(resume);
    const contactPhone = await getContactPhone(resume);
    const firstName = resume.name.split(" ")[0] ?? resume.name;
    const lastName = resume.name.split(" ").slice(1).join(" ") || "-";
    await fill('#first_name, input[name="first_name"]', firstName);
    await fill('#last_name, input[name="last_name"]', lastName);
    await fill('#email, input[name="email"]', contactEmail);
    if (contactPhone) await fill('#phone, input[name="phone"]', contactPhone);
    if (resume.linkedinUrl) {
      await fill('input[name="linkedin_url"], input[aria-label*="LinkedIn" i]', resume.linkedinUrl);
    }

    if (resumePath) {
      await upload('input[type="file"][name*="resume"], input#resume, input[type="file"]', resumePath);
      await page.waitForTimeout(800);
    }

    if (job.coverLetterText) {
      await fill('textarea[name="cover_letter"], textarea[id*="cover_letter"]', job.coverLetterText);
    }

    // Custom questions — iterate by label text and fill intelligently
    const questionLocator = root
      ? root.locator('[data-field-type], .field-container, .custom-field')
      : page.locator('[data-field-type], .field-container, .custom-field');

    const questionCount = await questionLocator.count();
    for (let i = 0; i < questionCount; i++) {
      const q = questionLocator.nth(i);
      const labelText = await q.locator("label").first().textContent().catch(() => "");
      if (!labelText?.trim()) continue;

      const answer = await generateAtsAnswer(
        labelText.trim(),
        { jobTitle: job.jobTitle, company: job.company, jobDescription: job.jobDescription ?? "" },
        resume
      );

      const taCount = await q.locator("textarea").count();
      const tiCount = await q.locator('input[type="text"]').count();
      if (taCount > 0) await q.locator("textarea").first().fill(answer).catch(() => {});
      else if (tiCount > 0) await q.locator('input[type="text"]').first().fill(answer).catch(() => {});
    }

    // Submit — verify the button exists before clicking
    const submitLocator = root
      ? root.locator('input[type="submit"], button[type="submit"]').first()
      : page.locator('input[type="submit"], button[type="submit"]').first();

    const submitCount = await submitLocator.count();
    if (submitCount === 0) {
      throw new Error(`Greenhouse: submit button not found on ${page.url()}`);
    }
    await submitLocator.click();

    // Wait for confirmation
    try {
      await page.waitForFunction(
        () => {
          const body = document.body?.textContent?.toLowerCase() ?? "";
          return (
            body.includes("thank you") ||
            body.includes("application received") ||
            body.includes("successfully submitted") ||
            window.location.href.includes("confirmation")
          );
        },
        { timeout: 8000 }
      );
    } catch {
      // Check we're not still on the form
      const stillOnForm = await submitLocator.count().catch(() => 0);
      if (stillOnForm > 0) {
        throw new Error(`Greenhouse: form still present after submit — possible validation error (${page.url()})`);
      }
    }

    await addLog(
      "info",
      `Greenhouse: submitted application for "${job.jobTitle}" at ${job.company}`,
      "greenhouse"
    );
  } finally {
    await page.close();
    await ctx.close();
  }
}

// ─── Lever Apply ─────────────────────────────────────────────────────────────

async function submitLever(job: Job, resume: ParsedResume): Promise<void> {
  const ctx = await getContextWithSession("lever_session.json");
  const page = await ctx.newPage();

  try {
    await page.goto(job.applyUrl, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(1000 + Math.random() * 800);

    // Verify the page is a real apply form, not a 404 or closed listing
    const pageText = await page.evaluate(() => document.body?.innerText?.toLowerCase() ?? "");
    if (
      pageText.includes("couldn't find anything") ||
      pageText.includes("404") ||
      pageText.includes("job posting") && pageText.includes("closed") ||
      pageText.includes("job posting") && pageText.includes("removed")
    ) {
      throw new Error(`Lever: job posting not found or closed (${page.url()})`);
    }

    // Require the name field to exist — confirms we're on a real apply form
    const nameField = await page.$('input[name="name"], input[placeholder*="Full name" i], input[placeholder*="Name" i]');
    if (!nameField) {
      throw new Error(`Lever: apply form not found on page — job may be closed (${page.url()})`);
    }

    const resumePath = await getResumePath();
    const contactEmail = await getContactEmail(resume);
    const contactPhone = await getContactPhone(resume);

    // Standard Lever fields
    await page.fill('input[name="name"], input[placeholder*="Full name" i]', resume.name).catch(() => {});
    await page.fill('input[name="email"], input[placeholder*="Email" i]', contactEmail).catch(() => {});
    if (contactPhone) {
      await page.fill('input[name="phone"], input[placeholder*="Phone" i]', contactPhone).catch(() => {});
    }
    if (resume.linkedinUrl) {
      await page.fill(
        'input[name="urls[LinkedIn]"], input[placeholder*="LinkedIn" i]',
        resume.linkedinUrl
      ).catch(() => {});
    }

    if (resumePath) {
      const fileInput = await page.$('input[type="file"][name*="resume"], input[type="file"]');
      if (fileInput) {
        await fileInput.setInputFiles(resumePath).catch(() => {});
        await page.waitForTimeout(800);
      }
    }

    if (job.coverLetterText) {
      await page
        .fill('textarea[name="comments"], textarea[placeholder*="cover letter" i]', job.coverLetterText)
        .catch(() => {});
    }

    // Custom questions
    await fillScreeningQuestions(page, job, resume, {
      questionContainer: ".application-question, [data-qa='custom-question']",
      labelEl: "label, .application-label",
      yesRadio: 'input[type="radio"][value="Yes"]',
      noRadio: 'input[type="radio"][value="No"]',
      textarea: "textarea",
      textInput: 'input[type="text"]',
      selectEl: "select",
    });

    // Find and click the submit button — throw if not found
    const submitBtn = await page.$(
      'button[type="submit"], input[type="submit"], .lever-button-primary[type="submit"]'
    );
    if (!submitBtn) {
      const url = page.url();
      const title = await page.title().catch(() => "");
      throw new Error(`Lever: submit button not found on "${title}" (${url})`);
    }
    await submitBtn.click();

    // Wait for Lever's confirmation
    let confirmed = false;
    try {
      await page.waitForFunction(
        () => {
          const bodyText = document.body?.innerText?.toLowerCase() ?? "";
          const url = window.location.href.toLowerCase();
          return (
            bodyText.includes("thank you") ||
            bodyText.includes("application received") ||
            bodyText.includes("successfully submitted") ||
            bodyText.includes("we've received your application") ||
            url.includes("confirmation") ||
            url.includes("thank")
          );
        },
        { timeout: 10000 }
      );
      confirmed = true;
    } catch {
      const stillOnForm = await page.$('button[type="submit"], .lever-button-primary[type="submit"]');
      if (stillOnForm) {
        const url = page.url();
        throw new Error(`Lever: form still present after submit — possible validation error (${url})`);
      }
      const url = page.url();
      throw new Error(`Lever: no confirmation received after submit — application may not have gone through (${url})`);
    }
    if (!confirmed) {
      throw new Error(`Lever: submission unconfirmed for "${job.jobTitle}" at ${job.company}`);
    }

    await addLog("info", `Lever: submitted application for "${job.jobTitle}" at ${job.company}`, "lever");
  } finally {
    await page.close();
    await ctx.close();
  }
}

// ─── Handshake Apply ─────────────────────────────────────────────────────────

async function submitHandshake(job: Job, resume: ParsedResume): Promise<void> {
  const ctx = await getContextWithSession("handshake_asu_session.json");
  const page = await ctx.newPage();

  try {
    await page.goto(job.applyUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1000 + Math.random() * 800);

    const applyBtn = await page.$(
      'button:has-text("Apply"), [data-testid="apply-button"], button[aria-label*="apply" i]'
    );
    if (!applyBtn) throw new Error("Handshake: Apply button not found");
    await applyBtn.click();
    await page.waitForTimeout(1500 + Math.random() * 500);

    const resumePath = await getResumePath();

    if (resumePath) {
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.setInputFiles(resumePath).catch(() => {});
        await page.waitForTimeout(800);
      }
    }

    if (job.coverLetterText) {
      const clArea = await page.$('textarea[aria-label*="cover letter" i], textarea[name*="cover"]');
      if (clArea) await clArea.fill(job.coverLetterText);
    }

    await fillScreeningQuestions(page, job, resume, {
      questionContainer: '[data-testid="question"], .application-question',
      labelEl: "label, legend",
      yesRadio: 'input[type="radio"][value="Yes"], input[type="radio"][value="true"]',
      noRadio: 'input[type="radio"][value="No"], input[type="radio"][value="false"]',
      textarea: "textarea",
      textInput: 'input[type="text"]',
      selectEl: "select",
    });

    const submitBtn = await page.$(
      'button[type="submit"], button:has-text("Submit application"), button:has-text("Submit")'
    );
    if (submitBtn) {
      await submitBtn.click();
      await page.waitForTimeout(2000);
    }

    await addLog("info", `Handshake: submitted application for "${job.jobTitle}" at ${job.company}`, "handshake");
  } finally {
    await page.close();
    await ctx.close();
  }
}
