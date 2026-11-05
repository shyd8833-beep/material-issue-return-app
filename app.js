
/************************************************************
 * MATERIAL ISSUE & RETURN APP
 * Frontend Version 2.0
 * Backend: Cloudflare Worker + Google Apps Script
 ************************************************************/

const API_URL = "https://material-issue-api.shyd8833.workers.dev";

const state = {
  token: "",
  username: "",
  role: "",
  page: "dashboard",
  items: [],
  people: [],
  transactions: [],
  dashboard: null,
  reportRows: [],
  deferredInstall: null,
  scannerStream: null,
  scannerActive: false,
  pendingVoiceCommand: null
};

const $ = id => document.getElementById(id);

const PAGE_INFO = {
  dashboard: ["Dashboard", "Material management overview"],
  issue: ["Material Issue", "Issue material to an employee"],
  inward: ["Material Inward", "Add material to Fresh Stock"],
  return: ["Material Return", "Record returned material"],
  stock: ["Live Stock", "Fresh, pending and returned stock"],
  history: ["Transaction History", "All material transactions"],
  people: ["People", "Manage employees"],
  items: ["Items", "Manage material list"],
  reports: ["Reports", "Transaction reports"],
  voice: ["Voice Agent", "Voice-assisted material management"],
  settings: ["Admin Settings", "Account and administration"]
};

/* =========================================================
   STARTUP
   ========================================================= */

document.addEventListener("DOMContentLoaded", init);

function init() {
  $("connectionStatus").textContent = "Checking connection...";

  $("loginForm").addEventListener("submit", login);
  $("logoutButton").addEventListener("click", logout);

  document.querySelectorAll(".nav-button").forEach(button => {
    button.addEventListener("click", () => navigate(button.dataset.page));
  });

  $("installButton").addEventListener("click", installApp);

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    state.deferredInstall = event;
    $("installButton").hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    showToast("App installed successfully.");
    $("installButton").hidden = true;
  });

  registerServiceWorker();
  testConnection();

  const saved = sessionStorage.getItem("material_session");

  if (saved) {
    try {
      const data = JSON.parse(saved);
      state.token = data.token;
      state.username = data.username;
      state.role = data.role;
      openApplication();
    } catch (error) {
      sessionStorage.removeItem("material_session");
    }
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  try {
    await navigator.serviceWorker.register("./service-worker.js");
  } catch (error) {
    console.warn("Service worker registration failed:", error);
  }
}

/* =========================================================
   API CONNECTION
   ========================================================= */

async function api(action, data = {}) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      action,
      token: state.token,
      ...data
    })
  });

  if (!response.ok) {
    throw new Error("Server connection failed: " + response.status);
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.message || "Request failed.");
  }

  return result;
}

async function testConnection() {
  try {
    const response = await fetch(API_URL);
    const result = await response.json();

    if (!result.success) throw new Error("Backend unavailable");

    $("connectionStatus").textContent = "Connected";
  } catch (error) {
    $("connectionStatus").textContent = "Connection error";
    showToast("Backend connection failed: " + error.message);
  }
}

/* =========================================================
   LOGIN / LOGOUT
   ========================================================= */

async function login(event) {
  event.preventDefault();

  const username = $("username").value.trim();
  const password = $("password").value;

  $("loginButton").disabled = true;
  $("loginButton").textContent = "Signing in...";
  $("loginMessage").textContent = "";

  try {
    const result = await api("login", { username, password });

    state.token = result.token;
    state.username = result.username;
    state.role = result.role;

    sessionStorage.setItem("material_session", JSON.stringify({
      token: state.token,
      username: state.username,
      role: state.role
    }));

    $("password").value = "";
    await openApplication();

  } catch (error) {
    $("loginMessage").textContent = error.message;
  } finally {
    $("loginButton").disabled = false;
    $("loginButton").textContent = "Sign In";
  }
}

function logout() {
  stopScanner();

  state.token = "";
  state.username = "";
  state.role = "";

  sessionStorage.removeItem("material_session");

  $("mainScreen").hidden = true;
  $("loginScreen").hidden = false;
  $("logoutButton").hidden = true;

  $("loginMessage").textContent = "";
  $("username").value = "";
  $("password").value = "";
}

async function openApplication() {
  $("loginScreen").hidden = true;
  $("mainScreen").hidden = false;
  $("logoutButton").hidden = false;

  $("loggedInUser").textContent = state.username;
  $("loggedInRole").textContent = state.role;
  $("userAvatar").textContent = state.username.charAt(0).toUpperCase();

  document.querySelectorAll(".nav-button").forEach(button => {
    const page = button.dataset.page;

    button.hidden =
      state.role !== "ADMIN" &&
      ["settings", "people", "items"].includes(page);
  });

  try {
    await refreshData();
    await navigate("dashboard");
  } catch (error) {
    showToast(error.message);
    logout();
  }
}

/* =========================================================
   DATA REFRESH
   ========================================================= */

async function refreshData() {
  const [items, people, transactions, dashboard] = await Promise.all([
    api("listItems"),
    api("listPeople"),
    api("listTransactions"),
    api("dashboard")
  ]);

  state.items = items.items || [];
  state.people = people.people || [];
  state.transactions = transactions.transactions || [];
  state.dashboard = dashboard;

  checkStockAlerts();
}

async function navigate(page) {
  if (!PAGE_INFO[page]) return;

  stopScanner();

  state.page = page;

  document.querySelectorAll(".nav-button").forEach(button => {
    button.classList.toggle("active", button.dataset.page === page);
  });

  $("breadcrumbPage").textContent = PAGE_INFO[page][0];
  $("pageTitle").textContent = PAGE_INFO[page][0];
  $("pageSubtitle").textContent = PAGE_INFO[page][1];

  $("pageContent").innerHTML =
    '<div class="loading-panel">Loading...</div>';

  try {
    await refreshData();

    const renderers = {
      dashboard: renderDashboard,
      issue: renderIssue,
      inward: renderInward,
      return: renderReturn,
      stock: renderStock,
      history: renderHistory,
      people: renderPeople,
      items: renderItems,
      reports: renderReports,
      voice: renderVoice,
      settings: renderSettings
    };

    renderers[page]();

  } catch (error) {
    $("pageContent").innerHTML =
      `<div class="empty-state">${escapeHTML(error.message)}</div>`;
  }
}

