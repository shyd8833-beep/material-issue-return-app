
/************************************************************
 * MATERIAL ISSUE & RETURN APP
 * Frontend Version 1.0
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
  deferredInstall: null
};

const $ = (id) => document.getElementById(id);

const PAGE_INFO = {
  dashboard: ["Dashboard", "Material management overview"],
  issue: ["Material Issue", "Issue material to an employee"],
  inward: ["Material Inward", "Add material to stock"],
  return: ["Material Return", "Record material returns"],
  stock: ["Live Stock", "Current material availability"],
  history: ["Transaction History", "All material transactions"],
  people: ["People", "Manage employees"],
  items: ["Items", "Manage material list"],
  reports: ["Reports", "Transaction reports"],
  voice: ["Voice Agent", "Voice-assisted material entry"],
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
    button.addEventListener("click", () => {
      navigate(button.dataset.page);
    });
  });

  $("installButton").addEventListener("click", installApp);

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    state.deferredInstall = event;
    $("installButton").hidden = false;
  });

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
    const result = await api("login", {
      username,
      password
    });

    state.token = result.token;
    state.username = result.username;
    state.role = result.role;

    sessionStorage.setItem("material_session", JSON.stringify({
      token: state.token,
      username: state.username,
      role: state.role
    }));

    $("password").value = "";
    openApplication();

  } catch (error) {
    $("loginMessage").textContent = error.message;
  } finally {
    $("loginButton").disabled = false;
    $("loginButton").textContent = "Sign In";
  }
}

function logout() {
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

  if (state.role !== "ADMIN") {
    document.querySelector('[data-page="settings"]').hidden = true;
    document.querySelector('[data-page="people"]').hidden = true;
    document.querySelector('[data-page="items"]').hidden = true;
  }

  try {
    await refreshData();
    navigate("dashboard");
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
}

/* =========================================================
   NAVIGATION
   ========================================================= */

async function navigate(page) {
  if (!PAGE_INFO[page]) return;

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
      ${statCard("Available Stock", number(d.availableStock))}
      ${statCard("Active Issues", number(d.activeIssues))}
    </div>

    <div class="content-grid">
      <div class="panel">
        <h2>Low Stock Alerts</h2>
        ${d.lowStock.length ? `
          ${table(
            ["Item Code", "Item Name", "Available", "Minimum"],
            d.lowStock.map(x => [
              x.ItemCode,
              x.ItemName,
              number(x.AvailableStock),
              number(x.MinStock)
            ])
          )}
        ` : '<div class="empty-state">No low-stock alerts.</div>'}
      </div>

      <div class="panel">
        <h2>Today's Activity</h2>
        <div class="stat-value">${number(d.todayTransactions)}</div>
        <p>Transactions recorded today</p>
      </div>
    </div>

    <div class="panel">
      <h2>Current Stock Summary</h2>
      ${stockTable(d.stock || [])}
    </div>
  `;
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
            <label>Employee</label>
            <input list="peopleList" id="issueEmployee"
              placeholder="Search employee name or code" required>
            ${peopleDatalist()}
          </div>

          <div class="form-field">
            <label>Material</label>
            <select id="issueItem" required>
              ${itemOptions()}
            </select>
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
  `;

  $("issueForm").addEventListener("submit", submitIssue);

  $("issueEmployee").addEventListener("input", updateOverrideVisibility);
  $("issueItem").addEventListener("change", updateOverrideVisibility);
}

function updateOverrideVisibility() {
  const person = findPerson($("issueEmployee").value);
  const item = $("issueItem").value;

  if (!person || !item || state.role !== "ADMIN") {
    $("overrideFields").hidden = true;
    return;
  }

  const outstanding = employeeItemOutstanding(
    person.EmployeeCode,
    item
  );

  $("overrideFields").hidden = outstanding <= 0;
}

