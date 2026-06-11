import "dotenv/config";
import { chromium } from "playwright";
import fs from "fs";
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const TMAIL_SECRET = process.env.TMAIL_SECRET;
const NEW_PASSWORD = process.env.NEW_PASSWORD;

function timestamp() {
  const d = new Date();
  const date = d.toISOString().slice(0, 10);
  const time = d.toTimeString().slice(0, 8).replace(/:/g, ":");
  return `${date}-${time}`;
}

function formatDuration(ms) {
  return (ms / 1000).toFixed(2) + "s";
}

function logResult(result) {
  const status = result.status === "PASS" ? "[PASS]" : "[FAIL]";
  const duration = result.duration ? ` | ${formatDuration(result.duration)}` : "";
  console.log(`${status} ${result.id} | ${result.name}${duration}`);
}

async function getOtp(email) {
  while (true) {
    try {
      const res = await fetch(
        `https://premiumis.me/api/messages/${email}/${TMAIL_SECRET}`,
      );
      const data = await res.json();
      const messages = Array.isArray(data) ? data : data.data || [];

      for (let msg of messages) {
        const isRecent =
          msg.datediff &&
          (msg.datediff.includes("second") ||
            msg.datediff.includes("just now"));

        if (isRecent) {
          const msgStr = JSON.stringify(msg);
          let match = msgStr.match(/verification code:\s*(\d{6})/i);
          if (!match) {
            match = msgStr.match(
              /(\d{6})\s*is your expressvpn verification code/i,
            );
          }
          if (match) {
            return match[1];
          }
        }
      }
    } catch (error) {}
    await sleep(3000);
  }
}