/* =========================================================
   DASHBOARD
   ========================================================= */

function renderDashboard() {
  const d = state.dashboard;

  $("pageContent").innerHTML = `
    <div class="stats-grid">
      ${statCard("Total Items", d.totalItems)}
      ${statCard("Total People", d.totalPeople)}
      ${statCard("Fresh Stock", number(d.availableStock))}
      ${statCard("Pending Issue", number(d.activeIssues))}
    </div>

    <div class="stats-grid">
      ${statCard("Returned / Used", number(d.returnedStock))}
      ${statCard("Reusable Pending", number(d.reusablePending))}
      ${statCard("Damaged Material", number(d.damagedStock))}
      ${statCard("Today's Transactions", number(d.todayTransactions))}
    </div>

    <div class="panel">
      <h2>Low Stock Alerts</h2>
      ${d.lowStock && d.lowStock.length
        ? table(
            ["Item Code", "Material", "Fresh Stock", "Minimum"],
            d.lowStock.map(x => [
              x.ItemCode,
              x.ItemName,
              number(x.FreshStock),
              number(x.MinStock)
            ])
          )
        : '<div class="empty-state">No low-stock alerts.</div>'}
    </div>

    <div class="panel">
      <h2>Current Stock Summary</h2>
      ${stockTable(d.stock || [])}
    </div>
  `;
}

function checkStockAlerts() {
  if (!state.dashboard || !state.dashboard.lowStock) return;

  const count = state.dashboard.lowStock.length;

  if (count > 0) {
    document.title = `(${count}) Low Stock - Material App`;
  } else {
    document.title = "Material Issue Return App";
  }
}

/* =========================================================
   MATERIAL ISSUE
   ========================================================= */

function renderIssue() {
  $("pageContent").innerHTML = `
    <div class="panel">
      <h2>Issue Material</h2>

      <form id="issueForm">
        <div class="form-grid">

          <div class="form-field">
            <label>Employee Name or Employee Code</label>
            <input list="peopleList" id="issueEmployee"
              placeholder="Search employee" required>
            ${peopleDatalist()}
            <small id="personIdInfo"></small>
          </div>

          <div class="form-field">
            <label>Material</label>
            <input list="itemList" id="issueItemSearch"
              placeholder="Search material name or code" required>
            ${itemDatalist()}
          </div>

          <div class="form-field">
            <label>Quantity</label>
            <input type="number" id="issueQuantity"
              min="0.0001" step="any" required>
          </div>

          <div class="form-field">
            <label>Reference</label>
            <input id="issueReference" placeholder="Optional reference">
          </div>

          <div class="form-field full-width">
            <label>Notes</label>
            <textarea id="issueNotes"></textarea>
          </div>
        </div>

        <div id="overrideFields" hidden class="panel">
          <h2>Admin Override</h2>
          <p>This employee already has this material pending return.</p>

          <div class="form-field">
            <label>Admin Override Password</label>
            <input type="password" id="overridePassword">
          </div>

          <div class="form-field">
            <label>Reason for Override</label>
            <textarea id="overrideReason"></textarea>
          </div>
        </div>

        <div class="form-actions">
          <button class="action-button" type="submit">Issue Material</button>
        </div>
      </form>

      <p id="issueMessage" class="message"></p>
    </div>

    ${scannerPanel("issue")}
  `;

  $("issueForm").addEventListener("submit", submitIssue);
  $("issueEmployee").addEventListener("input", updateIssueInfo);
  $("issueItemSearch").addEventListener("input", updateOverrideVisibility);
  $("issueEmployee").addEventListener("change", updateIssueInfo);

  setupScanner("issue");
}

function updateIssueInfo() {
  const person = findPerson($("issueEmployee").value);

  $("personIdInfo").textContent = person
    ? `PersonID: ${person.PersonID} | Employee Code: ${person.EmployeeCode}`
    : "Employee not selected";

  updateOverrideVisibility();
}

function updateOverrideVisibility() {
  const person = findPerson($("issueEmployee").value);
  const item = findItem($("issueItemSearch").value);

  if (!person || !item || state.role !== "ADMIN") {
    $("overrideFields").hidden = true;
    return;
  }

  const outstanding = employeeItemOutstanding(
    person.EmployeeCode,
    item.ItemCode
  );

  $("overrideFields").hidden = outstanding <= 0;
}

async function submitIssue(event) {
  event.preventDefault();

  const person = findPerson($("issueEmployee").value);
  const item = findItem($("issueItemSearch").value);

  if (!person) {
    showToast("Select a valid employee.");
    return;
  }

  if (!item) {
    showToast("Select a valid material.");
    return;
  }

  const quantity = Number($("issueQuantity").value);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    showToast("Enter a valid quantity.");
    return;
  }

  const outstanding = employeeItemOutstanding(
    person.EmployeeCode,
    item.ItemCode
  );

  const override = outstanding > 0;

  if (override && state.role !== "ADMIN") {
    showToast("This employee already has this item pending return.");
    return;
  }

  let overridePassword = "";
  let overrideReason = "";

  if (override) {
    overridePassword = $("overridePassword").value;
    overrideReason = $("overrideReason").value.trim();

    if (!overridePassword || !overrideReason) {
      showToast("Override password and reason are required.");
      return;
    }
  }

  if (quantity > Number(item.AvailableStock)) {
    showToast("Insufficient Fresh Stock.");
    return;
  }

  if (!confirm(
    `Issue ${quantity} ${item.ItemName} to ${person.PersonName} (${person.EmployeeCode})?`
  )) return;

  try {
    await api("issue", {
      itemCode: item.ItemCode,
      employeeCode: person.EmployeeCode,
      quantity,
      reference: $("issueReference").value,
      notes: $("issueNotes").value,
      overridePassword,
      overrideReason
    });

    showToast("Material issued successfully.");
    await navigate("issue");

  } catch (error) {
    showToast(error.message);
  }
}

/* =========================================================
   MATERIAL INWARD
   ========================================================= */

