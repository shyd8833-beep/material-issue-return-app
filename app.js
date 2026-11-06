
/************************************************************
 * MATERIAL ISSUE & RETURN MANAGEMENT APP
 * Frontend Version 2.0.0
 * API: Cloudflare Worker + Google Apps Script
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
  scanner: null,
  scannerStream: null,
  toastTimer: null
};

const $ = id => document.getElementById(id);

const PAGE_INFO = {
  dashboard: ["Dashboard", "Material management overview"],
  issue: ["Material Issue", "Issue material to an employee"],
  inward: ["Material Inward", "Add material to stock"],
  return: ["Material Return", "Record and classify material returns"],
  stock: ["Live Stock", "Current material availability"],
  history: ["Transaction History", "All material transactions"],
  people: ["People", "Manage employees"],
  items: ["Items", "Manage material list"],
  reports: ["Reports", "Transaction reports"],
  voice: ["Voice Agent", "Voice-assisted material entry"],
  settings: ["Admin Settings", "Account and administration"]
};

const isAdmin = () =>
  String(state.role || "").toUpperCase() === "ADMIN";


/* =========================================================
   STARTUP
   ========================================================= */

document.addEventListener("DOMContentLoaded", init);

function init() {
  const requiredIds = [
    "connectionStatus",
    "loginForm",
    "logoutButton",
    "installButton",
    "loginScreen",
    "mainScreen",
    "pageContent",
    "toast"
  ];

  const missing = requiredIds.filter(id => !$(id));

  if (missing.length) {
    console.error("Missing HTML elements:", missing);
    return;
  }

  $("loginForm").addEventListener("submit", login);
  $("logoutButton").addEventListener("click", logout);
  $("installButton").addEventListener("click", installApp);

  document.querySelectorAll(".nav-button").forEach(button => {
    button.addEventListener("click", () => {
      navigate(button.dataset.page);
    });
  });

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    state.deferredInstall = event;
    $("installButton").hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    state.deferredInstall = null;
    $("installButton").hidden = true;
    showToast("App installed successfully.");
  });

  testConnection();

  const saved = sessionStorage.getItem("material_session");

  if (saved) {
    try {
      const data = JSON.parse(saved);

      if (data.token) {
        state.token = data.token;
        state.username = data.username || "";
        state.role = data.role || "";

        openApplication();
      }
    } catch (error) {
      sessionStorage.removeItem("material_session");
    }
  }

  registerServiceWorker();
}


/* =========================================================
   API CONNECTION
   ========================================================= */

async function api(action, data = {}) {
  if (!action) {
    throw new Error("API action is missing.");
  }

  const payload = {
    action,
    token: state.token,
    ...data
  };

  let response;

  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8"
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    throw new Error(
      "Backend connection failed. Internet aur Worker URL check karein."
    );
  }

  let result;

  try {
    result = await response.json();
  } catch (error) {
    throw new Error("Backend ne valid JSON response nahi diya.");
  }

  if (!response.ok) {
    throw new Error(
      result.message || "Server request failed."
    );
  }

  if (!result || result.success !== true) {
    throw new Error(
      result && result.message
        ? result.message
        : "Request failed."
    );
  }

  return result;
}

async function testConnection() {
  try {
    const response = await fetch(API_URL);
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error("Backend unavailable.");
    }

    $("connectionStatus").textContent = "Connected";
    $("connectionStatus").classList.add("connected");

  } catch (error) {
    $("connectionStatus").textContent = "Connection error";
    $("connectionStatus").classList.remove("connected");
    console.error(error);
  }
}


/* =========================================================
   LOGIN / LOGOUT
   ========================================================= */

async function login(event) {
  event.preventDefault();

  const username = $("username").value.trim();
  const password = $("password").value;

  if (!username || !password) {
    showToast("Username aur password enter karein.");
    return;
  }

  $("loginButton").disabled = true;
  $("loginButton").textContent = "Signing in...";
  $("loginMessage").textContent = "";

  try {
    const result = await api("login", {
      username,
      password
    });

    if (!result.token) {
      throw new Error("Login token receive nahi hua.");
    }

    state.token = result.token;
    state.username = result.username || username;
    state.role = result.role || "";

    sessionStorage.setItem(
      "material_session",
      JSON.stringify({
        token: state.token,
        username: state.username,
        role: state.role
      })
    );

    $("password").value = "";

    await openApplication();

  } catch (error) {
    $("loginMessage").textContent = error.message;

  } finally {
    $("loginButton").disabled = false;
    $("loginButton").textContent = "Sign In";
  }
}

async function logout() {
  try {
    if (state.token) {
      await api("logout");
    }
  } catch (error) {
    console.warn("Logout API:", error.message);
  }

  state.token = "";
  state.username = "";
  state.role = "";
  state.items = [];
  state.people = [];
  state.transactions = [];
  state.dashboard = null;

  sessionStorage.removeItem("material_session");

  $("mainScreen").hidden = true;
  $("loginScreen").hidden = false;
  $("logoutButton").hidden = true;

  $("loginMessage").textContent = "";
  $("username").value = "";
  $("password").value = "";

  document.querySelectorAll(".nav-button").forEach(button => {
    button.hidden = false;
  });
}

