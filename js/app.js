// ===================================
// AUDIT LOG VIEWER - Main Application
// ===================================

// Default Price Configuration (must be defined before state)
const DEFAULT_PRICE_CONFIG = {
    'grok-4-fast-non-reasoning': { inputPrice: 0.20, outputPrice: 0.20, tokensUnit: 2000000 },
    'grok-4-fast-reasoning': { inputPrice: 0.20, outputPrice: 0.20, tokensUnit: 2000000 },
    'claude-3-5-sonnet-20241022': { inputPrice: 3.00, outputPrice: 15.00, tokensUnit: 1000000 },
    'claude-3-opus-20240229': { inputPrice: 15.00, outputPrice: 75.00, tokensUnit: 1000000 }
};

// Application State
const state = {
    rawData: [],
    sessions: {},
    currentSession: null,
    currentFile: null,
    filters: {
        eventTypes: {
            api_call_request: true, // API request events
            api_call_response: true, // API response events
            user_message: true,
            agent_turn: true,
            tool_call: true,
            tool_result: true
        },
        searchTerm: ''
    },
    priceConfig: loadPriceConfig()
};

// Chart instances
let inputPerEventChart, inputCumulativeChart, outputPerEventChart, outputCumulativeChart;

// ===================================
// UTILITY FUNCTIONS
// ===================================

function loadPriceConfig() {
    try {
        const saved = localStorage.getItem('auditLogPriceConfig');
        if (saved) return JSON.parse(saved);
    } catch (error) {
        console.error('Failed to load price config:', error);
    }
    return { ...DEFAULT_PRICE_CONFIG };
}

function savePriceConfig(config) {
    try {
        localStorage.setItem('auditLogPriceConfig', JSON.stringify(config));
        state.priceConfig = config;
    } catch (error) {
        console.error('Failed to save price config:', error);
    }
}

function formatTokenUnit(tokens) {
    if (tokens >= 1000000) return `${tokens / 1000000}M`;
    if (tokens >= 1000) return `${tokens / 1000}K`;
    return `${tokens}`;
}

function parseTokenUnit(unitStr) {
    const trimmed = unitStr.trim().toUpperCase();
    const numericPart = parseFloat(trimmed);
    if (trimmed.endsWith('M')) return numericPart * 1000000;
    if (trimmed.endsWith('K')) return numericPart * 1000;
    return numericPart;
}

function calculateCost(model, inputTokens, outputTokens) {
    const pricing = state.priceConfig[model];
    if (!pricing) return 0;
    const inputCost = (inputTokens / pricing.tokensUnit) * pricing.inputPrice;
    const outputCost = (outputTokens / pricing.tokensUnit) * pricing.outputPrice;
    return inputCost + outputCost;
}

function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString() + '.' + date.getMilliseconds().toString().padStart(3, '0');
}

function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
}

function formatValue(value) {
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'string' && value.length > 100) return value.substring(0, 100) + '...';
    return String(value);
}

// Get token direction with fallback for backward compatibility
function getTokenDirection(event) {
    // First check if direction is explicitly set
    if (event.data?.direction) return event.data.direction;
    if (event.metadata?.direction) return event.metadata.direction;

    // Fallback: infer from event type
    if (event.eventType === 'user_message' || event.eventType === 'tool_result') {
        return 'input';
    } else if (event.eventType === 'agent_turn' || event.eventType === 'tool_call') {
        return 'output';
    }

    return null;
}

// Get tokens from event with multiple fallback sources
function getEventTokens(event) {
    // Try data.tokens first (new format)
    if (event.data?.tokens) return event.data.tokens;

    // Try tokenUsage (some formats)
    if (event.data?.tokenUsage) {
        const input = event.data.tokenUsage.input || 0;
        const output = event.data.tokenUsage.output || 0;
        return input + output;
    }

    // Try metadata
    if (event.metadata?.tokens) {
        const input = event.metadata.tokens.input || 0;
        const output = event.metadata.tokens.output || 0;
        return input + output;
    }

    // Fallback to estimated tokens (old format)
    if (event.data?.estimatedTokens) return event.data.estimatedTokens;

    return 0;
}

// ===================================
// INITIALIZATION
// ===================================

document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
});