function renderInward() {
  $("pageContent").innerHTML = `
    <div class="panel">
      <h2>Material Inward - Fresh Stock</h2>

      <form id="inwardForm">
        <div class="form-grid">

          <div class="form-field">
            <label>Material</label>
            <input list="itemList" id="inwardItem"
              placeholder="Search material" required>
            ${itemDatalist()}
          </div>

          <div class="form-field">
            <label>Quantity</label>
            <input type="number" id="inwardQuantity"
              min="0.0001" step="any" required>
          </div>

          <div class="form-field">
            <label>Reference</label>
            <input id="inwardReference">
          </div>

          <div class="form-field">
            <label>Notes</label>
            <textarea id="inwardNotes"></textarea>
          </div>

        </div>

        <div class="form-actions">
          <button class="action-button">Save Inward</button>
        </div>
      </form>
    </div>

    ${scannerPanel("inward")}
  `;

  $("inwardForm").addEventListener("submit", async event => {
    event.preventDefault();

    const item = findItem($("inwardItem").value);

    if (!item) {
      showToast("Select a valid material.");
      return;
    }

    try {
      await api("inward", {
        itemCode: item.ItemCode,
        quantity: Number($("inwardQuantity").value),
        reference: $("inwardReference").value,
        notes: $("inwardNotes").value
      });

      showToast("Material inward saved to Fresh Stock.");
      await navigate("inward");

    } catch (error) {
      showToast(error.message);
    }
  });

  setupScanner("inward");
}

/* =========================================================
   MATERIAL RETURN
   ========================================================= */

function getPendingIssues() {
  return state.transactions.filter(t =>
    t.Type === "ISSUE" && getOutstanding(t.TxnID) > 0
  );
}

function getOutstanding(txnId) {
  const issue = state.transactions.find(t =>
    t.TxnID === txnId && t.Type === "ISSUE"
  );

  if (!issue) return 0;

  const returned = state.transactions
    .filter(t => t.Type === "RETURN" && t.RelatedTxnID === txnId)
    .reduce((sum, t) => sum + Number(t.Quantity || 0), 0);

  return Math.max(0, Number(issue.Quantity || 0) - returned);
}

function renderReturn() {
  const pending = getPendingIssues();

  const returnedRows = state.transactions.filter(t =>
    t.Type === "RETURN"
  );

  $("pageContent").innerHTML = `
    <div class="panel">
      <h2>Pending Material Returns</h2>

      ${pending.length ? table(
        ["Employee", "Employee Code", "Material", "Issued", "Pending", "Action"],
        pending.map(issue => [
          issue.PersonName,
          issue.EmployeeCode,
          issue.ItemName,
          number(issue.Quantity),
          number(getOutstanding(issue.TxnID)),
          `<button class="secondary-button"
            onclick="selectReturn('${escapeAttribute(issue.TxnID)}')">
            Return
          </button>`
        ])
      ) : '<div class="empty-state">No pending returns.</div>'}
    </div>

    <div class="panel">
      <h2>Record Material Return</h2>

      <form id="returnForm">
        <div class="form-grid">
          <div class="form-field full-width">
            <label>Original Issue</label>
            <select id="returnIssue" required>
              <option value="">Select pending issue</option>
              ${pending.map(t => `
                <option value="${escapeAttribute(t.TxnID)}">
                  ${escapeHTML(t.PersonName)} (${escapeHTML(t.EmployeeCode)})
                  — ${escapeHTML(t.ItemName)}
                  — Pending ${number(getOutstanding(t.TxnID))}
                </option>
              `).join("")}
            </select>
          </div>

          <div class="form-field">
            <label>Return Quantity</label>
            <input type="number" id="returnQuantity"
              min="0.0001" step="any" required>
          </div>

          <div class="form-field">
            <label>Reference</label>
            <input id="returnReference">
          </div>

          <div class="form-field full-width">
            <label>Notes</label>
            <textarea id="returnNotes"></textarea>
          </div>
        </div>

        <div class="form-actions">
          <button class="action-button">Save Return</button>
        </div>
      </form>
    </div>

    <div class="panel">
      <h2>Returned Material Inspection</h2>
      <p>Admin must classify returned material before it can be transferred to Fresh Stock.</p>

      ${state.role === "ADMIN"
        ? returnedRows.length
          ? table(
              ["Return ID", "Material", "Employee", "Quantity", "Condition", "Action"],
              returnedRows.map(t => [
                t.TxnID,
                t.ItemName,
                t.PersonName,
                number(t.Quantity),
                t.ReturnCondition || "Not Classified",
                t.ReturnCondition
                  ? "-"
                  : `<button class="secondary-button"
                      onclick="classifyReturnPrompt('${escapeAttribute(t.TxnID)}','REUSABLE')">
                      Reusable
                    </button>
                    <button class="secondary-button"
                      onclick="classifyReturnPrompt('${escapeAttribute(t.TxnID)}','DAMAGED')">
                      Damaged
                    </button>`
              ])
            )
          : '<div class="empty-state">No returned material.</div>'
        : '<div class="empty-state">Admin access required for inspection.</div>'}
    </div>

    ${state.role === "ADMIN" ? renderReusableTransferPanel() : ""}
  `;

  $("returnForm").addEventListener("submit", async event => {
    event.preventDefault();

    const issueTxnId = $("returnIssue").value;
    const quantity = Number($("returnQuantity").value);
    const pendingQty = getOutstanding(issueTxnId);

    if (!issueTxnId || quantity <= 0 || quantity > pendingQty) {
      showToast("Return quantity exceeds pending quantity or is invalid.");
      return;
    }

    if (!confirm("Confirm this material return?")) return;

    try {
      await api("return", {
        issueTxnId,
        quantity,
        reference: $("returnReference").value,
        notes: $("returnNotes").value
      });

      showToast("Return saved. Fresh Stock has not increased.");
      await navigate("return");

    } catch (error) {
      showToast(error.message);
    }
  });
}

window.selectReturn = function(txnId) {
  $("returnIssue").value = txnId;
  $("returnQuantity").focus();
};

window.classifyReturnPrompt = async function(txnId, condition) {
  const label = condition === "REUSABLE" ? "Reusable" : "Damaged";

  if (!confirm(`Classify this returned material as ${label}?`)) return;

  try {
    await api("classifyReturn", {
      returnTxnId: txnId,
      condition
    });

    showToast("Return classified as " + label + ".");
    await navigate("return");

  } catch (error) {
    showToast(error.message);
  }
};

