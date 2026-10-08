# Digital Engineering Planning Dashboard

A web-based resource planning, cost calculation, and portfolio management application to replace Excel-based tracking for engineering organizations.

---

## 1. Main Goal
Allow managers to quickly understand:
* **Who** is working on what.
* **Where** they are working (Location, Team, Department).
* **What** they are working on (Topics/Projects).
* **How much** effort is allocated (Utilization %).
* **What it costs** (Internal employee costs + additional costs).
* **Why** that activity exists (Business justification, objectives, scope).

---

## 2. Technical Requirements & Architecture
* **Language**: Python (backend).
* **Interface**: Web-based (responsive, accessible from any browser/device).
* **Database**: Persistent database/storage (e.g., SQLite for prototype optimized with indexes for large scale).
* **Scenarios**: Support saving, editing, and reloading multiple planning scenarios.
* **Multi-User**: Support concurrent access/viewing by multiple users.
* **Accessibility**: No manual Python running required for users.
* **Authentication & Role-Based Access Control (RBAC)**:
  * **Login Screen**: Glassmorphic authentication portal for admins and general users.
  * **Admin Role**: Full read/write access + exclusive Admin Insights (AI suggestions).
  * **User Role**: Read-only access (no CRUD or matrix edits, no admin insights).
* **Local Confidentiality**: All database queries, computations, and AI assistant operations run **locally** on the server. If a local Ollama LLM is available, it is queried; otherwise, it falls back to an offline rule-based heuristic query parser, keeping everything 100% confidential.

---

## 3. Core Features & Business Logic

### A. Data Import & Manual Entry
* **Excel / CSV Upload**: Smart parser that takes an exported Excel/CSV planning sheet matching the organizational layout, extracts employees, locations, hourly rates, available hours, topics/projects, allocations (%), and additional costs, and populates the active scenario instantly.
* **Manual Editing**: Full interface for admins to manually create, edit, or delete employees, topics, and additional costs, and insert allocation percentages directly from the dashboard.
* **Management Filtering & Sorting**: Supports client-side live-filtering by location or category, fuzzy search, and column sorting for managing large headcounts.

### B. Employee Management
* **Fields**: Name, Team, Department/Area, Location, Available Annual Hours, Hourly Rate, Status, Manager (optional), General Notes.
* **Statuses**: `Active`, `New Position`, `Replacement`, `Temporary`, `Inactive`.

### C. Topic & Project Management
* **Fields**: Name, Category, Area, Description, Objective, Expected Deliverables, Business Justification, Status, Management Comments, Additional Notes.

### D. Resource Allocation Matrix
* **Layout**: Grid with employees as rows, topics/projects as columns.
* **Interactivity** (Admin Only):
  * Editable allocation percentages per employee-topic.
  * Add allocation-specific comments (justifying why the employee is allocated).
* **Read-only grid** (User & Admin):
  * Auto-calculate total utilization per employee (sum of allocation %).
  * Highlight employees with >100% utilization.
* **Filtering**: Filter the grid by Team, Location, Department, and Topic Category.

### E. Cost Calculation Engine
* **Formula (Internal Cost)**: 
  $$\text{Cost per Employee per Topic} = \text{Available Hours per Year} \times \text{Hourly Rate} \times \text{Allocation Percentage}$$

### F. Additional Internal & External Costs (per Topic)
* **Additional Internal Costs**: CAD, Engineering Support, Sampling, Internal Testing, Internal Equipment, PTF, Internal Other.
* **External Costs**: Tooling, External Testing, Prototypes, Supplier Support, External Services, External Other.
* **Total Topic Cost Formula**:
  $$\text{Total Topic Cost} = \text{Employee Internal Cost} + \text{Additional Internal Cost} + \text{External Cost} - \text{Recovery}$$

### G. Justifications & Comments
* **Topic-Level Comments**: Scope, deliverables, risks, dependencies, management notes.
* **Allocation-Level Comments**: Reason for employee's specific allocation percentage.

---

## 4. Dashboards & Premium Visual Reports