function setupEventListeners() {
    document.getElementById('fileInput').addEventListener('change', handleFileLoad);
    document.getElementById('fileInput2').addEventListener('change', handleFileLoad);
    document.getElementById('refreshBtn').addEventListener('click', handleRefresh);
    document.getElementById('sessionSelector').addEventListener('change', handleSessionChange);

    document.querySelectorAll('[id^="filter_"]').forEach(checkbox => {
        checkbox.addEventListener('change', handleFilterChange);
    });

    document.getElementById('searchInput').addEventListener('input', handleSearchChange);
    document.getElementById('showErrorsBtn').addEventListener('click', showErrorsOnly);
    document.getElementById('showAllBtn').addEventListener('click', showAll);
    document.getElementById('collapseAllBtn').addEventListener('click', collapseAll);
    document.getElementById('expandAllBtn').addEventListener('click', expandAll);
    document.getElementById('priceKPI').addEventListener('click', openPriceModal);
    document.getElementById('closePriceModal').addEventListener('click', closePriceModal);
    document.getElementById('savePriceBtn').addEventListener('click', savePriceConfiguration);
    document.getElementById('resetPriceBtn').addEventListener('click', resetPriceConfiguration);

    document.getElementById('priceModal').addEventListener('click', (e) => {
        if (e.target.id === 'priceModal') closePriceModal();
    });

    // Sidebar collapse functionality
    document.getElementById('leftToggle').addEventListener('click', toggleLeftSidebar);
    document.getElementById('rightToggle').addEventListener('click', toggleRightSidebar);

    // Restore sidebar state from localStorage
    restoreSidebarState();
}

// ===================================
// SIDEBAR COLLAPSE FUNCTIONALITY
// ===================================

function toggleLeftSidebar() {
    const sidebar = document.getElementById('leftSidebar');
    const toggle = document.getElementById('leftToggle');
    const mainLayout = document.getElementById('mainLayout');
    const isCollapsed = sidebar.classList.toggle('collapsed');

    // Update toggle button icon
    toggle.textContent = isCollapsed ? '▶' : '◀';

    // Update main layout grid
    updateMainLayoutGrid();

    // Save state
    localStorage.setItem('leftSidebarCollapsed', isCollapsed);
}

function toggleRightSidebar() {
    const sidebar = document.getElementById('rightSidebar');
    const toggle = document.getElementById('rightToggle');
    const mainLayout = document.getElementById('mainLayout');
    const isCollapsed = sidebar.classList.toggle('collapsed');

    // Update toggle button icon
    toggle.textContent = isCollapsed ? '◀' : '▶';

    // Update main layout grid
    updateMainLayoutGrid();

    // Save state
    localStorage.setItem('rightSidebarCollapsed', isCollapsed);
}

function updateMainLayoutGrid() {
    const mainLayout = document.getElementById('mainLayout');
    const leftCollapsed = document.getElementById('leftSidebar').classList.contains('collapsed');
    const rightCollapsed = document.getElementById('rightSidebar').classList.contains('collapsed');

    // Remove all collapse classes
    mainLayout.classList.remove('left-collapsed', 'right-collapsed', 'both-collapsed');

    // Add appropriate class
    if (leftCollapsed && rightCollapsed) {
        mainLayout.classList.add('both-collapsed');
    } else if (leftCollapsed) {
        mainLayout.classList.add('left-collapsed');
    } else if (rightCollapsed) {
        mainLayout.classList.add('right-collapsed');
    }
}

function restoreSidebarState() {
    const leftCollapsed = localStorage.getItem('leftSidebarCollapsed') === 'true';
    const rightCollapsed = localStorage.getItem('rightSidebarCollapsed') === 'true';

    if (leftCollapsed) {
        document.getElementById('leftSidebar').classList.add('collapsed');
        document.getElementById('leftToggle').textContent = '▶';
    }

    if (rightCollapsed) {
        document.getElementById('rightSidebar').classList.add('collapsed');
        document.getElementById('rightToggle').textContent = '◀';
    }

    updateMainLayoutGrid();
}

// ===================================
// FILE HANDLING
// ===================================