async function openApplication() {
  $("loginScreen").hidden = true;
  $("mainScreen").hidden = false;
  $("logoutButton").hidden = false;

  $("loggedInUser").textContent = state.username;
  $("loggedInRole").textContent = state.role;
  $("userAvatar").textContent =
    (state.username || "U").charAt(0).toUpperCase();

  applyRolePermissions();

  try {
    await refreshData();
    await navigate("dashboard");

  } catch (error) {
    showToast(error.message);
    await logout();
  }
}

function applyRolePermissions() {
  const adminPages = ["settings", "people", "items"];

  document.querySelectorAll(".nav-button").forEach(button => {
    const page = button.dataset.page;

    button.hidden =
      adminPages.includes(page) && !isAdmin();
  });
}


/* =========================================================
   DATA REFRESH
   ========================================================= */

async function refreshData() {
  const [items, people, transactions, dashboard] =
    await Promise.all([
      api("listItems"),
      api("listPeople"),
      api("listTransactions"),
      api("dashboard")
    ]);

  state.items = Array.isArray(items.items)
    ? items.items
    : [];

  state.people = Array.isArray(people.people)
    ? people.people
    : [];

  state.transactions = Array.isArray(transactions.transactions)
    ? transactions.transactions
    : [];

  state.dashboard = dashboard;
}


/* =========================================================
   NAVIGATION
   ========================================================= */

async function navigate(page) {
  if (!PAGE_INFO[page]) return;

  if (
    ["settings", "people", "items"].includes(page) &&
    !isAdmin()
  ) {
    showToast("Admin access required.");
    return;
  }

  stopScanner();

  state.page = page;

  document.querySelectorAll(".nav-button").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.page === page
    );
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
  const d = state.dashboard || {};

  const lowStock = Array.isArray(d.lowStock)
    ? d.lowStock
    : [];

  const stock = Array.isArray(d.stock)
    ? d.stock
    : state.items;

  $("pageContent").innerHTML = `
    <div class="stats-grid">
      ${statCard("Total Items", d.totalItems || 0)}
      ${statCard("Total People", d.totalPeople || 0)}
      ${statCard("Available Stock", number(d.availableStock))}
      ${statCard("Active Issues", number(d.activeIssues))}
    </div>

    <div class="content-grid">

      <div class="panel">
        <h2>Low Stock Alerts</h2>

        ${
          lowStock.length
            ? table(
                ["Item Code", "Material", "Available", "Minimum"],
                lowStock.map(item => [
                  item.ItemCode,
                  item.ItemName,
                  number(item.AvailableStock),
                  number(item.MinStock)
                ])
              )
            : '<div class="empty-state">No low-stock alerts.</div>'
        }
      </div>

      <div class="panel">
        <h2>Today's Activity</h2>
        <div class="stat-value">
          ${number(d.todayTransactions)}
        </div>
        <p>Transactions recorded today</p>
      </div>

    </div>

    <div class="panel">
      <h2>Current Stock Summary</h2>
      ${stockTable(stock)}
    </div>

    <div class="panel">
      <h2>Pending Reusable Material</h2>
      ${reusableSummary()}
    </div>
  `;
}