function renderReusableTransferPanel() {
  const items = state.items.filter(item =>
    Number(item.ReusablePending || 0) > 0
  );

  return `
    <div class="panel">
      <h2>Admin - Transfer Reusable Material to Fresh Stock</h2>

      <form id="reusableTransferForm">
        <div class="form-grid">
          <div class="form-field">
            <label>Material</label>
            <select id="transferItem" required>
              <option value="">Select material</option>
              ${items.map(i => `
                <option value="${escapeAttribute(i.ItemCode)}">
                  ${escapeHTML(i.ItemName)} - Reusable:
                  ${number(i.ReusablePending)}
                </option>
              `).join("")}
            </select>
          </div>

          <div class="form-field">
            <label>Transfer Quantity</label>
            <input type="number" id="transferQuantity"
              min="0.0001" step="any" required>
          </div>

          <div class="form-field">
            <label>Reference</label>
            <input id="transferReference">
          </div>

          <div class="form-field">
            <label>Notes</label>
            <input id="transferNotes">
          </div>
        </div>

        <button class="action-button">Transfer to Fresh Stock</button>
      </form>
    </div>
  `;
}

/* =========================================================
   REUSABLE TRANSFER FORM HANDLER
   ========================================================= */

document.addEventListener("submit", async event => {
  if (event.target.id !== "reusableTransferForm") return;

  event.preventDefault();

  const itemCode = $("transferItem").value;
  const quantity = Number($("transferQuantity").value);

  if (!itemCode || quantity <= 0) {
    showToast("Select material and valid quantity.");
    return;
  }

  if (!confirm("Transfer approved reusable material to Fresh Stock?")) return;

  try {
    await api("transferReusable", {
      itemCode,
      quantity,
      reference: $("transferReference").value,
      notes: $("transferNotes").value
    });

    showToast("Reusable material transferred to Fresh Stock.");
    await navigate("return");

  } catch (error) {
    showToast(error.message);
  }
});

/* =========================================================
   LIVE STOCK
   ========================================================= */

function renderStock() {
  $("pageContent").innerHTML = `
    <div class="panel">
      <h2>Live Material Stock</h2>

      <input class="search-input" id="stockSearch"
        placeholder="Search item code or name">

      <div id="stockTable">${stockTable(state.items)}</div>
    </div>
  `;

  $("stockSearch").addEventListener("input", event => {
    const q = event.target.value.toLowerCase();

    const filtered = state.items.filter(item =>
      [item.ItemCode, item.ItemName]
        .some(v => String(v || "").toLowerCase().includes(q))
    );

    $("stockTable").innerHTML = stockTable(filtered);
  });
}

function stockTable(items) {
  return table(
    [
      "Item Code", "Material", "Unit", "Fresh Stock",
      "Pending Issue", "Returned/Used", "Reusable Pending",
      "Damaged", "Minimum", "Status"
    ],
    items.map(item => {
      const available = Number(item.FreshStock ?? item.AvailableStock ?? 0);
      const minimum = Number(item.MinStock || 0);

      return [
        item.ItemCode,
        item.ItemName,
        item.Unit,
        number(available),
        number(item.PendingIssue ?? item.IssuedStock),
        number(item.ReturnedStock),
        number(item.ReusablePending),
        number(item.DamagedStock),
        number(minimum),
        available <= minimum
          ? '<span class="badge badge-warning">Low Stock</span>'
          : '<span class="badge badge-success">Available</span>'
      ];
    })
  );
}

/* =========================================================
   TRANSACTION HISTORY
   ========================================================= */

function renderHistory() {
  $("pageContent").innerHTML = `
    <div class="panel">
      <h2>Transaction History</h2>

      <input class="search-input" id="historySearch"
        placeholder="Search employee, item, code or transaction">

      <div id="historyTable">
        ${transactionTable(state.transactions)}
      </div>
    </div>
  `;

  $("historySearch").addEventListener("input", event => {
    const q = event.target.value.toLowerCase();

    const filtered = state.transactions.filter(t =>
      [
        t.TxnID, t.Type, t.ItemCode, t.ItemName,
        t.EmployeeCode, t.PersonName, t.Department,
        t.ReturnCondition
      ].some(v => String(v || "").toLowerCase().includes(q))
    );

    $("historyTable").innerHTML = transactionTable(filtered);
  });
}

function transactionTable(rows) {
  return table(
    [
      "Date", "Type", "Item", "Quantity",
      "Employee", "Employee Code", "Condition", "Entered By", "Notes"
    ],
    rows.map(t => [
      formatDate(t.Timestamp),
      t.Type,
      `${escapeHTML(t.ItemName)} (${escapeHTML(t.ItemCode)})`,
      number(t.Quantity),
      escapeHTML(t.PersonName || "-"),
      escapeHTML(t.EmployeeCode || "-"),
      escapeHTML(t.ReturnCondition || "-"),
      escapeHTML(t.EnteredBy || "-"),
      escapeHTML(t.Notes || "-")
    ])
  );
}

/* =========================================================
   PEOPLE MANAGEMENT
   ========================================================= */

function renderPeople() {
  if (state.role !== "ADMIN") {
    $("pageContent").innerHTML =
      '<div class="empty-state">Admin access required.</div>';
    return;
  }

  $("pageContent").innerHTML = `
    <div class="panel">
      <h2>Add Employee</h2>

      <form id="personForm">
        <div class="form-grid">
          <div class="form-field">
            <label>Employee Code</label>
            <input id="personCode" required>
          </div>

          <div class="form-field">
            <label>Employee Name</label>
            <input id="personName" required>
          </div>

          <div class="form-field">
            <label>Department</label>
            <input id="personDepartment">
          </div>
        </div>

        <button class="action-button">Save Employee</button>
      </form>
    </div>

    <div class="panel">
      <h2>Employee List</h2>
      <input class="search-input" id="peopleSearch"
        placeholder="Search employee name or code">

      <div id="peopleTable">${peopleTable(state.people)}</div>
    </div>
  `;

  $("personForm").addEventListener("submit", async event => {
    event.preventDefault();

    try {
      await api("savePerson", {
        employeeCode: $("personCode").value,
        personName: $("personName").value,
        department: $("personDepartment").value
      });

      showToast("Employee saved.");
      await navigate("people");

    } catch (error) {
      showToast(error.message);
    }
  });

  $("peopleSearch").addEventListener("input", event => {
    const q = event.target.value.toLowerCase();

    $("peopleTable").innerHTML = peopleTable(
      state.people.filter(p =>
        [p.PersonID, p.EmployeeCode, p.PersonName, p.Department]
          .some(v => String(v || "").toLowerCase().includes(q))
      )
    );
  });
}