async function handleFileLoad(event) {
    const file = event.target.files[0];
    if (!file) return;

    state.currentFile = file;

    try {
        const text = await file.text();
        parseLogFile(text);
        document.getElementById('emptyState').style.display = 'none';
        document.getElementById('mainLayout').style.display = 'grid';
        document.getElementById('refreshBtn').disabled = false;
        document.getElementById('filePath').textContent = file.name;
    } catch (error) {
        showError('Failed to load file: ' + error.message);
        console.error('File load error:', error);
    }
}

function parseLogFile(text) {
    state.rawData = [];
    state.sessions = {};

    const lines = text.split('\n').filter(line => line.trim());

    lines.forEach((line, index) => {
        try {
            const entry = JSON.parse(line);
            state.rawData.push(entry);

            // Only process API call request/response events
            if (entry.eventType !== 'api_call_request' && entry.eventType !== 'api_call_response') {
                return; // Skip non-API events
            }

            const sessionId = entry.sessionId || 'unknown';
            if (!state.sessions[sessionId]) {
                state.sessions[sessionId] = {
                    id: sessionId,
                    events: [],
                    startTime: entry.timestamp,
                    endTime: entry.timestamp
                };
            }

            state.sessions[sessionId].events.push(entry);
            state.sessions[sessionId].endTime = entry.timestamp;
        } catch (error) {
            console.warn(`Failed to parse line ${index + 1}:`, error);
        }
    });

    const sessionIds = Object.keys(state.sessions);
    if (sessionIds.length > 0) {
        state.currentSession = sessionIds[0];
        updateSessionSelector();
        renderVisualization();
    } else {
        showError('No valid API call events found in file');
    }
}