### A. Dashboards
* **Topic Dashboard**: Name, category, area, description, objectives, justification, employees involved, calculated hours/costs per employee, additional costs, total topic cost, comments.
* **Team Dashboard**: Members, contributing topics, cost per topic, total team cost, average utilization, overloaded members, split by topic category.
* **Employee Dashboard**: Profile details, assigned topics, allocation percentages, cost contribution per topic, total utilization, total annual cost, allocation comments.
* **Admin Insights Dashboard (Admin Only)**: AI-driven cost optimizations, allocation alignments, overload mitigations, and scheduling risk reports.

### B. Reports & Presentation Generation
Both roles can generate reports:
1. **Simple Reports**: Plain data export (CSV/Excel) and raw structured summary tables.
2. **Visual Represented Reports (Design Focus)**: Premium visual dashboard reports styled specifically for executive slide decks. Includes vibrant, high-end vector charts (cost breakdown by team, category, location), visual warning highlights, and a clean print mode layout.
3. **AI Predictions Slide**: Integrated slide within the presentation deck outlining resource bottlenecks, budget overruns, and reallocation predictions.

---

## 5. Search, Filtering & Questions
* **Search**: By employee name.
* **Filters**: By team, department/area, location, topic, category, cost range, utilization range, and internal/external cost.

---

## 6. Storage & Deployment
* **Database**: SQLite (local persistent database, indexed for scale).
* **UI Delivery**: Fully responsive web application accessible in-browser.

---

## 7. Bonus Features
* **Confidential Local AI Assistant**: Queries a local Ollama LLM server (e.g. llama3) with RAG context of the entire database + strict guardrails, falling back to a smart offline heuristic parser if Ollama is not running.
* **What-If Simulation**: Test planning scenarios (e.g., add employee, change rate, adjust topic effort, compare original vs. new scenario).

---

## 8. Work Log & Current Status
* **2026-07-08**: Project initialized. Refined details for smart CSV import, manual editor, local data confidentiality, and high-fidelity visual reports.
* **2026-07-08**:
  * Established database schemas (`models.py`) and connection (`database.py`).
  * Wrote baseline data generator (`seed_data.py`) and populated local database.
  * Coded FastAPI application endpoints (`main.py`) mapping Scenarios cloning, CRUD, allocations, CSV parsing, reports, and AI query engine.
  * Designed static SPA index page (`static/index.html`) with headers, sidebars, dashboard tabs, presentation decks, and forms.
  * Applied dark-theme glassmorphism styling (`static/css/style.css`) with custom prints.
  * Linked dashboard interactions (`static/js/app.js`) handles.
  * Implemented automated Pytest suite (`tests.py`) and fixed CSV detection and AI queries punctuation bugs. All tests passed.
* **2026-07-08**: Added Login Screen and Token-based Session management requirements to support multiple concurrent users and roles authentication.
* **2026-07-08**: Added scale indexing, management panel sorting/searching, AI-driven slides/admin dashboard, Chart.js container height constraint sizing, and local LLM/Ollama fallback query engine integration.
* **2026-07-08**: Implemented character-overlap and token Jaccard similarity fuzzy entity matching for the local AI Assistant, making it capable of understanding partial names, typos, and abbreviations in conversational queries.
* **2026-07-08**: Added ambiguity checks to the fuzzy matching system, prompting users with explicit clarification choice lists when queries could apply to multiple matching employees, locations, or topics.
* **2026-07-08**: Added support for location-based staff queries (e.g. "Who is working in Germany/Romania?") resolving fuzzy location names and rendering staff member lists with utilization states.
* **2026-07-08**: Upgraded the query parser to support unified lookups (e.g. asking who works on a specific team, location, or project) and listing active projects associated with a location or category under a single dispatcher ruleset.
* **2026-07-08**: Implemented conversational history memory handling in both frontend chat submissions and the backend API, allowing the fallback engine to resolve ambiguous target options (resolving keywords like "all of them", "both", or index numbers like "first", "second").
* **2026-07-08**: Added secure system audit logging table, recording failed/successful logins, registrations, CSV imports, and report exports. Embedded a new "Audit Logs" tab in the admin sidebar to display all system logs dynamically.
* **Current Status**: Complete. All 9 test cases passed. Ready for deployment.
