const routeButton = document.getElementById("route-button");
const budgetButton = document.getElementById("budget-button");
const diagram = document.getElementById("diagram");
const beat1 = document.querySelector('[data-beat="1"]');
const beat2 = document.querySelector('[data-beat="2"]');
const beat3 = document.querySelector('[data-beat="3"]');
const dashboardLink = document.getElementById("dashboard-link");

const themeToggle = document.getElementById("theme-toggle");
const roleTag = document.getElementById("role-tag");
const operatorPanel = document.getElementById("operator-panel");
const resetButton = document.getElementById("reset-button");
const seedButton = document.getElementById("seed-button");
const seedHistoryButton = document.getElementById("seed-history-button");
const costsButton = document.getElementById("costs-button");
const operatorStatus = document.getElementById("operator-status");

async function loadLinks() {
  try {
    const res = await fetch("/api/links");
    const data = await res.json();
    dashboardLink.href = data.agentgatewayUiUrl;
  } catch {
    // Leave the placeholder href; the presenter can still navigate manually.
  }
}

function advanceToGateway() {
  diagram.dataset.state = "gateway";
  routeButton.textContent = "Routed through agentgateway";
  routeButton.disabled = true;

  beat1.classList.add("is-done");
  beat1.removeAttribute("aria-current");
  beat2.setAttribute("aria-current", "step");
}

function advanceToBudgetApplied() {
  budgetButton.textContent = "Budget policy applied";
  budgetButton.disabled = true;

  beat2.classList.add("is-done");
  beat2.removeAttribute("aria-current");
  beat3.setAttribute("aria-current", "step");
}

function resetBeats() {
  diagram.dataset.state = "direct";
  routeButton.textContent = "Route through agentgateway";
  routeButton.disabled = false;
  budgetButton.textContent = "Apply budget policy";
  budgetButton.disabled = false;
  beat1.classList.remove("is-done");
  beat2.classList.remove("is-done");
  beat1.setAttribute("aria-current", "step");
  beat2.removeAttribute("aria-current");
  beat3.removeAttribute("aria-current");
}

routeButton.addEventListener("click", async () => {
  routeButton.disabled = true;
  try {
    const res = await fetch("/api/route-through-gateway", { method: "POST" });
    if (res.ok) {
      advanceToGateway();
    } else {
      routeButton.disabled = false;
    }
  } catch {
    routeButton.disabled = false;
  }
});

budgetButton.addEventListener("click", async () => {
  budgetButton.disabled = true;
  try {
    const res = await fetch("/api/apply-budget", { method: "POST" });
    if (res.ok) {
      advanceToBudgetApplied();
    } else {
      budgetButton.disabled = false;
    }
  } catch {
    budgetButton.disabled = false;
  }
});

themeToggle.addEventListener("click", () => {
  const next =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("mission-control-theme", next);
});

// No visible affordance - looks like a plain badge to the audience.
roleTag.addEventListener("click", () => {
  const open = operatorPanel.classList.toggle("is-open");
  operatorPanel.inert = !open;
});

resetButton.addEventListener("click", async () => {
  operatorStatus.textContent = "Resetting...";
  try {
    const res = await fetch("/api/reset", { method: "POST" });
    operatorStatus.textContent = res.ok ? "Reset complete." : "Reset failed.";
    if (res.ok) resetBeats();
  } catch {
    operatorStatus.textContent = "Reset failed.";
  }
});

seedButton.addEventListener("click", async () => {
  operatorStatus.textContent = "Seeding traffic...";
  try {
    const res = await fetch("/api/seed-fake-data", { method: "POST" });
    const data = await res.json();
    operatorStatus.textContent = res.ok
      ? `Seeded ${data.count} requests.`
      : "Seeding failed.";
  } catch {
    operatorStatus.textContent = "Seeding failed.";
  }
});

// Run before the live task starts, not during.
seedHistoryButton.addEventListener("click", async () => {
  operatorStatus.textContent = "Seeding a week of history...";
  try {
    const res = await fetch("/api/seed-history", { method: "POST" });
    const data = await res.json();
    operatorStatus.textContent = res.ok
      ? `Backdated ${data.count} requests across the past week.`
      : `Seeding history failed: ${data.error}`;
  } catch {
    operatorStatus.textContent = "Seeding history failed.";
  }
});

// Run once, same timing as seeding history.
costsButton.addEventListener("click", async () => {
  operatorStatus.textContent = "Setting up cost catalog...";
  try {
    const res = await fetch("/api/apply-model-costs", { method: "POST" });
    const data = await res.json();
    operatorStatus.textContent = res.ok
      ? "Cost catalog configured."
      : `Cost catalog setup failed: ${data.error}`;
  } catch {
    operatorStatus.textContent = "Cost catalog setup failed.";
  }
});

loadLinks();