async function handleRefresh() {
    if (!state.currentFile) return;

    const btn = document.getElementById('refreshBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="loading"></span>';
    btn.disabled = true;

    try {
        const text = await state.currentFile.text();
        parseLogFile(text);
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }, 500);
    } catch (error) {
        showError('Failed to refresh: ' + error.message);
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// ===================================
// SESSION MANAGEMENT
// ===================================

function updateSessionSelector() {
    const selector = document.getElementById('sessionSelector');
    selector.innerHTML = '';
    selector.disabled = false;

    Object.keys(state.sessions).forEach(sessionId => {
        const option = document.createElement('option');
        option.value = sessionId;
        const shortId = sessionId.split('_').slice(1).join('_').substring(0, 20);
        option.textContent = shortId;
        if (sessionId === state.currentSession) option.selected = true;
        selector.appendChild(option);
    });
}

function handleSessionChange(event) {
    state.currentSession = event.target.value;
    renderVisualization();
}

// ===================================
// VISUALIZATION RENDERING
// ===================================

function renderVisualization() {
    const session = state.sessions[state.currentSession];
    if (!session) return;

    console.log('Rendering visualization for session:', state.currentSession);
    console.log('Total events:', session.events.length);

    renderKPIs(session);
    renderInsights(session);
    renderCharts(session);
    renderEventTimeline(session);
}

function getTokensByDirection(session) {
    let inputTokens = 0, outputTokens = 0;

    // Get ACTUAL tokens from API responses only (not estimated from requests)
    session.events.forEach(event => {
        if (event.eventType === 'api_call_response') {
            // API response includes actual input AND output tokens
            const input = event.data?.tokens?.input || event.metadata?.tokens?.input || 0;
            const output = event.data?.tokens?.output || event.metadata?.tokens?.output || 0;
            inputTokens += input;
            outputTokens += output;
        }
    });

    console.log('Token split (from API responses) - Input:', inputTokens, 'Output:', outputTokens);
    return { inputTokens, outputTokens };
}

function getSessionModel(session) {
    const apiEvent = session.events.find(e => e.eventType === 'api_request');
    return apiEvent?.data?.model || 'grok-4-fast-non-reasoning';
}

function renderKPIs(session) {
    const { inputTokens, outputTokens } = getTokensByDirection(session);

    const start = new Date(session.startTime);
    const end = new Date(session.endTime);
    const durationMs = end - start;
    const durationStr = formatDuration(durationMs);

    const toolResults = session.events.filter(e => e.eventType === 'tool_result');
    const successfulTools = toolResults.filter(e => !e.data?.isError).length;
    const totalTools = toolResults.length;
    const successRate = totalTools > 0 ? Math.round((successfulTools / totalTools) * 100) : 0;

    const model = getSessionModel(session);
    const cost = calculateCost(model, inputTokens, outputTokens);

    document.getElementById('inputTokens').textContent = inputTokens.toLocaleString();
    document.getElementById('outputTokens').textContent = outputTokens.toLocaleString();
    document.getElementById('estimatedCost').textContent = `$${cost.toFixed(4)}`;
    document.getElementById('totalEvents').textContent = session.events.length.toLocaleString();
    document.getElementById('sessionDuration').textContent = durationStr;
    document.getElementById('toolSuccess').textContent = `${successRate}% (${successfulTools}/${totalTools})`;
}

function renderInsights(session) {
    const insights = [];

    const toolCalls = session.events.filter(e => e.eventType === 'tool_call');
    const toolCounts = {};
    toolCalls.forEach(call => {
        const toolName = call.data?.toolName || 'unknown';
        toolCounts[toolName] = (toolCounts[toolName] || 0) + 1;
    });

    const mostUsedTool = Object.entries(toolCounts).sort((a, b) => b[1] - a[1])[0];
    if (mostUsedTool) {
        insights.push(`Most used: <strong>${mostUsedTool[0]}</strong> (${mostUsedTool[1]}x)`);
    }

    const start = new Date(session.startTime);
    const end = new Date(session.endTime);
    const durationMinutes = (end - start) / 1000 / 60;
    const { inputTokens, outputTokens } = getTokensByDirection(session);
    const totalTokens = inputTokens + outputTokens;
    const tokensPerMinute = durationMinutes > 0 ? Math.round(totalTokens / durationMinutes) : 0;
    insights.push(`Velocity: <strong>${tokensPerMinute} tok/min</strong>`);

    const errors = session.events.filter(e => e.data?.isError || e.eventType === 'error');
    if (errors.length > 0) {
        insights.push(`<span style="color: var(--accent-red)">⚠️ ${errors.length} error(s)</span>`);
    }

    document.getElementById('insightsList').innerHTML = insights.map(insight =>
        `<div class="insight-bullet">${insight}</div>`
    ).join('');
}

// ===================================
// CHART RENDERING (4 CHARTS)
// ===================================

function renderCharts(session) {
    console.log('Rendering all 4 charts...');
    renderInputPerEventChart(session);
    renderInputCumulativeChart(session);
    renderOutputPerEventChart(session);
    renderOutputCumulativeChart(session);
}

function renderInputPerEventChart(session) {
    if (inputPerEventChart) {
        inputPerEventChart.destroy();
        inputPerEventChart = null;
    }

    const canvas = document.getElementById('inputPerEventChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const apiCallNumbers = [], tokenValues = [];
    let apiCallIndex = 0;

    session.events.forEach((event) => {
        if (event.eventType === 'api_call_response') {
            apiCallIndex++;
            // Get actual input tokens from API response
            const tokens = event.data?.tokens?.input || event.metadata?.tokens?.input || 0;
            if (tokens > 0) {
                apiCallNumbers.push(apiCallIndex);
                tokenValues.push(tokens);
            }
        }
    });

    console.log('Input per-API-call chart:', apiCallNumbers.length, 'data points');

    inputPerEventChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: apiCallNumbers,
            datasets: [{
                label: 'Input Tokens',
                data: tokenValues,
                backgroundColor: 'rgba(0, 122, 204, 0.6)',
                borderColor: '#007acc',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    title: { display: true, text: 'API Call #', color: '#858585', font: { size: 10, weight: 'bold' } },
                    grid: { display: false },
                    ticks: { color: '#858585', font: { size: 9 } }
                },
                y: {
                    title: { display: true, text: 'Tokens', color: '#858585', font: { size: 10, weight: 'bold' } },
                    beginAtZero: true,
                    grid: { color: '#3e3e42' },
                    ticks: { color: '#858585', font: { size: 9 }, callback: value => value.toLocaleString() }
                }
            }
        }
    });
}

