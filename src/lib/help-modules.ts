export type HelpStep = {
  heading: string;
  body: string;
  tip?: string;
  shortcuts?: { keys: string[]; description: string }[];
  demo?: string;
};

export type HelpModule = {
  id: string;
  emoji: string;
  title: string;
  steps: HelpStep[];
};

export const MODULES: HelpModule[] = [
  {
    id: 'getting-started',
    emoji: '🚀',
    title: 'Getting Started',
    steps: [
      {
        heading: 'What is Veesker?',
        body: 'Veesker is a desktop IDE for Oracle 23ai databases. It runs natively on Windows and macOS without requiring Oracle Instant Client — the node-oracledb Thin mode driver is bundled in the app. You connect directly to any Oracle 23ai instance using host, port, and service name.',
        tip: 'No Oracle client installation needed. Veesker works out of the box on a fresh machine.',
      },
      {
        heading: 'Creating Your First Connection',
        body: 'On the home screen, click + New Connection. Fill in: Host (e.g. localhost), Port (default 1521), and Service Name (e.g. FREEPDB1 for Oracle 23ai Free). Enter your username and password — the password is stored securely in the OS keychain (Windows Credential Manager on Windows, macOS Keychain on macOS). Click Test Connection to verify, then Save.',
        tip: 'Use Service Name, not SID. Oracle 23ai Free uses FREEPDB1 as its default pluggable database service name.',
        demo: `<div style="font-family:monospace;font-size:12px;color:var(--text-secondary)">
  <div style="display:grid;grid-template-columns:120px 1fr;gap:6px;align-items:center">
    <span style="color:var(--text-muted)">Host</span>
    <span style="background:var(--bg-surface-alt);padding:4px 8px;border-radius:4px;border:1px solid var(--border)">localhost</span>
    <span style="color:var(--text-muted)">Port</span>
    <span style="background:var(--bg-surface-alt);padding:4px 8px;border-radius:4px;border:1px solid var(--border)">1521</span>
    <span style="color:var(--text-muted)">Service Name</span>
    <span style="background:var(--bg-surface-alt);padding:4px 8px;border-radius:4px;border:1px solid var(--border)">FREEPDB1</span>
    <span style="color:var(--text-muted)">Username</span>
    <span style="background:var(--bg-surface-alt);padding:4px 8px;border-radius:4px;border:1px solid var(--border)">hr</span>
    <span style="color:var(--text-muted)">Password</span>
    <span style="background:var(--bg-surface-alt);padding:4px 8px;border-radius:4px;border:1px solid var(--border)">••••••••</span>
  </div>
</div>`,
      },
      {
        heading: 'Navigating the Main Layout',
        body: 'After connecting, the workspace opens with three main areas: the Schema Tree on the left (browse all database objects), the Object Details panel in the centre (columns, indexes, DDL), and the Status Bar at the top. Toggle the SQL Drawer with Ctrl+J and the Sheep AI panel with Ctrl+I.',
        shortcuts: [
          { keys: ['Ctrl', 'J'], description: 'Toggle SQL Drawer' },
          { keys: ['Ctrl', 'I'], description: 'Toggle Sheep AI panel' },
          { keys: ['Ctrl', 'K'], description: 'Command Palette — search all objects' },
        ],
      },
      {
        heading: 'Security Notice',
        body: 'Veesker is pre-release software and has not undergone a formal security audit. The Sheep AI features (SheepChat and Analyze) send schema names, column names, SQL queries, and result samples to api.anthropic.com. Do not use AI features with sensitive, classified, or regulated data. All other features (SQL execution, schema browsing, debugging) are fully local.',
        tip: 'The AI features are completely optional — Veesker works without an Anthropic API key.',
      },
    ],
  },
  {
    id: 'schema-tree',
    emoji: '🌳',
    title: 'Schema Tree',
    steps: [
      {
        heading: 'Expanding Schemas',
        body: 'The Schema Tree on the left lists all schemas your user can see. Click a schema name to expand it — Veesker loads object counts for each type. System schemas (SYS, SYSTEM, DBSNMP, etc.) are hidden by default. Toggle them with the SYS button at the top of the tree.',
      },
      {
        heading: 'Object Type Colour Codes',
        body: 'Each object type has a consistent colour throughout the app. These colours appear in the Schema Tree, Data Flow diagrams, and Command Palette results.',
        demo: `<div style="display:flex;flex-wrap:wrap;gap:6px;font-size:11px">
  <span style="background:rgba(74,158,218,0.15);color:#4a9eda;padding:3px 10px;border-radius:12px;border:1px solid rgba(74,158,218,0.3)">● Tables</span>
  <span style="background:rgba(39,174,96,0.15);color:#27ae60;padding:3px 10px;border-radius:12px;border:1px solid rgba(39,174,96,0.3)">● Views</span>
  <span style="background:rgba(230,126,34,0.15);color:#e67e22;padding:3px 10px;border-radius:12px;border:1px solid rgba(230,126,34,0.3)">● Procedures</span>
  <span style="background:rgba(243,156,18,0.15);color:#f39c12;padding:3px 10px;border-radius:12px;border:1px solid rgba(243,156,18,0.3)">● Functions</span>
  <span style="background:rgba(155,89,182,0.15);color:#9b59b6;padding:3px 10px;border-radius:12px;border:1px solid rgba(155,89,182,0.3)">● Packages</span>
  <span style="background:rgba(231,76,60,0.15);color:#e74c3c;padding:3px 10px;border-radius:12px;border:1px solid rgba(231,76,60,0.3)">● Triggers</span>
  <span style="background:rgba(46,204,113,0.15);color:#2ecc71;padding:3px 10px;border-radius:12px;border:1px solid rgba(46,204,113,0.3)">● Sequences</span>
  <span style="background:rgba(52,152,219,0.15);color:#3498db;padding:3px 10px;border-radius:12px;border:1px solid rgba(52,152,219,0.3)">● Types</span>
</div>`,
      },
      {
        heading: 'Searching and Filter Chips',
        body: 'Type in the search box at the top of the Schema Tree to filter objects by name across all expanded schemas. Use the filter chips (TBL, VW, PROC, etc.) to toggle specific object types on or off. For a full cross-schema search, use the Command Palette.',
        shortcuts: [
          { keys: ['Ctrl', 'K'], description: 'Command Palette — instant search across all schemas' },
        ],
      },
      {
        heading: 'Right-click Context Menu',
        body: 'Right-clicking any object in the Schema Tree reveals context actions. For any object: View DDL. For procedures and functions: Execute (opens parameter input modal) and Open in Test Window (opens the PL/SQL debugger). For any object: Show Data Flow.',
        demo: `<div style="background:var(--bg-surface);border:1px solid var(--border-strong);border-radius:6px;padding:4px;width:240px;font-size:12px;box-shadow:0 8px 24px rgba(0,0,0,0.4)">
  <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:4px;color:var(--text-secondary);cursor:pointer">
    <span>📋</span> View DDL
  </div>
  <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:4px;background:rgba(179,62,31,0.15);color:var(--text-primary);cursor:pointer">
    <span>▶</span> Execute Procedure / Function
  </div>
  <div style="height:1px;background:var(--border);margin:3px 4px"></div>
  <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:4px;color:var(--text-secondary);cursor:pointer">
    <span>🐛</span> Open in Test Window (Debug)
  </div>
  <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:4px;color:var(--text-secondary);cursor:pointer">
    <span>🕸️</span> Show Data Flow
  </div>
</div>`,
      },
      {
        heading: 'Refreshing the Tree',
        body: 'After making schema changes — creating tables, compiling procedures, adding indexes — click the refresh button (↻) at the top of the Schema Tree to reload all object lists. This re-fetches the live list from Oracle and updates counts.',
        tip: 'The Schema Tree does not auto-refresh. Always refresh manually after DDL changes to see updated results.',
      },
    ],
  },
  {
    id: 'sql-editor',
    emoji: '⌨️',
    title: 'SQL Editor',
    steps: [
      {
        heading: 'Opening the SQL Drawer',
        body: 'Press Ctrl+J (or click the SQL button in the Status Bar) to toggle the SQL Drawer open or closed. It appears as a resizable panel at the bottom of the workspace. Drag the top handle to adjust its height. Press Ctrl+Shift+E to expand it to full screen.',
        shortcuts: [
          { keys: ['Ctrl', 'J'], description: 'Toggle SQL Drawer open/closed' },
          { keys: ['Ctrl', 'Shift', 'E'], description: 'Toggle full-screen expanded editor' },
        ],
      },
      {
        heading: 'Tabs and Running SQL',
        body: 'The SQL Editor supports multiple tabs — click the + button in the tab bar to open a new tab. Each tab has its own SQL content, result, and history. To run a single statement, place the cursor anywhere inside it and press Ctrl+Enter. To run all statements in the editor, press Ctrl+Shift+Enter.',
        shortcuts: [
          { keys: ['Ctrl', 'Enter'], description: 'Run statement at cursor (or selected text)' },
          { keys: ['Ctrl', 'Shift', 'Enter'], description: 'Run all statements' },
          { keys: ['Ctrl', 'W'], description: 'Close active tab' },
        ],
      },
      {
        heading: 'Result Grid',
        body: 'Query results appear in the Result Grid below the editor. The grid uses virtual scrolling — only visible rows are rendered, so large result sets stay smooth. Resize column widths by dragging the column header borders. Click any cell to select and copy its value. Press Ctrl+. to cancel a running query.',
        shortcuts: [
          { keys: ['Ctrl', '.'], description: 'Cancel the running query' },
        ],
        tip: 'For very large tables, add a FETCH FIRST N ROWS ONLY clause to avoid fetching millions of rows.',
      },
      {
        heading: 'Execution Log',
        body: 'Switch to the Log tab in the results area to see DBMS_OUTPUT output, row counts, and elapsed time for each executed statement. If your PL/SQL procedure calls DBMS_OUTPUT.PUT_LINE, its output appears here.',
        tip: 'DBMS_OUTPUT is enabled automatically for your session. You do not need to call DBMS_OUTPUT.ENABLE manually.',
      },
      {
        heading: 'Query History',
        body: 'Switch to the History tab to see all SQL executed in the current session, newest first. Click any history entry to load it back into the active editor tab. Each entry shows the schema, elapsed time, row count, and the full SQL.',
      },
      {
        heading: 'EXPLAIN PLAN',
        body: 'Press F6 to generate an EXPLAIN PLAN for the current statement (or selected text). The result is a colour-coded tree: Table Access nodes are green, Index nodes are blue, Join nodes are amber. Click any node to see its full details. Click Ask AI to send the plan to Sheep AI for interpretation and optimisation suggestions.',
        shortcuts: [
          { keys: ['F6'], description: 'Generate EXPLAIN PLAN for current statement' },
        ],
      },
    ],
  },
  {
    id: 'object-inspector',
    emoji: '🔎',
    title: 'Object Inspector',
    steps: [
      {
        heading: 'Selecting Objects',
        body: 'Click any object name in the Schema Tree to load it in the Object Inspector panel (centre of the workspace). The panel automatically switches tabs based on object type — tables and views open to Columns, procedures and functions open to their parameter list.',
      },
      {
        heading: 'Columns Tab',
        body: 'The Columns tab lists every column with its data type, nullable flag, default value, and comments. Use the search box above the list to filter columns by name — useful for wide tables with dozens of columns.',
        tip: 'The column list updates live as you type in the search box. Press Escape to clear the filter.',
      },
      {
        heading: 'Indexes and Related Objects',
        body: 'The Indexes tab shows all indexes on the selected table, including primary keys, unique constraints, and regular indexes — with column lists and index types. The Related tab shows tables that have foreign keys pointing to this table (FK children) and tables this table references (FK parents).',
      },
      {
        heading: 'DDL View and Live Row Count',
        body: 'Click the DDL tab to see the full CREATE statement for the selected object as Oracle generates it. For tables, click the Count Rows button to run a live SELECT COUNT(*) and display the result — this is fetched on demand, not automatically.',
        tip: 'Row count is not fetched automatically to avoid slow queries on large tables. Click the button when you need it.',
      },
      {
        heading: 'Procedures and Functions',
        body: 'When you select a procedure or function, the inspector shows its parameter list (name, direction IN/OUT/IN OUT, and data type) and its full DDL source. To execute it with values, right-click it in the Schema Tree and choose Execute, or click the Run button that appears in the inspector header.',
      },
    ],
  },
  {
    id: 'data-flow',
    emoji: '🕸️',
    title: 'Data Flow',
    steps: [
      {
        heading: 'What Data Flow Shows',
        body: 'Data Flow is a visual dependency map centred on the selected object. The left side shows upstream dependencies — objects this object uses or references. The right side shows downstream dependents — objects that reference this object. Foreign key parent tables appear as FK ↑, FK child tables as FK ↓. Triggers are listed in a separate row.',
      },
      {
        heading: 'Reading the Diagram',
        body: 'Each node in the diagram is colour-coded by object type — the same colour scheme as the Schema Tree. Bezier curves connect the selected object (centre) to its dependencies. Hover any node to see its fully-qualified owner.name. The object type is shown as a short badge (TBL, VIEW, PROC, etc.).',
      },
      {
        heading: 'Navigating the Dependency Chain',
        body: 'Click any node in the Data Flow diagram to navigate to that object — the Object Inspector loads it and a new Data Flow diagram re-centres on it. This lets you follow dependency chains across the schema. Use the Back button (top-left of the inspector) to return to the previous object in the chain.',
        tip: 'Data Flow is available for all object types: tables, views, procedures, packages, functions, triggers, and types.',
      },
    ],
  },
  {
    id: 'sheep-ai',
    emoji: '🤖',
    title: 'Sheep AI',
    steps: [
      {
        heading: 'Opening Sheep AI',
        body: 'Press Ctrl+I (or click the AI button in the Status Bar) to open the Sheep AI chat panel on the right side of the workspace. The first time you open it, you will be prompted to enter your Anthropic API key. This key is stored in the OS keychain and persists across sessions.',
        shortcuts: [
          { keys: ['Ctrl', 'I'], description: 'Toggle Sheep AI panel open/closed' },
        ],
      },
      {
        heading: 'API Key Setup',
        body: 'Click the settings gear icon in the Sheep AI panel. Paste your Anthropic API key (starts with sk-ant-...) into the API Key field and press Enter or click Save. The key is stored in the OS keychain, not in a plain text file. You only need to do this once.',
        tip: 'Get your Anthropic API key at console.anthropic.com. Sheep AI uses Claude with prompt caching to reduce API costs on repeated schema references.',
      },
      {
        heading: 'Asking SQL Questions',
        body: 'Type any question in natural language and press Enter or Ctrl+Enter to send. Sheep AI has context about your current connection and can help you write queries, explain ORA- error messages, optimise SQL, and explain Oracle behaviour. Example: "Write a query that finds the top 10 customers by total order value in the last 30 days."',
      },
      {
        heading: 'Sending an EXPLAIN PLAN to AI',
        body: 'After generating an EXPLAIN PLAN with F6, click the Ask AI button in the plan view. This sends the full execution plan text to Sheep AI and asks it to explain what is happening and suggest index or query improvements. This is the fastest way to turn a raw plan into actionable advice.',
        shortcuts: [
          { keys: ['F6'], description: 'Generate EXPLAIN PLAN (then click Ask AI in the result)' },
        ],
      },
      {
        heading: 'Guided Chart Builder',
        body: 'After running any query, click the Analyze button (chart icon in the result toolbar) to send the result set to Sheep AI. It guides you through: pick a chart type (bar, line, pie, scatter, or KPI), select X and Y columns, choose an aggregation (SUM, AVG, COUNT, MIN, MAX), and give the chart a title. A preview appears in the chat — click Add to Dashboard to save it.',
      },
    ],
  },
  {
    id: 'dashboard',
    emoji: '📊',
    title: 'Dashboard',
    steps: [
      {
        heading: 'What the Dashboard Is',
        body: 'The Dashboard tab (accessible from the top tab bar in the workspace) shows all charts added via the Sheep AI chart builder. It persists across queries within a session — build a dashboard of KPI cards and charts from multiple queries, then export everything to PDF.',
      },
      {
        heading: 'KPI Cards and Chart Grid',
        body: 'KPI charts (single-metric cards showing one number with a label) are displayed as a compact row at the top of the dashboard. All other chart types — bar, line, pie, scatter — are arranged in a responsive grid below. The layout is automatic and always puts KPIs first.',
        tip: 'To create a KPI, choose "KPI" as the chart type in the Sheep AI chart builder and pick the column that holds the metric value.',
      },
      {
        heading: 'Exporting to PDF',
        body: "Click Export PDF in the dashboard toolbar. Veesker generates a printable document with: a cover page (title and SQL from the first chart), then a full-page section for each chart showing the chart image and its underlying data table. The PDF opens in your system's default PDF viewer.",
      },
      {
        heading: 'Clearing the Dashboard',
        body: 'Click the Clear button in the dashboard toolbar to remove all charts. A confirmation step prevents accidental clearing. In v1, individual chart removal is not supported — use Clear to start over, then re-add the charts you want via Sheep AI Analyze.',
      },
    ],
  },
  {
    id: 'plsql-debugger',
    emoji: '🐛',
    title: 'PL/SQL Debugger',
    steps: [
      {
        heading: 'Prerequisites',
        body: 'Before debugging, the procedure or function must be compiled with debug information. If it was compiled normally, Veesker detects this and shows a clear error message. Your Oracle user also needs the DEBUG CONNECT SESSION and DEBUG ANY PROCEDURE privileges.',
        demo: `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;background:var(--bg-surface);border:1px solid var(--border);border-radius:4px;padding:10px;color:#81c784">
  ALTER PROCEDURE my_proc COMPILE DEBUG;<br>
  ALTER FUNCTION my_fn COMPILE DEBUG;<br>
  <span style="color:var(--text-muted)">-- or for a package:</span><br>
  ALTER PACKAGE my_pkg COMPILE DEBUG;
</div>`,
        tip: 'After fixing and re-deploying a procedure in production, remember to recompile WITHOUT debug to remove debug symbols.',
      },
      {
        heading: 'Opening the Test Window',
        body: 'Right-click a procedure or function in the Schema Tree and choose Open in Test Window. A full-screen modal opens showing the source code on the left and a parameter input form on the right. Veesker automatically generates the anonymous PL/SQL block that calls your routine.',
      },
      {
        heading: 'Setting Breakpoints',
        body: 'In the Test Window editor, click the gutter (the grey margin on the left side of the editor) next to any executable line to set a breakpoint — a red dot appears on that line. Click the dot again to remove it. Breakpoints can also be toggled with Ctrl+B at the cursor position.',
        shortcuts: [
          { keys: ['Ctrl', 'B'], description: 'Toggle breakpoint at cursor line' },
        ],
      },
      {
        heading: 'Starting a Debug Session',
        body: 'Click the 🐛 Debug button (or press F9) to start the step-through session. Veesker establishes a two-session DBMS_DEBUG protocol: one Oracle session runs your code, a second one controls execution. Execution pauses at the first breakpoint you set.',
        shortcuts: [
          { keys: ['F9'], description: 'Start step-through debug session' },
          { keys: ['F8'], description: 'Run without debugging (no breakpoints)' },
        ],
        tip: 'A debug session opens a second Oracle connection. If your schema has a session limit, you may need to free up a session or increase the limit.',
      },
      {
        heading: 'Stepping Through Code',
        body: 'When paused at a breakpoint, use the Debug Toolbar controls to move through execution. The current line is highlighted in the editor.',
        shortcuts: [
          { keys: ['F7'], description: 'Step Into — enter called procedures/functions' },
          { keys: ['F10'], description: 'Step Over — execute current line, skip into calls' },
          { keys: ['Shift', 'F7'], description: 'Step Out — finish current procedure, pause at caller' },
          { keys: ['F5'], description: 'Continue — run until next breakpoint or end' },
          { keys: ['Shift', 'F5'], description: 'Stop — terminate the debug session immediately' },
        ],
      },
      {
        heading: 'Reading the Call Stack',
        body: 'The Call Stack panel (below the toolbar) shows the current execution stack — the chain of procedure and function calls that led to the current paused line. The topmost entry is where execution is paused. Click any frame in the call stack to jump to that location in the source editor.',
      },
      {
        heading: 'Inspecting Live Variables',
        body: 'The Locals panel lists all variables in scope at the currently paused line, along with their current values. Values update each time you step. For a quick look, hover over any variable name in the source editor — a tooltip shows its current value without needing to scan the Locals panel.',
        tip: 'Complex types (cursors, records, collections) appear as structured values in the Locals panel. Primitive types show their scalar value directly.',
      },
    ],
  },
  {
    id: 'vector-search',
    emoji: '🔍',
    title: 'Vector Search',
    steps: [
      {
        heading: 'Oracle 23ai AI Vector Search',
        body: 'Oracle 23ai includes native AI vector storage and similarity search. You store high-dimensional embedding vectors (generated by AI models) in a VECTOR column, create a vector index, and run semantic similarity searches — finding rows whose vector is nearest to a query vector. This enables semantic search, recommendation systems, and RAG (retrieval-augmented generation) workflows.',
      },
      {
        heading: 'The Vectors Tab',
        body: 'Select a table in the Schema Tree and click the Vectors tab in the Object Inspector. Veesker detects VECTOR columns and lists any existing vector indexes on them. From here you can create a new vector index or drop an existing one. If the table has no VECTOR columns, the tab shows a message explaining this.',
      },
      {
        heading: 'Creating a Vector Index',
        body: 'In the Vectors tab, click Create Index next to a VECTOR column. Veesker runs CREATE VECTOR INDEX using the IVF (Inverted File Index) algorithm and NEIGHBOR PARTITIONS organisation. The index enables fast approximate nearest-neighbour search. Creation time depends on row count.',
        tip: 'You need at least a few hundred rows with populated vector values for the IVF index to be useful. Empty or sparse columns will produce poor search quality.',
      },
      {
        heading: 'Configuring an Embedding Provider',
        body: 'To search semantically, Veesker embeds your query text using the same model that generated the stored vectors. Supported providers: Ollama (local and free — use nomic-embed-text), OpenAI (text-embedding-3-small), Voyage AI (voyage-3-lite), or a Custom URL. Configure your provider and API key in the Vectors tab settings section.',
        tip: 'For local development, Ollama with nomic-embed-text is free and runs entirely on your machine. Start it with: ollama run nomic-embed-text',
      },
      {
        heading: 'Running a Semantic Search and Reading the Scatter Plot',
        body: 'Enter a search phrase in the Query field. Choose a distance metric — COSINE (best for text and language), EUCLIDEAN (geometric distance), or DOT (for normalised vectors). Set a result limit and click Search. Results appear in a grid ranked by similarity score. Below the grid, a PCA scatter plot projects all result vectors into 2D space — the query vector appears as a distinct point, and closer dots indicate higher similarity.',
      },
    ],
  },
  {
    id: 'shortcuts-reference',
    emoji: '⌨️',
    title: 'Shortcuts Reference',
    steps: [
      {
        heading: 'All Keyboard Shortcuts',
        body: 'Complete reference of every keyboard shortcut in Veesker, grouped by area.',
        demo: `<div style="font-size:11px;font-family:'Inter',sans-serif">
  <div style="color:#b33e1f;font-weight:700;font-size:9px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;font-family:'Space Grotesk',sans-serif">Global</div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px;color:var(--text-secondary)"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Ctrl+I</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Toggle Sheep AI panel</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Ctrl+J</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Toggle SQL Drawer</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Ctrl+K</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Command Palette</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Ctrl+O</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Open SQL file</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Ctrl+S</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Save active SQL tab</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Ctrl+Shift+S</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Save active SQL tab as…</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Ctrl+Shift+E</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Toggle expanded SQL editor</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Ctrl+W</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Close active SQL tab</td></tr>
    <tr><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Ctrl+.</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Cancel running query</td></tr>
  </table>
  <div style="color:#b33e1f;font-weight:700;font-size:9px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;font-family:'Space Grotesk',sans-serif">SQL Editor</div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Ctrl+Enter</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Run statement at cursor</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Ctrl+Shift+Enter</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Run all statements</td></tr>
    <tr><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">F6</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Generate EXPLAIN PLAN</td></tr>
  </table>
  <div style="color:#b33e1f;font-weight:700;font-size:9px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;font-family:'Space Grotesk',sans-serif">PL/SQL Debugger</div>
  <table style="width:100%;border-collapse:collapse">
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">F8</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Run (no debug)</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">F9</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Start debug session</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Ctrl+B</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Toggle breakpoint at cursor</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">F7</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Step Into</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">F10</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Step Over</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Shift+F7</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Step Out</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">F5</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Continue to next breakpoint</td></tr>
    <tr><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Shift+F5</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Stop debug session</td></tr>
  </table>
</div>`,
      },
    ],
  },
];