async function submitIssue(event) {
  event.preventDefault();

  const person = findPerson($("issueEmployee").value);

  if (!person) {
    showToast("Select a valid employee from the list.");
    return;
  }

  const itemCode = $("issueItem").value;
  const quantity = Number($("issueQuantity").value);

  const outstanding = employeeItemOutstanding(
    person.EmployeeCode,
    itemCode
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

  const item = state.items.find(x => x.ItemCode === itemCode);

  if (!item || quantity > Number(item.AvailableStock)) {
    showToast("Insufficient stock.");
    return;
  }

  if (!confirm(
    `Issue ${quantity} ${item.ItemName} to ${person.PersonName}?`
  )) return;

  try {
    await api("issue", {
      itemCode,
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
  `;

  $("inwardForm").addEventListener("submit", async event => {
    event.preventDefault();

    try {
      await api("inward", {
        itemCode: $("inwardItem").value,
        quantity: Number($("inwardQuantity").value),
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

  $("pageContent").innerHTML = `
    <div class="panel">
      <h2>Pending Material Returns</h2>

      ${pending.length ? `
        ${table(
          ["Employee", "Material", "Issued", "Pending", "Action"],
          pending.map(issue => [
            issue.PersonName,
            issue.ItemName,
            number(issue.Quantity),
            number(getOutstanding(issue.TxnID)),
            `<button class="secondary-button"
              onclick="selectReturn('${escapeAttribute(issue.TxnID)}')">
              Return
            </button>`
          ])
        )}
      ` : '<div class="empty-state">No pending returns.</div>'}
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
                  ${escapeHTML(t.PersonName)} — ${escapeHTML(t.ItemName)}
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
  `;

  $("returnForm").addEventListener("submit", async event => {
    event.preventDefault();

    const issueTxnId = $("returnIssue").value;
    const quantity = Number($("returnQuantity").value);
    const pendingQty = getOutstanding(issueTxnId);

    if (!issueTxnId || quantity > pendingQty) {
      showToast("Return quantity exceeds pending quantity.");
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

      showToast("Material return saved.");
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

/* =========================================================
   LIVE STOCK
   ========================================================= */

function renderStock() {
  $("pageContent").innerHTML = `
    <div class="panel">
      <h2>Live Material Stock</h2>
      <input class="search-input" id="stockSearch"
        placeholder="Search item code or name">

      <div id="stockTable">
        ${stockTable(state.items)}
      </div>
    </div>
  `;

  $("stockSearch").addEventListener("input", event => {
    const q = event.target.value.toLowerCase();

    const filtered = state.items.filter(item =>
      String(item.ItemCode).toLowerCase().includes(q) ||
      String(item.ItemName).toLowerCase().includes(q)
    );

    $("stockTable").innerHTML = stockTable(filtered);
  });
}

function stockTable(items) {
  return table(
    ["Item Code", "Material", "Unit", "Available", "Issued", "Minimum", "Status"],
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
        t.TxnID,
        t.Type,
        t.ItemCode,
        t.ItemName,
        t.EmployeeCode,
        t.PersonName,
        t.Department
      ].some(v => String(v || "").toLowerCase().includes(q))
    );

    $("historyTable").innerHTML = transactionTable(filtered);
  });
}

function transactionTable(rows) {
  return table(
    ["Date", "Type", "Item", "Quantity", "Employee", "Entered By", "Notes"],
    rows.map(t => [
      formatDate(t.Timestamp),
      t.Type,
      t.ItemName + " (" + t.ItemCode + ")",
      number(t.Quantity),
      t.PersonName || "-",
      t.EnteredBy,
      t.Notes || "-"
    ])
  );
}

/* =========================================================
   PEOPLE MANAGEMENT
   ========================================================= */

function renderPeople() {
  if (state.role !== "ADMIN") {
    $("pageContent").innerHTML = '<div class="empty-state">Admin access required.</div>';
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
          <button class="action-button">Save Employee</button>
        </div>
      </form>
    </div>

    <div class="panel">
      <h2>Employee List</h2>
      <input class="search-input" id="peopleSearch"
        placeholder="Search employee">

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
        [p.EmployeeCode, p.PersonName, p.Department]
          .some(v => String(v || "").toLowerCase().includes(q))
      )
    );
  });
}

function peopleTable(rows) {
  return table(
    ["Employee Code", "Name", "Department"],
    rows.map(p => [
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
  if (state.role !== "ADMIN") {
    $("pageContent").innerHTML = '<div class="empty-state">Admin access required.</div>';
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

        <div class="form-actions">
          <button class="action-button">Save Material</button>
        </div>
      </form>
    </div>

    <div class="panel">
      <h2>Material List</h2>
      <input class="search-input" id="itemSearch"
        placeholder="Search material">
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
            </select>
          </div>
          <div class="form-field">
            <label>Employee</label>
            <select id="reportEmployee">
              <option value="">All Employees</option>
              ${state.people.map(p => `
                <option value="${escapeAttribute(p.EmployeeCode)}">
                  ${escapeHTML(p.PersonName)}
                </option>
              `).join("")}
            </select>
          </div>
          <div class="form-field">
            <label>Material</label>
            <select id="reportItem">
              <option value="">All Materials</option>
              ${itemOptions()}
            </select>
          </div>
        </div>

        <div class="form-actions">
          <button class="action-button">Generate Report</button>
        </div>
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

  $("exportReport").addEventListener("click", () => {
    downloadCSV(state.reportRows || []);
  });

  $("printReport").addEventListener("click", () => window.print());
}

/* =========================================================
   VOICE AGENT
   ========================================================= */

function renderVoice() {
  $("pageContent").innerHTML = `
    <div class="voice-panel">
      <h2>Hindi Voice Agent</h2>
      <p>उदाहरण: "Rahul ko 2 Pen issue karo"</p>

      <button id="voiceButton" class="voice-button">🎙</button>

      <p id="voiceStatus">बोलने के लिए माइक्रोफोन दबाएँ।</p>

      <div class="form-field">
        <label>या अपना आदेश लिखें</label>
        <textarea id="voiceText"
          placeholder="Rahul ko 2 Pen issue karo"></textarea>
      </div>

      <div class="form-actions">
        <button class="action-button" id="voiceParse">
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

  recognition.start();
  $("voiceButton").classList.add("listening");
}

function parseVoice() {
  const text = $("voiceText").value.trim();

  if (!text) {
    showToast("पहले अपना आदेश बोलें या लिखें।");
    return;
  }

  const normalized = text.toLowerCase();

  const quantityMatch = normalized.match(/\b\d+(?:\.\d+)?\b/);

  if (!quantityMatch) {
    showToast("Quantity समझ नहीं आई। कृपया संख्या लिखें।");
    return;
  }

  const quantity = Number(quantityMatch[0]);

  const person = state.people.find(p =>
    normalized.includes(String(p.PersonName).toLowerCase()) ||
    normalized.includes(String(p.EmployeeCode).toLowerCase())
  );

  const item = state.items.find(i =>
    normalized.includes(String(i.ItemName).toLowerCase()) ||
    normalized.includes(String(i.ItemCode).toLowerCase())
  );

  if (!person || !item) {
    $("voiceResult").innerHTML =
      '<div class="empty-state">Employee या material नहीं मिला। कृपया सही नाम लिखें।</div>';
    return;
  }

  const isReturn = /return|वापस|लौटा|return karo/.test(normalized);
  const isIssue = /issue|दे दो|जारी|निकाल|भेज/.test(normalized);

  if (isReturn) {
    $("voiceResult").innerHTML =
      `<div class="panel">Return command पहचाना गया। कृपया Material Return पेज पर जाकर मूल Issue चुनें।</div>`;
    return;
  }

  if (!isIssue) {
    showToast("Issue आदेश स्पष्ट नहीं है।");
    return;
  }

  const outstanding = employeeItemOutstanding(
    person.EmployeeCode,
    item.ItemCode
  );

  if (outstanding > 0) {
    $("voiceResult").innerHTML =
      '<div class="empty-state">इस व्यक्ति के पास यह material पहले से pending है। नियम के अनुसार दोबारा issue नहीं किया जा सकता।</div>';
    return;
  }

  if (quantity > Number(item.AvailableStock || 0)) {
    showToast("पर्याप्त stock उपलब्ध नहीं है।");
    return;
  }

  const result = $("voiceResult");

  result.innerHTML = `
    <div class="panel">
      <h2>आदेश की पुष्टि करें</h2>
      <p>कर्मचारी: <strong>${escapeHTML(person.PersonName)}</strong></p>
      <p>Material: <strong>${escapeHTML(item.ItemName)}</strong></p>
      <p>Quantity: <strong>${number(quantity)}</strong></p>
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
        notes: "Voice Agent entry"
      });

      showToast("Voice order issued successfully.");
      $("voiceText").value = "";
      $("voiceResult").innerHTML = "";
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
  if (state.role !== "ADMIN") {
    $("pageContent").innerHTML = '<div class="empty-state">Admin access required.</div>';
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
            <input type="password" id="newPassword" minlength="10" required>
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
            <input type="password" id="newOverridePassword" minlength="10" required>
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
            <input type="password" id="newUserPassword" minlength="10" required>
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
      <button id="backupButton" class="action-button">Create Backup Now</button>
    </div>

    <div class="panel">
      <h2>Admin Correction</h2>
      <p>Current Backend supports correction of transaction Notes only.</p>
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
   HELPERS
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
        ${escapeHTML(item.ItemName)} (${escapeHTML(item.ItemCode)})
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

function findPerson(value) {
  const q = String(value || "").trim().toLowerCase();

  return state.people.find(p =>
    String(p.PersonName).toLowerCase() === q ||
    String(p.EmployeeCode).toLowerCase() === q
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

function table(headers, rows) {
  if (!rows.length) {
    return '<div class="empty-state">No records found.</div>';
  }

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>${headers.map(h => `<th>${escapeHTML(h)}</th>`).join("")}</tr>
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

  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
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
    "EnteredBy"
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