function renderInputCumulativeChart(session) {
    if (inputCumulativeChart) {
        inputCumulativeChart.destroy();
        inputCumulativeChart = null;
    }

    const canvas = document.getElementById('inputCumulativeChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const apiCallNumbers = [], cumulativeTokens = [];
    let cumulative = 0, apiCallIndex = 0;

    session.events.forEach((event) => {
        if (event.eventType === 'api_call_response') {
            apiCallIndex++;
            // Get actual input tokens from API response
            const tokens = event.data?.tokens?.input || event.metadata?.tokens?.input || 0;
            cumulative += tokens;
            apiCallNumbers.push(apiCallIndex);
            cumulativeTokens.push(cumulative);
        }
    });

    inputCumulativeChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: apiCallNumbers,
            datasets: [{
                label: 'Cumulative Input',
                data: cumulativeTokens,
                borderColor: '#007acc',
                backgroundColor: 'rgba(0, 122, 204, 0.1)',
                fill: true,
                tension: 0.4,
                borderWidth: 2,
                pointRadius: 3,
                pointBackgroundColor: '#007acc'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    title: { display: true, text: 'API Call #', color: '#858585', font: { size: 10, weight: 'bold' } },
                    grid: { display: false },
                    ticks: { color: '#858585', font: { size: 9 } }
                },
                y: {
                    title: { display: true, text: 'Total Input', color: '#858585', font: { size: 10, weight: 'bold' } },
                    beginAtZero: true,
                    grid: { color: '#3e3e42' },
                    ticks: { color: '#858585', font: { size: 9 }, callback: value => value.toLocaleString() }
                }
            }
        }
    });
}

function renderOutputPerEventChart(session) {
    if (outputPerEventChart) {
        outputPerEventChart.destroy();
        outputPerEventChart = null;
    }

    const canvas = document.getElementById('outputPerEventChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const apiCallNumbers = [], tokenValues = [];
    let apiCallIndex = 0;

    session.events.forEach((event) => {
        if (event.eventType === 'api_call_response') {
            apiCallIndex++;
            const tokens = event.data?.tokens?.output || event.metadata?.tokens?.output || 0;
            if (tokens > 0) {
                apiCallNumbers.push(apiCallIndex);
                tokenValues.push(tokens);
            }
        }
    });

    console.log('Output per-API-call chart:', apiCallNumbers.length, 'data points');

    outputPerEventChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: apiCallNumbers,
            datasets: [{
                label: 'Output Tokens',
                data: tokenValues,
                backgroundColor: 'rgba(78, 201, 176, 0.6)',
                borderColor: '#4ec9b0',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    title: { display: true, text: 'API Call #', color: '#858585', font: { size: 10, weight: 'bold' } },
                    grid: { display: false },
                    ticks: { color: '#858585', font: { size: 9 } }
                },
                y: {
                    title: { display: true, text: 'Tokens', color: '#858585', font: { size: 10, weight: 'bold' } },
                    beginAtZero: true,
                    grid: { color: '#3e3e42' },
                    ticks: { color: '#858585', font: { size: 9 }, callback: value => value.toLocaleString() }
                }
            }
        }
    });
}

function renderOutputCumulativeChart(session) {
    if (outputCumulativeChart) {
        outputCumulativeChart.destroy();
        outputCumulativeChart = null;
    }

    const canvas = document.getElementById('outputCumulativeChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const apiCallNumbers = [], cumulativeTokens = [];
    let cumulative = 0, apiCallIndex = 0;

    session.events.forEach((event) => {
        if (event.eventType === 'api_call_response') {
            apiCallIndex++;
            const tokens = event.data?.tokens?.output || event.metadata?.tokens?.output || 0;
            cumulative += tokens;
            apiCallNumbers.push(apiCallIndex);
            cumulativeTokens.push(cumulative);
        }
    });

    outputCumulativeChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: apiCallNumbers,
            datasets: [{
                label: 'Cumulative Output',
                data: cumulativeTokens,
                borderColor: '#4ec9b0',
                backgroundColor: 'rgba(78, 201, 176, 0.1)',
                fill: true,
                tension: 0.4,
                borderWidth: 2,
                pointRadius: 3,
                pointBackgroundColor: '#4ec9b0'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    title: { display: true, text: 'API Call #', color: '#858585', font: { size: 10, weight: 'bold' } },
                    grid: { display: false },
                    ticks: { color: '#858585', font: { size: 9 } }
                },
                y: {
                    title: { display: true, text: 'Total Output', color: '#858585', font: { size: 10, weight: 'bold' } },
                    beginAtZero: true,
                    grid: { color: '#3e3e42' },
                    ticks: { color: '#858585', font: { size: 9 }, callback: value => value.toLocaleString() }
                }
            }
        }
    });
}