function peopleTable(rows) {
  return table(
    ["Person ID", "Employee Code", "Name", "Department"],
    rows.map(p => [
      escapeHTML(p.PersonID || "-"),
      escapeHTML(p.EmployeeCode),
      escapeHTML(p.PersonName),
      escapeHTML(p.Department || "-")
    ])
  );
}

/* =========================================================
   ITEM MANAGEMENT
   ========================================================= */

function renderItems() {
  if (state.role !== "ADMIN") {
    $("pageContent").innerHTML =
      '<div class="empty-state">Admin access required.</div>';
    return;
  }

  $("pageContent").innerHTML = `
    <div class="panel">
      <h2>Add Material</h2>

      <form id="itemForm">
        <div class="form-grid">
          <div class="form-field">
            <label>Item Code</label>
            <input id="itemCode" required>
          </div>

          <div class="form-field">
            <label>Item Name</label>
            <input id="itemName" required>
          </div>

          <div class="form-field">
            <label>Unit</label>
            <input id="itemUnit" value="PCS" required>
          </div>

          <div class="form-field">
            <label>Opening Stock</label>
            <input type="number" id="openingStock"
              min="0" step="any" value="0" required>
          </div>

          <div class="form-field">
            <label>Minimum Stock</label>
            <input type="number" id="minStock"
              min="0" step="any" value="0" required>
          </div>
        </div>

        <button class="action-button">Save Material</button>
      </form>
    </div>

    <div class="panel">
      <h2>Material List</h2>
      <input class="search-input" id="itemSearch"
        placeholder="Search material code or name">

      <div id="itemsTable">${stockTable(state.items)}</div>
    </div>
  `;

  $("itemForm").addEventListener("submit", async event => {
    event.preventDefault();

    try {
      await api("saveItem", {
        itemCode: $("itemCode").value,
        itemName: $("itemName").value,
        unit: $("itemUnit").value,
        openingStock: Number($("openingStock").value),
        minStock: Number($("minStock").value)
      });

      showToast("Material saved.");
      await navigate("items");

    } catch (error) {
      showToast(error.message);
    }
  });

  $("itemSearch").addEventListener("input", event => {
    const q = event.target.value.toLowerCase();

    $("itemsTable").innerHTML = stockTable(
      state.items.filter(item =>
        [item.ItemCode, item.ItemName]
          .some(v => String(v || "").toLowerCase().includes(q))
      )
    );
  });
}

/* =========================================================
   REPORTS
   ========================================================= */

function renderReports() {
  $("pageContent").innerHTML = `
    <div class="panel">
      <h2>Transaction Reports</h2>

      <form id="reportForm">
        <div class="form-grid">
          <div class="form-field">
            <label>From Date</label>
            <input type="date" id="reportFrom">
          </div>

          <div class="form-field">
            <label>To Date</label>
            <input type="date" id="reportTo">
          </div>

          <div class="form-field">
            <label>Transaction Type</label>
            <select id="reportType">
              <option value="">All</option>
              <option value="ISSUE">Issue</option>
              <option value="INWARD">Inward</option>
              <option value="RETURN">Return</option>
              <option value="REUSABLE_TRANSFER">Reusable Transfer</option>
            </select>
          </div>

          <div class="form-field">
            <label>Employee</label>
            <select id="reportEmployee">
              <option value="">All Employees</option>
              ${state.people.map(p => `
                <option value="${escapeAttribute(p.EmployeeCode)}">
                  ${escapeHTML(p.PersonName)} (${escapeHTML(p.EmployeeCode)})
                </option>
              `).join("")}
            </select>
          </div>

          <div class="form-field">
            <label>Material</label>
            <select id="reportItem">
              <option value="">All Materials</option>
              ${state.items.map(i => `
                <option value="${escapeAttribute(i.ItemCode)}">
                  ${escapeHTML(i.ItemName)} (${escapeHTML(i.ItemCode)})
                </option>
              `).join("")}
            </select>
          </div>
        </div>

        <button class="action-button">Generate Report</button>
      </form>
    </div>

    <div class="panel">
      <div class="form-actions">
        <button class="secondary-button" id="exportReport">Export CSV</button>
        <button class="secondary-button" id="printReport">Print</button>
      </div>

      <div id="reportTable"></div>
    </div>
  `;

  $("reportForm").addEventListener("submit", async event => {
    event.preventDefault();

    try {
      const result = await api("reports", {
        from: $("reportFrom").value,
        to: $("reportTo").value,
        type: $("reportType").value,
        employeeCode: $("reportEmployee").value,
        itemCode: $("reportItem").value
      });

      state.reportRows = result.transactions || [];
      $("reportTable").innerHTML = transactionTable(state.reportRows);

    } catch (error) {
      showToast(error.message);
    }
  });

  $("exportReport").addEventListener("click", () =>
    downloadCSV(state.reportRows)
  );

  $("printReport").addEventListener("click", () => window.print());
}

/* =========================================================
   VOICE AGENT
   ========================================================= */

function renderVoice() {
  $("pageContent").innerHTML = `
    <div class="voice-panel">
      <h2>Hindi Voice Agent</h2>

      <p>उदाहरण:</p>
      <ul>
        <li>"Rahul ko 2 Pen issue karo"</li>
        <li>"Rahul ka pending issue batao"</li>
        <li>"Pen ka fresh stock kitna hai"</li>
        <li>"Rahul ko 1 Pen return karo"</li>
      </ul>

      <button id="voiceButton" class="voice-button">🎙</button>

      <p id="voiceStatus">बोलने के लिए माइक्रोफोन दबाएँ।</p>

      <div class="form-field">
        <label>या अपना आदेश लिखें</label>
        <textarea id="voiceText"
          placeholder="Rahul ko 2 Pen issue karo"></textarea>
      </div>

      <div class="form-actions">
        <button class="action-button" id="voiceParse">आदेश समझें</button>
      </div>

      <div id="voiceResult"></div>
    </div>
  `;

  $("voiceButton").addEventListener("click", startVoice);
  $("voiceParse").addEventListener("click", parseVoice);
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "hi-IN";
  utterance.rate = 0.95;

  window.speechSynthesis.speak(utterance);
}

