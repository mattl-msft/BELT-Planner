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
		weeksForward: 38,
		// Map<string(YYYY-MM-DD), "in-office"|"vacation"|"work-from-home"|"default"|"weekend">
		// Absent key = recurring schedule, or unmarked weekday/weekend
		dayStates: {},
		markMode: 'out-of-office',
		// Array of day-of-week indices (0=Sun..6=Sat) that are regular in-office days
		regularDays: [],
		showHolidays: true,
	};

	let dragState = null; // { startDate, currentDate, mode, active }

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
			sunday.toLocaleDateString('en-US', { month: 'long' }) +
			' ' +
			sunday.getDate() +
			' - ' +
			(sunday.getMonth() === sat.getMonth() ? '' : sat.toLocaleDateString('en-US', { month: 'long' }) + ' ') +
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
	function getSavedState() {
		return {
			daysRequired: state.daysRequired,
			weeksBack: state.weeksBack,
			weeksForward: state.weeksForward,
			dayStates: state.dayStates,
			regularDays: state.regularDays,
			showHolidays: state.showHolidays,
		};
	}

	let appMessageTimer;

	function hideAppMessage() {
		clearTimeout(appMessageTimer);
		appMessageTimer = undefined;
		document.getElementById('app-message').hidden = true;
	}

	function showAppMessage(message, isError = false) {
		clearTimeout(appMessageTimer);
		appMessageTimer = undefined;
		const dialog = document.querySelector('.app-dialog[open]');
		if (isError && dialog) {
			const dialogMessage = dialog.querySelector('.dialog-message');
			dialogMessage.textContent = message;
			dialogMessage.hidden = false;
			return;
		}
		const notification = document.getElementById('app-message');
		document.getElementById('app-message-text').textContent = message;
		notification.classList.toggle('error', isError);
		notification.setAttribute('role', isError ? 'alert' : 'status');
		notification.hidden = false;
		if (!isError) {
			appMessageTimer = setTimeout(hideAppMessage, 3000);
		}
	}

	function saveState() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(getSavedState()));
		} catch (e) {
			console.error('Unable to save planner data locally.', e);
			showAppMessage('Unable to save data locally. Download a save file from the app info dialog to keep your changes.', true);
		}
	}

	function createSaveFile() {
		const data = getSavedState();
		data.dayStates = Object.fromEntries(Object.entries(data.dayStates).filter(([key, dayState]) =>
			dayState !== 'in-office' || getScheduledDayState(fromKey(key)) !== 'in-office'));
		return JSON.stringify({
			app: 'BELT Planner',
			formatVersion: 1,
			appVersion: BELT_APP_INFO.version,
			savedAt: new Date().toISOString(),
			data,
		}, null, 2);
	}

	function parseSaveFile(text) {
		let file;
		try {
			file = JSON.parse(text);
		} catch (error) {
			if (!(error instanceof SyntaxError)) throw error;
			throw new Error('The save file is not valid JSON.');
		}
		if (!file || file.app !== 'BELT Planner' || file.formatVersion !== 1) {
			throw new Error('This is not a supported BELT Planner save file.');
		}
		const data = file.data;
		if (!data || typeof data !== 'object' || Array.isArray(data) ||
			!Number.isInteger(data.daysRequired) || data.daysRequired < 1 || data.daysRequired > 5 ||
			!Number.isInteger(data.weeksBack) || data.weeksBack < 1 || data.weeksBack > 52 ||
			!Number.isInteger(data.weeksForward) || data.weeksForward < 1 || data.weeksForward > 52 ||
			typeof data.showHolidays !== 'boolean' ||
			!Array.isArray(data.regularDays) ||
			data.regularDays.some(day => !Number.isInteger(day) || day < 0 || day > 6) ||
			new Set(data.regularDays).size !== data.regularDays.length ||
			!data.dayStates || typeof data.dayStates !== 'object' || Array.isArray(data.dayStates)) {
			throw new Error('The save file contains invalid planner settings.');
		}
		const allowedStates = ['in-office', 'vacation', 'work-from-home', 'default', 'weekend'];
		const entries = Object.entries(data.dayStates);
		if (entries.some(([key, value]) => !/^\d{4}-\d{2}-\d{2}$/.test(key) ||
			toKey(fromKey(key)) !== key || !allowedStates.includes(value))) {
			throw new Error('The save file contains invalid dates or day markings.');
		}
		return {
			daysRequired: data.daysRequired,
			weeksBack: data.weeksBack,
			weeksForward: data.weeksForward,
			regularDays: data.regularDays.slice(),
			showHolidays: data.showHolidays,
			dayStates: Object.fromEntries(entries),
		};
	}

	function restoreSaveFile(text) {
		const data = parseSaveFile(text);
		// Persist before changing the current plan so a failed write leaves it intact.
		localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
		Object.assign(state, data);
	}

	function loadState() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw === null) return 'empty';
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
			return 'loaded';
		} catch (e) {
			console.error('Unable to load locally saved planner data.', e);
			showAppMessage('Unable to load locally saved data. Restore a save file, or clear local data from the app info dialog.', true);
			return 'error';
		}
	}

	// ===== Evaluation =====
	function getDayState(date) {
		const key = toKey(date);
		if (state.dayStates[key] === 'vacation' && state.showHolidays && holidayMap[key]) {
			return getScheduledDayState(date);
		}
		if (state.dayStates[key]) return state.dayStates[key];
		return getScheduledDayState(date);
	}

	function getScheduledDayState(date) {
		if (
			state.regularDays.indexOf(date.getDay()) !== -1 &&
			!(state.showHolidays && holidayMap[toKey(date)])
		) {
			return 'in-office';
		}
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
	function getCompleteWindowSundays(sundays) {
		return sundays.slice(0, Math.max(0, sundays.length - WINDOW_SIZE + 1));
	}

	function computeSummary(sundays) {
		let total = 0,
			pass = 0,
			warn = 0,
			fail = 0;
		for (const sun of getCompleteWindowSundays(sundays)) {
			const result = evaluateWindow(sun);
			total++;
			if (result.passingWeeks >= 9) pass++;
			else if (result.passingWeeks === 8) warn++;
			else fail++;
		}
		return { total, pass, warn, fail };
	}

	function computeWeekAttention(sundays) {
		const qualifying = sundays.map(sunday => evaluateWeek(sunday).meets);
		const levels = sundays.map(() => 'good');
		for (let start = 0; start <= sundays.length - WINDOW_SIZE; start++) {
			const passing = qualifying.slice(start, start + WINDOW_SIZE).filter(Boolean).length;
			if (passing > WINDOW_PASS_THRESHOLD) continue;
			for (let index = start; index < start + WINDOW_SIZE; index++) {
				if (passing < WINDOW_PASS_THRESHOLD) levels[index] = 'fail';
				else if (levels[index] !== 'fail') levels[index] = 'warn';
			}
		}
		return new Map(sundays.map((sunday, index) => [toKey(sunday), levels[index]]));
	}

	function getAttentionRanges(sundays, attentionLevels) {
		const ranges = [];
		sundays.forEach(function (sunday, index) {
			const level = attentionLevels.get(toKey(sunday));
			if (level === 'good') return;
			const previous = ranges[ranges.length - 1];
			if (previous && previous.level === level && previous.end === index) {
				previous.end = index + 1;
			} else {
				ranges.push({ start: index, end: index + 1, level: level });
			}
		});
		return ranges;
	}

	function updateAttentionFlags(attentionLevels) {
		const container = document.getElementById('calendar-container');
		container.querySelectorAll('.attention-range').forEach(range => range.remove());
		getAttentionRanges(weekSundays, attentionLevels).forEach(function (range) {
			const section = document.createElement('div');
			section.className = 'attention-range';
			section.style.gridRow = (range.start + 1) + ' / ' + (range.end + 1);
			const flag = document.createElement('div');
			flag.className = 'attention-flag ' + range.level;
			flag.textContent = range.level === 'fail' ? 'Below target' : 'At threshold';
			flag.setAttribute('role', 'note');
			flag.setAttribute('aria-label', flag.textContent + ', '
				+ weekSundays[range.start].toLocaleDateString() + ' to '
				+ addDays(weekSundays[range.end - 1], 6).toLocaleDateString());
			flag.tabIndex = 0;
			const bubble = document.createElement('span');
			bubble.className = 'attention-flag-bubble';
			bubble.id = 'attention-flag-help-' + range.start;
			bubble.setAttribute('role', 'tooltip');
			bubble.textContent = range.level === 'fail'
				? 'Weeks in this range do not meet requirements.'
				: 'No additional weeks can be spent WFH or OOF in this range.';
			flag.setAttribute('aria-describedby', bubble.id);
			flag.appendChild(bubble);
			flag.addEventListener('keydown', function (event) {
				if (event.key === 'Escape') {
					flag.classList.add('bubble-dismissed');
					event.stopPropagation();
				}
			});
			function resetBubble() { flag.classList.remove('bubble-dismissed'); }
			flag.addEventListener('mouseenter', resetBubble);
			flag.addEventListener('focus', resetBubble);
			section.appendChild(flag);
			container.appendChild(section);
		});
	}

	function getWeekAttentionStatus(level) {
		return {
			status: level,
			description: level === 'fail'
				? 'Below expectations: this week is part of a 12-week window with fewer than 8 qualifying weeks.'
				: level === 'warn'
					? 'At threshold: this week is part of a 12-week window with exactly 8 qualifying weeks. No additional weeks can be spent WFH or OOF in this range.'
					: 'No additional constraint from complete 12-week windows in the displayed range. Incomplete windows are not evaluated.',
		};
	}

	function updateWeekAttention(strip, level) {
		const attention = getWeekAttentionStatus(level);
		strip.className = 'week-attention ' + attention.status;
		strip.title = attention.description;
		strip.setAttribute('role', 'img');
		strip.setAttribute('aria-label', strip.title);
	}

	// ===== Rendering =====
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const currentSunday = getSunday(today);
	let lastAttentionWeekKey = toKey(currentSunday);
	let weekSundays = [];

	// Cache DOM refs per week for targeted updates
	const weekElements = new Map(); // sunday key -> { row, infoCells, dayCells[] }
	const minimapElements = new Map();
	let topVisibleMinimapSegment = null;

	function createIcon(name) {
		const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		icon.setAttribute('class', 'icon');
		icon.setAttribute('aria-hidden', 'true');
		const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
		use.setAttribute('href', '#icon-' + name);
		icon.appendChild(use);
		return icon;
	}

	function createDayCell(date) {
		const cell = document.createElement('div');
		cell.className = 'day-cell';
		cell.dataset.date = toKey(date);
		cell.tabIndex = 0;
		cell.setAttribute('role', 'button');

		const numSpan = document.createElement('span');
		numSpan.className = 'day-number';
		numSpan.textContent = date.getDate();
		cell.appendChild(numSpan);

		const nameSpan = document.createElement('span');
		nameSpan.className = 'day-name';
		nameSpan.textContent = DAY_NAMES[date.getDay()];
		cell.appendChild(nameSpan);

		const statusSpan = document.createElement('span');
		statusSpan.className = 'day-status';
		cell.appendChild(statusSpan);

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
			'work-from-home',
			'today',
			'holiday',
		);
		cell.classList.add(s);
		if (sameDay(date, today)) cell.classList.add('today');
		cell.setAttribute('aria-pressed', String(s === 'in-office' || s === 'vacation'));
		const holidayName = state.showHolidays && holidayMap[toKey(date)];
		const statusName = s === 'vacation' ? 'Out of office'
			: s === 'in-office' ? 'In office'
			: s === 'work-from-home' ? 'Work from home'
			: holidayName ? 'MSFT holiday'
			: s === 'weekend' ? 'Weekend' : 'Work from home';
		const fullDate = date.toLocaleDateString(undefined, {
			weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
		});
		cell.title = fullDate + '\nMarked as: ' + statusName
			+ (holidayName ? '\n' + holidayName : '');
		cell.setAttribute('aria-label', fullDate + ', Marked as: ' + statusName
			+ (holidayName ? ', ' + holidayName : ''));
		const statusSpan = cell.querySelector('.day-status');
		statusSpan.replaceChildren();
		if (s === 'in-office' || s === 'vacation' || s === 'work-from-home') {
			statusSpan.appendChild(createIcon(s === 'in-office' ? 'office' : s === 'vacation' ? 'away' : 'home'));
		} else if (s === 'default' && !holidayName) {
			const icon = createIcon('home');
			icon.setAttribute('class', 'icon implicit-home-icon');
			statusSpan.appendChild(icon);
		}

		// Holiday indicator
		var dateKey = cell.dataset.date;
		var nameSpan = cell.querySelector('.day-name');
		if (holidayName) {
			cell.classList.add('holiday');
			nameSpan.textContent = holidayName;
			if (s !== 'in-office' && s !== 'vacation' && s !== 'work-from-home') {
				statusSpan.appendChild(createIcon('calendar'));
			}
		} else {
			var d = fromKey(dateKey);
			nameSpan.textContent = DAY_NAMES[d.getDay()];
		}

		// Remove old edge buttons
		cell.querySelectorAll('.vacation-edge-btn').forEach((b) => b.remove());

		// Add edge buttons if vacation
		if (s === 'vacation') {
			const prev = getOOFExtensionDate(date, -1);
			const next = getOOFExtensionDate(date, 1);
			const prevState = getDayState(prev);
			const nextState = getDayState(next);

			if (prevState !== 'vacation') {
				const btn = document.createElement('button');
				btn.className = 'vacation-edge-btn left';
				btn.appendChild(createIcon('left'));
				btn.title = 'Extend out of office to ' + prev.toLocaleDateString();
				btn.setAttribute('aria-label', btn.title);
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
				btn.appendChild(createIcon('right'));
				btn.title = 'Extend out of office to ' + next.toLocaleDateString();
				btn.setAttribute('aria-label', btn.title);
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

		infoEl.innerHTML = '';

		const rangeDiv = document.createElement('div');
		rangeDiv.className = 'week-date-range';
		rangeDiv.textContent = formatDateRange(sunday);
		infoEl.appendChild(rangeDiv);

		const statuses = document.createElement('div');
		statuses.className = 'week-statuses';
		const windowEnd = addDays(sunday, WINDOW_SIZE * 7 - 1);
		const windowLevel = getWeekWindowStatus(sunday);
		[
			{
				label: 'This week', count: weekResult.inOfficeDays, total: state.daysRequired,
				level: weekResult.meets ? 'good' : 'fail',
				description: 'In-office days / required days',
			},
			{
				label: 'Window starting here', count: windowResult.passingWeeks, total: WINDOW_SIZE,
				level: windowLevel,
				description: 'Qualifying weeks / 12 weeks, ' + sunday.toLocaleDateString()
					+ ' to ' + windowEnd.toLocaleDateString(),
			},
		].forEach(function (status) {
			const row = document.createElement('div');
			row.className = 'week-status ' + status.level;
			row.title = status.description;
			row.setAttribute('role', 'group');
			const incomplete = status.level === 'out-of-range';
			row.setAttribute('aria-label', status.label + ': '
				+ (incomplete ? 'Not enough data' : status.count + ' of ' + status.total)
				+ ', ' + status.description);
			row.appendChild(createIcon(incomplete ? 'question' : status.level === 'good' ? 'check' : status.level === 'warn' ? 'warning' : 'dismiss'));
			const label = document.createElement('span');
			label.textContent = status.label + ':';
			row.appendChild(label);
			const count = document.createElement('span');
			count.className = 'week-status-count';
			count.textContent = incomplete ? 'Not enough data' : status.count + ' / ' + status.total;
			row.appendChild(count);
			statuses.appendChild(row);
		});
		infoEl.appendChild(statuses);
	}

	function syncColumnHeader() {
		document.getElementById('sidebar').style.setProperty('--sidebar-mobile-width',
			document.querySelector('.app-layout').clientWidth + 'px');
		const calendar = document.getElementById('calendar-container');
		const scroller = document.querySelector('.calendar-scroll');
		const header = document.getElementById('calendar-column-header');
		const row = header.querySelector('.day-header-row');
		if (!row) return;
		const style = getComputedStyle(calendar);
		const calendarWidth = calendar.getBoundingClientRect().width;
		const headerWidth = scroller.scrollWidth + scroller.offsetWidth - scroller.clientWidth;
		row.style.gridTemplateColumns = style.gridTemplateColumns;
		row.style.width = headerWidth + 'px';
		row.style.paddingLeft = style.paddingLeft;
		row.style.paddingRight = (parseFloat(style.paddingRight) + headerWidth - calendarWidth) + 'px';
		header.scrollLeft = scroller.scrollLeft;
		updateMinimapViewport();
	}

	function highlightNavigationTarget(element) {
		element.classList.remove('navigation-highlight');
		// Flush the removed class so repeated navigation restarts the animation.
		void element.offsetWidth;
		element.classList.add('navigation-highlight');
	}

	function handleNavigationHighlightEnd(event) {
		if (event.animationName === 'week-navigation-highlight' || event.animationName === 'week-navigation-highlight-fade') {
			event.target.classList.remove('navigation-highlight');
		}
	}

	function scrollToWeek(row, behavior = 'smooth', highlight = true) {
		document.querySelectorAll('.week-row.navigation-highlight').forEach(function (highlighted) {
			highlighted.classList.remove('navigation-highlight');
		});
		row.scrollIntoView({
			block: 'center',
			behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : behavior,
		});
		if (highlight) highlightNavigationTarget(row);
	}

	function renderCalendar(highlightCurrentWeek = true) {
		weekSundays = getWeekSundays();
		const attentionLevels = computeWeekAttention(weekSundays);
		const container = document.getElementById('calendar-container');
		container.innerHTML = '';
		weekElements.clear();

		// Day-of-week header
		const headerRow = document.createElement('div');
		headerRow.className = 'day-header-row';
		const spacer = document.createElement('div');
		spacer.className = 'day-label';
		spacer.textContent = 'Status';
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
		document.getElementById('calendar-column-header').replaceChildren(headerRow);

		weekSundays.forEach(function (sunday, index) {
			const row = document.createElement('div');
			row.className = 'week-row';
			row.style.gridRow = String(index + 1);
			if (index === weekSundays.length - 1) row.classList.add('last-week');
			if (sameDay(sunday, currentSunday)) row.classList.add('current-week');

			// Left info panel
			const info = document.createElement('div');
			info.className = 'week-info';
			updateWeekInfo(sunday, info);
			row.appendChild(info);

			const attention = document.createElement('div');
			updateWeekAttention(attention, attentionLevels.get(toKey(sunday)));
			row.appendChild(attention);

			// Month label column
			const monthLabel = document.createElement('div');
			monthLabel.className = 'month-label';
			var monthText = '';
			for (var d = 0; d < 7; d++) {
				var dayDate = addDays(sunday, d);
				if (dayDate.getDate() === 1) {
					monthText = dayDate.toLocaleDateString('en-US', { month: 'long' });
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
				attention: attention,
				dayCells: dayCells,
				sunday: sunday,
			});
		});

		updateAttentionFlags(attentionLevels);

		// Scroll to current week
		const currentKey = toKey(currentSunday);
		const current = weekElements.get(currentKey);
		if (current) {
			scrollToWeek(current.row, 'instant', highlightCurrentWeek);
		}
		syncColumnHeader();
	}

	function updateSummary() {
		const summary = computeSummary(weekSundays);
		const el = document.getElementById('summary-text');
		el.innerHTML = '';
		const statuses = document.createElement('div');
		statuses.className = 'summary-statuses';
		[
			{ level: 'good', icon: 'check', label: 'Passing', count: summary.pass },
			{ level: 'warn', icon: 'warning', label: 'At threshold', count: summary.warn },
			{ level: 'fail', icon: 'dismiss', label: 'Below target', count: summary.fail },
		].forEach(function (status) {
			const badge = document.createElement('span');
			badge.className = 'summary-badge ' + status.level;
			badge.title = status.label + ': ' + status.count;
			badge.setAttribute('aria-label', badge.title);
			badge.appendChild(createIcon(status.icon));
			const label = document.createElement('span');
			label.className = 'summary-status-label';
			label.textContent = status.label;
			badge.appendChild(label);
			const count = document.createElement('strong');
			count.textContent = status.count;
			badge.appendChild(count);
			statuses.appendChild(badge);
		});
		el.appendChild(statuses);
		const attentionButton = document.getElementById('next-attention-btn');
		attentionButton.disabled = !getNextAttentionWeek(lastAttentionWeekKey);
		attentionButton.title = attentionButton.disabled
			? 'No warning or below-target windows in the displayed range'
			: 'Jump to the next warning or below-target window';
	}

	function updateAll() {
		const attentionLevels = computeWeekAttention(weekSundays);
		weekElements.forEach(function (entry) {
			updateWeekInfo(entry.sunday, entry.info);
			updateWeekAttention(entry.attention, attentionLevels.get(toKey(entry.sunday)));
			for (let i = 0; i < 7; i++) {
				const date = addDays(entry.sunday, i);
				updateDayCellClass(entry.dayCells[i], date);
			}
		});
		updateAttentionFlags(attentionLevels);
		updateSummary();
		updateMinimap();
		syncColumnHeader();
	}

	// ===== Minimap =====
	function updateMinimapViewport() {
		let next = null;
		if (weekElements.size) {
			const viewport = document.querySelector('.calendar-scroll').getBoundingClientRect();
			for (const [key, entry] of weekElements) {
				const row = entry.row.getBoundingClientRect();
				if (row.bottom > viewport.top && row.top < viewport.bottom) {
					next = minimapElements.get(key) ?? null;
					break;
				}
			}
		}
		if (next === topVisibleMinimapSegment) return;
		if (topVisibleMinimapSegment) {
			topVisibleMinimapSegment.classList.remove('mm-viewport');
			topVisibleMinimapSegment.removeAttribute('aria-description');
		}
		if (next) {
			next.classList.add('mm-viewport');
			next.setAttribute('aria-description', 'Top visible week in the calendar');
		}
		topVisibleMinimapSegment = next;
	}

	function getWeekWindowStatus(sunday) {
		const lastSunday = weekSundays[weekSundays.length - 1];
		const windowEndSunday = addDays(sunday, (WINDOW_SIZE - 1) * 7);
		if (windowEndSunday > lastSunday) return 'out-of-range';
		const result = evaluateWindow(sunday);
		if (result.passingWeeks >= 9) return 'good';
		if (result.passingWeeks === 8) return 'warn';
		return 'fail';
	}

	function getNextAttentionWeek(afterKey) {
		const candidates = weekSundays.filter(function (sunday) {
			const status = getWeekWindowStatus(sunday);
			return status === 'fail' || status === 'warn';
		});
		return candidates.find(sunday => toKey(sunday) > afterKey) || candidates[0] || null;
	}

	function updateMinimap() {
		const container = document.getElementById('minimap');
		container.innerHTML = '';
		minimapElements.clear();
		topVisibleMinimapSegment = null;
		const attentionLevels = computeWeekAttention(weekSundays);
		weekSundays.forEach(function (sunday) {
			const seg = document.createElement('button');
			const level = attentionLevels.get(toKey(sunday));
			const attention = getWeekAttentionStatus(level);
			const status = level === 'good' ? getWeekWindowStatus(sunday) : attention.status;
			seg.className = 'minimap-segment mm-' + status;
			if (sameDay(sunday, currentSunday)) {
				seg.classList.add('mm-current');
				seg.setAttribute('aria-current', 'date');
			}
			const statusDescription = ', ' + (status === 'out-of-range' ? 'Not enough data'
				: status === 'good' ? 'Passing' : attention.description);
			seg.title = formatDateRange(sunday) + statusDescription;
			seg.setAttribute('aria-label', 'Jump to ' + formatDateRange(sunday) + ', ' + sunday.getFullYear() + statusDescription);
			if (status === 'warn' || status === 'fail') {
				const marker = document.createElement('span');
				marker.className = 'minimap-marker';
				marker.setAttribute('aria-hidden', 'true');
				marker.textContent = status === 'warn' ? '!' : '\u00d7';
				seg.appendChild(marker);
			}
			seg.addEventListener('click', function () {
				const entry = weekElements.get(toKey(sunday));
				if (entry)
					scrollToWeek(entry.row);
			});
			container.appendChild(seg);
			minimapElements.set(toKey(sunday), seg);
		});
		updateMinimapViewport();
	}

	// ===== Click Handling =====
	function handleDayClick(dateKey, markMode = state.markMode) {
		applyDayRange(dateKey, dateKey, markMode);
	}

	// ===== Drag Handling =====
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

	function getOOFExtensionDate(date, direction) {
		let next = addDays(date, direction);
		while (state.showHolidays && holidayMap[toKey(next)]) next = addDays(next, direction);
		return next;
	}

	function getEditableDateKeys(dateKeys, mode) {
		return mode === 'out-of-office'
			? dateKeys.filter(key => !(state.showHolidays && holidayMap[key]))
			: dateKeys;
	}

	function rangeMatchesTool(dateKeys, mode) {
		const dayState = mode === 'out-of-office' ? 'vacation' : mode;
		return dateKeys.every(key => getDayState(fromKey(key)) === dayState);
	}

	function applyDayRange(startKey, endKey, mode) {
		const dayState = mode === 'out-of-office' ? 'vacation' : mode;
		const dateKeys = getEditableDateKeys(getDatesInRange(startKey, endKey), mode);
		const reset = rangeMatchesTool(dateKeys, mode);
		dateKeys.forEach(function (key) {
			if (reset) {
				delete state.dayStates[key];
			} else {
				state.dayStates[key] = dayState;
			}
		});
		saveState();
		updateAll();
	}

	function clearDragHighlights() {
		document
			.querySelectorAll('.day-cell.drag-highlight')
			.forEach(function (el) {
				el.classList.remove('drag-highlight', 'drag-in-office', 'drag-out-of-office', 'drag-work-from-home', 'drag-reset');
			});
	}

	function applyDragHighlights(dateKeys) {
		dateKeys = getEditableDateKeys(dateKeys, dragState.mode);
		const reset = rangeMatchesTool(dateKeys, dragState.mode);
		dateKeys.forEach(function (key) {
			const el = document.querySelector('.day-cell[data-date="' + key + '"]');
			if (el) {
				el.classList.add('drag-highlight', 'drag-' + dragState.mode);
				el.classList.toggle('drag-reset', reset);
			}
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
					// Let recurrence handle office days and holidays instead of saving bulk overrides.
					if (
						state.dayStates[key] !== 'vacation' &&
						state.dayStates[key] !== 'work-from-home'
					) {
						delete state.dayStates[key];
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

	function setShowHolidays(showHolidays) {
		state.showHolidays = showHolidays;
		for (const [key, dayState] of Object.entries(state.dayStates)) {
			if (
				dayState === 'in-office' &&
				holidayMap[key] &&
				state.regularDays.includes(fromKey(key).getDay())
			) {
				delete state.dayStates[key];
			}
		}
		saveState();
		updateAll();
	}

	// ===== Event Wiring =====
	function init() {
		const savedStateStatus = loadState();
		const sidebar = document.getElementById('sidebar');
		const sidebarToggle = document.getElementById('sidebar-toggle-btn');
		sidebarToggle.addEventListener('click', function () {
			const collapsed = sidebar.classList.toggle('collapsed');
			sidebar.classList.toggle('expanding', !collapsed);
			sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
			sidebarToggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
			sidebarToggle.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
			sidebarToggle.querySelector('use').setAttribute('href', collapsed ? '#icon-right' : '#icon-left');
			const help = document.getElementById('rolling-window-help');
			if (help.matches(':popover-open')) help.hidePopover();
			syncColumnHeader();
		});

		const appInfoDialog = document.getElementById('app-info-dialog');
		const welcomeDialog = document.getElementById('welcome-dialog');
		const regularDaysSetting = document.getElementById('regular-days-setting');
		regularDaysSetting.addEventListener('animationend', handleNavigationHighlightEnd);
		welcomeDialog.addEventListener('close', function () {
			document.getElementById('settings-panel').hidden = false;
			const settingsToggle = document.getElementById('settings-toggle-btn');
			settingsToggle.classList.add('active');
			settingsToggle.setAttribute('aria-expanded', 'true');
			regularDaysSetting.scrollIntoView({ block: 'nearest', behavior: 'instant' });
			highlightNavigationTarget(regularDaysSetting);
		});
		const holidayInfoDialog = document.getElementById('holiday-info-dialog');
		document.getElementById('holiday-info-btn').addEventListener('click', function () {
			holidayInfoDialog.querySelector('.dialog-message').hidden = true;
			holidayInfoDialog.showModal();
		});
		document.getElementById('close-holiday-info-btn').addEventListener('click', function () {
			holidayInfoDialog.close();
		});
		document.getElementById('close-welcome-btn').addEventListener('click', function () {
			welcomeDialog.close();
		});
		const clearDataButton = document.getElementById('clear-data-btn');
		const clearDataConfirmation = document.getElementById('clear-data-confirmation');
		let clearDataArmed = false;
		function resetClearDataConfirmation() {
			clearDataArmed = false;
			clearDataButton.classList.remove('confirm-clear');
			clearDataButton.removeAttribute('aria-describedby');
			clearDataConfirmation.hidden = true;
		}
		appInfoDialog.addEventListener('close', resetClearDataConfirmation);
		clearDataButton.addEventListener('click', function () {
			if (!clearDataArmed) {
				clearDataArmed = true;
				clearDataButton.classList.add('confirm-clear');
				clearDataButton.setAttribute('aria-describedby', 'clear-data-confirmation');
				clearDataConfirmation.hidden = false;
				return;
			}
			try {
				localStorage.removeItem(STORAGE_KEY);
			} catch (error) {
				console.error('Unable to clear locally saved planner data.', error);
				resetClearDataConfirmation();
				showAppMessage('Unable to clear locally saved data. Your saved plan was not changed. Please try again.', true);
				return;
			}
			window.location.reload();
		});
		document.getElementById('app-version').textContent = BELT_APP_INFO.version;
		const publishedDate = document.getElementById('app-published-date');
		publishedDate.dateTime = BELT_APP_INFO.publishedDate;
		publishedDate.textContent = new Date(BELT_APP_INFO.publishedDate + 'T12:00:00')
			.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
		document.getElementById('app-info-btn').addEventListener('click', function () {
			resetClearDataConfirmation();
			document.getElementById('dialog-message').hidden = true;
			appInfoDialog.showModal();
		});
		document.getElementById('close-app-info-btn').addEventListener('click', function () {
			appInfoDialog.close();
		});
		[appInfoDialog, welcomeDialog, holidayInfoDialog].forEach(function (dialog) {
			dialog.addEventListener('keydown', function (event) {
				if (event.key === 'Escape') {
					event.preventDefault();
					dialog.close();
				}
			});
			dialog.addEventListener('click', function (event) {
				if (event.target !== dialog) return;
				const bounds = dialog.getBoundingClientRect();
				if (
					event.clientX < bounds.left || event.clientX >= bounds.right ||
					event.clientY < bounds.top || event.clientY >= bounds.bottom
				) {
					dialog.close();
				}
			});
		});
		document.getElementById('dismiss-app-message-btn').addEventListener('click', hideAppMessage);
		document.getElementById('download-save-btn').addEventListener('click', function () {
			try {
				const blob = new Blob([createSaveFile()], { type: 'application/json' });
				const url = URL.createObjectURL(blob);
				try {
					const link = document.createElement('a');
					link.href = url;
					link.download = 'belt-planner-save-' + toKey(new Date()) + '.json';
					link.hidden = true;
					document.body.appendChild(link);
					try {
						link.click();
					} finally {
						link.remove();
					}
				} finally {
					setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
				}
			} catch (error) {
				console.error('Unable to download planner save file.', error);
				showAppMessage('Unable to download a save file. Please try again.', true);
			}
		});

		function isFileDrag(event) {
			return event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');
		}
		document.addEventListener('dragover', function (event) {
			if (!isFileDrag(event)) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = 'copy';
		});
		document.addEventListener('drop', async function (event) {
			if (!isFileDrag(event)) return;
			event.preventDefault();
			if (event.dataTransfer.files.length !== 1) {
				showAppMessage('Drop one BELT Planner save file at a time.', true);
				return;
			}
			const file = event.dataTransfer.files[0];
			try {
				restoreSaveFile(await file.text());
			} catch (error) {
				console.error('Unable to restore planner save file.', error);
				const detail = error instanceof Error ? error.message : 'The file could not be read.';
				showAppMessage('Unable to load save file: ' + detail + ' Your current plan was not changed.', true);
				return;
			}
			clearDragHighlights();
			dragState = null;
			lastAttentionWeekKey = toKey(currentSunday);
			document.getElementById('days-required').value = state.daysRequired;
			document.getElementById('weeks-back').value = state.weeksBack;
			document.getElementById('weeks-forward').value = state.weeksForward;
			document.getElementById('show-holidays').checked = state.showHolidays;
			document.querySelectorAll('#regular-days-checkboxes input').forEach(function (checkbox) {
				checkbox.checked = state.regularDays.includes(Number(checkbox.dataset.day));
			});
			renderCalendar();
			updateSummary();
			updateMinimap();
			if (appInfoDialog.open) appInfoDialog.close();
			if (welcomeDialog.open) welcomeDialog.close();
			if (holidayInfoDialog.open) holidayInfoDialog.close();
			showAppMessage('Save file loaded');
		});

		document.querySelectorAll('[data-info-tooltip]').forEach(function (button) {
			const tooltip = document.getElementById(button.dataset.infoTooltip);
			let hideTimer;
			let restoringFocus = false;
			function positionTooltip() {
				const anchor = button.getBoundingClientRect();
				const bounds = tooltip.getBoundingClientRect();
				tooltip.style.left = Math.max(8, Math.min(anchor.left, window.innerWidth - bounds.width - 8)) + 'px';
				const top = anchor.bottom + 8 + bounds.height <= window.innerHeight
					? anchor.bottom + 8 : anchor.top - bounds.height - 8;
				tooltip.style.top = Math.max(8, top) + 'px';
			}
			function showTooltip() {
				clearTimeout(hideTimer);
				if (!tooltip.matches(':popover-open')) tooltip.showPopover();
				positionTooltip();
			}
			function scheduleHide() {
				clearTimeout(hideTimer);
				hideTimer = setTimeout(function () {
					if (!button.matches(':hover, :focus') && !tooltip.matches(':hover')) {
						tooltip.hidePopover();
					}
				}, 150);
			}
			button.addEventListener('mouseenter', showTooltip);
			button.addEventListener('focus', function () {
				if (!restoringFocus) showTooltip();
			});
			button.addEventListener('click', showTooltip);
			button.addEventListener('mouseleave', scheduleHide);
			button.addEventListener('blur', scheduleHide);
			tooltip.addEventListener('mouseenter', function () { clearTimeout(hideTimer); });
			tooltip.addEventListener('mouseleave', scheduleHide);
			tooltip.addEventListener('beforetoggle', function (event) {
				if (event.newState === 'closed') {
					restoringFocus = true;
					setTimeout(function () { restoringFocus = false; }, 0);
				}
			});
			tooltip.addEventListener('toggle', function () {
				button.setAttribute('aria-expanded', String(tooltip.matches(':popover-open')));
			});
			document.addEventListener('keydown', function (event) {
				if (event.key === 'Escape' && tooltip.matches(':popover-open')) {
					tooltip.hidePopover();
				}
			});
			document.addEventListener('pointerdown', function (event) {
				if (tooltip.matches(':popover-open') &&
					!button.contains(event.target) && !tooltip.contains(event.target)) {
					tooltip.hidePopover();
				}
			});
			function repositionOpenTooltip() {
				if (tooltip.matches(':popover-open')) positionTooltip();
			}
			window.addEventListener('resize', repositionOpenTooltip);
			document.addEventListener('scroll', repositionOpenTooltip, true);
		});

		// Settings toggle
		var settingsBtn = document.getElementById('settings-toggle-btn');
		var settingsPanel = document.getElementById('settings-panel');
		settingsBtn.addEventListener('click', function () {
			var isHidden = settingsPanel.hidden;
			settingsPanel.hidden = !isHidden;
			settingsBtn.classList.toggle('active', isHidden);
			settingsBtn.setAttribute('aria-expanded', String(isHidden));
		});
		document.getElementById('today-btn').addEventListener('click', function () {
			lastAttentionWeekKey = toKey(currentSunday);
			const current = weekElements.get(toKey(currentSunday));
			if (current) scrollToWeek(current.row);
		});
		document.getElementById('next-attention-btn').addEventListener('click', function () {
			const next = getNextAttentionWeek(lastAttentionWeekKey);
			if (next) {
				lastAttentionWeekKey = toKey(next);
				scrollToWeek(weekElements.get(lastAttentionWeekKey).row);
			}
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
			setShowHolidays(holidayCb.checked);
		});

		const modeToggle = document.getElementById('mode-toggle');
		const modeButtons = modeToggle.querySelectorAll('[data-mode]');
		const cursorIcon = document.getElementById('cursor-icon');

		function updateModeToggle() {
			modeButtons.forEach(function (button) {
				const active = button.dataset.mode === state.markMode;
				button.setAttribute('aria-pressed', String(active));
				button.classList.toggle('active', active);
			});
			cursorIcon.classList.toggle('out-of-office', state.markMode === 'out-of-office');
			cursorIcon.classList.toggle('work-from-home', state.markMode === 'work-from-home');
			cursorIcon.replaceChildren(createIcon(state.markMode === 'in-office' ? 'office'
				: state.markMode === 'out-of-office' ? 'away' : 'home'));
		}

		modeButtons.forEach(function (button) {
			button.addEventListener('click', function () {
				state.markMode = button.dataset.mode;
				updateModeToggle();
			});
		});
		updateModeToggle();

		// Active tool icon follows the mouse, visible only over day cells.
		document.addEventListener('mousemove', function (e) {
			cursorIcon.style.left = e.clientX + 'px';
			cursorIcon.style.top = e.clientY + 'px';
			var overDayCell = e.target.closest('.day-cell') !== null;
			cursorIcon.style.opacity = overDayCell ? '1' : '0';
		});

		renderCalendar(false);
		updateSummary();
		updateMinimap();

		// Delegate click and drag events on the calendar container
		const container = document.getElementById('calendar-container');
		const scroller = document.querySelector('.calendar-scroll');
		container.addEventListener('animationend', handleNavigationHighlightEnd);
		scroller.addEventListener('scroll', function () {
			document.getElementById('calendar-column-header').scrollLeft = scroller.scrollLeft;
			updateMinimapViewport();
		});
		const columnHeaderObserver = new ResizeObserver(syncColumnHeader);
		columnHeaderObserver.observe(container);
		columnHeaderObserver.observe(scroller);

		container.addEventListener('keydown', function (e) {
			if (e.key !== 'Enter' && e.key !== ' ') return;
			if (!e.target.classList.contains('day-cell')) return;
			e.preventDefault();
			handleDayClick(e.target.dataset.date);
		});

		container.addEventListener('mousedown', function (e) {
			if (e.button !== 0 || e.target.closest('.vacation-edge-btn')) return;
			const cell = e.target.closest('.day-cell');
			if (!cell) return;
			const dateKey = cell.dataset.date;
			if (!dateKey) return;

			dragState = { startDate: dateKey, currentDate: dateKey, mode: state.markMode, active: true };
			clearDragHighlights();
			applyDragHighlights([dateKey]);
			e.preventDefault();
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

		document.addEventListener('mouseup', function (e) {
			if (e.button !== 0 || !dragState || !dragState.active) return;

			if (dragState.startDate === dragState.currentDate) {
				handleDayClick(dragState.startDate, dragState.mode);
			} else {
				applyDayRange(
					dragState.startDate,
					dragState.currentDate,
					dragState.mode,
				);
			}

			clearDragHighlights();
			dragState = null;
		});

		window.addEventListener('blur', function () {
			clearDragHighlights();
			dragState = null;
		});

		// Assistive clicks without mouse events; mouse edits finish on mouseup.
		container.addEventListener('click', function (e) {
			if (e.detail !== 0) return;
			const cell = e.target.closest('.day-cell');
			if (!cell) return;
			// Ignore if click was on an edge button
			if (e.target.closest('.vacation-edge-btn')) return;
			const dateKey = cell.dataset.date;
			if (!dateKey) return;
			handleDayClick(dateKey);
		});
		if (savedStateStatus === 'empty') welcomeDialog.showModal();
	}

	// Boot
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