// ===================================
// PRICE MODAL
// ===================================

function openPriceModal() {
    const modal = document.getElementById('priceModal');
    const body = document.getElementById('priceModalBody');
    body.innerHTML = '';

    Object.entries(state.priceConfig).forEach(([model, config]) => {
        const item = document.createElement('div');
        item.className = 'price-config-item';
        item.innerHTML = `
            <h4>${model}</h4>
            <div class="price-input-row">
                <div class="price-input-group">
                    <label>Input Price ($)</label>
                    <input type="number" step="0.01" value="${config.inputPrice}" data-model="${model}" data-field="inputPrice">
                </div>
                <div class="price-input-group">
                    <label>Output Price ($)</label>
                    <input type="number" step="0.01" value="${config.outputPrice}" data-model="${model}" data-field="outputPrice">
                </div>
                <div class="price-input-group">
                    <label>Per Tokens</label>
                    <input type="text" value="${formatTokenUnit(config.tokensUnit)}" data-model="${model}" data-field="tokensUnit" placeholder="e.g., 1M, 2M">
                </div>
            </div>
        `;
        body.appendChild(item);
    });

    modal.classList.add('active');
}

function closePriceModal() {
    document.getElementById('priceModal').classList.remove('active');
}

function savePriceConfiguration() {
    const inputs = document.querySelectorAll('#priceModalBody input');
    const newConfig = { ...state.priceConfig };

    inputs.forEach(input => {
        const model = input.dataset.model;
        const field = input.dataset.field;
        let value = input.value;

        if (field === 'tokensUnit') value = parseTokenUnit(value);
        else value = parseFloat(value);

        if (!newConfig[model]) newConfig[model] = {};
        newConfig[model][field] = value;
    });

    savePriceConfig(newConfig);
    closePriceModal();

    if (state.currentSession) {
        renderKPIs(state.sessions[state.currentSession]);
    }
}

function resetPriceConfiguration() {
    if (confirm('Reset all pricing to defaults?')) {
        savePriceConfig({ ...DEFAULT_PRICE_CONFIG });
        openPriceModal();
        if (state.currentSession) {
            renderKPIs(state.sessions[state.currentSession]);
        }
    }
}

// ===================================
// EVENT TIMELINE
// ===================================

function renderEventTimeline(session) {
    const container = document.getElementById('eventsList');
    container.innerHTML = '';

    const groups = createEventGroups(session.events);
    const filteredGroups = filterGroups(groups);

    document.getElementById('eventsCount').textContent =
        `${filteredGroups.length} ${filteredGroups.length === 1 ? 'event' : 'events'}`;

    filteredGroups.forEach(group => container.appendChild(createGroupElement(group)));
}

function createEventGroups(events) {
    // Create one group per event (each request and response is separate)
    return events.map((event, index) => {
        const isRequest = event.eventType === 'api_call_request';

        return {
            type: isRequest ? 'api_call_request' : 'api_call_response',
            timestamp: event.timestamp,
            turnNumber: event.metadata?.turnNumber ?? 0,
            eventNumber: index + 1, // Sequential numbering
            event: event, // Single event
            events: [event] // Keep array for backward compatibility
        };
    });
}

function filterGroups(groups) {
    return groups.filter(group => {
        if (!state.filters.eventTypes[group.type]) return false;

        if (state.filters.searchTerm) {
            const searchLower = state.filters.searchTerm.toLowerCase();
            const hasMatch = group.events.some(event => {
                const content = JSON.stringify(event.data || {}).toLowerCase();
                return content.includes(searchLower);
            });
            if (!hasMatch) return false;
        }

        return true;
    });
}

