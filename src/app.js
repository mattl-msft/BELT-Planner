(function () {
	'use strict';

	// ===== Constants =====
	const WINDOW_SIZE = 12;
	const WINDOW_PASS_THRESHOLD = 8;
	const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	const MONTH_NAMES = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec',
	];
	const STORAGE_KEY = 'belt-planner-state';

	// ===== State =====
	const state = {
		daysRequired: 3,
		weeksBack: 12,
		weeksForward: 26,
		// Map<string(YYYY-MM-DD), "in-office"|"vacation">
		// Absent key = default (weekday white / weekend gray)
		dayStates: {},
		vacationMode: false,
		// Array of day-of-week indices (0=Sun..6=Sat) that are regular in-office days
		regularDays: [],
		showHolidays: true,
	};

	// Drag state for vacation mode
	let dragState = null; // { startDate, currentDate, active }

	// ===== Date Helpers =====
	function toKey(date) {
		const y = date.getFullYear();
		const m = String(date.getMonth() + 1).padStart(2, '0');
		const d = String(date.getDate()).padStart(2, '0');
		return y + '-' + m + '-' + d;
	}

	function fromKey(key) {
		const parts = key.split('-');
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
		return (
			a.getFullYear() === b.getFullYear() &&
			a.getMonth() === b.getMonth() &&
			a.getDate() === b.getDate()
		);
	}

	function formatDateRange(sunday) {
		const sat = addDays(sunday, 6);
		return (
			MONTH_NAMES[sunday.getMonth()] +
			' ' +
			sunday.getDate() +
			' – ' +
			MONTH_NAMES[sat.getMonth()] +
			' ' +
			sat.getDate()
		);
	}

	// ===== Microsoft Company Holidays =====
	function getNthWeekday(year, month, weekday, n) {
		var first = new Date(year, month, 1);
		var diff = (weekday - first.getDay() + 7) % 7;
		return new Date(year, month, 1 + diff + (n - 1) * 7);
	}

	function getLastWeekday(year, month, weekday) {
		var last = new Date(year, month + 1, 0);
		var diff = (last.getDay() - weekday + 7) % 7;
		return new Date(year, month, last.getDate() - diff);
	}

	function observedDate(year, month, day) {
		var d = new Date(year, month, day);
		var dow = d.getDay();
		if (dow === 6) return new Date(year, month, day - 1);
		if (dow === 0) return new Date(year, month, day + 1);
		return d;
	}

	function getChristmasPair(year) {
		var eveDow = new Date(year, 11, 24).getDay();
		if (eveDow === 5) return [new Date(year, 11, 24), new Date(year, 11, 23)];
		if (eveDow === 6) return [new Date(year, 11, 23), new Date(year, 11, 26)];
		if (eveDow === 0) return [new Date(year, 11, 22), new Date(year, 11, 25)];
		return [new Date(year, 11, 24), new Date(year, 11, 25)];
	}

	function getMicrosoftHolidays(year) {
		var thanksgiving = getNthWeekday(year, 10, 4, 4);
		var christmas = getChristmasPair(year);
		return [
			{ name: "New Year's Day", date: observedDate(year, 0, 1) },
			{ name: 'MLK Day', date: getNthWeekday(year, 0, 1, 3) },
			{ name: "Presidents' Day", date: getNthWeekday(year, 1, 1, 3) },
			{ name: 'Memorial Day', date: getLastWeekday(year, 4, 1) },
			{ name: 'Independence Day', date: observedDate(year, 6, 4) },
			{ name: 'Labor Day', date: getNthWeekday(year, 8, 1, 1) },
			{ name: 'Thanksgiving', date: thanksgiving },
			{ name: 'Day after Thanksgiving', date: addDays(thanksgiving, 1) },
			{ name: 'Christmas Eve', date: christmas[0] },
			{ name: 'Christmas Day', date: christmas[1] },
		];
	}

	var holidayMap = {};
	for (var y = 2026; y <= 2030; y++) {
		getMicrosoftHolidays(y).forEach(function (h) {
			holidayMap[toKey(h.date)] = h.name;
		});
	}

	// ===== Persistence =====
	function saveState() {
		const data = {
			daysRequired: state.daysRequired,
			weeksBack: state.weeksBack,
			weeksForward: state.weeksForward,
			dayStates: state.dayStates,
			regularDays: state.regularDays,
			showHolidays: state.showHolidays,
		};
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
		} catch (e) {
			/* quota exceeded — silently ignore */
		}
	}

	function loadState() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const data = JSON.parse(raw);
			if (typeof data.daysRequired === 'number') {
				state.daysRequired = data.daysRequired;
			}
			if (data.dayStates && typeof data.dayStates === 'object') {
				state.dayStates = data.dayStates;
			}
			if (Array.isArray(data.regularDays)) {
				state.regularDays = data.regularDays;
			}
			if (typeof data.showHolidays === 'boolean') {
				state.showHolidays = data.showHolidays;
			}
			if (typeof data.weeksBack === 'number') {
				state.weeksBack = data.weeksBack;
			}
			if (typeof data.weeksForward === 'number') {
				state.weeksForward = data.weeksForward;
			}
		} catch (e) {
			/* corrupted data — start fresh */
		}
	}

	// ===== Evaluation =====
	function getDayState(date) {
		const key = toKey(date);
		if (state.dayStates[key]) return state.dayStates[key];
		return isWeekend(date) ? 'weekend' : 'default';
	}

	function evaluateWeek(sunday) {
		let inOffice = 0;
		for (let i = 0; i < 7; i++) {
			const d = addDays(sunday, i);
			const s = getDayState(d);
			if (s === 'in-office') inOffice++;
		}
		return {
			inOfficeDays: inOffice,
			meets: inOffice >= state.daysRequired,
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
			meets: passing >= WINDOW_PASS_THRESHOLD,
		};
	}

	// ===== Compute all week sundays =====
	function getWeekSundays() {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const currentSunday = getSunday(today);
		const sundays = [];
		for (let i = -state.weeksBack; i <= state.weeksForward; i++) {
			sundays.push(addDays(currentSunday, i * 7));
		}
		return sundays;
	}

	// ===== Summary =====
	function computeSummary(sundays) {
		let total = 0,
			pass = 0,
			warn = 0,
			fail = 0;
		for (const sun of sundays) {
			// Only evaluate windows that have all 12 weeks in our range
			const endSunday = addDays(sun, (WINDOW_SIZE - 1) * 7);
			if (endSunday > sundays[sundays.length - 1]) continue;
			const result = evaluateWindow(sun);
			total++;
			if (result.passingWeeks >= 9) pass++;
			else if (result.passingWeeks === 8) warn++;
			else fail++;
		}
		return { total, pass, warn, fail };
	}

	// ===== Rendering =====
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const currentSunday = getSunday(today);
	let weekSundays = [];

	// Cache DOM refs per week for targeted updates
	const weekElements = new Map(); // sunday key -> { row, infoCells, dayCells[] }

	function createDayCell(date) {
		const cell = document.createElement('div');
		cell.className = 'day-cell';
		cell.dataset.date = toKey(date);

		const numSpan = document.createElement('span');
		numSpan.className = 'day-number';
		numSpan.textContent = date.getDate();
		cell.appendChild(numSpan);

		const nameSpan = document.createElement('span');
		nameSpan.className = 'day-name';
		nameSpan.textContent = DAY_NAMES[date.getDay()];
		cell.appendChild(nameSpan);

		updateDayCellClass(cell, date);
		return cell;
	}

	function updateDayCellClass(cell, date) {
		const s = getDayState(date);
		cell.classList.remove(
			'weekend',
			'default',
			'in-office',
			'vacation',
			'today',
			'holiday',
		);
		cell.classList.add(s);
		if (sameDay(date, today)) cell.classList.add('today');

		// Holiday indicator
		var dateKey = cell.dataset.date;
		var nameSpan = cell.querySelector('.day-name');
		if (state.showHolidays && holidayMap[dateKey]) {
			cell.classList.add('holiday');
			cell.title = holidayMap[dateKey];
			nameSpan.textContent = holidayMap[dateKey];
		} else {
			cell.title = '';
			var d = fromKey(dateKey);
			nameSpan.textContent = DAY_NAMES[d.getDay()];
		}

		// Remove old edge buttons
		cell.querySelectorAll('.vacation-edge-btn').forEach((b) => b.remove());

		// Add edge buttons if vacation
		if (s === 'vacation') {
			const prev = addDays(date, -1);
			const next = addDays(date, 1);
			const prevState = getDayState(prev);
			const nextState = getDayState(next);

			if (prevState !== 'vacation') {
				const btn = document.createElement('button');
				btn.className = 'vacation-edge-btn left';
				btn.textContent = '◀';
				btn.title = 'Extend vacation one day earlier';
				btn.addEventListener('click', function (e) {
					e.stopPropagation();
					state.dayStates[toKey(prev)] = 'vacation';
					saveState();
					updateAll();
				});
				cell.appendChild(btn);
			}
			if (nextState !== 'vacation') {
				const btn = document.createElement('button');
				btn.className = 'vacation-edge-btn right';
				btn.textContent = '▶';
				btn.title = 'Extend vacation one day later';
				btn.addEventListener('click', function (e) {
					e.stopPropagation();
					state.dayStates[toKey(next)] = 'vacation';
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
		const lastSunday = weekSundays[weekSundays.length - 1];
		const windowEndSunday = addDays(sunday, (WINDOW_SIZE - 1) * 7);
		const outOfRange = windowEndSunday > lastSunday;

		infoEl.innerHTML = '';

		const rangeDiv = document.createElement('div');
		rangeDiv.className = 'week-date-range';
		rangeDiv.textContent = formatDateRange(sunday);
		infoEl.appendChild(rangeDiv);

		const statsDiv = document.createElement('div');
		statsDiv.className = 'week-stats';
		statsDiv.textContent =
			'In-office: ' +
			weekResult.inOfficeDays +
			'/' +
			state.daysRequired +
			(weekResult.meets ? ' ✓' : ' ✗');
		infoEl.appendChild(statsDiv);

		const badge = document.createElement('span');
		const windowStart = sunday;
		const windowEnd = addDays(sunday, WINDOW_SIZE * 7 - 1);

		if (outOfRange) {
			badge.className = 'window-badge out-of-range';
			badge.textContent =
				'Window ' +
				(windowStart.getMonth() + 1) +
				'/' +
				windowStart.getDate() +
				' to ' +
				(windowEnd.getMonth() + 1) +
				'/' +
				windowEnd.getDate() +
				'  |  Out of range';
		} else {
			var badgeLevel;
			if (windowResult.passingWeeks >= 9) {
				badgeLevel = 'good';
			} else if (windowResult.passingWeeks === 8) {
				badgeLevel = 'warn';
			} else {
				badgeLevel = 'fail';
			}
			badge.className = 'window-badge ' + badgeLevel;
			var badgeIcon =
				badgeLevel === 'good' ? ' ✓' : badgeLevel === 'warn' ? ' ⚠' : ' ✗';
			badge.textContent =
				'Window ' +
				(windowStart.getMonth() + 1) +
				'/' +
				windowStart.getDate() +
				' to ' +
				(windowEnd.getMonth() + 1) +
				'/' +
				windowEnd.getDate() +
				'  |  ' +
				windowResult.passingWeeks +
				' of ' +
				WINDOW_SIZE +
				badgeIcon;
		}
		infoEl.appendChild(badge);
	}

	function renderCalendar() {
		weekSundays = getWeekSundays();
		const container = document.getElementById('calendar-container');
		container.innerHTML = '';
		weekElements.clear();

		// Day-of-week header
		const headerRow = document.createElement('div');
		headerRow.className = 'day-header-row';
		const spacer = document.createElement('div');
		headerRow.appendChild(spacer);
		const monthSpacer = document.createElement('div');
		headerRow.appendChild(monthSpacer);
		const labels = document.createElement('div');
		labels.className = 'day-labels';
		DAY_NAMES.forEach(function (n) {
			const lbl = document.createElement('div');
			lbl.className = 'day-label';
			lbl.textContent = n;
			labels.appendChild(lbl);
		});
		headerRow.appendChild(labels);
		container.appendChild(headerRow);

		weekSundays.forEach(function (sunday) {
			const row = document.createElement('div');
			row.className = 'week-row';
			if (sameDay(sunday, currentSunday)) row.classList.add('current-week');

			// Left info panel
			const info = document.createElement('div');
			info.className = 'week-info';
			updateWeekInfo(sunday, info);
			row.appendChild(info);

			// Month label column
			const monthLabel = document.createElement('div');
			monthLabel.className = 'month-label';
			var monthText = '';
			for (var d = 0; d < 7; d++) {
				var dayDate = addDays(sunday, d);
				if (dayDate.getDate() === 1) {
					monthText = MONTH_NAMES[dayDate.getMonth()];
					break;
				}
			}
			monthLabel.textContent = monthText;
			row.appendChild(monthLabel);

			// Right day cells
			const daysGrid = document.createElement('div');
			daysGrid.className = 'week-days';
			const dayCells = [];
			for (let i = 0; i < 7; i++) {
				const date = addDays(sunday, i);
				const cell = createDayCell(date);
				daysGrid.appendChild(cell);
				dayCells.push(cell);
			}
			row.appendChild(daysGrid);

			container.appendChild(row);
			weekElements.set(toKey(sunday), {
				row: row,
				info: info,
				dayCells: dayCells,
				sunday: sunday,
			});
		});

		// Scroll to current week
		const currentKey = toKey(currentSunday);
		const current = weekElements.get(currentKey);
		if (current) {
			current.row.scrollIntoView({ block: 'center' });
		}
	}

	function updateSummary() {
		const summary = computeSummary(weekSundays);
		const el = document.getElementById('summary-text');
		el.innerHTML = '';
		const evalLabel = document.createElement('span');
		evalLabel.className = 'sidebar-label';
		evalLabel.textContent = 'Windows evaluated: ';
		el.appendChild(evalLabel);
		el.appendChild(document.createTextNode(summary.total));

		el.appendChild(document.createElement('br'));

		const passBadge = document.createElement('span');
		passBadge.className = 'summary-badge good';
		passBadge.textContent = '\u2713 Pass: ' + summary.pass;
		el.appendChild(passBadge);

		el.appendChild(document.createTextNode('  '));

		const warnBadge = document.createElement('span');
		warnBadge.className = 'summary-badge warn';
		warnBadge.textContent = '\u26A0 Warn: ' + summary.warn;
		el.appendChild(warnBadge);

		el.appendChild(document.createTextNode('  '));

		const failBadge = document.createElement('span');
		failBadge.className = 'summary-badge fail';
		failBadge.textContent = '\u2717 Fail: ' + summary.fail;
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
		updateMinimap();
	}

	// ===== Minimap =====
	function getWeekWindowStatus(sunday) {
		const lastSunday = weekSundays[weekSundays.length - 1];
		const windowEndSunday = addDays(sunday, (WINDOW_SIZE - 1) * 7);
		if (windowEndSunday > lastSunday) return 'out-of-range';
		const result = evaluateWindow(sunday);
		if (result.passingWeeks >= 9) return 'good';
		if (result.passingWeeks === 8) return 'warn';
		return 'fail';
	}

	function updateMinimap() {
		const container = document.getElementById('minimap');
		container.innerHTML = '';
		weekSundays.forEach(function (sunday, idx) {
			const seg = document.createElement('div');
			const status = getWeekWindowStatus(sunday);
			seg.className = 'minimap-segment mm-' + status;
			if (sameDay(sunday, currentSunday)) seg.classList.add('mm-current');
			seg.title = formatDateRange(sunday);
			seg.addEventListener('click', function () {
				const entry = weekElements.get(toKey(sunday));
				if (entry)
					entry.row.scrollIntoView({ block: 'center', behavior: 'smooth' });
			});
			container.appendChild(seg);
		});
	}

	// ===== Click Handling =====
	function handleDayClick(dateKey) {
		const date = fromKey(dateKey);
		const currentState = getDayState(date);

		if (state.vacationMode) {
			// Toggle vacation
			if (currentState === 'vacation') {
				delete state.dayStates[dateKey];
			} else {
				state.dayStates[dateKey] = 'vacation';
			}
		} else {
			// Toggle in-office
			if (currentState === 'in-office') {
				delete state.dayStates[dateKey];
			} else {
				state.dayStates[dateKey] = 'in-office';
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
		document
			.querySelectorAll('.day-cell.drag-highlight')
			.forEach(function (el) {
				el.classList.remove('drag-highlight');
			});
	}

	function applyDragHighlights(dateKeys) {
		dateKeys.forEach(function (key) {
			const el = document.querySelector('.day-cell[data-date="' + key + '"]');
			if (el) el.classList.add('drag-highlight');
		});
	}

	// ===== Regular Days Logic =====
	function applyRegularDay(dayIndex, checked) {
		weekSundays.forEach(function (sunday) {
			for (var i = 0; i < 7; i++) {
				var date = addDays(sunday, i);
				if (date.getDay() !== dayIndex) continue;
				var key = toKey(date);
				if (checked) {
					// Only set to in-office if not already vacation or a holiday
					if (
						state.dayStates[key] !== 'vacation' &&
						!(state.showHolidays && holidayMap[key])
					) {
						state.dayStates[key] = 'in-office';
					}
				} else {
					// Only clear if currently in-office
					if (state.dayStates[key] === 'in-office') {
						delete state.dayStates[key];
					}
				}
			}
		});
	}

	// ===== Event Wiring =====
	function init() {
		loadState();

		// Settings toggle
		var settingsBtn = document.getElementById('settings-toggle-btn');
		var settingsPanel = document.getElementById('settings-panel');
		settingsBtn.addEventListener('click', function () {
			var isHidden = settingsPanel.hidden;
			settingsPanel.hidden = !isHidden;
			settingsBtn.classList.toggle('active', isHidden);
			settingsBtn.textContent = isHidden
				? 'Settings \u25b4'
				: 'Settings \u25be';
		});

		const daysInput = document.getElementById('days-required');
		daysInput.value = state.daysRequired;
		daysInput.addEventListener('change', function () {
			const val = parseInt(daysInput.value, 10);
			if (val >= 1 && val <= 5) {
				state.daysRequired = val;
				saveState();
				updateAll();
			}
		});

		var weeksBackInput = document.getElementById('weeks-back');
		var weeksForwardInput = document.getElementById('weeks-forward');
		weeksBackInput.value = state.weeksBack;
		weeksForwardInput.value = state.weeksForward;
		weeksBackInput.addEventListener('change', function () {
			var val = parseInt(weeksBackInput.value, 10);
			if (val >= 1 && val <= 52) {
				state.weeksBack = val;
				saveState();
				renderCalendar();
				updateSummary();
				updateMinimap();
			}
		});
		weeksForwardInput.addEventListener('change', function () {
			var val = parseInt(weeksForwardInput.value, 10);
			if (val >= 1 && val <= 52) {
				state.weeksForward = val;
				saveState();
				renderCalendar();
				updateSummary();
				updateMinimap();
			}
		});

		// Regular in-office day checkboxes
		var checkboxes = document.querySelectorAll(
			'#regular-days-checkboxes input[type=checkbox]',
		);
		checkboxes.forEach(function (cb) {
			var dayIdx = parseInt(cb.dataset.day, 10);
			cb.checked = state.regularDays.indexOf(dayIdx) !== -1;
			cb.addEventListener('change', function () {
				if (cb.checked) {
					if (state.regularDays.indexOf(dayIdx) === -1) {
						state.regularDays.push(dayIdx);
					}
				} else {
					state.regularDays = state.regularDays.filter(function (d) {
						return d !== dayIdx;
					});
				}
				applyRegularDay(dayIdx, cb.checked);
				saveState();
				updateAll();
			});
		});

		// Holiday checkbox
		var holidayCb = document.getElementById('show-holidays');
		holidayCb.checked = state.showHolidays;
		holidayCb.addEventListener('change', function () {
			state.showHolidays = holidayCb.checked;
			saveState();
			updateAll();
		});

		const modeToggle = document.getElementById('mode-toggle');
		const inOfficeBtn = modeToggle.querySelector('[data-mode="in-office"]');
		const outOfOfficeBtn = modeToggle.querySelector(
			'[data-mode="out-of-office"]',
		);
		const cursorDot = document.getElementById('cursor-dot');

		function updateModeToggle() {
			if (state.vacationMode) {
				inOfficeBtn.classList.remove('active');
				outOfOfficeBtn.classList.add('active');
				cursorDot.style.background = '#9b59b6';
			} else {
				inOfficeBtn.classList.add('active');
				outOfOfficeBtn.classList.remove('active');
				cursorDot.style.background = '#27ae60';
			}
		}

		inOfficeBtn.addEventListener('click', function () {
			state.vacationMode = false;
			updateModeToggle();
		});

		outOfOfficeBtn.addEventListener('click', function () {
			state.vacationMode = true;
			updateModeToggle();
		});

		// Cursor dot follows mouse, visible only over day cells
		document.addEventListener('mousemove', function (e) {
			cursorDot.style.left = e.clientX + 'px';
			cursorDot.style.top = e.clientY + 'px';
			var overDayCell = e.target.closest('.day-cell') !== null;
			cursorDot.style.opacity = overDayCell ? '1' : '0';
		});

		renderCalendar();
		updateSummary();
		updateMinimap();

		// Delegate click and drag events on the calendar container
		const container = document.getElementById('calendar-container');

		container.addEventListener('mousedown', function (e) {
			const cell = e.target.closest('.day-cell');
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

		container.addEventListener('mousemove', function (e) {
			if (!dragState || !dragState.active) return;
			const cell = e.target.closest('.day-cell');
			if (!cell) return;
			const dateKey = cell.dataset.date;
			if (!dateKey || dateKey === dragState.currentDate) return;

			dragState.currentDate = dateKey;
			clearDragHighlights();
			const range = getDatesInRange(dragState.startDate, dateKey);
			applyDragHighlights(range);
		});

		document.addEventListener('mouseup', function () {
			if (!dragState || !dragState.active) return;

			if (dragState.startDate === dragState.currentDate) {
				// Single click in vacation mode
				handleDayClick(dragState.startDate);
			} else {
				// Drag range — set all to vacation
				const range = getDatesInRange(
					dragState.startDate,
					dragState.currentDate,
				);
				range.forEach(function (key) {
					state.dayStates[key] = 'vacation';
				});
				saveState();
				updateAll();
			}

			clearDragHighlights();
			dragState = null;
		});

		// Normal mode clicks (non-drag)
		container.addEventListener('click', function (e) {
			if (state.vacationMode) return; // handled by mousedown/mouseup
			const cell = e.target.closest('.day-cell');
			if (!cell) return;
			// Ignore if click was on an edge button
			if (e.target.closest('.vacation-edge-btn')) return;
			const dateKey = cell.dataset.date;
			if (!dateKey) return;
			handleDayClick(dateKey);
		});
	}

	// Boot
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