function reusableSummary() {
  const pending = state.transactions.filter(t =>
    t.Type === "RETURN" &&
    String(t.ReturnCategory || "").toUpperCase() === "REUSABLE"
  );

  if (!pending.length) {
    return '<div class="empty-state">No reusable material pending.</div>';
  }

  return table(
    ["Material", "Quantity", "Return Date"],
    pending.map(t => [
      t.ItemName,
      number(t.Quantity),
      formatDate(t.Timestamp)
    ])
  );
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

            <input
              list="peopleList"
              id="issueEmployee"
              placeholder="Search employee name or code"
              autocomplete="off"
              required
            >

            ${peopleDatalist()}

            <small id="selectedPersonInfo"></small>
          </div>

          <div class="form-field">
            <label>Material</label>

            <select id="issueItem" required>
              ${itemOptions()}
            </select>
          </div>

          <div class="form-field">
            <label>Quantity</label>

            <input
              type="number"
              id="issueQuantity"
              min="0.0001"
              step="any"
              required
            >
          </div>

          <div class="form-field">
            <label>Reference</label>
            <input id="issueReference">
          </div>

          <div class="form-field full-width">
            <label>Notes</label>
            <textarea id="issueNotes"></textarea>
          </div>

        </div>

        <div id="overrideFields" hidden class="panel">
          <h2>Admin Override</h2>

          <p>
            This employee already has this material pending return.
          </p>

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
          <button class="action-button" type="submit">
            Issue Material
          </button>

          <button
            class="secondary-button"
            type="button"
            id="scanIssueItem"
          >
            Scan QR / Barcode
          </button>
        </div>

      </form>

      <div id="issueScanner" hidden></div>
      <p id="issueMessage" class="message"></p>

    </div>
  `;

  $("issueForm").addEventListener("submit", submitIssue);

  $("issueEmployee").addEventListener(
    "input",
    updateSelectedPerson
  );

  $("issueItem").addEventListener(
    "change",
    updateOverrideVisibility
  );

  $("scanIssueItem").addEventListener(
    "click",
    () => startScanner("issueItem")
  );
}

function updateSelectedPerson() {
  const value = $("issueEmployee").value;
  const matches = findPeople(value);

  const info = $("selectedPersonInfo");

  if (matches.length === 1) {
    const person = matches[0];

    info.textContent =
      "Person ID: " + person.PersonID +
      " | Employee Code: " + person.EmployeeCode;

  } else if (matches.length > 1) {
    info.textContent =
      "Multiple employees found. Employee Code se exact employee select karein.";

  } else {
    info.textContent = "";
  }

  updateOverrideVisibility();
}

function findPeople(value) {
  const q = String(value || "").trim().toLowerCase();

  if (!q) return [];

  return state.people.filter(p =>
    String(p.PersonName || "").trim().toLowerCase() === q ||
    String(p.EmployeeCode || "").trim().toLowerCase() === q
  );
}

function findPerson(value) {
  const matches = findPeople(value);

  return matches.length === 1
    ? matches[0]
    : null;
}

function updateOverrideVisibility() {
  const person = findPerson($("issueEmployee").value);
  const itemCode = $("issueItem").value;

  if (!person || !itemCode || !isAdmin()) {
    $("overrideFields").hidden = true;
    return;
  }

  const outstanding = employeeItemOutstanding(
    person,
    itemCode
  );

  $("overrideFields").hidden = outstanding <= 0;
}

async function submitIssue(event) {
  event.preventDefault();

  const person = findPerson($("issueEmployee").value);

  if (!person) {
    showToast(
      "Employee ko exact Name ya Employee Code se select karein."
    );
    return;
  }

  const itemCode = $("issueItem").value;
  const quantity = Number($("issueQuantity").value);

  if (!itemCode || !Number.isFinite(quantity) || quantity <= 0) {
    showToast("Valid material aur quantity select karein.");
    return;
  }

  const item = state.items.find(x =>
    String(x.ItemCode) === String(itemCode)
  );

  if (!item) {
    showToast("Material nahi mila.");
    return;
  }

  const available = Number(item.AvailableStock || 0);

  if (quantity > available) {
    showToast("Insufficient stock. Available: " + available);
    return;
  }

  const outstanding = employeeItemOutstanding(
    person,
    itemCode
  );

  const override = outstanding > 0;

  if (override && !isAdmin()) {
    showToast(
      "Is employee ke paas ye item pehle se pending hai."
    );
    return;
  }

  let overridePassword = "";
  let overrideReason = "";

  if (override) {
    overridePassword = $("overridePassword").value;
    overrideReason = $("overrideReason").value.trim();

    if (!overridePassword || !overrideReason) {
      showToast(
        "Override password aur reason dono zaroori hain."
      );
      return;
    }
  }

  if (!confirm(
    `Issue ${quantity} ${item.ItemName} to ${person.PersonName} (${person.EmployeeCode})?`
  )) {
    return;
  }

  try {
    await api("issue", {
      itemCode,
      employeeCode: person.EmployeeCode,
      personId: person.PersonID,
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

      <h2>Material Inward</h2>

      <form id="inwardForm">

        <div class="form-grid">

          <div class="form-field">
            <label>Material</label>

            <select id="inwardItem" required>
              ${itemOptions()}
            </select>
          </div>

          <div class="form-field">
            <label>Quantity</label>

            <input
              type="number"
              id="inwardQuantity"
              min="0.0001"
              step="any"
              required
            >
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
          <button class="action-button" type="submit">
            Save Inward
          </button>
        </div>

      </form>

    </div>
  `;

  $("inwardForm").addEventListener("submit", async event => {
    event.preventDefault();

    const quantity = Number($("inwardQuantity").value);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      showToast("Valid quantity enter karein.");
      return;
    }

    try {
      await api("inward", {
        itemCode: $("inwardItem").value,
        quantity,
        reference: $("inwardReference").value,
        notes: $("inwardNotes").value
      });

      showToast("Material inward saved.");

      await navigate("inward");

    } catch (error) {
      showToast(error.message);
    }
  });
}


/* =========================================================
   MATERIAL RETURN
   ========================================================= */

function getPendingIssues() {
  return state.transactions.filter(t =>
    t.Type === "ISSUE" &&
    getOutstanding(t.TxnID) > 0
  );
}

function getOutstanding(txnId) {
  const issue = state.transactions.find(t =>
    t.TxnID === txnId &&
    t.Type === "ISSUE"
  );

  if (!issue) return 0;

  const returned = state.transactions
    .filter(t =>
      t.Type === "RETURN" &&
      String(t.RelatedTxnID) === String(txnId)
    )
    .reduce(
      (sum, t) => sum + Number(t.Quantity || 0),
      0
    );

  return Math.max(
    0,
    Number(issue.Quantity || 0) - returned
  );
}