function startVoice() {
  const Recognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!Recognition) {
    showToast("Voice recognition is not supported. Please type the command.");
    return;
  }

  const recognition = new Recognition();

  recognition.lang = "hi-IN";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  $("voiceStatus").textContent = "सुन रहा हूँ...";

  recognition.onresult = event => {
    $("voiceText").value = event.results[0][0].transcript;
    $("voiceStatus").textContent = "आदेश मिल गया।";
    parseVoice();
  };

  recognition.onerror = event => {
    $("voiceStatus").textContent = "Microphone error: " + event.error;
  };

  recognition.onend = () => {
    $("voiceButton").classList.remove("listening");
  };

  try {
    recognition.start();
    $("voiceButton").classList.add("listening");
  } catch (error) {
    showToast("Microphone could not start: " + error.message);
  }
}

function parseVoice() {
  const command = $("voiceText").value.trim();

  if (!command) {
    showToast("पहले अपना आदेश बोलें या लिखें।");
    return;
  }

  const normalized = command.toLowerCase();

  const person = state.people.find(p =>
    normalized.includes(String(p.PersonName).toLowerCase()) ||
    normalized.includes(String(p.EmployeeCode).toLowerCase())
  );

  const item = state.items.find(i =>
    normalized.includes(String(i.ItemName).toLowerCase()) ||
    normalized.includes(String(i.ItemCode).toLowerCase())
  );

  const isPendingQuestion =
    /pending|बाकी|कितना बाकी|लंबित/.test(normalized);

  const isStockQuestion =
    /stock|स्टॉक|उपलब्ध|कितना है/.test(normalized);

  const isReturn =
    /return|वापस|लौटा/.test(normalized);

  const isIssue =
    /issue|दे दो|जारी|निकाल|भेज/.test(normalized);

  if (isPendingQuestion && person && item) {
    const pending = employeeItemOutstanding(person.EmployeeCode, item.ItemCode);

    const answer =
      `${person.PersonName} के पास ${item.ItemName} का pending issue ${pending} है।`;

    $("voiceResult").textContent = answer;
    speak(answer);
    return;
  }

  if (isStockQuestion && item) {
    const answer =
      `${item.ItemName} का Fresh Stock ${number(item.AvailableStock)} है।`;

    $("voiceResult").textContent = answer;
    speak(answer);
    return;
  }

  if (!person || !item) {
    const message = "कर्मचारी या सामग्री नहीं मिली। कृपया सही नाम या कोड बोलें।";
    $("voiceResult").textContent = message;
    speak(message);
    return;
  }

  const quantityMatch = normalized.match(/\b\d+(?:\.\d+)?\b/);

  if (!quantityMatch) {
    showToast("Quantity समझ नहीं आई।");
    return;
  }

  const quantity = Number(quantityMatch[0]);

  if (quantity <= 0) {
    showToast("Quantity शून्य से अधिक होनी चाहिए।");
    return;
  }

  if (!isIssue && !isReturn) {
    showToast("Issue या Return का आदेश स्पष्ट नहीं है।");
    return;
  }

  if (isReturn) {
    const matchingIssues = getPendingIssues().filter(t =>
      String(t.EmployeeCode) === String(person.EmployeeCode) &&
      String(t.ItemCode) === String(item.ItemCode)
    );

    if (!matchingIssues.length) {
      showToast("इस कर्मचारी के पास इस सामग्री का Pending Issue नहीं है।");
      return;
    }

    const options = matchingIssues.map(t => `
      <option value="${escapeAttribute(t.TxnID)}">
        ${escapeHTML(t.TxnID)} - Pending ${number(getOutstanding(t.TxnID))}
      </option>
    `).join("");

    $("voiceResult").innerHTML = `
      <div class="panel">
        <h2>Return की पुष्टि करें</h2>
        <p>कर्मचारी: ${escapeHTML(person.PersonName)}</p>
        <p>Material: ${escapeHTML(item.ItemName)}</p>
        <label>Original Issue</label>
        <select id="voiceReturnIssue">${options}</select>
        <label>Quantity</label>
        <input type="number" id="voiceReturnQty"
          min="0.0001" step="any" value="${quantity}">
        <button class="action-button" id="confirmVoiceReturn">
          Confirm Return
        </button>
      </div>
    `;

    $("confirmVoiceReturn").addEventListener("click", async () => {
      const issueTxnId = $("voiceReturnIssue").value;
      const qty = Number($("voiceReturnQty").value);

      if (qty <= 0 || qty > getOutstanding(issueTxnId)) {
        showToast("Return quantity गलत है।");
        return;
      }

      if (!confirm("क्या आप यह Return सेव करना चाहते हैं?")) return;

      try {
        await api("return", {
          issueTxnId,
          quantity: qty,
          notes: "Voice Agent entry"
        });

        showToast("Voice Return saved.");
        speak("Material Return सेव हो गया है।");
        await navigate("voice");

      } catch (error) {
        showToast(error.message);
      }
    });

    return;
  }

  const outstanding = employeeItemOutstanding(
    person.EmployeeCode,
    item.ItemCode
  );

  if (outstanding > 0 && state.role !== "ADMIN") {
    showToast("इस कर्मचारी के पास यह सामग्री पहले से Pending है।");
    return;
  }

  if (quantity > Number(item.AvailableStock || 0)) {
    showToast("पर्याप्त Fresh Stock उपलब्ध नहीं है।");
    return;
  }

  $("voiceResult").innerHTML = `
    <div class="panel">
      <h2>Issue आदेश की पुष्टि करें</h2>
      <p>कर्मचारी: <strong>${escapeHTML(person.PersonName)}</strong></p>
      <p>Employee Code: <strong>${escapeHTML(person.EmployeeCode)}</strong></p>
      <p>Material: <strong>${escapeHTML(item.ItemName)}</strong></p>
      <p>Quantity: <strong>${number(quantity)}</strong></p>

      ${outstanding > 0 && state.role === "ADMIN" ? `
        <div class="form-field">
          <label>Admin Override Password</label>
          <input type="password" id="voiceOverridePassword">
        </div>
        <div class="form-field">
          <label>Override Reason</label>
          <textarea id="voiceOverrideReason"></textarea>
        </div>
      ` : ""}

      <button class="action-button" id="confirmVoiceIssue">
        Confirm and Issue
      </button>
    </div>
  `;

  $("confirmVoiceIssue").addEventListener("click", async () => {
    if (!confirm("क्या आप यह Issue सेव करना चाहते हैं?")) return;

    try {
      await api("issue", {
        itemCode: item.ItemCode,
        employeeCode: person.EmployeeCode,
        quantity,
        notes: "Voice Agent entry",
        overridePassword: $("voiceOverridePassword")
          ? $("voiceOverridePassword").value : "",
        overrideReason: $("voiceOverrideReason")
          ? $("voiceOverrideReason").value : ""
      });

      showToast("Voice Issue saved.");
      speak("Material Issue सफलतापूर्वक सेव हो गया है।");
      await navigate("voice");

    } catch (error) {
      showToast(error.message);
      speak(error.message);
    }
  });
}

