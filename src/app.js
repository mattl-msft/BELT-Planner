(function () {
    "use strict";

    // ===== Constants =====
    const WEEKS_BACK = 26;
    const WEEKS_FORWARD = 26;
    const WINDOW_SIZE = 12;
    const WINDOW_PASS_THRESHOLD = 8;
    const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                         "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const STORAGE_KEY = "belt-planner-state";

    // ===== State =====
    const state = {
        daysRequired: 3,
        // Map<string(YYYY-MM-DD), "in-office"|"vacation">
        // Absent key = default (weekday white / weekend gray)
        dayStates: {},
        vacationMode: false
    };

    // Drag state for vacation mode
    let dragState = null; // { startDate, currentDate, active }

    // ===== Date Helpers =====
    function toKey(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return y + "-" + m + "-" + d;
    }

    function fromKey(key) {
        const parts = key.split("-");
        return new Date(+parts[0], +parts[1] - 1, +parts[2]);
    }

    function addDays(date, n) {
        const d = new Date(date);
        d.setDate(d.getDate() + n);
        return d;
    }

    function getSunday(date) {
        const d = new Date(date);
        d.setDate(d.getDate() - d.getDay());
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function isWeekend(date) {
        const day = date.getDay();
        return day === 0 || day === 6;
    }

    function sameDay(a, b) {
        return a.getFullYear() === b.getFullYear() &&
               a.getMonth() === b.getMonth() &&
               a.getDate() === b.getDate();
    }

    function formatDateRange(sunday) {
        const sat = addDays(sunday, 6);
        return MONTH_NAMES[sunday.getMonth()] + " " + sunday.getDate() +
               " – " + MONTH_NAMES[sat.getMonth()] + " " + sat.getDate();
    }

    // ===== Persistence =====
    function saveState() {
        const data = {
            daysRequired: state.daysRequired,
            dayStates: state.dayStates
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) { /* quota exceeded — silently ignore */ }
    }

    function loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const data = JSON.parse(raw);
            if (typeof data.daysRequired === "number") {
                state.daysRequired = data.daysRequired;
            }
            if (data.dayStates && typeof data.dayStates === "object") {
                state.dayStates = data.dayStates;
            }
        } catch (e) { /* corrupted data — start fresh */ }
    }

    // ===== Evaluation =====
    function getDayState(date) {
        const key = toKey(date);
        if (state.dayStates[key]) return state.dayStates[key];
        return isWeekend(date) ? "weekend" : "default";
    }

    function evaluateWeek(sunday) {
        let inOffice = 0;
        for (let i = 0; i < 7; i++) {
            const d = addDays(sunday, i);
            const s = getDayState(d);
            if (s === "in-office") inOffice++;
        }
        return {
            inOfficeDays: inOffice,
            meets: inOffice >= state.daysRequired
        };
    }

    function evaluateWindow(startSunday) {
        let passing = 0;
        for (let w = 0; w < WINDOW_SIZE; w++) {
            const wSunday = addDays(startSunday, w * 7);
            if (evaluateWeek(wSunday).meets) passing++;
        }
        return {
            passingWeeks: passing,
            meets: passing >= WINDOW_PASS_THRESHOLD
        };
    }

    // ===== Compute all week sundays =====
    function getWeekSundays() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const currentSunday = getSunday(today);
        const sundays = [];
        for (let i = -WEEKS_BACK; i <= WEEKS_FORWARD; i++) {
            sundays.push(addDays(currentSunday, i * 7));
        }
        return sundays;
    }

    // ===== Summary =====
    function computeSummary(sundays) {
        let total = 0, pass = 0, fail = 0;
        for (const sun of sundays) {
            // Only evaluate windows that have all 12 weeks in our range
            const endSunday = addDays(sun, (WINDOW_SIZE - 1) * 7);
            if (endSunday > sundays[sundays.length - 1]) continue;
            const result = evaluateWindow(sun);
            total++;
            if (result.meets) pass++;
            else fail++;
        }
        return { total, pass, fail };
    }

    // ===== Rendering =====
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentSunday = getSunday(today);
    let weekSundays = [];

    // Cache DOM refs per week for targeted updates
    const weekElements = new Map(); // sunday key -> { row, infoCells, dayCells[] }

    function createDayCell(date) {
        const cell = document.createElement("div");
        cell.className = "day-cell";
        cell.dataset.date = toKey(date);

        const numSpan = document.createElement("span");
        numSpan.className = "day-number";
        numSpan.textContent = date.getDate();
        cell.appendChild(numSpan);

        const nameSpan = document.createElement("span");
        nameSpan.className = "day-name";
        nameSpan.textContent = DAY_NAMES[date.getDay()];
        cell.appendChild(nameSpan);

        updateDayCellClass(cell, date);
        return cell;
    }

    function updateDayCellClass(cell, date) {
        const s = getDayState(date);
        cell.classList.remove("weekend", "default", "in-office", "vacation", "today");
        cell.classList.add(s);
        if (sameDay(date, today)) cell.classList.add("today");

        // Remove old edge buttons
        cell.querySelectorAll(".vacation-edge-btn").forEach(b => b.remove());

        // Add edge buttons if vacation
        if (s === "vacation") {
            const prev = addDays(date, -1);
            const next = addDays(date, 1);
            const prevState = getDayState(prev);
            const nextState = getDayState(next);

            if (prevState !== "vacation") {
                const btn = document.createElement("button");
                btn.className = "vacation-edge-btn left";
                btn.textContent = "◀";
                btn.title = "Extend vacation one day earlier";
                btn.addEventListener("click", function (e) {
                    e.stopPropagation();
                    state.dayStates[toKey(prev)] = "vacation";
                    saveState();
                    updateAll();
                });
                cell.appendChild(btn);
            }
            if (nextState !== "vacation") {
                const btn = document.createElement("button");
                btn.className = "vacation-edge-btn right";
                btn.textContent = "▶";
                btn.title = "Extend vacation one day later";
                btn.addEventListener("click", function (e) {
                    e.stopPropagation();
                    state.dayStates[toKey(next)] = "vacation";
                    saveState();
                    updateAll();
                });
                cell.appendChild(btn);
            }
        }
    }

    function updateWeekInfo(sunday, infoEl) {
        const weekResult = evaluateWeek(sunday);
        const windowResult = evaluateWindow(sunday);

        infoEl.innerHTML = "";

        const rangeDiv = document.createElement("div");
        rangeDiv.className = "week-date-range";
        rangeDiv.textContent = formatDateRange(sunday);
        infoEl.appendChild(rangeDiv);

        const statsDiv = document.createElement("div");
        statsDiv.className = "week-stats";
        statsDiv.textContent = "In-office: " + weekResult.inOfficeDays + "/" + state.daysRequired +
            (weekResult.meets ? " ✓" : " ✗");
        infoEl.appendChild(statsDiv);

        const badge = document.createElement("span");
        badge.className = "window-badge " + (windowResult.meets ? "pass" : "fail");
        badge.textContent = "Window: " + windowResult.passingWeeks + "/" + WINDOW_SIZE +
            (windowResult.meets ? " PASS" : " FAIL");
        infoEl.appendChild(badge);
    }

    function renderCalendar() {
        weekSundays = getWeekSundays();
        const container = document.getElementById("calendar-container");
        container.innerHTML = "";
        weekElements.clear();

        // Day-of-week header
        const headerRow = document.createElement("div");
        headerRow.className = "day-header-row";
        const spacer = document.createElement("div");
        headerRow.appendChild(spacer);
        const labels = document.createElement("div");
        labels.className = "day-labels";
        DAY_NAMES.forEach(function (n) {
            const lbl = document.createElement("div");
            lbl.className = "day-label";
            lbl.textContent = n;
            labels.appendChild(lbl);
        });
        headerRow.appendChild(labels);
        container.appendChild(headerRow);

        weekSundays.forEach(function (sunday) {
            const row = document.createElement("div");
            row.className = "week-row";
            if (sameDay(sunday, currentSunday)) row.classList.add("current-week");

            // Left info panel
            const info = document.createElement("div");
            info.className = "week-info";
            updateWeekInfo(sunday, info);
            row.appendChild(info);

            // Right day cells
            const daysGrid = document.createElement("div");
            daysGrid.className = "week-days";
            const dayCells = [];
            for (let i = 0; i < 7; i++) {
                const date = addDays(sunday, i);
                const cell = createDayCell(date);
                daysGrid.appendChild(cell);
                dayCells.push(cell);
            }
            row.appendChild(daysGrid);

            container.appendChild(row);
            weekElements.set(toKey(sunday), { row: row, info: info, dayCells: dayCells, sunday: sunday });
        });

        // Scroll to current week
        const currentKey = toKey(currentSunday);
        const current = weekElements.get(currentKey);
        if (current) {
            current.row.scrollIntoView({ block: "start" });
            // Offset for sticky header
            window.scrollBy(0, -80);
        }
    }

    function updateSummary() {
        const summary = computeSummary(weekSundays);
        const el = document.getElementById("summary-text");
        el.innerHTML = "";
        el.textContent = "Windows evaluated: " + summary.total + "  ";

        const passBadge = document.createElement("span");
        passBadge.className = "summary-badge pass";
        passBadge.textContent = "Pass: " + summary.pass;
        el.appendChild(passBadge);

        el.appendChild(document.createTextNode("  "));

        const failBadge = document.createElement("span");
        failBadge.className = "summary-badge fail";
        failBadge.textContent = "Fail: " + summary.fail;
        el.appendChild(failBadge);
    }

    function updateAll() {
        weekElements.forEach(function (entry) {
            updateWeekInfo(entry.sunday, entry.info);
            for (let i = 0; i < 7; i++) {
                const date = addDays(entry.sunday, i);
                updateDayCellClass(entry.dayCells[i], date);
            }
        });
        updateSummary();
    }

    // ===== Click Handling =====
    function handleDayClick(dateKey) {
        const date = fromKey(dateKey);
        const currentState = getDayState(date);

        if (state.vacationMode) {
            // Toggle vacation
            if (currentState === "vacation") {
                delete state.dayStates[dateKey];
            } else {
                state.dayStates[dateKey] = "vacation";
            }
        } else {
            // Toggle in-office
            if (currentState === "in-office") {
                delete state.dayStates[dateKey];
            } else {
                state.dayStates[dateKey] = "in-office";
            }
        }
        saveState();
        updateAll();
    }

    // ===== Drag Handling (vacation mode) =====
    function getDatesInRange(startKey, endKey) {
        let startDate = fromKey(startKey);
        let endDate = fromKey(endKey);
        if (startDate > endDate) {
            const tmp = startDate;
            startDate = endDate;
            endDate = tmp;
        }
        const dates = [];
        let d = new Date(startDate);
        while (d <= endDate) {
            dates.push(toKey(d));
            d = addDays(d, 1);
        }
        return dates;
    }

    function clearDragHighlights() {
        document.querySelectorAll(".day-cell.drag-highlight").forEach(function (el) {
            el.classList.remove("drag-highlight");
        });
    }

    function applyDragHighlights(dateKeys) {
        dateKeys.forEach(function (key) {
            const el = document.querySelector('.day-cell[data-date="' + key + '"]');
            if (el) el.classList.add("drag-highlight");
        });
    }

    // ===== Event Wiring =====
    function init() {
        loadState();

        const daysInput = document.getElementById("days-required");
        daysInput.value = state.daysRequired;
        daysInput.addEventListener("change", function () {
            const val = parseInt(daysInput.value, 10);
            if (val >= 1 && val <= 5) {
                state.daysRequired = val;
                saveState();
                updateAll();
            }
        });

        const vacBtn = document.getElementById("vacation-mode-btn");
        vacBtn.addEventListener("click", function () {
            state.vacationMode = !state.vacationMode;
            vacBtn.textContent = "Vacation Mode: " + (state.vacationMode ? "ON" : "OFF");
            vacBtn.classList.toggle("active", state.vacationMode);
        });

        renderCalendar();
        updateSummary();

        // Delegate click and drag events on the calendar container
        const container = document.getElementById("calendar-container");

        container.addEventListener("mousedown", function (e) {
            const cell = e.target.closest(".day-cell");
            if (!cell) return;
            const dateKey = cell.dataset.date;
            if (!dateKey) return;

            if (state.vacationMode) {
                dragState = { startDate: dateKey, currentDate: dateKey, active: true };
                clearDragHighlights();
                applyDragHighlights([dateKey]);
                e.preventDefault();
            }
        });

        container.addEventListener("mousemove", function (e) {
            if (!dragState || !dragState.active) return;
            const cell = e.target.closest(".day-cell");
            if (!cell) return;
            const dateKey = cell.dataset.date;
            if (!dateKey || dateKey === dragState.currentDate) return;

            dragState.currentDate = dateKey;
            clearDragHighlights();
            const range = getDatesInRange(dragState.startDate, dateKey);
            applyDragHighlights(range);
        });

        document.addEventListener("mouseup", function () {
            if (!dragState || !dragState.active) return;

            if (dragState.startDate === dragState.currentDate) {
                // Single click in vacation mode
                handleDayClick(dragState.startDate);
            } else {
                // Drag range — set all to vacation
                const range = getDatesInRange(dragState.startDate, dragState.currentDate);
                range.forEach(function (key) {
                    state.dayStates[key] = "vacation";
                });
                saveState();
                updateAll();
            }

            clearDragHighlights();
            dragState = null;
        });

        // Normal mode clicks (non-drag)
        container.addEventListener("click", function (e) {
            if (state.vacationMode) return; // handled by mousedown/mouseup
            const cell = e.target.closest(".day-cell");
            if (!cell) return;
            // Ignore if click was on an edge button
            if (e.target.closest(".vacation-edge-btn")) return;
            const dateKey = cell.dataset.date;
            if (!dateKey) return;
            handleDayClick(dateKey);
        });
    }

    // Boot
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