function renderReturn() {
  const pending = getPendingIssues();

  const unclassified = state.transactions.filter(t =>
    t.Type === "RETURN" &&
    !["REUSABLE", "DAMAGED"].includes(
      String(t.ReturnCategory || "").toUpperCase()
    )
  );

  $("pageContent").innerHTML = `

    <div class="panel">
      <h2>Pending Material Returns</h2>

      ${
        pending.length
          ? table(
              [
                "Employee",
                "Employee Code",
                "Material",
                "Issued",
                "Pending",
                "Action"
              ],
              pending.map(issue => [
                issue.PersonName,
                issue.EmployeeCode,
                issue.ItemName,
                number(issue.Quantity),
                number(getOutstanding(issue.TxnID)),
                `<button
                  type="button"
                  class="secondary-button"
                  data-return-id="${escapeAttribute(issue.TxnID)}"
                >Return</button>`
              ])
            )
          : '<div class="empty-state">No pending returns.</div>'
      }
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
                  ${escapeHTML(t.PersonName)}
                  (${escapeHTML(t.EmployeeCode)})
                  — ${escapeHTML(t.ItemName)}
                  — Pending ${number(getOutstanding(t.TxnID))}
                </option>
              `).join("")}

            </select>
          </div>

          <div class="form-field">
            <label>Return Quantity</label>

            <input
              type="number"
              id="returnQuantity"
              min="0.0001"
              step="any"
              required
            >
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
          <button class="action-button">
            Save Return
          </button>
        </div>

      </form>
    </div>

    ${
      isAdmin()
        ? `
          <div class="panel">
            <h2>Returned Material Classification</h2>

            ${
              unclassified.length
                ? table(
                    [
                      "Return ID",
                      "Material",
                      "Quantity",
                      "Date",
                      "Classification"
                    ],
                    unclassified.map(t => [
                      t.TxnID,
                      t.ItemName,
                      number(t.Quantity),
                      formatDate(t.Timestamp),
                      `
                        <select
                          class="return-category"
                          data-txn-id="${escapeAttribute(t.TxnID)}"
                        >
                          <option value="">Select</option>
                          <option value="REUSABLE">REUSABLE</option>
                          <option value="DAMAGED">DAMAGED</option>
                        </select>
                        <button
                          type="button"
                          class="secondary-button classify-button"
                          data-txn-id="${escapeAttribute(t.TxnID)}"
                        >
                          Save
                        </button>
                      `
                    ])
                  )
                : '<div class="empty-state">All returns are classified.</div>'
            }

          </div>

          <div class="panel">
            <h2>Transfer Reusable Stock</h2>

            <p>
              Only Admin can transfer classified reusable material
              into Fresh Stock.
            </p>

            <form id="reusableTransferForm">

              <div class="form-grid">

                <div class="form-field">
                  <label>Material</label>
                  <select id="reusableItem" required>
                    ${itemOptions()}
                  </select>
                </div>

                <div class="form-field">
                  <label>Transfer Quantity</label>
                  <input
                    type="number"
                    id="reusableQuantity"
                    min="0.0001"
                    step="any"
                    required
                  >
                </div>

              </div>

              <button class="action-button">
                Transfer to Fresh Stock
              </button>

            </form>
          </div>
        `
        : ""
    }

  `;

  $("returnForm").addEventListener("submit", submitReturn);

  document.querySelectorAll("[data-return-id]").forEach(button => {
    button.addEventListener("click", () => {
      $("returnIssue").value = button.dataset.returnId;
      $("returnQuantity").focus();
    });
  });

  if (isAdmin()) {
    document.querySelectorAll(".classify-button").forEach(button => {
      button.addEventListener("click", () => {
        classifyReturn(button.dataset.txnId);
      });
    });

    $("reusableTransferForm").addEventListener(
      "submit",
      transferReusableStock
    );
  }
}

async function submitReturn(event) {
  event.preventDefault();

  const issueTxnId = $("returnIssue").value;
  const quantity = Number($("returnQuantity").value);

  const pendingQty = getOutstanding(issueTxnId);

  if (!issueTxnId || !Number.isFinite(quantity) || quantity <= 0) {
    showToast("Original issue aur valid quantity select karein.");
    return;
  }

  if (quantity > pendingQty) {
    showToast("Return quantity pending quantity se zyada hai.");
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

    showToast(
      "Return saved. Fresh Stock mein material automatically add nahi hua."
    );

    await navigate("return");

  } catch (error) {
    showToast(error.message);
  }
}

async function classifyReturn(txnId) {
  const select = document.querySelector(
    `.return-category[data-txn-id="${CSS.escape(txnId)}"]`
  );

  const category = select ? select.value : "";

  if (!["REUSABLE", "DAMAGED"].includes(category)) {
    showToast("REUSABLE ya DAMAGED select karein.");
    return;
  }

  if (!confirm("Save return classification as " + category + "?")) {
    return;
  }

  try {
    await api("classifyReturn", {
      txnId,
      category
    });

    showToast("Return classification saved.");

    await navigate("return");

  } catch (error) {
    showToast(error.message);
  }
}

async function transferReusableStock(event) {
  event.preventDefault();

  const itemCode = $("reusableItem").value;
  const quantity = Number($("reusableQuantity").value);

  if (!itemCode || !Number.isFinite(quantity) || quantity <= 0) {
    showToast("Valid material aur quantity select karein.");
    return;
  }

  if (!confirm(
    "Transfer reusable material to Fresh Stock?"
  )) {
    return;
  }

  try {
    await api("transferReusable", {
      itemCode,
      quantity
    });

    showToast("Reusable material transferred to Fresh Stock.");

    await navigate("return");

  } catch (error) {
    showToast(error.message);
  }
}


/* =========================================================
   LIVE STOCK
   ========================================================= */

function renderStock() {
  $("pageContent").innerHTML = `
    <div class="panel">

      <h2>Live Material Stock</h2>

      <input
        class="search-input"
        id="stockSearch"
        placeholder="Search item code or name"
      >

      <div id="stockTable">
        ${stockTable(state.items)}
      </div>

    </div>
  `;

  $("stockSearch").addEventListener("input", event => {
    const q = event.target.value.toLowerCase();

    const filtered = state.items.filter(item =>
      [
        item.ItemCode,
        item.ItemName,
        item.Unit
      ].some(value =>
        String(value || "").toLowerCase().includes(q)
      )
    );

    $("stockTable").innerHTML = stockTable(filtered);
  });
}

function stockTable(items) {
  return table(
    [
      "Item Code",
      "Material",
      "Unit",
      "Fresh Stock",
      "Issued",
      "Minimum",
      "Status"
    ],
    items.map(item => {
      const available = Number(item.AvailableStock || 0);
      const minimum = Number(item.MinStock || 0);

      return [
        item.ItemCode,
        item.ItemName,
        item.Unit,
        number(available),
        number(item.IssuedStock),
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

      <input
        class="search-input"
        id="historySearch"
        placeholder="Search employee, item, code or transaction"
      >

      <div id="historyTable">
        ${transactionTable(state.transactions)}
      </div>

    </div>
  `;

  $("historySearch").addEventListener("input", event => {
    const q = event.target.value.toLowerCase();

    const filtered = state.transactions.filter(t =>
      [
        t.TxnID,
        t.Type,
        t.ItemCode,
        t.ItemName,
        t.EmployeeCode,
        t.PersonName,
        t.Department,
        t.Notes
      ].some(value =>
        String(value || "").toLowerCase().includes(q)
      )
    );

    $("historyTable").innerHTML =
      transactionTable(filtered);
  });
}