/* =========================================================
   QR / BARCODE SCANNER
   ========================================================= */

function scannerPanel(target) {
  return `
    <div class="panel scanner-panel">
      <h2>QR / Barcode Scanner</h2>
      <p>Material का QR Code या Barcode कैमरे से Scan करें।</p>

      <button class="secondary-button" id="startScanner">
        Start Scanner
      </button>

      <button class="secondary-button" id="stopScanner" hidden>
        Stop Scanner
      </button>

      <video id="scannerVideo" autoplay playsinline
        style="width:100%;max-width:450px;display:none"></video>

      <p id="scannerStatus"></p>
    </div>
  `;
}

function setupScanner(target) {
  if (!$("startScanner")) return;

  $("startScanner").addEventListener("click", () => startScanner(target));
  $("stopScanner").addEventListener("click", stopScanner);
}

async function startScanner(target) {
  if (!("BarcodeDetector" in window)) {
    showToast("इस browser में Barcode scanning उपलब्ध नहीं है।");
    return;
  }

  try {
    const formats = await BarcodeDetector.getSupportedFormats();

    const supported = formats.filter(f =>
      ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e"].includes(f)
    );

    const detector = new BarcodeDetector({ formats: supported });

    state.scannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" }
    });

    state.scannerActive = true;

    const video = $("scannerVideo");
    video.srcObject = state.scannerStream;
    video.style.display = "block";

    $("startScanner").hidden = true;
    $("stopScanner").hidden = false;
    $("scannerStatus").textContent = "Scanning...";

    await video.play();

    async function scanFrame() {
      if (!state.scannerActive) return;

      try {
        const results = await detector.detect(video);

        if (results.length) {
          const value = results[0].rawValue;

          stopScanner();
          handleScannedCode(value, target);
          return;
        }

      } catch (error) {
        console.warn("Barcode scan error:", error);
      }

      if (state.scannerActive) {
        requestAnimationFrame(scanFrame);
      }
    }

    scanFrame();

  } catch (error) {
    stopScanner();
    showToast("Camera permission or scanner error: " + error.message);
  }
}

function stopScanner() {
  state.scannerActive = false;

  if (state.scannerStream) {
    state.scannerStream.getTracks().forEach(track => track.stop());
    state.scannerStream = null;
  }

  const video = $("scannerVideo");

  if (video) {
    video.pause();
    video.srcObject = null;
    video.style.display = "none";
  }

  if ($("startScanner")) $("startScanner").hidden = false;
  if ($("stopScanner")) $("stopScanner").hidden = true;
}

function handleScannedCode(value, target) {
  const item = findItem(value);

  if (!item) {
    showToast("Scanned code does not match any Item Code.");
    return;
  }

  if (target === "issue") {
    $("issueItemSearch").value = item.ItemCode;
    updateOverrideVisibility();
  }

  if (target === "inward") {
    $("inwardItem").value = item.ItemCode;
  }

  showToast("Material found: " + item.ItemName);
}

/* =========================================================
   ADMIN SETTINGS
   ========================================================= */

