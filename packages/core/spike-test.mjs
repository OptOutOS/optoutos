import { chromium } from "playwright";
import { ThatsThemAdapter } from "./dist/brokers/thatsthem.js";

// Dummy/test data only — never real PII in test scripts. Matches the
// example placeholders shown in That'sThem's own form.
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
}
