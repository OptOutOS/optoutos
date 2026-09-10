// OptOutOS web GUI — vanilla JS, no framework/build step (matches this
// project's minimal-dependency-footprint philosophy for a PII tool — see
// docs/DESIGN.md decision 12). Talks only to same-origin /api/* routes.

const unlockScreen = document.getElementById("unlock-screen");
const householdScreen = document.getElementById("household-screen");
const unlockSourceNote = document.getElementById("unlock-source-note");
const unlockForm = document.getElementById("unlock-form");
const unlockError = document.getElementById("unlock-error");
const passphraseInput = document.getElementById("passphrase-input");
const passphraseLabel = document.getElementById("passphrase-label");
const confirmPassphraseField = document.getElementById("confirm-passphrase-field");
const confirmPassphraseInput = document.getElementById("confirm-passphrase-input");
const firstTimeWarning = document.getElementById("first-time-warning");
const unlockHeading = document.getElementById("unlock-heading");
const lockButton = document.getElementById("lock-button");
const peopleTbody = document.getElementById("people-tbody");
const addPersonForm = document.getElementById("add-person-form");
const peopleError = document.getElementById("people-error");
const dashboardScreen = document.getElementById("dashboard-screen");
const dashboardHeading = document.getElementById("dashboard-heading");
const dashboardTbody = document.getElementById("dashboard-tbody");
const dashboardBackButton = document.getElementById("dashboard-back-button");

async function api(path, options) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options && options.headers) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

async function refreshUnlockStatus() {
  const status = await api("/api/unlock/status");
  if (status.locked) {
    unlockScreen.hidden = false;
    householdScreen.hidden = true;
    unlockSourceNote.textContent =
      status.source === "bws"
        ? "Unlock source: Bitwarden Secrets Manager (configured via environment)."
        : "Unlock source: passphrase (held only in server memory for this session).";
    // BWS mode never needs a passphrase submitted from the browser — hide
    // the form entirely so there's nothing confusing to fill in.
    unlockForm.hidden = status.source === "bws";

    // First-time setup (no store file exists yet) vs. returning unlock:
    // require and show a confirmation field only when this passphrase is
    // about to become the permanent one for a brand-new store.
    const firstTime = status.source === "passphrase-prompt" && !status.storeExists;
    confirmPassphraseField.hidden = !firstTime;
    confirmPassphraseInput.hidden = !firstTime;
    confirmPassphraseInput.required = firstTime;
    firstTimeWarning.hidden = !firstTime;
    unlockHeading.textContent = firstTime ? "Create household store" : "Unlock household store";
    passphraseLabel.textContent = firstTime ? "Choose a passphrase" : "Passphrase";
  } else {
    unlockScreen.hidden = true;
    householdScreen.hidden = false;
    await refreshPeople();
  }
}

unlockForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  unlockError.hidden = true;
  try {
    await api("/api/unlock", {
      method: "POST",
      body: JSON.stringify({
        passphrase: passphraseInput.value,
        ...(confirmPassphraseInput.hidden ? {} : { confirmPassphrase: confirmPassphraseInput.value }),
      }),
    });
    passphraseInput.value = "";
    confirmPassphraseInput.value = "";
    await refreshUnlockStatus();
  } catch (err) {
    unlockError.textContent = err.message;
    unlockError.hidden = false;
  }
});

lockButton.addEventListener("click", async () => {
  await api("/api/lock", { method: "POST" });
  await refreshUnlockStatus();
});

function renderPeople(people) {
  peopleTbody.innerHTML = "";
  for (const person of people) {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = `${person.firstName} ${person.lastName}`;
    const email = document.createElement("td");
    email.textContent = (person.emails && person.emails[0]) || "";
    const phone = document.createElement("td");
    phone.textContent = (person.phones && person.phones[0]) || "";
    const notes = document.createElement("td");
    notes.textContent = person.notes || "";
    const actions = document.createElement("td");
    const statusButton = document.createElement("button");
    statusButton.type = "button";
    statusButton.textContent = "View status";
    statusButton.addEventListener("click", () => showDashboard(person));
    actions.appendChild(statusButton);
    tr.append(name, email, phone, notes, actions);
    peopleTbody.appendChild(tr);
  }
}

async function refreshPeople() {
  peopleError.hidden = true;
  try {
    const people = await api("/api/people");
    renderPeople(people);
  } catch (err) {
    peopleError.textContent = err.message;
    peopleError.hidden = false;
  }
}

addPersonForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  peopleError.hidden = true;
  const firstName = document.getElementById("first-name-input").value.trim();
  const lastName = document.getElementById("last-name-input").value.trim();
  const email = document.getElementById("email-input").value.trim();
  const phone = document.getElementById("phone-input").value.trim();

  try {
    await api("/api/people", {
      method: "POST",
      body: JSON.stringify({
        firstName,
        lastName,
        ...(email ? { emails: [email] } : {}),
        ...(phone ? { phones: [phone] } : {}),
      }),
    });
    addPersonForm.reset();
    await refreshPeople();
  } catch (err) {
    peopleError.textContent = err.message;
    peopleError.hidden = false;
  }
});

function renderDashboard(rows) {
  dashboardTbody.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    const broker = document.createElement("td");
    broker.textContent = row.brokerName;
    const lastRunAt = document.createElement("td");
    lastRunAt.textContent = row.lastRunAt ? new Date(row.lastRunAt).toLocaleDateString() : "Never checked";
    const lastStatus = document.createElement("td");
    lastStatus.textContent = row.lastStatus || "—";
    tr.append(broker, lastRunAt, lastStatus);
    dashboardTbody.appendChild(tr);
  }
}

async function showDashboard(person) {
  householdScreen.hidden = true;
  dashboardScreen.hidden = false;
  dashboardHeading.textContent = `Broker status — ${person.firstName} ${person.lastName}`;
  const rows = await api(`/api/people/${person.id}/dashboard`);
  renderDashboard(rows);
}

dashboardBackButton.addEventListener("click", () => {
  dashboardScreen.hidden = true;
  householdScreen.hidden = false;
});

refreshUnlockStatus();