function renderSettings() {
  if (state.role !== "ADMIN") {
    $("pageContent").innerHTML =
      '<div class="empty-state">Admin access required.</div>';
    return;
  }

  $("pageContent").innerHTML = `
    <div class="panel">
      <h2>Change Login Password</h2>

      <form id="passwordForm">
        <div class="form-grid">
          <div class="form-field">
            <label>Current Password</label>
            <input type="password" id="oldPassword" required>
          </div>

          <div class="form-field">
            <label>New Password</label>
            <input type="password" id="newPassword"
              minlength="10" required>
          </div>
        </div>

        <button class="action-button">Change Password</button>
      </form>
    </div>

    <div class="panel">
      <h2>Change Override Password</h2>

      <form id="overrideForm">
        <div class="form-grid">
          <div class="form-field">
            <label>Current Override Password</label>
            <input type="password" id="oldOverridePassword" required>
          </div>

          <div class="form-field">
            <label>New Override Password</label>
            <input type="password" id="newOverridePassword"
              minlength="10" required>
          </div>
        </div>

        <button class="action-button">Change Override Password</button>
      </form>
    </div>

    <div class="panel">
      <h2>Create User</h2>

      <form id="userForm">
        <div class="form-grid">
          <div class="form-field">
            <label>Username</label>
            <input id="newUsername" required>
          </div>

          <div class="form-field">
            <label>Password (minimum 10 characters)</label>
            <input type="password" id="newUserPassword"
              minlength="10" required>
          </div>

          <div class="form-field">
            <label>Role</label>
            <select id="newUserRole">
              <option value="USER">User</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>
        </div>

        <button class="action-button">Create User</button>
      </form>
    </div>

    <div class="panel">
      <h2>Database Backup</h2>
      <p>Create a copy of the Google Spreadsheet in Google Drive.</p>
      <button id="backupButton" class="action-button">
        Create Backup Now
      </button>
    </div>

    <div class="panel">
      <h2>Admin Correction</h2>
      <form id="correctionForm">
        <div class="form-grid">
          <div class="form-field">
            <label>Transaction ID</label>
            <input id="correctionTxn" required>
          </div>

          <div class="form-field">
            <label>Correction Reason</label>
            <input id="correctionReason" required>
          </div>

          <div class="form-field full-width">
            <label>Corrected Notes</label>
            <textarea id="correctionNotes"></textarea>
          </div>
        </div>

        <button class="action-button">Save Notes Correction</button>
      </form>
    </div>
  `;

  $("passwordForm").addEventListener("submit", async event => {
    event.preventDefault();

    try {
      await api("changePassword", {
        oldPassword: $("oldPassword").value,
        newPassword: $("newPassword").value
      });

      showToast("Login password changed.");
      $("passwordForm").reset();

    } catch (error) {
      showToast(error.message);
    }
  });

  $("overrideForm").addEventListener("submit", async event => {
    event.preventDefault();

    try {
      await api("changeOverridePassword", {
        oldPassword: $("oldOverridePassword").value,
        newPassword: $("newOverridePassword").value
      });

      showToast("Override password changed.");
      $("overrideForm").reset();

    } catch (error) {
      showToast(error.message);
    }
  });

  $("userForm").addEventListener("submit", async event => {
    event.preventDefault();

    try {
      await api("addUser", {
        username: $("newUsername").value,
        password: $("newUserPassword").value,
        role: $("newUserRole").value
      });

      showToast("User created.");
      $("userForm").reset();

    } catch (error) {
      showToast(error.message);
    }
  });

  $("backupButton").addEventListener("click", async () => {
    if (!confirm("Create a Google Drive backup now?")) return;

    try {
      const result = await api("createBackup");
      showToast(result.message);

    } catch (error) {
      showToast(error.message);
    }
  });

  $("correctionForm").addEventListener("submit", async event => {
    event.preventDefault();

    try {
      const result = await api("adminCorrection", {
        txnId: $("correctionTxn").value,
        reason: $("correctionReason").value,
        notes: $("correctionNotes").value
      });

      showToast(result.message);
      $("correctionForm").reset();

    } catch (error) {
      showToast(error.message);
    }
  });
}

/* =========================================================
   SEARCH HELPERS
   ========================================================= */

function itemDatalist() {
  return `
    <datalist id="itemList">
      ${state.items.map(i => `
        <option value="${escapeAttribute(i.ItemName)}">
          ${escapeHTML(i.ItemCode)}
        </option>
        <option value="${escapeAttribute(i.ItemCode)}">
          ${escapeHTML(i.ItemName)}
        </option>
      `).join("")}
    </datalist>
  `;
}

function peopleDatalist() {
  return `
    <datalist id="peopleList">
      ${state.people.map(p => `
        <option value="${escapeAttribute(p.PersonName)}">
          ${escapeHTML(p.EmployeeCode)}
        </option>
        <option value="${escapeAttribute(p.EmployeeCode)}">
          ${escapeHTML(p.PersonName)}
        </option>
      `).join("")}
    </datalist>
  `;
}

function findPerson(value) {
  const q = String(value || "").trim().toLowerCase();

  return state.people.find(p =>
    String(p.PersonName).toLowerCase() === q ||
    String(p.EmployeeCode).toLowerCase() === q ||
    String(p.PersonID).toLowerCase() === q
  );
}

function findItem(value) {
  const q = String(value || "").trim().toLowerCase();

  return state.items.find(i =>
    String(i.ItemName).toLowerCase() === q ||
    String(i.ItemCode).toLowerCase() === q
  );
}

function employeeItemOutstanding(employeeCode, itemCode) {
  return state.transactions
    .filter(t =>
      t.Type === "ISSUE" &&
      String(t.EmployeeCode) === String(employeeCode) &&
      String(t.ItemCode) === String(itemCode)
    )
    .reduce((sum, t) => sum + getOutstanding(t.TxnID), 0);
}

/* =========================================================
   UI HELPERS
   ========================================================= */

function statCard(label, value) {
  return `
    <div class="stat-card">
      <div class="stat-label">${escapeHTML(label)}</div>
      <div class="stat-value">${escapeHTML(value)}</div>
    </div>
  `;
}

function table(headers, rows) {
  if (!rows || !rows.length) {
    return '<div class="empty-state">No records found.</div>';
  }

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${headers.map(h => `<th>${escapeHTML(h)}</th>`).join("")}
          </tr>
        </thead>

        <tbody>
          ${rows.map(row => `
            <tr>
              ${row.map(cell => `
                <td>${cell == null ? "" : cell}</td>
              `).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function number(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 3
  });
}

function formatDate(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-IN");
}

function escapeHTML(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHTML(value);
}

function showToast(message) {
  const toast = $("toast");
  if (!toast) {
    alert(message);
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => toast.classList.remove("show"), 3500);
}

/* =========================================================
   CSV EXPORT
   ========================================================= */

function downloadCSV(rows) {
  if (!rows || !rows.length) {
    showToast("No report data to export.");
    return;
  }

  const headers = [
    "TxnID", "Timestamp", "Type", "ItemCode", "ItemName",
    "Quantity", "EmployeeCode", "PersonName", "Department",
    "Reference", "Notes", "EnteredBy", "ReturnCondition"
  ];

  const csv = [
    headers.join(","),
    ...rows.map(row =>
      headers.map(key => {
        const value = String(row[key] == null ? "" : row[key]);
        return '"' + value.replace(/"/g, '""') + '"';
      }).join(",")
    )
  ].join("\r\n");

  const blob = new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "Material_Report.csv";
  link.click();

  URL.revokeObjectURL(url);
}

/* =========================================================
   PWA INSTALL
   ========================================================= */

async function installApp() {
  if (!state.deferredInstall) {
    showToast("Install option is not available in this browser.");
    return;
  }

  state.deferredInstall.prompt();
  await state.deferredInstall.userChoice;

  state.deferredInstall = null;
  $("installButton").hidden = true;
}
