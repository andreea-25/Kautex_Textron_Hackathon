/* ==========================================================
   DIGITAL ENGINEERING PLANNING DASHBOARD - LOGIC ENGINE
   FastAPI integration, Matrix Grid Renderer, and Local AI Chat
   ========================================================== */

// Global Fetch Interceptor for Authentication Headers
const originalFetch = window.fetch;
window.fetch = async function (url, options = {}) {
    if (!options.headers) {
        options.headers = {};
    }
    const token = localStorage.getItem("token");
    if (token && !url.includes("/api/auth/login")) {
        options.headers["Authorization"] = `Bearer ${token}`;
    }
    if (options.body && typeof options.body === "string" && !options.headers["Content-Type"]) {
        options.headers["Content-Type"] = "application/json";
    }
    
    const response = await originalFetch(url, options);
    if (response.status === 401 && !url.includes("/api/auth/login")) {
        // Unauthorized or expired session, force logout
        localStorage.removeItem("token");
        localStorage.removeItem("role");
        localStorage.removeItem("username");
        document.body.classList.remove("authenticated");
        window.location.reload();
        throw new Error("Session expired or invalid. Redirecting to sign in.");
    }
    return response;
};

document.addEventListener("DOMContentLoaded", () => {
    // State management variables
    let activeScenario = null;
    let scenarios = [];
    let employees = [];
    let topics = [];
    let allocations = [];
    let dashboardData = null;
    
    let activeRole = "admin"; // admin or user
    let activeSection = "matrix-section";
    let activeDashTab = "tab-executive";
    
    // Filters state
    const filters = {
        location: "",
        team: "",
        department: "",
        category: ""
    };

    // Management Panel CRUD states
    let empSearch = "";
    let empLocFilter = "";
    let empSortField = "name";
    let empSortOrder = 1;

    let topicSearch = "";
    let topicCatFilter = "";
    let topicSortField = "name";
    let topicSortOrder = 1;

    // Chart.js instances
    let locationChart = null;
    let categoryChart = null;
    let presLocationChart = null;

    // Presentation Deck: custom slides appended from other tabs (e.g. Simulation compare)
    let customSlides = []; // { id, html }
    let customSlideCounter = 0;
    let pendingSlideReportA = null;
    let pendingSlideReportB = null;

    // DOM Elements
    const scenarioSelect = document.getElementById("scenario-select");
    const formLogin = document.getElementById("form-login");
    const btnLogout = document.getElementById("btn-logout");
    const userDisplayName = document.getElementById("user-display-name");
    const loginOverlay = document.getElementById("login-overlay");
    const loginErrorAlert = document.getElementById("login-error-alert");
    
    const navItems = document.querySelectorAll(".nav-item");
    const mainSections = document.querySelectorAll(".main-section");
    
    const filterLocation = document.getElementById("filter-location");
    const filterTeam = document.getElementById("filter-team");
    const filterDept = document.getElementById("filter-dept");
    const filterCategory = document.getElementById("filter-category");
    const btnResetFilters = document.getElementById("btn-reset-filters");

    // Modal forms
    const formEmployee = document.getElementById("form-employee");
    const formTopic = document.getElementById("form-topic");
    const formAllocation = document.getElementById("form-allocation");
    const formCreateScenario = document.getElementById("form-create-scenario");
    const formCloneScenario = document.getElementById("form-clone-scenario");

    // AI chat drawer elements
    const btnToggleAI = document.getElementById("btn-toggle-ai");
    const btnCloseAI = document.getElementById("btn-close-ai");
    const aiDrawer = document.getElementById("ai-drawer");
    const aiChatBody = document.getElementById("ai-chat-body");
    const aiChatInput = document.getElementById("ai-chat-input");
    const btnSendAI = document.getElementById("btn-send-ai");

    // ==========================================
    // 1. INITIALIZATION & DATA SYNC
    // ==========================================
    
    async function init() {
        setupEventListeners();

        // Check session
        const token = localStorage.getItem("token");
        const role = localStorage.getItem("role");
        const username = localStorage.getItem("username");

        if (token && role && username) {
            activeRole = role;
            document.body.classList.add("authenticated");
            userDisplayName.innerHTML = `<i class="fa-solid fa-user-circle" style="color: var(--primary-color);"></i> ${username}`;
            await fetchScenarios();
            await fetchActiveScenario();
            await refreshAllData();
        } else {
            document.body.classList.remove("authenticated");
        }
    }

    function logout() {
        localStorage.removeItem("token");
        localStorage.removeItem("role");
        localStorage.removeItem("username");
        document.body.classList.remove("authenticated");
        
        // Reset local variables
        scenarios = [];
        employees = [];
        topics = [];
        allocations = [];
        dashboardData = null;
        
        // Clear login form fields
        if (formLogin) {
            formLogin.reset();
        }
        window.location.reload();
    }

    async function fetchScenarios() {
        try {
            const response = await fetch("/api/scenarios");
            scenarios = await response.json();
            populateScenarioDropdown();
        } catch (error) {
            console.error("Error fetching scenarios:", error);
        }
    }

    async function fetchActiveScenario() {
        try {
            const response = await fetch("/api/scenarios/active");
            activeScenario = await response.json();
            scenarioSelect.value = activeScenario.id;
            document.getElementById("pres-scenario-name").innerText = activeScenario.name;
        } catch (error) {
            console.error("Error fetching active scenario:", error);
        }
    }

    async function refreshAllData() {
        showLoader();
        try {
            // Parallel fetches
            const [empRes, topRes, allocRes, reportRes] = await Promise.all([
                fetch("/api/employees"),
                fetch("/api/topics"),
                fetch("/api/allocations"),
                fetch("/api/reports/dashboard")
            ]);
            
            employees = await empRes.json();
            topics = await topRes.json();
            allocations = await allocRes.json();
            dashboardData = await reportRes.json();
            
            updateFilterDropdowns();
            renderAllocationMatrix();
            renderDashboards();
            renderPresentationDeck();
            renderCRUDTables();
            await fetchAIPredictions();
        } catch (error) {
            console.error("Error refreshing planning data:", error);
        } finally {
            hideLoader();
        }
    }

    // Loader helper (for UI status updates)
    function showLoader() {
        // Simple opacity fade
        document.querySelector(".app-main").style.opacity = "0.7";
    }

    function hideLoader() {
        document.querySelector(".app-main").style.opacity = "1";
    }

    // ==========================================
    // 2. INTERACTIVE RESOURCE MATRIX RENDER
    // ==========================================
    
    function renderAllocationMatrix() {
        const container = document.getElementById("allocation-matrix-container");
        container.innerHTML = "";
        
        // 1. Apply Filters to local variables
        const filteredEmployees = employees.filter(emp => {
            if (filters.location && emp.location !== filters.location) return false;
            if (filters.team && emp.team !== filters.team) return false;
            if (filters.department && emp.department !== filters.department) return false;
            return true;
        });

        const filteredTopics = topics.filter(topic => {
            if (filters.category && topic.category !== filters.category) return false;
            return true;
        });

        if (filteredEmployees.length === 0 && filteredTopics.length === 0) {
            container.innerHTML = "<div class='empty-state-message'>No matches found for active filters. Add employees or topics.</div>";
            return;
        }

        // Map allocation list to map for quick O(1) checks
        const allocMap = {};
        allocations.forEach(a => {
            allocMap[`${a.employee_id}_${a.topic_id}`] = a;
        });

        // Compute employee total allocations in advance
        const empAllocSums = {};
        filteredEmployees.forEach(emp => {
            empAllocSums[emp.id] = 0.0;
            filteredTopics.forEach(topic => {
                const key = `${emp.id}_${topic.id}`;
                if (allocMap[key]) {
                    empAllocSums[emp.id] += allocMap[key].percentage;
                }
            });
        });

        // Compute topic totals: staff cost, internal additional, external cost, recovery, and net totals
        const topicStaffCosts = {};
        filteredTopics.forEach(t => {
            topicStaffCosts[t.id] = 0.0;
            filteredEmployees.forEach(emp => {
                const key = `${emp.id}_${t.id}`;
                const pct = allocMap[key] ? allocMap[key].percentage : 0.0;
                if (pct > 0.0) {
                    topicStaffCosts[t.id] += emp.available_hours * emp.hourly_rate * (pct / 100.0);
                }
            });
        });

        // Create table elements
        const table = document.createElement("table");
        table.className = "matrix-table";

        // --- HEADERS ---
        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");

        // Metadata headers
        const thEmp = document.createElement("th");
        thEmp.className = "sticky-col";
        thEmp.innerText = "Employee";
        headerRow.appendChild(thEmp);

        const thTeam = document.createElement("th");
        thTeam.innerText = "Team";
        headerRow.appendChild(thTeam);

        const thLoc = document.createElement("th");
        thLoc.innerText = "Location";
        headerRow.appendChild(thLoc);

        const thHours = document.createElement("th");
        thHours.innerText = "Hours/Yr";
        headerRow.appendChild(thHours);

        const thRate = document.createElement("th");
        thRate.innerText = "Rate ($)";
        headerRow.appendChild(thRate);

        // Topic column headers
        filteredTopics.forEach(topic => {
            const thTopic = document.createElement("th");
            thTopic.innerHTML = `${topic.name}<br><small style='font-weight:normal;color:#9ca3af;'>${topic.category}</small>`;
            headerRow.appendChild(thTopic);
        });

        // Total Column Header
        const thTotal = document.createElement("th");
        thTotal.innerText = "Total Util %";
        headerRow.appendChild(thTotal);

        thead.appendChild(headerRow);
        table.appendChild(thead);

        // --- BODY ROWS (EMPLOYEES) ---
        const tbody = document.createElement("tbody");
        
        filteredEmployees.forEach(emp => {
            const tr = document.createElement("tr");

            // Meta cells
            const tdName = document.createElement("td");
            tdName.className = "sticky-col";
            tdName.innerText = emp.name;
            tr.appendChild(tdName);

            const tdTeam = document.createElement("td");
            tdTeam.innerText = emp.team;
            tr.appendChild(tdTeam);

            const tdLoc = document.createElement("td");
            tdLoc.innerText = emp.location;
            tr.appendChild(tdLoc);

            const tdHours = document.createElement("td");
            tdHours.innerText = emp.available_hours.toLocaleString();
            tr.appendChild(tdHours);

            const tdRate = document.createElement("td");
            tdRate.innerText = `$${emp.hourly_rate.toFixed(2)}`;
            tr.appendChild(tdRate);

            // Topic cells (Matrix percentage cells)
            filteredTopics.forEach(topic => {
                const tdCell = document.createElement("td");
                const key = `${emp.id}_${topic.id}`;
                const allocVal = allocMap[key] ? allocMap[key].percentage : 0.0;
                const comment = allocMap[key] ? allocMap[key].comment : "";

                const span = document.createElement("span");
                span.className = "matrix-cell-pct";
                span.innerText = allocVal > 0 ? `${allocVal}%` : "-";
                
                // Event cell edit handlers
                if (activeRole === "admin") {
                    tdCell.addEventListener("dblclick", () => {
                        openAllocationModal(emp.id, emp.name, topic.id, topic.name, allocVal, comment);
                    });
                }
                tdCell.appendChild(span);

                if (comment) {
                    const icon = document.createElement("i");
                    icon.className = "fa-solid fa-comment-dots matrix-comment-indicator";
                    icon.title = comment;
                    tdCell.appendChild(icon);
                }

                tr.appendChild(tdCell);
            });

            // Employee total cell
            const tdTotalVal = document.createElement("td");
            const utilVal = empAllocSums[emp.id];
            tdTotalVal.innerText = `${utilVal.toFixed(1)}%`;
            
            // Highlight overloaded employees
            if (utilVal > 100.0) {
                tdTotalVal.className = "cell-danger";
            } else if (utilVal > 0.0) {
                tdTotalVal.className = "cell-normal";
            } else {
                tdTotalVal.className = "cell-warning";
            }
            tr.appendChild(tdTotalVal);

            tbody.appendChild(tr);
        });

        // --- BOTTOM COSTS ROWS (Aggregated Topic Costs) ---
        
        // 1. Employee Internal Cost Row
        const trEmpCost = document.createElement("tr");
        trEmpCost.className = "matrix-cost-row";
        
        const tdECLabel = document.createElement("td");
        tdECLabel.className = "sticky-col matrix-cost-title";
        tdECLabel.innerText = "Employee Cost";
        trEmpCost.appendChild(tdECLabel);
        
        // Empty cells for other meta columns
        for(let i=0; i<4; i++) trEmpCost.appendChild(document.createElement("td"));
        
        filteredTopics.forEach(t => {
            const tdVal = document.createElement("td");
            tdVal.innerText = `$${topicStaffCosts[t.id].toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            trEmpCost.appendChild(tdVal);
        });
        trEmpCost.appendChild(document.createElement("td")); // Total cell empty
        tbody.appendChild(trEmpCost);

        // 2. Additional Internal Costs Row
        const trIntCost = document.createElement("tr");
        trIntCost.className = "matrix-cost-row";
        
        const tdICLabel = document.createElement("td");
        tdICLabel.className = "sticky-col matrix-cost-title";
        tdICLabel.innerText = "Additional Internal Cost";
        trIntCost.appendChild(tdICLabel);
        for(let i=0; i<4; i++) trIntCost.appendChild(document.createElement("td"));
        
        filteredTopics.forEach(t => {
            const tdVal = document.createElement("td");
            const addIntCost = t.additional_costs.filter(c => c.cost_type === "internal").reduce((acc, curr) => acc + curr.amount, 0);
            tdVal.innerText = addIntCost > 0 ? `$${addIntCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : "-";
            trIntCost.appendChild(tdVal);
        });
        trIntCost.appendChild(document.createElement("td"));
        tbody.appendChild(trIntCost);

        // 3. External Costs Row
        const trExtCost = document.createElement("tr");
        trExtCost.className = "matrix-cost-row";
        
        const tdEXCLabel = document.createElement("td");
        tdEXCLabel.className = "sticky-col matrix-cost-title";
        tdEXCLabel.innerText = "External Cost";
        trExtCost.appendChild(tdEXCLabel);
        for(let i=0; i<4; i++) trExtCost.appendChild(document.createElement("td"));
        
        filteredTopics.forEach(t => {
            const tdVal = document.createElement("td");
            const extCost = t.additional_costs.filter(c => c.cost_type === "external").reduce((acc, curr) => acc + curr.amount, 0);
            tdVal.innerText = extCost > 0 ? `$${extCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : "-";
            trExtCost.appendChild(tdVal);
        });
        trExtCost.appendChild(document.createElement("td"));
        tbody.appendChild(trExtCost);

        // 4. Cost Recovery Row
        const trRecovery = document.createElement("tr");
        trRecovery.className = "matrix-cost-row";
        
        const tdRecLabel = document.createElement("td");
        tdRecLabel.className = "sticky-col matrix-cost-title text-green";
        tdRecLabel.innerText = "Recovery";
        trRecovery.appendChild(tdRecLabel);
        for(let i=0; i<4; i++) trRecovery.appendChild(document.createElement("td"));
        
        filteredTopics.forEach(t => {
            const tdVal = document.createElement("td");
            tdVal.innerText = t.recovery > 0 ? `-$${t.recovery.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : "-";
            tdVal.className = "text-green";
            trRecovery.appendChild(tdVal);
        });
        trRecovery.appendChild(document.createElement("td"));
        tbody.appendChild(trRecovery);

        // 5. Total Topic Costs Row
        const trTopicTotal = document.createElement("tr");
        trTopicTotal.className = "matrix-cost-row";
        trTopicTotal.style.fontWeight = "bold";
        
        const tdTTL = document.createElement("td");
        tdTTL.className = "sticky-col matrix-cost-title text-blue";
        tdTTL.innerText = "Total Topic Cost";
        trTopicTotal.appendChild(tdTTL);
        for(let i=0; i<4; i++) trTopicTotal.appendChild(document.createElement("td"));
        
        filteredTopics.forEach(t => {
            const tdVal = document.createElement("td");
            const empCost = topicStaffCosts[t.id];
            const addInt = t.additional_costs.filter(c => c.cost_type === "internal").reduce((acc, curr) => acc + curr.amount, 0);
            const ext = t.additional_costs.filter(c => c.cost_type === "external").reduce((acc, curr) => acc + curr.amount, 0);
            const total = empCost + addInt + ext - t.recovery;
            
            tdVal.innerText = `$${total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            tdVal.className = "text-blue";
            trTopicTotal.appendChild(tdVal);
        });
        trTopicTotal.appendChild(document.createElement("td"));
        tbody.appendChild(trTopicTotal);

        table.appendChild(tbody);
        container.appendChild(table);
    }

    // ==========================================
    // 3. KPI DASHBOARD RENDER & CHARTS
    // ==========================================
    
    function renderDashboards() {
        if (!dashboardData) return;

        // EXECUTIVE SUMMARY KPIs
        document.getElementById("kpi-headcount").innerText = dashboardData.total_headcount;
        document.getElementById("kpi-internal-cost").innerText = `$${dashboardData.total_internal_employee_cost.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
        document.getElementById("kpi-add-cost").innerText = `$${dashboardData.total_additional_internal_cost.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
        document.getElementById("kpi-external-cost").innerText = `$${dashboardData.total_external_cost.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
        document.getElementById("kpi-recovery").innerText = `-$${dashboardData.total_recovery_cost.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
        document.getElementById("kpi-net-cost").innerText = `$${dashboardData.total_annual_planning_cost.toLocaleString(undefined, {maximumFractionDigits: 0})}`;

        // Render charts
        renderLocationChart();
        renderCategoryChart();

        // Populate breakdowns selectors
        populateDashboardSelects();
        renderTopicDashboard();
        renderTeamDashboard();
        renderEmployeeDashboard();
    }

    function renderLocationChart() {
        const ctx = document.getElementById("chart-location").getContext("2d");
        
        if (locationChart) locationChart.destroy();
        
        const labels = Object.keys(dashboardData.cost_by_location);
        const data = Object.values(dashboardData.cost_by_location);
        
        if (labels.length === 0) return;

        locationChart = new Chart(ctx, {
            type: "pie",
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"],
                    borderWidth: 1,
                    borderColor: "rgba(255, 255, 255, 0.1)"
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: "right",
                        labels: { color: "#f3f4f6", font: { family: "Outfit" } }
                    }
                }
            }
        });
    }

    function renderCategoryChart() {
        const ctx = document.getElementById("chart-category").getContext("2d");
        
        if (categoryChart) categoryChart.destroy();
        
        const labels = Object.keys(dashboardData.cost_by_category);
        const data = Object.values(dashboardData.cost_by_category);

        if (labels.length === 0) return;

        categoryChart = new Chart(ctx, {
            type: "bar",
            data: {
                labels: labels,
                datasets: [{
                    label: "Budget ($)",
                    data: data,
                    backgroundColor: "rgba(59, 130, 246, 0.75)",
                    borderColor: "#3b82f6",
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: "#9ca3af", font: { family: "Outfit" } }, grid: { display: false } },
                    y: { ticks: { color: "#9ca3af", font: { family: "Outfit" } }, grid: { color: "rgba(255,255,255,0.05)" } }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }

    function populateDashboardSelects() {
        // Topics Dropdown
        const topicSelect = document.getElementById("select-dash-topic");
        const prevTopic = topicSelect.value;
        topicSelect.innerHTML = "";
        topics.forEach(t => {
            const opt = document.createElement("option");
            opt.value = t.id;
            opt.innerText = t.name;
            topicSelect.appendChild(opt);
        });
        if (prevTopic && topics.some(t => t.id == prevTopic)) {
            topicSelect.value = prevTopic;
        }

        // Teams Dropdown
        const teamSelect = document.getElementById("select-dash-team");
        const prevTeam = teamSelect.value;
        teamSelect.innerHTML = "";
        const teamsSet = new Set(employees.map(e => e.team));
        teamsSet.forEach(team => {
            const opt = document.createElement("option");
            opt.value = team;
            opt.innerText = team;
            teamSelect.appendChild(opt);
        });
        if (prevTeam && teamsSet.has(prevTeam)) {
            teamSelect.value = prevTeam;
        }

        // Employees Dropdown
        const empSelect = document.getElementById("select-dash-employee");
        const prevEmp = empSelect.value;
        empSelect.innerHTML = "";
        employees.forEach(e => {
            const opt = document.createElement("option");
            opt.value = e.id;
            opt.innerText = e.name;
            empSelect.appendChild(opt);
        });
        if (prevEmp && employees.some(e => e.id == prevEmp)) {
            empSelect.value = prevEmp;
        }
    }

    function renderTopicDashboard() {
        const topicId = document.getElementById("select-dash-topic").value;
        const detailsContainer = document.getElementById("topic-dash-details");
        detailsContainer.innerHTML = "";
        
        if (!topicId || !dashboardData) return;
        
        const summary = dashboardData.topic_summaries.find(t => t.id == topicId);
        if (!summary) return;

        detailsContainer.innerHTML = `
            <div class="detail-grid">
                <div class="detail-card">
                    <h4>About Project</h4>
                    <p><strong>Category:</strong> ${summary.category}</p>
                    <p><strong>Topic Area:</strong> ${summary.area || "General"}</p>
                    <p style="margin-top:8px;"><strong>Description:</strong> ${summary.description || "N/A"}</p>
                </div>
                <div class="detail-card">
                    <h4>Justification & Objective</h4>
                    <p><strong>Justification:</strong> ${summary.justification || "N/A"}</p>
                    <p style="margin-top:8px;"><strong>Objective:</strong> ${summary.objective || "N/A"}</p>
                    <p style="margin-top:8px;"><strong>Deliverables:</strong> ${summary.deliverables || "N/A"}</p>
                </div>
                <div class="detail-card">
                    <h4>Financial Summary</h4>
                    <p><strong>Internal Effort Cost:</strong> $${summary.employee_cost.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                    <p><strong>Additional Internal:</strong> $${summary.additional_internal_cost.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                    <p><strong>External Cost:</strong> $${summary.external_cost.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                    <p><strong>Cost Recovery:</strong> -$${summary.recovery.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                    <p style="margin-top:8px; font-weight:bold; color:var(--primary-color);"><strong>Total Net Cost:</strong> $${summary.total_cost.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                </div>
            </div>
            
            <div class="crud-card" style="margin-top:20px; max-height:280px;">
                <div class="crud-card-header">
                    <h3>Contributing Staff</h3>
                </div>
                <div class="crud-table-wrapper">
                    <table class="involved-table">
                        <thead>
                            <tr>
                                <th>Staff Name</th>
                                <th>Team</th>
                                <th>Location</th>
                                <th>Allocation %</th>
                                <th>Effort Cost</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${summary.staff.map(s => `
                                <tr>
                                    <td><strong>${s.employee_name}</strong></td>
                                    <td>${s.team}</td>
                                    <td>${s.location}</td>
                                    <td>${s.percentage}%</td>
                                    <td>$${s.cost.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                                </tr>
                            `).join('')}
                            ${summary.staff.length === 0 ? "<tr><td colspan='5' style='text-align:center;'>No staff currently planned.</td></tr>" : ""}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    function renderTeamDashboard() {
        const teamName = document.getElementById("select-dash-team").value;
        const detailsContainer = document.getElementById("team-dash-details");
        detailsContainer.innerHTML = "";
        
        if (!teamName || !dashboardData) return;
        
        const summary = dashboardData.team_summaries.find(t => t.team_name === teamName);
        if (!summary) return;

        detailsContainer.innerHTML = `
            <div class="detail-grid">
                <div class="detail-card">
                    <h4>Team Overview</h4>
                    <p><strong>Team Name:</strong> ${summary.team_name}</p>
                    <p><strong>Total Planned Resources:</strong> ${summary.member_count} headcount</p>
                    <p><strong>Total Annual Cost:</strong> $${summary.total_cost.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                </div>
                <div class="detail-card">
                    <h4>Capacity Metrics</h4>
                    <p><strong>Average Utilization:</strong> ${summary.average_utilization.toFixed(1)}%</p>
                    <p><strong>Overloaded Headcount:</strong> <span class="${summary.overloaded_count > 0 ? "text-danger" : "text-green"}" style="font-weight:bold;">${summary.overloaded_count} overloaded</span></p>
                </div>
            </div>

            <div class="crud-card" style="margin-top:20px; max-height:280px;">
                <div class="crud-card-header">
                    <h3>Team Contributions by Topic</h3>
                </div>
                <div class="crud-table-wrapper">
                    <table class="involved-table">
                        <thead>
                            <tr>
                                <th>Topic / Project Name</th>
                                <th>Total Team Allocation %</th>
                                <th>Team Cost Contribution</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${summary.topics.map(t => `
                                <tr>
                                    <td><strong>${t.topic_name}</strong></td>
                                    <td>${t.total_percentage.toFixed(1)}%</td>
                                    <td>$${t.generated_cost.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                                </tr>
                            `).join('')}
                            ${summary.topics.length === 0 ? "<tr><td colspan='3' style='text-align:center;'>No project allocations.</td></tr>" : ""}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    function renderEmployeeDashboard() {
        const empId = document.getElementById("select-dash-employee").value;
        const detailsContainer = document.getElementById("employee-dash-details");
        detailsContainer.innerHTML = "";
        
        if (!empId) return;
        
        const emp = employees.find(e => e.id == empId);
        if (!emp) return;
        
        // Find allocations
        const empAllocations = allocations.filter(a => a.employee_id == empId);
        const totalUtil = empAllocations.reduce((acc, curr) => acc + curr.percentage, 0.0);
        const totalCost = emp.available_hours * emp.hourly_rate * (totalUtil / 100.0);

        detailsContainer.innerHTML = `
            <div class="detail-grid">
                <div class="detail-card">
                    <h4>Profile Information</h4>
                    <p><strong>Name:</strong> ${emp.name}</p>
                    <p><strong>Team:</strong> ${emp.team}</p>
                    <p><strong>Department:</strong> ${emp.department}</p>
                    <p><strong>Location:</strong> ${emp.location}</p>
                    <p><strong>Status:</strong> ${emp.status}</p>
                    <p><strong>Manager:</strong> ${emp.manager || "N/A"}</p>
                </div>
                <div class="detail-card">
                    <h4>Rate & Hours</h4>
                    <p><strong>Hourly Planning Rate:</strong> $${emp.hourly_rate.toFixed(2)}/hr</p>
                    <p><strong>Available Hours/Yr:</strong> ${emp.available_hours.toLocaleString()} hrs</p>
                    <p style="margin-top:8px;"><strong>Total Utilization:</strong> <span class="${totalUtil > 100.0 ? "text-danger" : "text-green"}" style="font-weight:bold;">${totalUtil.toFixed(1)}%</span></p>
                    <p><strong>Total Annual Allocated Cost:</strong> $${totalCost.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                </div>
                <div class="detail-card">
                    <h4>General Notes</h4>
                    <p>${emp.notes || "No notes registered."}</p>
                </div>
            </div>

            <div class="crud-card" style="margin-top:20px; max-height:280px;">
                <div class="crud-card-header">
                    <h3>Initiative Allocation Split</h3>
                </div>
                <div class="crud-table-wrapper">
                    <table class="involved-table">
                        <thead>
                            <tr>
                                <th>Topic / Project Name</th>
                                <th>Allocation %</th>
                                <th>Cost Value</th>
                                <th>Planning Comments</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${empAllocations.map(a => {
                                const topic = topics.find(t => t.id == a.topic_id);
                                if (!topic) return '';
                                const costVal = emp.available_hours * emp.hourly_rate * (a.percentage / 100.0);
                                return `
                                    <tr>
                                        <td><strong>${topic.name}</strong></td>
                                        <td>${a.percentage}%</td>
                                        <td>$${costVal.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                                        <td><span style="font-style:italic;color:var(--text-secondary);">${a.comment || "-"}</span></td>
                                    </tr>
                                `;
                            }).join('')}
                            ${empAllocations.length === 0 ? "<tr><td colspan='4' style='text-align:center;'>No allocations registered for this employee.</td></tr>" : ""}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    // ==========================================
    // 4. PRESENTATION DECK RENDER
    // ==========================================
    
    function renderPresentationDeck() {
        if (!dashboardData) return;

        // Slide 2 KPIs
        document.getElementById("pres-kpi-headcount").innerText = dashboardData.total_headcount;
        document.getElementById("pres-kpi-internal").innerText = `$${dashboardData.total_internal_employee_cost.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
        document.getElementById("pres-kpi-additional").innerText = `$${(dashboardData.total_additional_internal_cost + dashboardData.total_external_cost).toLocaleString(undefined, {maximumFractionDigits: 0})}`;
        document.getElementById("pres-kpi-net").innerText = `$${dashboardData.total_annual_planning_cost.toLocaleString(undefined, {maximumFractionDigits: 0})}`;

        // Slide 2 Chart.js (Vector presentation pie chart)
        const ctx = document.getElementById("pres-chart-location-canvas").getContext("2d");
        if (presLocationChart) presLocationChart.destroy();

        const labels = Object.keys(dashboardData.cost_by_location);
        const data = Object.values(dashboardData.cost_by_location);

        presLocationChart = new Chart(ctx, {
            type: "doughnut",
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: "right",
                        labels: { color: "#e2e8f0", font: { family: "Outfit", size: 10 } }
                    }
                }
            }
        });

        // Slide 3 Topic summary table
        const tbody = document.querySelector("#pres-topic-table tbody");
        tbody.innerHTML = "";
        dashboardData.topic_summaries.forEach(t => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${t.name}</strong></td>
                <td>${t.category}</td>
                <td>$${(t.additional_internal_cost + t.external_cost).toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                <td>${t.staff.length} Planned</td>
                <td><strong>$${t.total_cost.toLocaleString(undefined, {maximumFractionDigits: 0})}</strong></td>
            `;
            tbody.appendChild(tr);
        });

        // Slide 4 Overloaded list
        const riskList = document.getElementById("pres-overloaded-list");
        riskList.innerHTML = "";
        dashboardData.overloaded_employees.forEach(emp => {
            const li = document.createElement("li");
            li.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <strong>${emp.name}</strong> (${emp.team}) planned utilization is at <strong>${emp.utilization.toFixed(1)}%</strong>. Immediate risk of burnout/project delay.`;
            riskList.appendChild(li);
        });
        if (dashboardData.overloaded_employees.length === 0) {
            riskList.innerHTML = "<li><i class='fa-solid fa-circle-check text-green'></i> No overloaded planning risks detected in this scenario.</li>";
        }

        renderCustomSlides();
    }

    // Custom slides appended after the fixed 5 (e.g. Simulation comparison snapshots)
    function renderCustomSlides() {
        const container = document.getElementById("pres-custom-slides");
        container.innerHTML = "";
        customSlides.forEach(slide => {
            const div = document.createElement("div");
            div.className = "presentation-slide";
            div.innerHTML = slide.html;
            container.appendChild(div);
        });
        container.querySelectorAll(".btn-remove-custom-slide").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = parseInt(btn.getAttribute("data-slide-id"));
                customSlides = customSlides.filter(s => s.id !== id);
                renderCustomSlides();
            });
        });
    }

    function buildComparisonSlideHtml(reportA, reportB, selectedTeams) {
        const money = (val) => `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

        const avgUtil = (report) => {
            if (!report.team_summaries.length) return 0;
            const totalWeighted = report.team_summaries.reduce((sum, t) => sum + (t.average_utilization * t.member_count), 0);
            const totalMembers = report.team_summaries.reduce((sum, t) => sum + t.member_count, 0);
            return totalMembers ? totalWeighted / totalMembers : 0;
        };

        const headcountDelta = reportB.total_headcount - reportA.total_headcount;
        const costDelta = reportB.total_annual_planning_cost - reportA.total_annual_planning_cost;
        const utilA = avgUtil(reportA);
        const utilB = avgUtil(reportB);
        const overloadedDelta = reportB.overloaded_employees.length - reportA.overloaded_employees.length;

        const teamUtilA = {};
        reportA.team_summaries.forEach(t => { teamUtilA[t.team_name] = t.average_utilization; });
        const teamUtilB = {};
        reportB.team_summaries.forEach(t => { teamUtilB[t.team_name] = t.average_utilization; });
        const utilText = (val) => `<span class="${val > 100 ? "text-danger" : ""}">${val.toFixed(1)}%</span>`;

        const allTeams = [...new Set([...Object.keys(reportA.cost_by_team), ...Object.keys(reportB.cost_by_team)])].sort();
        const teams = (selectedTeams && selectedTeams.length) ? allTeams.filter(t => selectedTeams.includes(t)) : allTeams;

        const teamRows = teams.map(team => {
            const costA = reportA.cost_by_team[team] || 0;
            const costB = reportB.cost_by_team[team] || 0;
            const delta = costB - costA;
            const teamUtilAVal = teamUtilA[team] || 0;
            const teamUtilBVal = teamUtilB[team] || 0;
            return `<tr><td>${team}</td><td>${money(costA)}</td><td>${money(costB)}</td><td>${delta > 0 ? "+" : ""}${money(delta)}</td><td>${utilText(teamUtilAVal)} &rarr; ${utilText(teamUtilBVal)}</td></tr>`;
        }).join("");

        return `
            <div class="slide-title-bar">
                <h3>Simulation Comparison: ${reportA.scenario_name} vs ${reportB.scenario_name}</h3>
                <span class="confidential-small">CONFIDENTIAL</span>
            </div>
            <div class="slide-content-split">
                <div class="slide-col-full">
                    <div class="pres-kpi-grid">
                        <div class="pres-kpi-item">
                            <span class="pres-kpi-label">Headcount</span>
                            <span class="pres-kpi-number">${reportA.total_headcount} &rarr; ${reportB.total_headcount}</span>
                        </div>
                        <div class="pres-kpi-item">
                            <span class="pres-kpi-label">Total Annual Cost</span>
                            <span class="pres-kpi-number">${money(costDelta)} ${costDelta >= 0 ? "increase" : "decrease"}</span>
                        </div>
                        <div class="pres-kpi-item">
                            <span class="pres-kpi-label">Average Utilization</span>
                            <span class="pres-kpi-number">${utilA.toFixed(1)}% &rarr; ${utilB.toFixed(1)}%</span>
                        </div>
                        <div class="pres-kpi-item">
                            <span class="pres-kpi-label">Overloaded Employees</span>
                            <span class="pres-kpi-number">${reportA.overloaded_employees.length} &rarr; ${reportB.overloaded_employees.length} (${overloadedDelta > 0 ? "+" : ""}${overloadedDelta})</span>
                        </div>
                    </div>
                    <div style="margin-top: 16px;">
                        <table class="pres-table pres-table-comparison">
                            <thead>
                                <tr><th>Team</th><th>${reportA.scenario_name}</th><th>${reportB.scenario_name}</th><th>&Delta; Cost</th><th>Utilization</th></tr>
                            </thead>
                            <tbody>${teamRows || "<tr><td colspan='5'>No teams selected.</td></tr>"}</tbody>
                        </table>
                    </div>
                </div>
            </div>
            <div class="slide-footer">
                <span>Textron Inc. Planning Platform</span>
                <button class="btn-remove-custom-slide no-print" data-slide-id="__SLIDE_ID__" style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; font-size: 16px;">&times;</button>
            </div>
        `;
    }

    function openSlideTeamSelectionModal(reportA, reportB) {
        pendingSlideReportA = reportA;
        pendingSlideReportB = reportB;

        const teams = [...new Set([...Object.keys(reportA.cost_by_team), ...Object.keys(reportB.cost_by_team)])].sort();
        const checklist = document.getElementById("slide-teams-checklist");
        checklist.innerHTML = teams.map(team => `
            <label style="display: flex; align-items: center; gap: 8px; font-size: 13px;">
                <input type="checkbox" class="slide-team-checkbox" value="${team}" checked> ${team}
            </label>
        `).join("");

        document.getElementById("modal-slide-teams").classList.add("active");
    }

    document.getElementById("slide-teams-select-all").addEventListener("click", (e) => {
        e.preventDefault();
        document.querySelectorAll(".slide-team-checkbox").forEach(cb => { cb.checked = true; });
    });

    document.getElementById("slide-teams-select-none").addEventListener("click", (e) => {
        e.preventDefault();
        document.querySelectorAll(".slide-team-checkbox").forEach(cb => { cb.checked = false; });
    });

    document.getElementById("btn-confirm-add-slide").addEventListener("click", () => {
        const selectedTeams = [...document.querySelectorAll(".slide-team-checkbox:checked")].map(cb => cb.value);
        if (selectedTeams.length === 0) {
            alert("Select at least one team to add to the slide.");
            return;
        }

        const id = ++customSlideCounter;
        const slideHtml = buildComparisonSlideHtml(pendingSlideReportA, pendingSlideReportB, selectedTeams).replace("__SLIDE_ID__", id);
        customSlides.push({ id, html: slideHtml });
        renderCustomSlides();

        document.getElementById("modal-slide-teams").classList.remove("active");
    });

    // ==========================================
    // 5. CRUD MANAGEMENT TABLES
    // ==========================================
    
    function populateCRUDLocDropdown() {
        const select = document.getElementById("filter-crud-employees-location");
        if (!select) return;
        const currentVal = select.value;
        select.innerHTML = '<option value="">All Locations</option>';
        const locs = [...new Set(employees.map(e => e.location))].sort();
        locs.forEach(loc => {
            const opt = document.createElement("option");
            opt.value = loc;
            opt.textContent = loc;
            select.appendChild(opt);
        });
        select.value = currentVal;
    }

    function populateCRUDCatDropdown() {
        const select = document.getElementById("filter-crud-topics-category");
        if (!select) return;
        const currentVal = select.value;
        select.innerHTML = '<option value="">All Categories</option>';
        const cats = [...new Set(topics.map(t => t.category))].sort();
        cats.forEach(cat => {
            const opt = document.createElement("option");
            opt.value = cat;
            opt.textContent = cat;
            select.appendChild(opt);
        });
        select.value = currentVal;
    }

    async function fetchAIPredictions() {
        try {
            const response = await fetch("/api/reports/ai-predictions");
            if (response.ok) {
                const predictions = await response.json();
                renderAIPredictions(predictions);
            }
        } catch (err) {
            console.error("Error fetching AI predictions:", err);
        }
    }

    function renderAIPredictions(data) {
        const bList = document.getElementById("ai-insight-bottlenecks-list");
        const cList = document.getElementById("ai-insight-costs-list");
        const rList = document.getElementById("ai-insight-reallocations-list");
        
        if (bList) {
            bList.innerHTML = data.bottlenecks.map(b => `
                <div style="margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.03);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 4px;">
                        <strong style="color:var(--text-primary); font-size:12px;">${b.type}</strong>
                        <span class="badge ${b.severity === 'High' ? 'badge-danger' : b.severity === 'Medium' ? 'badge-warning' : 'badge-success'}" style="font-size:9px; padding:1px 6px;">${b.severity}</span>
                    </div>
                    <p style="font-size:11px; color:var(--text-secondary);">${b.description}</p>
                </div>
            `).join("") || "<p style='color:var(--text-muted); font-size:11px;'>No bottlenecks predicted.</p>";
        }
        
        if (cList) {
            cList.innerHTML = data.cost_optimizations.map(c => `
                <div style="margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.03);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 4px;">
                        <strong style="color:var(--text-primary); font-size:12px;">${c.category}</strong>
                        <span style="color:var(--success-color); font-size:11px; font-weight:600;">${c.impact}</span>
                    </div>
                    <p style="font-size:11px; color:var(--text-secondary);">${c.description}</p>
                </div>
            `).join("") || "<p style='color:var(--text-muted); font-size:11px;'>No cost optimizations found.</p>";
        }
        
        if (rList) {
            rList.innerHTML = data.reallocations.map(r => `
                <div style="margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.03);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 4px;">
                        <strong style="color:var(--text-primary); font-size:12px;">${r.action}</strong>
                        <span class="badge ${r.priority === 'High' ? 'badge-danger' : r.priority === 'Medium' ? 'badge-warning' : 'badge-success'}" style="font-size:10px; padding:1px 6px;">${r.priority}</span>
                    </div>
                    <p style="font-size:11px; color:var(--text-secondary);">${r.description}</p>
                </div>
            `).join("") || "<p style='color:var(--text-muted); font-size:11px;'>No load balancing needed.</p>";
        }

        const slideB = document.getElementById("pres-ai-bottlenecks-list");
        const slideS = document.getElementById("pres-ai-suggestions-list");
        
        if (slideB) {
            slideB.innerHTML = data.bottlenecks.map(b => `
                <li style="padding: 8px 12px; border-radius: 6px; background: rgba(239, 68, 68, 0.04); border-left: 3px solid ${b.severity === 'High' ? 'var(--danger-color)' : 'var(--warning-color)'}; margin-bottom: 6px; font-size: 11px;">
                    <strong>[${b.type}]</strong> ${b.description}
                </li>
            `).join("");
        }
        if (slideS) {
            slideS.innerHTML = [...data.cost_optimizations, ...data.reallocations].slice(0, 3).map(s => `
                <li style="padding: 8px 12px; border-radius: 6px; background: rgba(59, 130, 246, 0.04); border-left: 3px solid var(--primary-color); margin-bottom: 6px; font-size: 11px;">
                    <strong>[${s.category || s.action}]</strong> ${s.description}
                </li>
            `).join("");
        }
    }

    function renderCRUDTables() {
        // Employees Table
        const empBody = document.querySelector("#crud-employee-table tbody");
        empBody.innerHTML = "";
        
        // Filtering
        let filteredEmps = [...employees];
        if (empSearch) {
            const q = empSearch.toLowerCase();
            filteredEmps = filteredEmps.filter(e => e.name.toLowerCase().includes(q) || e.team.toLowerCase().includes(q) || e.location.toLowerCase().includes(q));
        }
        if (empLocFilter) {
            filteredEmps = filteredEmps.filter(e => e.location === empLocFilter);
        }
        
        // Sorting
        filteredEmps.sort((a, b) => {
            let valA = a[empSortField];
            let valB = b[empSortField];
            if (typeof valA === "string") {
                return valA.localeCompare(valB) * empSortOrder;
            }
            return (valA - valB) * empSortOrder;
        });

        filteredEmps.forEach(emp => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${emp.name}</strong></td>
                <td>${emp.team}</td>
                <td>${emp.location}</td>
                <td>$${emp.hourly_rate.toFixed(2)}</td>
                <td>
                    <button class="btn btn-secondary btn-icon-only btn-edit-emp" data-id="${emp.id}" title="Edit Profile"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn btn-danger btn-icon-only btn-delete-emp" data-id="${emp.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
                </td>
            `;
            empBody.appendChild(tr);
        });

        // Topics Table
        const topBody = document.querySelector("#crud-topic-table tbody");
        topBody.innerHTML = "";

        // Filtering
        let filteredTopics = [...topics];
        if (topicSearch) {
            const q = topicSearch.toLowerCase();
            filteredTopics = filteredTopics.filter(t => t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
        }
        if (topicCatFilter) {
            filteredTopics = filteredTopics.filter(t => t.category === topicCatFilter);
        }

        // Sorting
        filteredTopics.sort((a, b) => {
            let valA = a[topicSortField];
            let valB = b[topicSortField];
            if (typeof valA === "string") {
                return valA.localeCompare(valB) * topicSortOrder;
            }
            return (valA - valB) * topicSortOrder;
        });

        filteredTopics.forEach(topic => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${topic.name}</strong></td>
                <td>${topic.category}</td>
                <td>$${topic.recovery.toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                <td>
                    <button class="btn btn-secondary btn-icon-only btn-edit-topic" data-id="${topic.id}" title="Edit Scope"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn btn-danger btn-icon-only btn-delete-topic" data-id="${topic.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
                </td>
            `;
            topBody.appendChild(tr);
        });

        // Populate filter options dynamically
        populateCRUDLocDropdown();
        populateCRUDCatDropdown();

        // Add event listeners dynamically to CRUD actions
        document.querySelectorAll(".btn-edit-emp").forEach(btn => {
            btn.addEventListener("click", () => editEmployeePrompt(btn.getAttribute("data-id")));
        });
        document.querySelectorAll(".btn-delete-emp").forEach(btn => {
            btn.addEventListener("click", () => deleteEmployeePrompt(btn.getAttribute("data-id")));
        });
        document.querySelectorAll(".btn-edit-topic").forEach(btn => {
            btn.addEventListener("click", () => editTopicPrompt(btn.getAttribute("data-id")));
        });
        document.querySelectorAll(".btn-delete-topic").forEach(btn => {
            btn.addEventListener("click", () => deleteTopicPrompt(btn.getAttribute("data-id")));
        });

        // Hide/Show action buttons based on Active Role
        toggleRoleUIVisibility();
    }

    function toggleRoleUIVisibility() {
        if (activeRole === "user") {
            document.body.classList.add("role-user-active");
            document.body.classList.remove("role-admin-active");
            
            // Hide CRUD Action Buttons
            document.getElementById("btn-add-employee").style.display = "none";
            document.getElementById("btn-add-topic").style.display = "none";
            document.querySelectorAll(".btn-delete-emp, .btn-edit-emp, .btn-delete-topic, .btn-edit-topic").forEach(b => {
                b.style.display = "none";
            });
            document.getElementById("btn-clone-scenario").style.display = "none";
            document.getElementById("btn-create-scenario").style.display = "none";
            document.getElementById("btn-delete-scenario").style.display = "none";
        } else {
            document.body.classList.add("role-admin-active");
            document.body.classList.remove("role-user-active");
            
            // Show CRUD Action Buttons
            document.getElementById("btn-add-employee").style.display = "inline-flex";
            document.getElementById("btn-add-topic").style.display = "inline-flex";
            document.querySelectorAll(".btn-delete-emp, .btn-edit-emp, .btn-delete-topic, .btn-edit-topic").forEach(b => {
                b.style.display = "inline-flex";
            });
            document.getElementById("btn-clone-scenario").style.display = "inline-flex";
            document.getElementById("btn-create-scenario").style.display = "inline-flex";
            document.getElementById("btn-delete-scenario").style.display = "inline-flex";
        }

        // Show or hide admin-only elements
        if (activeRole === "admin") {
            document.querySelectorAll(".admin-only").forEach(el => el.style.display = "");
        } else {
            document.querySelectorAll(".admin-only").forEach(el => el.style.display = "none");
        }
    }

    // ==========================================
    // 6. DETAILED EVENT HANDLERS (CRUD & MODALS)
    // ==========================================
    
    function setupEventListeners() {
        // Logout handler
        if (btnLogout) {
            btnLogout.addEventListener("click", logout);
        }

        // Login form submission handler
        if (formLogin) {
            formLogin.addEventListener("submit", async (e) => {
                e.preventDefault();
                const username = document.getElementById("login-username").value.trim();
                const password = document.getElementById("login-password").value;
                loginErrorAlert.style.display = "none";

                try {
                    const response = await fetch("/api/auth/login", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ username, password })
                    });

                    if (response.ok) {
                        const data = await response.json();
                        localStorage.setItem("token", data.access_token);
                        localStorage.setItem("role", data.role);
                        localStorage.setItem("username", data.username);
                        
                        activeRole = data.role;
                        
                        document.body.classList.add("authenticated");
                        userDisplayName.innerHTML = `<i class="fa-solid fa-user-circle" style="color: var(--primary-color);"></i> ${data.username}`;
                        
                        await fetchScenarios();
                        await fetchActiveScenario();
                        await refreshAllData();
                    } else {
                        loginErrorAlert.style.display = "block";
                        loginErrorAlert.classList.add("shake-animation");
                        setTimeout(() => loginErrorAlert.classList.remove("shake-animation"), 500);
                    }
                } catch (err) {
                    console.error("Login request failed:", err);
                    loginErrorAlert.innerText = "Network connection error.";
                    loginErrorAlert.style.display = "block";
                }
            });
        }

        // Sidebar Navigation click swaps
        navItems.forEach(item => {
            item.addEventListener("click", () => {
                navItems.forEach(n => n.classList.remove("active"));
                item.classList.add("active");
                
                activeSection = item.getAttribute("data-target");
                mainSections.forEach(s => s.classList.remove("active"));
                document.getElementById(activeSection).classList.add("active");

                // Workaround chart redraws
                if (activeSection === "dashboards-section") {
                    renderDashboards();
                } else if (activeSection === "presentation-section") {
                    renderPresentationDeck();
                } else if (activeSection === "logs-section") {
                    fetchAndRenderAdminLogs();
                } else if (activeSection === "simulation-section") {
                    renderSimulationTab();
                }
            });
        });

        // Matrix Filtering event drops
        const triggerFilter = () => {
            filters.location = filterLocation.value;
            filters.team = filterTeam.value;
            filters.department = filterDept.value;
            filters.category = filterCategory.value;
            renderAllocationMatrix();
        };

        filterLocation.addEventListener("change", triggerFilter);
        filterTeam.addEventListener("change", triggerFilter);
        filterDept.addEventListener("change", triggerFilter);
        filterCategory.addEventListener("change", triggerFilter);

        btnResetFilters.addEventListener("click", () => {
            filterLocation.value = "";
            filterTeam.value = "";
            filterDept.value = "";
            filterCategory.value = "";
            triggerFilter();
        });

        // Tab switches on Dashboard
        document.querySelectorAll(".dash-tab").forEach(tab => {
            tab.addEventListener("click", () => {
                document.querySelectorAll(".dash-tab").forEach(t => t.classList.remove("active"));
                tab.classList.add("active");

                activeDashTab = tab.getAttribute("data-tab");
                document.querySelectorAll(".dash-tab-content").forEach(tc => tc.classList.remove("active"));
                document.getElementById(activeDashTab).classList.add("active");
            });
        });

        // Dashboard specific dropdown filters
        document.getElementById("select-dash-topic").addEventListener("change", renderTopicDashboard);
        document.getElementById("select-dash-team").addEventListener("change", renderTeamDashboard);
        document.getElementById("select-dash-employee").addEventListener("change", renderEmployeeDashboard);

        // Modals close button hooks
        document.querySelectorAll(".modal-close").forEach(btn => {
            btn.addEventListener("click", () => {
                document.getElementById(btn.getAttribute("data-modal")).classList.remove("active");
            });
        });

        // CRUD Modal Add button launches
        document.getElementById("btn-add-employee").addEventListener("click", () => {
            formEmployee.reset();
            document.getElementById("emp-id").value = "";
            document.getElementById("employee-modal-title").innerText = "Add New Employee";
            populateEmployeeFormDropdowns();
            document.getElementById("modal-employee").classList.add("active");
        });

        document.getElementById("btn-add-topic").addEventListener("click", () => {
            formTopic.reset();
            document.getElementById("topic-id").value = "";
            document.getElementById("topic-modal-title").innerText = "Add New Topic";
            document.getElementById("modal-topic").classList.add("active");
        });

        // Submit actions for Employee CRUD Form
        formEmployee.addEventListener("submit", async (e) => {
            e.preventDefault();
            const id = document.getElementById("emp-id").value;
            const empData = {
                name: document.getElementById("emp-name").value,
                team: document.getElementById("emp-team").value,
                department: document.getElementById("emp-dept").value,
                location: document.getElementById("emp-location").value,
                available_hours: parseFloat(document.getElementById("emp-hours").value),
                hourly_rate: parseFloat(document.getElementById("emp-rate").value),
                status: document.getElementById("emp-status").value,
                manager: document.getElementById("emp-manager").value || null,
                notes: document.getElementById("emp-notes").value || null
            };

            try {
                let response;
                if (id) {
                    // Update
                    response = await fetch(`/api/employees/${id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(empData)
                    });
                } else {
                    // Create
                    response = await fetch("/api/employees", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(empData)
                    });
                }
                
                if (response.ok) {
                    document.getElementById("modal-employee").classList.remove("active");
                    await refreshAllData();
                } else {
                    alert("Error saving employee.");
                }
            } catch (err) {
                console.error("Error submitting employee form:", err);
            }
        });

        // Submit actions for Topic CRUD Form
        formTopic.addEventListener("submit", async (e) => {
            e.preventDefault();
            const id = document.getElementById("topic-id").value;
            const topicData = {
                name: document.getElementById("topic-name").value,
                category: document.getElementById("topic-category").value,
                area: document.getElementById("topic-area").value || null,
                description: document.getElementById("topic-desc").value || null,
                objective: document.getElementById("topic-objective").value || null,
                deliverables: document.getElementById("topic-deliverables").value || null,
                justification: document.getElementById("topic-justification").value || null,
                status: "Active",
                recovery: parseFloat(document.getElementById("topic-recovery").value || 0.0)
            };

            try {
                let response;
                if (id) {
                    response = await fetch(`/api/topics/${id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(topicData)
                    });
                } else {
                    response = await fetch("/api/topics", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(topicData)
                    });
                }
                
                if (response.ok) {
                    document.getElementById("modal-topic").classList.remove("active");
                    await refreshAllData();
                } else {
                    alert("Error saving topic.");
                }
            } catch (err) {
                console.error("Error submitting topic form:", err);
            }
        });

        // Submit actions for Allocation Matrix Cell Save
        formAllocation.addEventListener("submit", async (e) => {
            e.preventDefault();
            const allocData = {
                employee_id: parseInt(document.getElementById("alloc-emp-id").value),
                topic_id: parseInt(document.getElementById("alloc-topic-id").value),
                percentage: parseFloat(document.getElementById("alloc-pct").value),
                comment: document.getElementById("alloc-comment").value || ""
            };

            try {
                const response = await fetch("/api/allocations", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(allocData)
                });
                
                if (response.ok) {
                    document.getElementById("modal-allocation").classList.remove("active");
                    await refreshAllData();
                } else {
                    alert("Error updating allocation.");
                }
            } catch (err) {
                console.error("Error saving allocation:", err);
            }
        });

        // Scenario management switches
        scenarioSelect.addEventListener("change", async () => {
            const selectedId = scenarioSelect.value;
            if (selectedId) {
                try {
                    const response = await fetch(`/api/scenarios/active/${selectedId}`, { method: "POST" });
                    if (response.ok) {
                        await fetchActiveScenario();
                        await refreshAllData();
                    }
                } catch (err) {
                    console.error("Error switching scenario:", err);
                }
            }
        });

        // Scenario Creation launches
        document.getElementById("btn-create-scenario").addEventListener("click", () => {
            formCreateScenario.reset();
            document.getElementById("modal-scenario").classList.add("active");
        });

        formCreateScenario.addEventListener("submit", async (e) => {
            e.preventDefault();
            const scenData = {
                name: document.getElementById("new-scenario-name").value,
                description: document.getElementById("new-scenario-desc").value || ""
            };
            try {
                const response = await fetch("/api/scenarios", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(scenData)
                });
                if (response.ok) {
                    document.getElementById("modal-scenario").classList.remove("active");
                    await fetchScenarios();
                    await fetchActiveScenario();
                    await refreshAllData();
                }
            } catch (err) {
                console.error("Error creating scenario:", err);
            }
        });

        // Scenario Clone launches
        document.getElementById("btn-clone-scenario").addEventListener("click", () => {
            formCloneScenario.reset();
            document.getElementById("clone-scenario-name").value = `Clone of ${activeScenario.name}`;
            document.getElementById("modal-clone").classList.add("active");
        });

        formCloneScenario.addEventListener("submit", async (e) => {
            e.preventDefault();
            const cloneData = {
                new_name: document.getElementById("clone-scenario-name").value,
                new_description: document.getElementById("clone-scenario-desc").value || ""
            };
            try {
                const response = await fetch(`/api/scenarios/${activeScenario.id}/clone`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(cloneData)
                });
                if (response.ok) {
                    document.getElementById("modal-clone").classList.remove("active");
                    await fetchScenarios();
                    await fetchActiveScenario();
                    await refreshAllData();
                }
            } catch (err) {
                console.error("Error cloning scenario:", err);
            }
        });

        // Scenario Deletion launches
        document.getElementById("btn-delete-scenario").addEventListener("click", async () => {
            if (scenarios.length <= 1) {
                alert("Cannot delete the only scenario. Keep at least one scenario active.");
                return;
            }
            if (confirm(`Are you sure you want to delete scenario: '${activeScenario.name}'? This deletes all mapped employees, topics and allocations.`)) {
                try {
                    const response = await fetch(`/api/scenarios/${activeScenario.id}`, { method: "DELETE" });
                    if (response.ok) {
                        await fetchScenarios();
                        await fetchActiveScenario();
                        await refreshAllData();
                    }
                } catch (err) {
                    console.error("Error deleting scenario:", err);
                }
            }
        });

        // CSV File Drag Drop hooks
        const dropArea = document.getElementById("csv-drag-drop");
        const fileInput = document.getElementById("csv-file-input");

        dropArea.addEventListener("click", () => fileInput.click());

        dropArea.addEventListener("dragover", (e) => {
            e.preventDefault();
            dropArea.classList.add("dragover");
        });
        
        dropArea.addEventListener("dragleave", () => {
            dropArea.classList.remove("dragover");
        });

        dropArea.addEventListener("drop", (e) => {
            e.preventDefault();
            dropArea.classList.remove("dragover");
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                uploadCSV(files[0]);
            }
        });

        fileInput.addEventListener("change", (e) => {
            if (fileInput.files.length > 0) {
                uploadCSV(fileInput.files[0]);
            }
        });

        // Presentation Print Deck trigger
        document.getElementById("btn-print-deck").addEventListener("click", async () => {
            try {
                const token = localStorage.getItem("token");
                await fetch("/api/reports/log-export", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        report_name: `Visual Presentation Deck (${activeScenario ? activeScenario.name : "Scenario"})`,
                        format: "PDF/Print"
                    })
                });
            } catch (err) {
                console.error("Failed to log deck print:", err);
            }
            window.print();
        });

        // Export Matrix CSV trigger
        const btnExportCSV = document.getElementById("btn-export-matrix-csv");
        if (btnExportCSV) {
            btnExportCSV.addEventListener("click", exportMatrixToCSV);
        }

        // Refresh Audit Logs trigger
        const btnRefreshLogs = document.getElementById("btn-refresh-logs");
        if (btnRefreshLogs) {
            btnRefreshLogs.addEventListener("click", fetchAndRenderAdminLogs);
        }

        // AI Chat Drawer Toggle Actions
        btnToggleAI.addEventListener("click", () => {
            aiDrawer.classList.add("active");
            aiChatInput.focus();
        });

        btnCloseAI.addEventListener("click", () => {
            aiDrawer.classList.remove("active");
        });

        btnSendAI.addEventListener("click", handleAISubmit);
        aiChatInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") handleAISubmit();
        });

        // Setup hooks for AI pre-written questions
        document.addEventListener("click", (e) => {
            if (e.target.classList.contains("ai-sample-query")) {
                e.preventDefault();
                aiChatInput.value = e.target.innerText;
                handleAISubmit();
            }
        });

        // Management Search and Filters binding
        const inputEmpSearch = document.getElementById("search-crud-employees");
        if (inputEmpSearch) {
            inputEmpSearch.addEventListener("input", (e) => {
                empSearch = e.target.value.trim();
                renderCRUDTables();
            });
        }
        const selectEmpLoc = document.getElementById("filter-crud-employees-location");
        if (selectEmpLoc) {
            selectEmpLoc.addEventListener("change", (e) => {
                empLocFilter = e.target.value;
                renderCRUDTables();
            });
        }

        const inputTopicSearch = document.getElementById("search-crud-topics");
        if (inputTopicSearch) {
            inputTopicSearch.addEventListener("input", (e) => {
                topicSearch = e.target.value.trim();
                renderCRUDTables();
            });
        }
        const selectTopicCat = document.getElementById("filter-crud-topics-category");
        if (selectTopicCat) {
            selectTopicCat.addEventListener("change", (e) => {
                topicCatFilter = e.target.value;
                renderCRUDTables();
            });
        }

        // Click sorting employees headers
        document.querySelectorAll("th.sortable-emp").forEach(th => {
            th.addEventListener("click", () => {
                const field = th.getAttribute("data-sort");
                if (empSortField === field) {
                    empSortOrder = -empSortOrder;
                } else {
                    empSortField = field;
                    empSortOrder = 1;
                }
                document.querySelectorAll("th.sortable-emp i").forEach(icon => {
                    icon.className = "fa-solid fa-sort";
                    icon.style.opacity = "0.4";
                });
                const icon = th.querySelector("i");
                if (icon) {
                    icon.className = empSortOrder === 1 ? "fa-solid fa-sort-up" : "fa-solid fa-sort-down";
                    icon.style.opacity = "1";
                }
                renderCRUDTables();
            });
        });

        // Click sorting topics headers
        document.querySelectorAll("th.sortable-topic").forEach(th => {
            th.addEventListener("click", () => {
                const field = th.getAttribute("data-sort");
                if (topicSortField === field) {
                    topicSortOrder = -topicSortOrder;
                } else {
                    topicSortField = field;
                    topicSortOrder = 1;
                }
                document.querySelectorAll("th.sortable-topic i").forEach(icon => {
                    icon.className = "fa-solid fa-sort";
                    icon.style.opacity = "0.4";
                });
                const icon = th.querySelector("i");
                if (icon) {
                    icon.className = topicSortOrder === 1 ? "fa-solid fa-sort-up" : "fa-solid fa-sort-down";
                    icon.style.opacity = "1";
                }
                renderCRUDTables();
            });
        });
    }

    // ==========================================
    // 7. CSV PARSING UPLOADER INTERACTION
    // ==========================================
    
    async function uploadCSV(file) {
        const statusBox = document.getElementById("upload-status");
        statusBox.style.display = "block";
        statusBox.innerHTML = `<h4><i class="fa-solid fa-spinner fa-spin"></i> Processing file: ${file.name}...</h4>`;
        
        const formData = new FormData();
        formData.append("file", file);

        try {
            const response = await fetch("/api/import/csv", {
                method: "POST",
                body: formData
            });

            const resData = await response.json();
            if (response.ok && resData.status === "success") {
                statusBox.innerHTML = `
                    <h4 class="text-green"><i class="fa-solid fa-circle-check"></i> Import Successful!</h4>
                    <p>${resData.message}</p>
                    <ul>
                        <li><i class="fa-solid fa-user-plus text-blue"></i> Employees imported: <strong>${resData.imported_employees}</strong></li>
                        <li><i class="fa-solid fa-file-invoice text-blue"></i> Topics imported: <strong>${resData.imported_topics}</strong></li>
                        <li><i class="fa-solid fa-link text-blue"></i> Allocation cells loaded: <strong>${resData.imported_allocations}</strong></li>
                        <li><i class="fa-solid fa-dollar-sign text-blue"></i> Additional costs rows loaded: <strong>${resData.imported_additional_costs}</strong></li>
                    </ul>
                `;
                // Reload matrix planning data
                await refreshAllData();
            } else {
                statusBox.innerHTML = `
                    <h4 class="text-danger"><i class="fa-solid fa-circle-exclamation"></i> Import Failed</h4>
                    <p>${resData.detail || "Invalid spreadsheet structure."}</p>
                `;
            }
        } catch (err) {
            console.error("Error uploading CSV:", err);
            statusBox.innerHTML = `
                <h4 class="text-danger"><i class="fa-solid fa-circle-exclamation"></i> Upload Error</h4>
                <p>An unexpected network error occurred while uploading. Ensure server is running.</p>
            `;
        }
    }

    // ==========================================
    // 8. MATRIX INLINE EDIT PROMPT POPULATORS
    // ==========================================
    
    function openAllocationModal(empId, empName, topicId, topicName, currentPct, currentComment) {
        document.getElementById("alloc-emp-id").value = empId;
        document.getElementById("alloc-topic-id").value = topicId;
        document.getElementById("alloc-info-label").innerHTML = `<strong>${empName}</strong> allocated to <strong>${topicName}</strong>`;
        document.getElementById("alloc-pct").value = currentPct;
        document.getElementById("alloc-comment").value = currentComment || "";
        
        document.getElementById("modal-allocation").classList.add("active");
        setTimeout(() => document.getElementById("alloc-pct").focus(), 150);
    }

    // Populates the Team and Location dropdowns on the Add/Edit Employee modal from distinct existing employee values
    function populateEmployeeFormDropdowns(selectedTeam, selectedLocation) {
        const teamSelect = document.getElementById("emp-team");
        const locationSelect = document.getElementById("emp-location");

        const teams = [...new Set(employees.map(e => e.team))].sort();
        teamSelect.innerHTML = "";
        teams.forEach(team => {
            const opt = document.createElement("option");
            opt.value = team;
            opt.innerText = team;
            teamSelect.appendChild(opt);
        });
        if (selectedTeam && teams.includes(selectedTeam)) {
            teamSelect.value = selectedTeam;
        }

        const locations = [...new Set(employees.map(e => e.location))].sort();
        locationSelect.innerHTML = "";
        locations.forEach(loc => {
            const opt = document.createElement("option");
            opt.value = loc;
            opt.innerText = loc;
            locationSelect.appendChild(opt);
        });
        if (selectedLocation && locations.includes(selectedLocation)) {
            locationSelect.value = selectedLocation;
        }
    }

    // CRUD edit launchers
    function editEmployeePrompt(id) {
        const emp = employees.find(e => e.id == id);
        if (!emp) return;

        document.getElementById("emp-id").value = emp.id;
        document.getElementById("emp-name").value = emp.name;
        populateEmployeeFormDropdowns(emp.team, emp.location);
        document.getElementById("emp-dept").value = emp.department;
        document.getElementById("emp-hours").value = emp.available_hours;
        document.getElementById("emp-rate").value = emp.hourly_rate;
        document.getElementById("emp-status").value = emp.status;
        document.getElementById("emp-manager").value = emp.manager || "";
        document.getElementById("emp-notes").value = emp.notes || "";
        
        document.getElementById("employee-modal-title").innerText = "Edit Employee Profile";
        document.getElementById("modal-employee").classList.add("active");
    }

    async function deleteEmployeePrompt(id) {
        const emp = employees.find(e => e.id == id);
        if (!emp) return;
        if (confirm(`Are you sure you want to delete employee '${emp.name}'? This removes all allocation history in active scenario.`)) {
            try {
                const response = await fetch(`/api/employees/${id}`, { method: "DELETE" });
                if (response.ok) {
                    await refreshAllData();
                }
            } catch (err) {
                console.error("Error deleting employee:", err);
            }
        }
    }

    function editTopicPrompt(id) {
        const topic = topics.find(t => t.id == id);
        if (!topic) return;

        document.getElementById("topic-id").value = topic.id;
        document.getElementById("topic-name").value = topic.name;
        document.getElementById("topic-category").value = topic.category;
        document.getElementById("topic-area").value = topic.area || "";
        document.getElementById("topic-recovery").value = topic.recovery;
        document.getElementById("topic-desc").value = topic.description || "";
        document.getElementById("topic-objective").value = topic.objective || "";
        document.getElementById("topic-deliverables").value = topic.deliverables || "";
        document.getElementById("topic-justification").value = topic.justification || "";

        document.getElementById("topic-modal-title").innerText = "Edit Topic Scope";
        document.getElementById("modal-topic").classList.add("active");
    }

    async function deleteTopicPrompt(id) {
        const topic = topics.find(t => t.id == id);
        if (!topic) return;
        if (confirm(`Are you sure you want to delete topic '${topic.name}'? This deletes all allocation percentages and additional costs associated.`)) {
            try {
                const response = await fetch(`/api/topics/${id}`, { method: "DELETE" });
                if (response.ok) {
                    await refreshAllData();
                }
            } catch (err) {
                console.error("Error deleting topic:", err);
            }
        }
    }

    async function fetchAndRenderAdminLogs() {
        const tbody = document.querySelector("#admin-logs-table tbody");
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;"><i class="fa-solid fa-spinner fa-spin"></i> Loading audit logs...</td></tr>';
        
        try {
            const token = localStorage.getItem("token");
            const response = await fetch("/api/admin/logs", {
                headers: {
                    "Authorization": `Bearer ${token}`
                }
            });
            if (response.ok) {
                const logs = await response.json();
                tbody.innerHTML = "";
                if (logs.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">No system audit logs found.</td></tr>';
                    return;
                }
                logs.forEach(log => {
                    const tr = document.createElement("tr");
                    const date = new Date(log.timestamp + "Z");
                    const localTime = date.toLocaleString();
                    
                    let badgeClass = "badge-secondary";
                    if (log.action === "Login") badgeClass = "badge-success";
                    else if (log.action === "Failed Login") badgeClass = "badge-danger";
                    else if (log.action === "Import CSV") badgeClass = "badge-primary";
                    else if (log.action === "Export Report") badgeClass = "badge-warning";
                    else if (log.action === "Registration") badgeClass = "badge-info";
                    
                    tr.innerHTML = `
                        <td style="font-size: 11px; color: var(--text-secondary);">${localTime}</td>
                        <td><strong>${log.username}</strong></td>
                        <td><span class="badge ${badgeClass}">${log.action}</span></td>
                        <td style="font-size: 12px; color: var(--text-primary); max-width: 400px; word-wrap: break-word;">${log.details || ""}</td>
                    `;
                    tbody.appendChild(tr);
                });
            } else {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--danger-color);"><i class="fa-solid fa-triangle-exclamation"></i> Error loading logs. Access denied.</td></tr>';
            }
        } catch (err) {
            console.error("Error fetching logs:", err);
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--danger-color);">Failed to connect to backend server.</td></tr>';
        }
    }

    async function exportMatrixToCSV() {
        const activeScenarioName = activeScenario ? activeScenario.name : "Scenario";
        
        let csvContent = "Employee,Team,Location,Hours/Year,Hourly Rate";
        topics.forEach(t => {
            csvContent += `,"${t.name.replace(/"/g, '""')}"`;
        });
        csvContent += "\n";
        
        employees.forEach(emp => {
            csvContent += `"${emp.name.replace(/"/g, '""')}","${emp.team.replace(/"/g, '""')}","${emp.location.replace(/"/g, '""')}",${emp.available_hours},${emp.hourly_rate}`;
            topics.forEach(t => {
                const pct = allocations.find(a => a.employee_id === emp.id && a.topic_id === t.id);
                const pctVal = pct ? pct.percentage : 0.0;
                csvContent += `,${pctVal}`;
            });
            csvContent += "\n";
        });
        
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Allocation_Matrix_${activeScenarioName.replace(/\s+/g, "_")}.csv`);
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        try {
            const token = localStorage.getItem("token");
            await fetch("/api/reports/log-export", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({
                    report_name: `Allocation Matrix (${activeScenarioName})`,
                    format: "CSV"
                })
            });
        } catch (err) {
            console.error("Failed to log matrix export:", err);
        }
    }

    // ==========================================
    // 9. LOCAL AI CHAT LOGIC
    // ==========================================
    
    async function handleAISubmit() {
        const text = aiChatInput.value.trim();
        if (!text) return;
        
        // Collect history before appending
        const history = [];
        document.querySelectorAll(".ai-chat-body .ai-message").forEach(b => {
            const role = b.classList.contains("user") ? "user" : "assistant";
            const textContent = b.innerText.trim();
            if (textContent && !b.querySelector(".fa-spinner")) {
                history.push({ role: role, content: textContent });
            }
        });

        aiChatInput.value = "";
        
        // Append user bubble
        appendChatBubble("user", text);
        
        // Append assistant loading bubble
        const loadingId = "bubble-" + Date.now();
        appendChatBubble("assistant", "<i class='fa-solid fa-spinner fa-spin'></i> AI is querying local planning database...", loadingId);

        try {
            const response = await fetch("/api/ai/query", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: text, history: history })
            });

            const resData = await response.json();
            
            // Swap loading bubble with result text
            const bubble = document.getElementById(loadingId);
            if (bubble) {
                let formatted = resData.answer
                    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                    .replace(/\*(.*?)\*/g, "<em>$1</em>")
                    .replace(/\n/g, "<br>");
                    
                bubble.innerHTML = formatted;
            }
        } catch (err) {
            console.error("Error asking local AI query:", err);
            const bubble = document.getElementById(loadingId);
            if (bubble) {
                bubble.innerHTML = "An unexpected error occurred while processing query. Confirm server connection.";
            }
        }
        
        // Scroll body down
        aiChatBody.scrollTop = aiChatBody.scrollHeight;
    }

    function appendChatBubble(sender, content, id = null) {
        const div = document.createElement("div");
        div.className = `ai-message ${sender}`;
        if (id) div.id = id;
        div.innerHTML = content;
        aiChatBody.appendChild(div);
        aiChatBody.scrollTop = aiChatBody.scrollHeight;
    }

    // Populate scenario lists on select dropdown
    function populateScenarioDropdown() {
        scenarioSelect.innerHTML = "";
        scenarios.forEach(scen => {
            const opt = document.createElement("option");
            opt.value = scen.id;
            opt.innerText = scen.name + (scen.is_active ? " (Active)" : "");
            scenarioSelect.appendChild(opt);
        });
    }

    // Populate Filters Options based on Seeding Details
    function updateFilterDropdowns() {
        const prevLoc = filterLocation.value;
        const prevTeam = filterTeam.value;
        const prevDept = filterDept.value;
        const prevCat = filterCategory.value;

        // Locations
        const locations = [...new Set(employees.map(e => e.location))];
        filterLocation.innerHTML = "<option value=''>All Locations</option>";
        locations.forEach(loc => {
            const opt = document.createElement("option");
            opt.value = loc;
            opt.innerText = loc;
            filterLocation.appendChild(opt);
        });
        filterLocation.value = locations.includes(prevLoc) ? prevLoc : "";

        // Teams
        const teams = [...new Set(employees.map(e => e.team))];
        filterTeam.innerHTML = "<option value=''>All Teams</option>";
        teams.forEach(team => {
            const opt = document.createElement("option");
            opt.value = team;
            opt.innerText = team;
            filterTeam.appendChild(opt);
        });
        filterTeam.value = teams.includes(prevTeam) ? prevTeam : "";

        // Departments
        const depts = [...new Set(employees.map(e => e.department))];
        filterDept.innerHTML = "<option value=''>All Departments</option>";
        depts.forEach(dept => {
            const opt = document.createElement("option");
            opt.value = dept;
            opt.innerText = dept;
            filterDept.appendChild(opt);
        });
        filterDept.value = depts.includes(prevDept) ? prevDept : "";

        // Categories
        const categories = [...new Set(topics.map(t => t.category))];
        filterCategory.innerHTML = "<option value=''>All Categories</option>";
        categories.forEach(cat => {
            const opt = document.createElement("option");
            opt.value = cat;
            opt.innerText = cat;
            filterCategory.appendChild(opt);
        });
        filterCategory.value = categories.includes(prevCat) ? prevCat : "";
    }

    // ==========================================
    // 10. SIMULATION MODULE (WHAT-IF PLANNING)
    // ==========================================

    function renderSimulationTab() {
        const fillScenarioSelect = (select, selectValue) => {
            const prevValue = select.value;
            select.innerHTML = "";
            scenarios.forEach(scen => {
                const opt = document.createElement("option");
                opt.value = scen.id;
                opt.innerText = scen.name + (scen.is_active ? " (Active)" : "");
                select.appendChild(opt);
            });
            const target = selectValue !== undefined ? selectValue : prevValue;
            if (scenarios.some(s => s.id == target)) {
                select.value = target;
            }
        };

        fillScenarioSelect(document.getElementById("sim-base-scenario"), activeScenario ? activeScenario.id : undefined);
        fillScenarioSelect(document.getElementById("sim-compare-a"));
        fillScenarioSelect(document.getElementById("sim-compare-b"), activeScenario ? activeScenario.id : undefined);

        document.getElementById("sim-new-name").value = activeScenario ? `${activeScenario.name} - Simulation` : "";

        const fillEmployeeSelect = (select) => {
            const prevValue = select.value;
            select.innerHTML = "";
            employees.forEach(emp => {
                const opt = document.createElement("option");
                opt.value = emp.id;
                opt.innerText = `${emp.name} (${emp.team})`;
                select.appendChild(opt);
            });
            if (employees.some(e => e.id == prevValue)) {
                select.value = prevValue;
            }
        };
        [document.getElementById("sim-rate-emp"), document.getElementById("sim-move-from"), document.getElementById("sim-move-to"), document.getElementById("sim-effort-emp")].forEach(fillEmployeeSelect);

        const fillTopicSelect = (select) => {
            const prevValue = select.value;
            select.innerHTML = "";
            topics.forEach(topic => {
                const opt = document.createElement("option");
                opt.value = topic.id;
                opt.innerText = topic.name;
                select.appendChild(opt);
            });
            if (topics.some(t => t.id == prevValue)) {
                select.value = prevValue;
            }
        };
        [document.getElementById("sim-move-topic"), document.getElementById("sim-effort-topic"), document.getElementById("sim-teammove-topic")].forEach(fillTopicSelect);

        const fillTeamSelect = (select) => {
            const prevValue = select.value;
            const teams = [...new Set(employees.map(e => e.team))];
            select.innerHTML = "";
            teams.forEach(team => {
                const opt = document.createElement("option");
                opt.value = team;
                opt.innerText = team;
                select.appendChild(opt);
            });
            if (teams.includes(prevValue)) {
                select.value = prevValue;
            }
        };
        [document.getElementById("sim-teammove-from-team"), document.getElementById("sim-teammove-to-team")].forEach(fillTeamSelect);

        // Prefill hourly rate field with the selected employee's current rate
        const rateEmpSelect = document.getElementById("sim-rate-emp");
        const prefillRate = () => {
            const emp = employees.find(e => e.id == rateEmpSelect.value);
            document.getElementById("sim-rate-value").value = emp ? emp.hourly_rate : "";
        };
        rateEmpSelect.onchange = prefillRate;
        prefillRate();

        // Prefill effort field with the current allocation for the selected employee/topic pair
        const effortTopicSelect = document.getElementById("sim-effort-topic");
        const effortEmpSelect = document.getElementById("sim-effort-emp");
        const prefillEffort = () => {
            const alloc = allocations.find(a => a.employee_id == effortEmpSelect.value && a.topic_id == effortTopicSelect.value);
            document.getElementById("sim-effort-value").value = alloc ? alloc.percentage : 0;
        };
        effortTopicSelect.onchange = prefillEffort;
        effortEmpSelect.onchange = prefillEffort;
        prefillEffort();

        document.getElementById("sim-compare-results").innerHTML = "";
    }

    async function upsertAllocation(employeeId, topicId, percentage) {
        const clamped = Math.max(0, Math.min(100, percentage));
        await fetch("/api/allocations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ employee_id: parseInt(employeeId), topic_id: parseInt(topicId), percentage: clamped })
        });
    }

    document.getElementById("btn-start-simulation").addEventListener("click", async () => {
        const baseId = document.getElementById("sim-base-scenario").value;
        const newName = document.getElementById("sim-new-name").value.trim();
        if (!baseId || !newName) {
            alert("Choose a base scenario and enter a name for the new simulation.");
            return;
        }
        try {
            const baseScenario = scenarios.find(s => s.id == baseId);
            const response = await fetch(`/api/scenarios/${baseId}/clone`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ new_name: newName, new_description: `[Simulation Sandbox] Cloned from ${baseScenario ? baseScenario.name : "scenario"}` })
            });
            if (response.ok) {
                await fetchScenarios();
                await fetchActiveScenario();
                await refreshAllData();
                renderSimulationTab();
            } else {
                alert("Error starting simulation.");
            }
        } catch (err) {
            console.error("Error starting simulation:", err);
        }
    });

    document.getElementById("btn-cleanup-sandboxes").addEventListener("click", async () => {
        const sandboxes = scenarios.filter(s => s.description && s.description.toLowerCase().includes("simulation sandbox") && s.id !== activeScenario.id);

        if (sandboxes.length === 0) {
            alert("No simulation sandboxes to clean up.");
            return;
        }

        if (confirm(`Delete ${sandboxes.length} simulation sandbox scenario(s)? This cannot be undone.`)) {
            try {
                for (const scen of sandboxes) {
                    await fetch(`/api/scenarios/${scen.id}`, { method: "DELETE" });
                }
                await fetchScenarios();
                await refreshAllData();
                renderSimulationTab();
            } catch (err) {
                console.error("Error cleaning up sandboxes:", err);
            }
        }
    });

    document.getElementById("btn-sim-add-employee").addEventListener("click", () => {
        document.getElementById("btn-add-employee").click();
    });

    document.getElementById("btn-sim-apply-rate").addEventListener("click", async () => {
        const empId = document.getElementById("sim-rate-emp").value;
        const newRate = parseFloat(document.getElementById("sim-rate-value").value);
        const emp = employees.find(e => e.id == empId);
        if (!emp || isNaN(newRate)) return;

        try {
            const response = await fetch(`/api/employees/${empId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...emp, hourly_rate: newRate })
            });
            if (response.ok) {
                await refreshAllData();
                renderSimulationTab();
            } else {
                alert("Error applying rate change.");
            }
        } catch (err) {
            console.error("Error applying rate change:", err);
        }
    });

    document.getElementById("btn-sim-move-work").addEventListener("click", async () => {
        const topicId = document.getElementById("sim-move-topic").value;
        const fromEmpId = document.getElementById("sim-move-from").value;
        const toEmpId = document.getElementById("sim-move-to").value;
        const amount = parseFloat(document.getElementById("sim-move-amount").value);

        if (!topicId || !fromEmpId || !toEmpId || isNaN(amount) || amount <= 0) return;
        if (fromEmpId === toEmpId) {
            alert("Choose two different employees to move work between.");
            return;
        }

        const fromAlloc = allocations.find(a => a.employee_id == fromEmpId && a.topic_id == topicId);
        const toAlloc = allocations.find(a => a.employee_id == toEmpId && a.topic_id == topicId);
        const fromPct = fromAlloc ? fromAlloc.percentage : 0;
        const toPct = toAlloc ? toAlloc.percentage : 0;
        const moved = Math.min(amount, fromPct);

        try {
            await upsertAllocation(fromEmpId, topicId, fromPct - moved);
            await upsertAllocation(toEmpId, topicId, toPct + moved);
            await refreshAllData();
            renderSimulationTab();
        } catch (err) {
            console.error("Error moving work between teams:", err);
        }
    });

    document.getElementById("btn-sim-move-team").addEventListener("click", async () => {
        const topicId = document.getElementById("sim-teammove-topic").value;
        const sourceTeam = document.getElementById("sim-teammove-from-team").value;
        const targetTeam = document.getElementById("sim-teammove-to-team").value;
        const amount = parseFloat(document.getElementById("sim-teammove-amount").value);

        if (!topicId || !sourceTeam || !targetTeam || isNaN(amount) || amount <= 0) return;
        if (sourceTeam === targetTeam) {
            alert("Choose two different teams to move work between.");
            return;
        }

        const sourceMembers = employees.filter(e => e.team === sourceTeam);
        const sourceAllocs = sourceMembers
            .map(emp => ({ emp, alloc: allocations.find(a => a.employee_id == emp.id && a.topic_id == topicId) }))
            .filter(entry => entry.alloc && entry.alloc.percentage > 0);

        if (sourceAllocs.length === 0) {
            alert("Selected source team has no effort on this topic to move.");
            return;
        }

        const targetMembers = employees.filter(e => e.team === targetTeam);
        if (targetMembers.length === 0) {
            alert("Selected target team has no employees.");
            return;
        }

        const sourceTotal = sourceAllocs.reduce((sum, entry) => sum + entry.alloc.percentage, 0);
        const actualMove = Math.min(amount, sourceTotal);
        const perPersonIncrease = actualMove / targetMembers.length;

        try {
            for (const entry of sourceAllocs) {
                const reduction = actualMove * (entry.alloc.percentage / sourceTotal);
                await upsertAllocation(entry.emp.id, topicId, entry.alloc.percentage - reduction);
            }
            for (const emp of targetMembers) {
                const existing = allocations.find(a => a.employee_id == emp.id && a.topic_id == topicId);
                const currentPct = existing ? existing.percentage : 0;
                await upsertAllocation(emp.id, topicId, currentPct + perPersonIncrease);
            }
            await refreshAllData();
            renderSimulationTab();
        } catch (err) {
            console.error("Error moving team workload:", err);
        }
    });

    document.getElementById("btn-sim-adjust-effort").addEventListener("click", async () => {
        const topicId = document.getElementById("sim-effort-topic").value;
        const empId = document.getElementById("sim-effort-emp").value;
        const newPct = parseFloat(document.getElementById("sim-effort-value").value);
        if (!topicId || !empId || isNaN(newPct)) return;

        try {
            await upsertAllocation(empId, topicId, newPct);
            await refreshAllData();
            renderSimulationTab();
        } catch (err) {
            console.error("Error adjusting topic effort:", err);
        }
    });

    document.getElementById("btn-sim-compare").addEventListener("click", async () => {
        const scenarioAId = document.getElementById("sim-compare-a").value;
        const scenarioBId = document.getElementById("sim-compare-b").value;
        if (!scenarioAId || !scenarioBId) return;

        try {
            const [resA, resB] = await Promise.all([
                fetch(`/api/reports/dashboard/${scenarioAId}`),
                fetch(`/api/reports/dashboard/${scenarioBId}`)
            ]);
            const reportA = await resA.json();
            const reportB = await resB.json();
            renderScenarioComparison(reportA, reportB);
        } catch (err) {
            console.error("Error comparing scenarios:", err);
        }
    });

    function renderScenarioComparison(reportA, reportB) {
        const container = document.getElementById("sim-compare-results");

        const avgUtil = (report) => {
            if (!report.team_summaries.length) return 0;
            const totalWeighted = report.team_summaries.reduce((sum, t) => sum + (t.average_utilization * t.member_count), 0);
            const totalMembers = report.team_summaries.reduce((sum, t) => sum + t.member_count, 0);
            return totalMembers ? totalWeighted / totalMembers : 0;
        };

        const money = (val) => `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
        const deltaClass = (delta) => delta > 0 ? "delta-positive" : (delta < 0 ? "delta-negative" : "delta-neutral");
        const deltaLabel = (delta, isPct) => `${delta > 0 ? "+" : ""}${isPct ? delta.toFixed(1) + "%" : money(delta)}`;

        const headcountDelta = reportB.total_headcount - reportA.total_headcount;
        const costDelta = reportB.total_annual_planning_cost - reportA.total_annual_planning_cost;
        const utilA = avgUtil(reportA);
        const utilB = avgUtil(reportB);
        const utilDelta = utilB - utilA;
        const overloadedDelta = reportB.overloaded_employees.length - reportA.overloaded_employees.length;

        let html = `
            <div class="detail-grid">
                <div class="detail-card">
                    <h4>Headcount</h4>
                    <p>${reportA.scenario_name}: <strong>${reportA.total_headcount}</strong> &rarr; ${reportB.scenario_name}: <strong>${reportB.total_headcount}</strong></p>
                    <p class="${deltaClass(headcountDelta)}">${headcountDelta > 0 ? "+" : ""}${headcountDelta}</p>
                </div>
                <div class="detail-card">
                    <h4>Total Annual Cost</h4>
                    <p>${money(reportA.total_annual_planning_cost)} &rarr; ${money(reportB.total_annual_planning_cost)}</p>
                    <p class="${deltaClass(costDelta)}">${deltaLabel(costDelta, false)}</p>
                </div>
                <div class="detail-card">
                    <h4>Average Utilization</h4>
                    <p>${utilA.toFixed(1)}% &rarr; ${utilB.toFixed(1)}%</p>
                    <p class="${deltaClass(utilDelta)}">${deltaLabel(utilDelta, true)}</p>
                </div>
                <div class="detail-card">
                    <h4>Overloaded Employees</h4>
                    <p>${reportA.overloaded_employees.length} &rarr; ${reportB.overloaded_employees.length}</p>
                    <p class="${deltaClass(overloadedDelta)}">${overloadedDelta > 0 ? "+" : ""}${overloadedDelta}</p>
                </div>
            </div>
        `;

        const teamUtilA = {};
        reportA.team_summaries.forEach(t => { teamUtilA[t.team_name] = t.average_utilization; });
        const teamUtilB = {};
        reportB.team_summaries.forEach(t => { teamUtilB[t.team_name] = t.average_utilization; });
        const utilCell = (val) => `<span class="${val > 100 ? "text-danger" : ""}">${val.toFixed(1)}%</span>`;

        const teams = [...new Set([...Object.keys(reportA.cost_by_team), ...Object.keys(reportB.cost_by_team)])].sort();
        const teamRows = teams.map(team => {
            const costA = reportA.cost_by_team[team] || 0;
            const costB = reportB.cost_by_team[team] || 0;
            const delta = costB - costA;
            const deltaPct = costA !== 0 ? (delta / costA) * 100 : (costB !== 0 ? 100 : 0);
            const teamUtilAVal = teamUtilA[team] || 0;
            const teamUtilBVal = teamUtilB[team] || 0;
            return `
                <tr>
                    <td>${team}</td>
                    <td>${money(costA)}</td>
                    <td>${money(costB)}</td>
                    <td class="${deltaClass(delta)}">${deltaLabel(delta, false)}</td>
                    <td class="${deltaClass(delta)}">${deltaLabel(deltaPct, true)}</td>
                    <td>${utilCell(teamUtilAVal)} &rarr; ${utilCell(teamUtilBVal)}</td>
                </tr>
            `;
        }).join("");

        html += `
            <div class="crud-card" style="max-height: none; margin-top: 16px;">
                <div class="crud-card-header"><h3><i class="fa-solid fa-table"></i> Cost by Team</h3></div>
                <div class="crud-table-wrapper">
                    <table class="crud-table">
                        <thead>
                            <tr><th>Team</th><th>${reportA.scenario_name}</th><th>${reportB.scenario_name}</th><th>&Delta; Cost</th><th>&Delta; %</th><th>Utilization (&gt;100% = overloaded)</th></tr>
                        </thead>
                        <tbody>${teamRows || "<tr><td colspan='6'>No team cost data.</td></tr>"}</tbody>
                    </table>
                </div>
            </div>
            <div class="modal-footer" style="justify-content: flex-start; padding-top: 16px;">
                <button id="btn-add-to-deck" class="btn btn-secondary"><i class="fa-solid fa-file-circle-plus"></i> Add to Presentation Deck</button>
                <button id="btn-export-comparison-csv" class="btn btn-secondary"><i class="fa-solid fa-file-csv"></i> Export to CSV</button>
            </div>
        `;

        container.innerHTML = html;

        document.getElementById("btn-add-to-deck").addEventListener("click", () => {
            openSlideTeamSelectionModal(reportA, reportB);
        });

        document.getElementById("btn-export-comparison-csv").addEventListener("click", () => {
            exportComparisonToCSV(reportA, reportB);
        });
    }

    async function exportComparisonToCSV(reportA, reportB) {
        const esc = (val) => `"${String(val).replace(/"/g, '""')}"`;
        const avgUtil = (report) => {
            if (!report.team_summaries.length) return 0;
            const totalWeighted = report.team_summaries.reduce((sum, t) => sum + (t.average_utilization * t.member_count), 0);
            const totalMembers = report.team_summaries.reduce((sum, t) => sum + t.member_count, 0);
            return totalMembers ? totalWeighted / totalMembers : 0;
        };

        const utilA = avgUtil(reportA);
        const utilB = avgUtil(reportB);

        let csvContent = `Metric,${esc(reportA.scenario_name)},${esc(reportB.scenario_name)},Delta\n`;
        csvContent += `Headcount,${reportA.total_headcount},${reportB.total_headcount},${reportB.total_headcount - reportA.total_headcount}\n`;
        csvContent += `Total Annual Cost,${reportA.total_annual_planning_cost.toFixed(2)},${reportB.total_annual_planning_cost.toFixed(2)},${(reportB.total_annual_planning_cost - reportA.total_annual_planning_cost).toFixed(2)}\n`;
        csvContent += `Average Utilization %,${utilA.toFixed(1)},${utilB.toFixed(1)},${(utilB - utilA).toFixed(1)}\n`;
        csvContent += `Overloaded Employees,${reportA.overloaded_employees.length},${reportB.overloaded_employees.length},${reportB.overloaded_employees.length - reportA.overloaded_employees.length}\n`;
        csvContent += "\n";

        const teamUtilA = {};
        reportA.team_summaries.forEach(t => { teamUtilA[t.team_name] = t.average_utilization; });
        const teamUtilB = {};
        reportB.team_summaries.forEach(t => { teamUtilB[t.team_name] = t.average_utilization; });

        csvContent += `Team,${esc(reportA.scenario_name)},${esc(reportB.scenario_name)},Delta Cost,Delta %,${esc(reportA.scenario_name)} Utilization %,${esc(reportB.scenario_name)} Utilization %,Overloaded (>100%)\n`;
        const teams = [...new Set([...Object.keys(reportA.cost_by_team), ...Object.keys(reportB.cost_by_team)])].sort();
        teams.forEach(team => {
            const costA = reportA.cost_by_team[team] || 0;
            const costB = reportB.cost_by_team[team] || 0;
            const delta = costB - costA;
            const deltaPct = costA !== 0 ? (delta / costA) * 100 : (costB !== 0 ? 100 : 0);
            const teamUtilAVal = teamUtilA[team] || 0;
            const teamUtilBVal = teamUtilB[team] || 0;
            const overloadedFlag = (teamUtilAVal > 100 || teamUtilBVal > 100) ? "Yes" : "No";
            csvContent += `${esc(team)},${costA.toFixed(2)},${costB.toFixed(2)},${delta.toFixed(2)},${deltaPct.toFixed(1)},${teamUtilAVal.toFixed(1)},${teamUtilBVal.toFixed(1)},${overloadedFlag}\n`;
        });

        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Scenario_Comparison_${reportA.scenario_name.replace(/\s+/g, "_")}_vs_${reportB.scenario_name.replace(/\s+/g, "_")}.csv`);
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        try {
            const token = localStorage.getItem("token");
            await fetch("/api/reports/log-export", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                body: JSON.stringify({
                    report_name: `Scenario Comparison (${reportA.scenario_name} vs ${reportB.scenario_name})`,
                    format: "CSV"
                })
            });
        } catch (err) {
            console.error("Failed to log comparison export:", err);
        }
    }

    // Launch Application Init
    init();
});