function createGroupElement(group) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'event-group';

    const header = document.createElement('div');
    header.className = 'event-group-header';

    const expandIcon = document.createElement('span');
    expandIcon.className = 'expand-icon';
    expandIcon.textContent = '▶';

    const eventNumber = document.createElement('span');
    eventNumber.className = 'event-number';
    eventNumber.textContent = `#${group.eventNumber}`;

    const typeBadge = document.createElement('span');
    typeBadge.className = `type-badge ${group.type}`;
    typeBadge.textContent = group.type.replace('_', ' ');

    const title = document.createElement('span');
    title.className = 'group-title';
    title.textContent = getGroupTitle(group);

    let inputTokens = 0, outputTokens = 0;

    // Get actual tokens from API response only
    const event = group.event;
    if (group.type === 'api_call_response') {
        // Response includes both actual input and output tokens from API
        inputTokens = event.data?.tokens?.input || event.metadata?.tokens?.input || 0;
        outputTokens = event.data?.tokens?.output || event.metadata?.tokens?.output || 0;
    }
    // Request events have no tokens (actual tokens come from response)

    header.appendChild(expandIcon);
    header.appendChild(eventNumber);
    header.appendChild(typeBadge);
    header.appendChild(title);

    if (inputTokens > 0) {
        const inputBadge = document.createElement('span');
        inputBadge.className = 'token-badge input';
        inputBadge.textContent = `↓${inputTokens}`;
        header.appendChild(inputBadge);
    }

    if (outputTokens > 0) {
        const outputBadge = document.createElement('span');
        outputBadge.className = 'token-badge output';
        outputBadge.textContent = `↑${outputTokens}`;
        header.appendChild(outputBadge);
    }

    const timestamp = document.createElement('span');
    timestamp.className = 'group-timestamp';
    timestamp.textContent = formatTimestamp(group.timestamp);
    header.appendChild(timestamp);

    const content = document.createElement('div');
    content.className = 'event-group-content';
    group.events.forEach(event => content.appendChild(createEventElement(event)));

    header.addEventListener('click', () => groupDiv.classList.toggle('expanded'));

    groupDiv.appendChild(header);
    groupDiv.appendChild(content);

    return groupDiv;
}

function getGroupTitle(group) {
    const event = group.event;
    const turnNum = group.turnNumber;

    if (group.type === 'api_call_request') {
        const messageCount = event.data?.messageCount || 0;
        const toolCount = event.data?.toolCount || 0;
        let title = `API Call Request - Turn ${turnNum}`;
        if (messageCount > 0) {
            title += ` (${messageCount} messages`;
            if (toolCount > 0) title += `, ${toolCount} tools`;
            title += ')';
        }
        return title;
    } else if (group.type === 'api_call_response') {
        const toolCallCount = event.data?.toolCallCount || 0;
        let title = `API Call Response - Turn ${turnNum}`;
        if (toolCallCount > 0) {
            title += ` (${toolCallCount} tool calls)`;
        }
        return title;
    }

    // Fallback for old event types
    return group.type;
}

function createToolCallElement(toolCall) {
    const toolDiv = document.createElement('div');
    toolDiv.className = 'tool-call-item';

    // Extract tool name
    const toolName = toolCall.function?.name || toolCall.name || 'unknown';
    toolDiv.setAttribute('data-tool', toolName);

    // Tool header
    const toolHeader = document.createElement('div');
    toolHeader.className = 'tool-call-header';

    const toolNameSpan = document.createElement('strong');
    toolNameSpan.textContent = toolName;
    toolHeader.appendChild(toolNameSpan);

    if (toolCall.id) {
        const toolId = document.createElement('span');
        toolId.className = 'tool-call-id';
        toolId.textContent = ` (${toolCall.id.substring(0, 12)}...)`;
        toolHeader.appendChild(toolId);
    }

    toolDiv.appendChild(toolHeader);

    // Tool arguments
    if (toolCall.function?.arguments) {
        try {
            const args = typeof toolCall.function.arguments === 'string'
                ? JSON.parse(toolCall.function.arguments)
                : toolCall.function.arguments;

            const argsDiv = document.createElement('div');
            argsDiv.className = 'tool-call-args';

            Object.entries(args).forEach(([key, value]) => {
                const argRow = document.createElement('div');
                argRow.className = 'tool-arg-row';

                const argKey = document.createElement('span');
                argKey.className = 'tool-arg-key';
                argKey.textContent = key + ':';

                const argValue = document.createElement('span');
                argValue.className = 'tool-arg-value';

                // Format value with truncation
                let displayValue = typeof value === 'object'
                    ? JSON.stringify(value, null, 2)
                    : String(value);

                if (displayValue.length > 200) {
                    argValue.textContent = displayValue.substring(0, 200) + '...';
                    argValue.title = displayValue; // Full value in tooltip
                } else {
                    argValue.textContent = displayValue;
                }

                argRow.appendChild(argKey);
                argRow.appendChild(argValue);
                argsDiv.appendChild(argRow);
            });

            toolDiv.appendChild(argsDiv);
        } catch (error) {
            const argsDiv = document.createElement('div');
            argsDiv.className = 'tool-call-args';
            argsDiv.textContent = toolCall.function.arguments;
            toolDiv.appendChild(argsDiv);
        }
    }

    return toolDiv;
}