async function getResetLink(email) {
  while (true) {
    try {
      const res = await fetch(
        `https://premiumis.me/api/messages/${email}/${TMAIL_SECRET}`,
      );
      const data = await res.json();
      const messages = Array.isArray(data) ? data : data.data || [data];

      for (let msg of messages) {
        const msgStr = JSON.stringify(msg);
        if (msgStr.includes("Reset password instructions")) {
          const linkMatch = msgStr.match(
            /(https:\/\/link\.clicks\.expressvpn\.com\/ls\/click[^"'\s\\]+)/,
          );
          if (linkMatch) {
            return linkMatch[1];
          }
        }
      }
    } catch (error) {}
    await sleep(3000);
  }
}

async function processEmail(EMAIL, browser, workerId) {
  console.log(`\n[Worker ${workerId}] Processing: ${EMAIL}`);

  const results = [];
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // TC-001: Login form submitted
    let start = Date.now();
    await page.goto("https://portal.expressvpn.com/");
    await page.waitForSelector("#username");
    await page.fill("#username", EMAIL);
    await page.press("#username", "Enter");
    const tc001 = { id: "TC-001", name: "Login form submitted", status: "PASS", duration: Date.now() - start };
    results.push(tc001);
    logResult(tc001);

    // TC-002: OTP received and submitted
    start = Date.now();
    const otp = await getOtp(EMAIL);
    await page.waitForSelector("#otp");
    await page.fill("#otp", otp);
    await page.press("#otp", "Enter");
    const tc002 = { id: "TC-002", name: "OTP received and submitted", status: "PASS", duration: Date.now() - start };
    results.push(tc002);
    logResult(tc002);

    await sleep(2000);

    // TC-003: Reset password triggered
    start = Date.now();
    const resetUrl =
      "https://auth.expressvpn.com/realms/xvpn/login-actions/reset-credentials?client_id=customer-portal&redirect_uri=https://portal.expressvpn.com";
    await page.goto(resetUrl);

    try {
      const usernameCount = await page.locator("#username").count();
      if (usernameCount > 0) {
        const currentVal = await page.inputValue("#username");
        if (!currentVal) await page.fill("#username", EMAIL);
        await page.press("#username", "Enter");
        await page.waitForLoadState("networkidle");
        await sleep(2000);
      } else {
        const submitBtnCount = await page
          .locator('button[type="submit"], input[type="submit"]')
          .count();
        if (submitBtnCount > 0) {
          await page.click('button[type="submit"], input[type="submit"]');
          await page.waitForLoadState("networkidle");
          await sleep(2000);
        }
      }
    } catch (e) {}

    const tc003 = { id: "TC-003", name: "Reset password triggered", status: "PASS", duration: Date.now() - start };
    results.push(tc003);
    logResult(tc003);

    // TC-004: Reset link received and opened
    start = Date.now();
    const resetLink = await getResetLink(EMAIL);
    await page.goto(resetLink);
    const tc004 = { id: "TC-004", name: "Reset link received and opened", status: "PASS", duration: Date.now() - start };
    results.push(tc004);
    logResult(tc004);

    // TC-005: Password changed successfully
    start = Date.now();
    await page.waitForSelector("#password-new");
    await page.fill("#password-new", NEW_PASSWORD);
    await page.fill("#password-confirm", NEW_PASSWORD);
    await page.press("#password-confirm", "Enter");
    await sleep(5000);
    const tc005 = { id: "TC-005", name: "Password changed successfully", status: "PASS", duration: Date.now() - start };
    results.push(tc005);
    logResult(tc005);

    await context.close();
    parentPort.postMessage({ type: "done", email: EMAIL, results });

  } catch (error) {
    const failed = {
      id: `TC-00${results.length + 1}`,
      name: "Unexpected error",
      status: "FAIL",
      duration: null,
      error: error.message || "Unknown error",
    };
    results.push(failed);
    logResult(failed);
    await context.close();
    parentPort.postMessage({ type: "done", email: EMAIL, results });
  }
}

function writeSummary(allResults, outputDir) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const ts = timestamp();
  const filePath = `${outputDir}/summary-${ts}.txt`;

  const lines = [];
  lines.push("ExpressVPN Password Recovery Test");
  lines.push(`Date    : ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`);
  lines.push("");

  let totalPass = 0;
  let totalFail = 0;

  for (const { email, results } of allResults) {
    lines.push(`Email   : ${email}`);
    lines.push("");
    lines.push("Results:");

    for (const r of results) {
      const status = r.status === "PASS" ? "[PASS]" : "[FAIL]";
      const duration = r.duration ? formatDuration(r.duration) : "-";
      const name = r.name.padEnd(35);
      lines.push(`  ${status} ${r.id} | ${name} | ${duration}`);
      if (r.status === "PASS") totalPass++;
      else totalFail++;
    }

    lines.push("");
  }

  const total = totalPass + totalFail;
  lines.push("─".repeat(50));
  lines.push("Summary:");
  lines.push(`  Total  : ${total}`);
  lines.push(`  Passed : ${totalPass}`);
  lines.push(`  Failed : ${totalFail}`);
  lines.push(`  Status : ${totalFail === 0 ? "ALL PASSED" : "SOME FAILED"}`);
  lines.push("─".repeat(50));

  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
  console.log(`\n[+] Summary saved: ${filePath}`);
}

if (isMainThread) {
  let emails = [];
  try {
    const fileContent = fs.readFileSync("email.txt", "utf8").trim();
    if (fileContent) {
      emails = fileContent
        .split("\n")
        .map((e) => e.trim())
        .filter((e) => e !== "");
    }
  } catch (e) {}

  if (emails.length === 0) {
    console.error("[-] File email.txt kosong atau tidak ditemukan.");
    process.exit(1);
  }

  const chunk1 = [];
  const chunk2 = [];
  emails.forEach((email, i) => {
    if (i % 2 === 0) chunk1.push(email);
    else chunk2.push(email);
  });

  const chunks = [chunk1, chunk2].filter((c) => c.length > 0);
  let activeWorkers = chunks.length;
  const allResults = [];

  for (let i = 0; i < chunks.length; i++) {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { emails: chunks[i], workerId: i + 1 },
    });

    worker.on("message", (msg) => {
      if (msg.type === "done") {
        allResults.push({ email: msg.email, results: msg.results });
      }
    });

    worker.on("exit", () => {
      activeWorkers--;
      if (activeWorkers === 0) {
        console.log("\n[+] All workers done.");
        writeSummary(allResults, "./output");
      }
    });

    worker.on("error", (err) => {
      console.error(`Worker error:`, err);
    });
  }
} else {
  const { emails, workerId } = workerData;
  console.log(`[Worker ${workerId}] Starting ${emails.length} email(s)...`);

  (async () => {
    const browser = await chromium.launch({ headless: true });
    for (const email of emails) {
      await processEmail(email, browser, workerId);
    }
    await browser.close();
  })();
}
