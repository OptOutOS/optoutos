import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { ThatsThemAdapter } from "./dist/brokers/thatsthem.js";

chromium.use(stealth());

// Dummy/test data only — never real PII in test scripts.
const testProfile = {
  firstName: "John",
  lastName: "Smith",
  emails: ["john@example.com"],
  phones: ["2065551234"],
  addresses: [
    { street: "123 Main St", city: "Seattle", state: "WA", zip: "98101", country: "US" },
  ],
  relatives: [],
};

const adapter = new ThatsThemAdapter();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  const result = await adapter.optOut(page, testProfile);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  process.exit(0);
}