function createToolCallsDisplay(toolCalls) {
    const container = document.createElement('div');
    container.className = 'tool-calls-container';

    if (Array.isArray(toolCalls)) {
        toolCalls.forEach(toolCall => {
            container.appendChild(createToolCallElement(toolCall));
        });
    } else if (typeof toolCalls === 'string') {
        // If it's a string like "[2 tool calls]", just display it
        container.textContent = toolCalls;
    } else {
        // Single tool call object
        container.appendChild(createToolCallElement(toolCalls));
    }

    return container;
}

function createEventElement(event) {
    const eventDiv = document.createElement('div');
    eventDiv.className = 'event-item';

    const header = document.createElement('div');
    header.className = 'event-item-header';

    const badge = document.createElement('span');
    badge.className = `type-badge ${event.eventType}`;
    badge.textContent = event.eventType;

    const time = document.createElement('span');
    time.className = 'event-time';
    time.textContent = formatTimestamp(event.timestamp);

    header.appendChild(badge);
    header.appendChild(time);

    const details = document.createElement('div');
    details.className = 'event-details';

    if (event.data) {
        Object.entries(event.data).forEach(([key, value]) => {
            if (key === 'arguments' || key === 'data') return;

            const row = document.createElement('div');
            row.className = 'detail-row';

            const keySpan = document.createElement('span');
            keySpan.className = 'detail-key';
            keySpan.textContent = key + ':';

            // Special handling for toolCalls field
            if (key === 'toolCalls' && Array.isArray(value) && value.length > 0) {
                const toolCallsDisplay = createToolCallsDisplay(value);
                row.appendChild(keySpan);
                row.appendChild(toolCallsDisplay);
                details.appendChild(row);
                return;
            }

            const valueSpan = document.createElement('span');
            valueSpan.className = 'detail-value';
            valueSpan.textContent = formatValue(value);

            row.appendChild(keySpan);
            row.appendChild(valueSpan);
            details.appendChild(row);
        });
    }

    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(event, null, 2);
    details.appendChild(pre);

    eventDiv.appendChild(header);
    eventDiv.appendChild(details);

    return eventDiv;
}

// ===================================
// FILTER HANDLERS
// ===================================

function handleFilterChange(event) {
    const eventType = event.target.id.replace('filter_', '');
    state.filters.eventTypes[eventType] = event.target.checked;
    renderEventTimeline(state.sessions[state.currentSession]);
}

function handleSearchChange(event) {
    state.filters.searchTerm = event.target.value;
    renderEventTimeline(state.sessions[state.currentSession]);
}

function showErrorsOnly() {
    Object.keys(state.filters.eventTypes).forEach(key => {
        state.filters.eventTypes[key] = false;
        document.getElementById(`filter_${key}`).checked = false;
    });
    state.filters.eventTypes.tool_result = true;
    document.getElementById('filter_tool_result').checked = true;
    renderEventTimeline(state.sessions[state.currentSession]);
}

function showAll() {
    Object.keys(state.filters.eventTypes).forEach(key => {
        state.filters.eventTypes[key] = true;
        document.getElementById(`filter_${key}`).checked = true;
    });
    state.filters.searchTerm = '';
    document.getElementById('searchInput').value = '';
    renderEventTimeline(state.sessions[state.currentSession]);
}

function collapseAll() {
    document.querySelectorAll('.event-group.expanded').forEach(group => {
        group.classList.remove('expanded');
    });
}

function expandAll() {
    document.querySelectorAll('.event-group').forEach(group => {
        group.classList.add('expanded');
    });
}

// ===================================
// ERROR HANDLING
// ===================================

function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = '❌ ' + message;
    errorDiv.style.display = 'block';
    setTimeout(() => errorDiv.style.display = 'none', 5000);
}