function transactionTable(rows) {
  return table(
    [
      "Date",
      "Type",
      "Item",
      "Quantity",
      "Employee",
      "Employee Code",
      "Entered By",
      "Notes"
    ],
    rows.map(t => [
      formatDate(t.Timestamp),
      t.Type,
      String(t.ItemName || "") +
        " (" + String(t.ItemCode || "") + ")",
      number(t.Quantity),
      t.PersonName || "-",
      t.EmployeeCode || "-",
      t.EnteredBy || "-",
      t.Notes || "-"
    ])
  );
}


/* =========================================================
   PEOPLE MANAGEMENT
   ========================================================= */

function renderPeople() {
  if (!isAdmin()) {
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

        <div class="form-actions">
          <button class="action-button">
            Save Employee
          </button>
        </div>

      </form>

    </div>

    <div class="panel">

      <h2>Employee List</h2>

      <input
        class="search-input"
        id="peopleSearch"
        placeholder="Search employee"
      >

      <div id="peopleTable">
        ${peopleTable(state.people)}
      </div>

    </div>
  `;

  $("personForm").addEventListener("submit", async event => {
    event.preventDefault();

    try {
      await api("savePerson", {
        employeeCode: $("personCode").value.trim(),
        personName: $("personName").value.trim(),
        department: $("personDepartment").value.trim()
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
        [
          p.EmployeeCode,
          p.PersonName,
          p.Department,
          p.PersonID
        ].some(value =>
          String(value || "").toLowerCase().includes(q)
        )
      )
    );
  });
}

function peopleTable(rows) {
  return table(
    [
      "Person ID",
      "Employee Code",
      "Name",
      "Department"
    ],
    rows.map(p => [
      p.PersonID || "-",
      p.EmployeeCode,
      p.PersonName,
      p.Department || "-"
    ])
  );
}


/* =========================================================
   ITEM MANAGEMENT
   ========================================================= */

function renderItems() {
  if (!isAdmin()) {
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
            <input
              type="number"
              id="openingStock"
              min="0"
              step="any"
              value="0"
              required
            >
          </div>

          <div class="form-field">
            <label>Minimum Stock</label>
            <input
              type="number"
              id="minStock"
              min="0"
              step="any"
              value="0"
              required
            >
          </div>

        </div>

        <div class="form-actions">
          <button class="action-button">
            Save Material
          </button>
        </div>

      </form>

    </div>

    <div class="panel">

      <h2>Material List</h2>

      <input
        class="search-input"
        id="itemSearch"
        placeholder="Search material"
      >

      <div id="itemsTable">
        ${stockTable(state.items)}
      </div>

    </div>
  `;

  $("itemForm").addEventListener("submit", async event => {
    event.preventDefault();

    try {
      await api("saveItem", {
        itemCode: $("itemCode").value.trim(),
        itemName: $("itemName").value.trim(),
        unit: $("itemUnit").value.trim(),
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
        [
          item.ItemCode,
          item.ItemName
        ].some(value =>
          String(value || "").toLowerCase().includes(q)
        )
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
                  ${escapeHTML(p.PersonName)}
                  (${escapeHTML(p.EmployeeCode)})
                </option>
              `).join("")}

            </select>
          </div>

          <div class="form-field">
            <label>Material</label>

            <select id="reportItem">
              ${itemOptions()}
            </select>
          </div>

        </div>

        <div class="form-actions">
          <button class="action-button">
            Generate Report
          </button>
        </div>

      </form>

    </div>

    <div class="panel">

      <div class="form-actions">

        <button
          class="secondary-button"
          id="exportReport"
          type="button"
        >
          Export CSV
        </button>

        <button
          class="secondary-button"
          id="printReport"
          type="button"
        >
          Print
        </button>

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

      $("reportTable").innerHTML =
        transactionTable(state.reportRows);

    } catch (error) {
      showToast(error.message);
    }
  });

  $("exportReport").addEventListener("click", () => {
    downloadCSV(state.reportRows || []);
  });

  $("printReport").addEventListener("click", () => {
    window.print();
  });
}


/* =========================================================
   VOICE AGENT
   ========================================================= */

function renderVoice() {
  $("pageContent").innerHTML = `
    <div class="voice-panel">

      <h2>Hindi Voice Agent</h2>

      <p>
        उदाहरण: Rahul ko 2 Pen issue karo
      </p>

      <button
        type="button"
        id="voiceButton"
        class="voice-button"
      >
        🎙
      </button>

      <p id="voiceStatus">
        बोलने के लिए माइक्रोफोन दबाएँ।
      </p>

      <div class="form-field">

        <label>या अपना आदेश लिखें</label>

        <textarea
          id="voiceText"
          placeholder="Rahul ko 2 Pen issue karo"
        ></textarea>

      </div>

      <div class="form-actions">

        <button
          type="button"
          class="action-button"
          id="voiceParse"
        >
          आदेश समझें
        </button>

      </div>

      <div id="voiceResult"></div>

    </div>
  `;

  $("voiceButton").addEventListener("click", startVoice);
  $("voiceParse").addEventListener("click", parseVoice);
}

function startVoice() {
  const Recognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (!Recognition) {
    showToast(
      "Voice recognition supported nahi hai. Command type karein."
    );
    return;
  }

  const recognition = new Recognition();

  recognition.lang = "hi-IN";
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  $("voiceStatus").textContent = "सुन रहा हूँ...";
  $("voiceResult").textContent = "";

  recognition.onresult = event => {
    $("voiceText").value =
      event.results[0][0].transcript;

    $("voiceStatus").textContent = "आदेश मिल गया।";

    parseVoice();
  };

  recognition.onerror = event => {
    $("voiceStatus").textContent =
      "Microphone error: " + event.error;
  };

  recognition.onend = () => {
    $("voiceButton").classList.remove("listening");
  };

  try {
    recognition.start();
    $("voiceButton").classList.add("listening");

  } catch (error) {
    $("voiceStatus").textContent =
      "Microphone start nahi hua. Dobara try karein.";
  }
}

function parseHindiNumber(text) {
  const digit = String(text).match(/\d+(?:\.\d+)?/);

  if (digit) return Number(digit[0]);

  const words = {
    "एक": 1,
    "दो": 2,
    "तीन": 3,
    "चार": 4,
    "पांच": 5,
    "पाँच": 5,
    "छह": 6,
    "छः": 6,
    "सात": 7,
    "आठ": 8,
    "नौ": 9,
    "दस": 10,
    "ग्यारह": 11,
    "बारह": 12,
    "तेरह": 13,
    "चौदह": 14,
    "पंद्रह": 15,
    "पन्द्रह": 15,
    "सोलह": 16,
    "सत्रह": 17,
    "अठारह": 18,
    "उन्नीस": 19,
    "बीस": 20
  };

  const parts = String(text).split(/\s+/);

  for (const part of parts) {
    if (Object.prototype.hasOwnProperty.call(words, part)) {
      return words[part];
    }
  }

  return 0;
}

function parseVoice() {
  const text = $("voiceText").value.trim();

  if (!text) {
    showToast("पहले अपना आदेश बोलें या लिखें।");
    return;
  }

  const normalized = text.toLowerCase();

  const quantity = parseHindiNumber(normalized);

  if (!(quantity > 0)) {
    showToast("Quantity samajh nahi aayi. Number dobara boliye.");
    return;
  }

  const personMatches = state.people.filter(p => {
    const name = String(p.PersonName || "").toLowerCase();
    const code = String(p.EmployeeCode || "").toLowerCase();

    return (
      (name.length > 1 && normalized.includes(name)) ||
      (code.length > 1 && normalized.includes(code))
    );
  });

  const itemMatches = state.items.filter(item => {
    const name = String(item.ItemName || "").toLowerCase();
    const code = String(item.ItemCode || "").toLowerCase();

    return (
      (name.length > 1 && normalized.includes(name)) ||
      (code.length > 1 && normalized.includes(code))
    );
  });

  if (personMatches.length !== 1) {
    $("voiceResult").textContent =
      personMatches.length > 1
        ? "एक से ज्यादा Employee मिले। कृपया Employee Code बोलें।"
        : "Employee नहीं मिला। सही नाम या Employee Code बोलें।";

    return;
  }

  if (itemMatches.length !== 1) {
    $("voiceResult").textContent =
      itemMatches.length > 1
        ? "एक से ज्यादा Material मिले। कृपया Item Code बोलें।"
        : "Material नहीं मिला। सही Material Name या Code बोलें।";

    return;
  }

  const person = personMatches[0];
  const item = itemMatches[0];

  const isReturn =
    /return|वापस|लौटा|जमा करो|जमा कर/.test(normalized);

  const isIssue =
    /issue|दे दो|जारी|निकाल|भेज|इश्यू/.test(normalized);

  if (isReturn) {
    $("voiceResult").textContent =
      "Return command पहचाना गया। Material Return पेज पर जाकर Original Issue चुनें।";
    return;
  }

  if (!isIssue) {
    showToast("Issue command स्पष्ट नहीं है।");
    return;
  }

  const outstanding = employeeItemOutstanding(
    person,
    item.ItemCode
  );

  if (outstanding > 0 && !isAdmin()) {
    $("voiceResult").textContent =
      "इस Employee के पास यह Material पहले से Pending है।";
    return;
  }

  if (quantity > Number(item.AvailableStock || 0)) {
    showToast("पर्याप्त Stock उपलब्ध नहीं है।");
    return;
  }

  $("voiceResult").innerHTML = `
    <div class="panel">

      <h2>आदेश की पुष्टि करें</h2>

      <p>
        कर्मचारी:
        <strong>${escapeHTML(person.PersonName)}</strong>
      </p>

      <p>
        Employee Code:
        <strong>${escapeHTML(person.EmployeeCode)}</strong>
      </p>

      <p>
        Material:
        <strong>${escapeHTML(item.ItemName)}</strong>
      </p>

      <p>
        Quantity:
        <strong>${number(quantity)}</strong>
      </p>

      ${
        outstanding > 0 && isAdmin()
          ? `
            <p>Admin Override Password</p>
            <input type="password" id="voiceOverridePassword">

            <p>Override Reason</p>
            <textarea id="voiceOverrideReason"></textarea>
          `
          : ""
      }

      <button
        type="button"
        class="action-button"
        id="confirmVoiceIssue"
      >
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
        personId: person.PersonID,
        quantity,
        notes: "Voice Agent entry",
        overridePassword:
          $("voiceOverridePassword")?.value || "",
        overrideReason:
          $("voiceOverrideReason")?.value || ""
      });

      showToast("Voice order issued successfully.");

      $("voiceText").value = "";
      $("voiceResult").textContent = "";

      await refreshData();

    } catch (error) {
      showToast(error.message);
    }
  });
}


/* =========================================================
   ADMIN SETTINGS
   ========================================================= */

function renderSettings() {
  if (!isAdmin()) {
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
            <input
              type="password"
              id="newPassword"
              minlength="10"
              required
            >
          </div>

        </div>

        <button class="action-button">
          Change Password
        </button>

      </form>

    </div>


    <div class="panel">

      <h2>Change Override Password</h2>

      <form id="overrideForm">

        <div class="form-grid">

          <div class="form-field">
            <label>Current Override Password</label>
            <input
              type="password"
              id="oldOverridePassword"
              required
            >
          </div>

          <div class="form-field">
            <label>New Override Password</label>
            <input
              type="password"
              id="newOverridePassword"
              minlength="10"
              required
            >
          </div>

        </div>

        <button class="action-button">
          Change Override Password
        </button>

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
            <label>Password</label>
            <input
              type="password"
              id="newUserPassword"
              minlength="10"
              required
            >
          </div>

          <div class="form-field">
            <label>Role</label>

            <select id="newUserRole">
              <option value="USER">User</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>

        </div>

        <button class="action-button">
          Create User
        </button>

      </form>

    </div>


    <div class="panel">

      <h2>Database Backup</h2>

      <p>Create a copy of the Google Spreadsheet in Google Drive.</p>

      <button
        id="backupButton"
        class="action-button"
        type="button"
      >
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

        <button class="action-button">
          Save Notes Correction
        </button>

      </form>

    </div>

  `;

  $("passwordForm").addEventListener("submit", async event => {
    event.preventDefault();

    const newPassword = $("newPassword").value;

    if (newPassword.length < 10) {
      showToast("New password minimum 10 characters ka hona chahiye.");
      return;
    }

    try {
      await api("changePassword", {
        oldPassword: $("oldPassword").value,
        newPassword
      });

      showToast("Login password changed.");
      $("passwordForm").reset();

    } catch (error) {
      showToast(error.message);
    }
  });

  $("overrideForm").addEventListener("submit", async event => {
    event.preventDefault();

    const newPassword = $("newOverridePassword").value;

    if (newPassword.length < 10) {
      showToast("Override password minimum 10 characters ka hona chahiye.");
      return;
    }

    try {
      await api("changeOverridePassword", {
        oldPassword: $("oldOverridePassword").value,
        newPassword
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
        username: $("newUsername").value.trim(),
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

      showToast(result.message || "Backup created.");

    } catch (error) {
      showToast(error.message);
    }
  });

  $("correctionForm").addEventListener("submit", async event => {
    event.preventDefault();

    try {
      const result = await api("adminCorrection", {
        txnId: $("correctionTxn").value.trim(),
        reason: $("correctionReason").value.trim(),
        notes: $("correctionNotes").value
      });

      showToast(result.message || "Correction saved.");

      $("correctionForm").reset();

    } catch (error) {
      showToast(error.message);
    }
  });
}


/* =========================================================
   QR / BARCODE SCANNER
   ========================================================= */

async function startScanner(targetId) {
  const target = $(targetId);

  if (!target) return;

  if (!("BarcodeDetector" in window)) {
    showToast(
      "Is browser mein Barcode Scanner supported nahi hai. Item Code manually enter karein."
    );
    return;
  }

  const detector = new BarcodeDetector({
    formats: [
      "qr_code",
      "code_128",
      "code_39",
      "ean_13",
      "ean_8",
      "upc_a",
      "upc_e"
    ]
  });

  const scannerBox = $("issueScanner");

  if (!scannerBox) return;

  scannerBox.hidden = false;

  scannerBox.innerHTML = `
    <div class="panel">

      <h3>Scan QR / Barcode</h3>

      <video
        id="scannerVideo"
        autoplay
        muted
        playsinline
        style="width:100%;max-width:450px"
      ></video>

      <p id="scannerStatus">Camera starting...</p>

      <button
        type="button"
        class="secondary-button"
        id="stopScanner"
      >
        Stop Scanner
      </button>

    </div>
  `;

  $("stopScanner").addEventListener("click", stopScanner);

  try {
    state.scannerStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" }
      },
      audio: false
    });

    const video = $("scannerVideo");

    video.srcObject = state.scannerStream;

    await video.play();

    state.scanner = {
      detector,
      video,
      target
    };

    scanFrame();

  } catch (error) {
    stopScanner();

    showToast(
      "Camera permission nahi mili. Browser settings check karein."
    );
  }
}

async function scanFrame() {
  if (!state.scanner) return;

  try {
    const results = await state.scanner.detector.detect(
      state.scanner.video
    );

    if (results.length) {
      const code = String(results[0].rawValue || "").trim();

      const item = state.items.find(i =>
        String(i.ItemCode).toLowerCase() === code.toLowerCase()
      );

      if (item) {
        state.scanner.target.value = item.ItemCode;

        showToast("Material scanned: " + item.ItemName);

        stopScanner();
        updateOverrideVisibility();

        return;
      }

      $("scannerStatus").textContent =
        "Scanned code material list mein nahi mila.";
    }

  } catch (error) {
    console.warn("Scanner error:", error);
  }

  if (state.scanner) {
    requestAnimationFrame(scanFrame);
  }
}

function stopScanner() {
  if (state.scannerStream) {
    state.scannerStream.getTracks().forEach(track => {
      track.stop();
    });
  }

  state.scannerStream = null;
  state.scanner = null;

  const scannerBox = $("issueScanner");

  if (scannerBox) {
    scannerBox.hidden = true;
    scannerBox.innerHTML = "";
  }
}


/* =========================================================
   COMMON HELPERS
   ========================================================= */

function statCard(label, value) {
  return `
    <div class="stat-card">
      <div class="stat-label">${escapeHTML(label)}</div>
      <div class="stat-value">${escapeHTML(value)}</div>
    </div>
  `;
}

function itemOptions() {
  return `
    <option value="">Select material</option>

    ${state.items.map(item => `
      <option value="${escapeAttribute(item.ItemCode)}">
        ${escapeHTML(item.ItemName)}
        (${escapeHTML(item.ItemCode)})
        — Available: ${number(item.AvailableStock)}
      </option>
    `).join("")}
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

function employeeItemOutstanding(person, itemCode) {
  if (!person) return 0;

  return state.transactions
    .filter(t => {
      const samePerson =
        person.PersonID &&
        t.PersonID &&
        String(t.PersonID) === String(person.PersonID);

      const fallbackPerson =
        !t.PersonID &&
        String(t.EmployeeCode) === String(person.EmployeeCode);

      return (
        t.Type === "ISSUE" &&
        (samePerson || fallbackPerson) &&
        String(t.ItemCode) === String(itemCode)
      );
    })
    .reduce(
      (sum, t) => sum + getOutstanding(t.TxnID),
      0
    );
}

function table(headers, rows) {
  if (!rows.length) {
    return '<div class="empty-state">No records found.</div>';
  }

  return `
    <div class="table-wrap">

      <table>

        <thead>
          <tr>
            ${headers.map(h =>
              `<th>${escapeHTML(h)}</th>`
            ).join("")}
          </tr>
        </thead>

        <tbody>

          ${rows.map(row => `
            <tr>
              ${row.map(cell => `
                <td>${safeCell(cell)}</td>
              `).join("")}
            </tr>
          `).join("")}

        </tbody>

      </table>

    </div>
  `;
}

function safeCell(value) {
  if (value == null) return "";

  const text = String(value);

  if (text.startsWith("<span class=")) {
    return text;
  }

  if (
    text.startsWith("<button") ||
    text.startsWith("<select")
  ) {
    return text;
  }

  return escapeHTML(text);
}

function number(value) {
  const n = Number(value || 0);

  if (!Number.isFinite(n)) return "0";

  return n.toLocaleString("en-IN", {
    maximumFractionDigits: 3
  });
}

function formatDate(value) {
  if (!value) return "-";

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

  if (!toast) return;

  toast.textContent = String(message || "");

  toast.classList.add("show");

  if (state.toastTimer) {
    clearTimeout(state.toastTimer);
  }

  state.toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 3500);
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
    "TxnID",
    "Timestamp",
    "Type",
    "ItemCode",
    "ItemName",
    "Quantity",
    "EmployeeCode",
    "PersonName",
    "Department",
    "Reference",
    "Notes",
    "EnteredBy",
    "ReturnCategory"
  ];

  function csvValue(value) {
    let text = String(value == null ? "" : value);

    // Prevent CSV formula injection.
    if (/^[\s]*[=+\-@]/.test(text)) {
      text = "'" + text;
    }

    return '"' + text.replace(/"/g, '""') + '"';
  }

  const csv = [
    headers.map(csvValue).join(","),

    ...rows.map(row =>
      headers.map(key =>
        csvValue(row[key])
      ).join(",")
    )

  ].join("\r\n");

  const blob = new Blob(
    ["\uFEFF" + csv],
    { type: "text/csv;charset=utf-8;" }
  );

  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");

  link.href = url;
  link.download = "Material_Report.csv";

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


/* =========================================================
   PWA SERVICE WORKER
   ========================================================= */

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  try {
    await navigator.serviceWorker.register("./service-worker.js");
    console.log("Service Worker registered.");

  } catch (error) {
    console.warn("Service Worker registration failed:", error);
  }
}

async function installApp() {
  if (!state.deferredInstall) {
    showToast(
      "Install option abhi available nahi hai. Browser menu se Install App try karein."
    );
    return;
  }

  try {
    await state.deferredInstall.prompt();

    await state.deferredInstall.userChoice;

  } catch (error) {
    console.warn("Install prompt:", error);

  } finally {
    state.deferredInstall = null;
    $("installButton").hidden = true;
  }
}
