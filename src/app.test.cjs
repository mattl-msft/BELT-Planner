const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(require.resolve('./app.js'), 'utf8');
const appInfoSource = readFileSync(require.resolve('./app-info.js'), 'utf8');

function createPlanner(savedState, environment = {}) {
	let stored = savedState && JSON.stringify(savedState);
	let writeError;
	const context = vm.createContext({
		setTimeout,
		clearTimeout,
		document: {
			createElement: () => ({ appendChild() {}, setAttribute() {}, addEventListener() {} }),
			createElementNS: () => ({
				children: [], attributes: {},
				appendChild(child) { this.children.push(child); },
				setAttribute(name, value) { this.attributes[name] = value; },
			}),
		},
		localStorage: {
			getItem: () => stored ?? null,
			setItem: (_key, value) => {
				if (writeError) throw writeError;
				stored = value;
			},
		},
		...environment,
	});
	vm.runInContext(appInfoSource, context);
	vm.runInContext(source.replace('// Boot', `
		globalThis.planner = {
			state, getDayState, getWeekSundays, evaluateWeek, evaluateWindow, updateWeekInfo,
			applyRegularDay, setShowHolidays, handleDayClick, saveState, loadState, updateDayCellClass,
			getCompleteWindowSundays, computeSummary,
			computeWeekAttention, updateWeekAttention, getWeekAttentionStatus, updateMinimap,
			getAttentionRanges, updateAttentionFlags, getMonthRanges,
			weekElements, updateMinimapViewport,
			formatDateRange, getWeekWindowStatus, initResponsiveLayout, setSettingsExpanded,
			applyDayRange,
			applyDragHighlights, clearDragHighlights,
			setDragMode: mode => { dragState = { mode }; },
			getNextAttentionWeek,
			createSaveFile, parseSaveFile, restoreSaveFile,
			showAppMessage, hideAppMessage,
			scrollToWeek,
			setWeeks: () => { weekSundays = getWeekSundays(); },
		};
		updateAll = function () {};
		return;
		// Boot
	`), context);
	const loadStatus = context.planner.loadState();
	return {
		...context.planner,
		loadStatus,
		saved: () => JSON.parse(stored),
		failWrites: error => { writeError = error; },
	};
}

test('loading distinguishes a first run from saved plans, even when saved settings are defaults', () => {
	assert.equal(createPlanner().loadStatus, 'empty');
	assert.equal(createPlanner({}).loadStatus, 'loaded');
	assert.equal(createPlanner({
		daysRequired: 3, weeksBack: 12, weeksForward: 38,
		regularDays: [], dayStates: {}, showHolidays: true,
	}).loadStatus, 'loaded');
});

test('weeks after today default to 26 without overriding saved preferences', () => {
	assert.equal(createPlanner().state.weeksForward, 26);
	assert.equal(createPlanner({ weeksForward: 38 }).state.weeksForward, 38);
});

function createResponsivePlanner(width) {
	const nodes = new Map();
	const media = [];
	const listeners = {};
	const document = {
		activeElement: null,
		getElementById: id => node(id),
		querySelector: selector => selector === 'dialog[open], :popover-open' ? null : node(selector),
		querySelectorAll: () => controls,
		addEventListener: (name, handler) => { listeners[name] = handler; },
	};
	function node(id) {
		if (!nodes.has(id)) {
			const classes = new Set();
			nodes.set(id, {
				attributes: {}, events: {}, dataset: {}, hidden: false,
				classList: {
					toggle(name, value) {
						const enabled = value ?? !classes.has(name);
						if (enabled) classes.add(name);
						else classes.delete(name);
						return enabled;
					},
					remove: name => classes.delete(name),
					contains: name => classes.has(name),
				},
				setAttribute(name, value) { this.attributes[name] = value; },
				removeAttribute(name) { delete this.attributes[name]; },
				addEventListener(name, handler) { this.events[name] = handler; },
				querySelector: selector => selector === '.day-header-row' ? null : node(id + selector),
				querySelectorAll: () => [node('sidebar-toggle-btn'), node('app-info-btn')],
				contains: element => element === node('sidebar-toggle-btn') || element === node('app-info-btn'),
				matches: () => false,
				focus() { document.activeElement = this; },
				getClientRects: () => [{}],
			});
		}
		return nodes.get(id);
	}
	const controls = ['navigation', 'tools'].map(name => {
		const button = node('controls-' + name);
		button.dataset.controls = name;
		return button;
	});
	const planner = createPlanner(undefined, {
		document,
		window: {
			matchMedia(query) {
				const max = Number(query.match(/\d+/)[0]);
				const entry = { matches: width <= max, max, addEventListener: (_name, handler) => { entry.change = handler; } };
				media.push(entry);
				return entry;
			},
		},
	});
	const layout = planner.initResponsiveLayout();
	return {
		node, document, layout, state: planner.state,
		key(key, shiftKey = false, defaultPrevented = false) {
			let prevented = false;
			listeners.keydown({ key, shiftKey, defaultPrevented, preventDefault() { prevented = true; } });
			return prevented;
		},
		resize(nextWidth) {
			const changed = media.filter(entry => entry.matches !== (nextWidth <= entry.max));
			media.forEach(entry => { entry.matches = nextWidth <= entry.max; });
			changed.forEach(entry => entry.change());
		},
	};
}

test('responsive defaults collapse settings and the narrow rail without losing independent sidebar choices', () => {
	const ui = createResponsivePlanner(1600);
	const sidebar = ui.node('sidebar');
	assert.equal(ui.node('settings-panel').hidden, false);
	assert.equal(sidebar.classList.contains('collapsed'), false);
	ui.node('sidebar-toggle-btn').events.click();
	assert.equal(sidebar.classList.contains('collapsed'), true);
	ui.resize(1280);
	assert.equal(ui.node('settings-panel').hidden, true);
	ui.resize(1000);
	assert.equal(sidebar.classList.contains('collapsed'), true);
	ui.node('sidebar-toggle-btn').events.click();
	assert.equal(sidebar.classList.contains('collapsed'), false);
	ui.resize(1600);
	assert.equal(sidebar.classList.contains('collapsed'), true);
	assert.equal(ui.node('settings-panel').hidden, false);
	ui.resize(1000);
	assert.equal(sidebar.classList.contains('collapsed'), false);
});

test('mobile drawer is inert when closed, modal when open, traps focus and restores it on dismissal', () => {
	const ui = createResponsivePlanner(390);
	const sidebar = ui.node('sidebar');
	const menu = ui.node('mobile-menu-btn');
	const close = ui.node('sidebar-toggle-btn');
	assert.equal(sidebar.inert, true);
	assert.equal(menu.attributes['aria-expanded'], 'false');
	menu.events.click();
	assert.equal(sidebar.inert, false);
	assert.equal(sidebar.attributes['role'], 'dialog');
	assert.equal(sidebar.attributes['aria-modal'], 'true');
	assert.equal(ui.node('.main-wrapper').inert, true);
	assert.equal(ui.node('sidebar-backdrop').hidden, false);
	assert.equal(ui.document.activeElement, close);
	assert.equal(ui.key('Tab', true), true);
	assert.equal(ui.document.activeElement, ui.node('app-info-btn'));
	assert.equal(ui.key('Tab'), true);
	assert.equal(ui.document.activeElement, close);
	assert.equal(ui.key('Escape', false, true), false);
	assert.equal(sidebar.attributes['aria-modal'], 'true');
	assert.equal(ui.key('Escape'), true);
	assert.equal(sidebar.inert, true);
	assert.equal(sidebar.attributes['aria-modal'], undefined);
	assert.equal(ui.node('.main-wrapper').inert, false);
	assert.equal(ui.document.activeElement, menu);
	for (const dismiss of [() => ui.node('sidebar-backdrop').events.click(), () => close.events.click()]) {
		menu.events.click();
		dismiss();
		assert.equal(menu.attributes['aria-expanded'], 'false');
		assert.equal(ui.document.activeElement, menu);
	}
});

test('resizing an open mobile drawer clears modality and restores usable desktop controls', () => {
	const ui = createResponsivePlanner(390);
	ui.layout.openSidebar();
	ui.resize(1280);
	assert.equal(ui.node('sidebar').inert, false);
	assert.equal(ui.node('sidebar').classList.contains('mobile-open'), false);
	assert.equal(ui.node('sidebar').attributes['aria-modal'], undefined);
	assert.equal(ui.node('.main-wrapper').inert, false);
	assert.equal(ui.node('sidebar-backdrop').hidden, true);
	assert.equal(ui.document.activeElement, ui.node('sidebar-toggle-btn'));
	ui.resize(390);
	assert.equal(ui.node('sidebar').inert, true);
	assert.equal(ui.document.activeElement, ui.node('mobile-menu-btn'));
});

test('mobile control switch reflects navigation and editing selection without changing the marking tool', () => {
	const ui = createResponsivePlanner(390);
	const mode = ui.state.markMode;
	assert.equal(ui.node('.workspace-header').dataset.controls, 'tools');
	ui.node('controls-navigation').events.click();
	assert.equal(ui.node('.workspace-header').dataset.controls, 'navigation');
	assert.equal(ui.node('controls-navigation').attributes['aria-pressed'], 'true');
	assert.equal(ui.node('controls-tools').attributes['aria-pressed'], 'false');
	ui.node('controls-tools').events.click();
	assert.equal(ui.node('.workspace-header').dataset.controls, 'tools');
	assert.equal(ui.node('controls-tools').attributes['aria-pressed'], 'true');
	assert.equal(ui.state.markMode, mode);
});

test('unreadable local data is reported instead of being treated as a first run', () => {
	for (const getItem of [
		() => '{invalid JSON',
		() => { throw new Error('Storage unavailable'); },
	]) {
		const messages = [];
		const nodes = {
			'app-info-dialog': { open: false },
			'app-message': { hidden: true, classList: { toggle() {} }, setAttribute() {} },
			'app-message-text': { textContent: '' },
		};
		const planner = createPlanner(undefined, {
			document: { getElementById: id => nodes[id], querySelector: () => null },
			localStorage: { getItem },
			console: { error: (...args) => messages.push(args) },
		});
		assert.equal(planner.loadStatus, 'error');
		assert.equal(messages.length, 1);
		assert.equal(nodes['app-message'].hidden, false);
		assert.match(nodes['app-message-text'].textContent, /Unable to load locally saved data/);
	}
});

test('success notifications close after three seconds and reset when replaced or dismissed', () => {
	const timers = new Map();
	let nextTimer = 0;
	const notification = { hidden: true, classList: { toggle() {} }, setAttribute() {} };
	const text = { textContent: '' };
	const planner = createPlanner(undefined, {
		document: {
			querySelector: () => null,
			getElementById: id => id === 'app-message' ? notification : text,
		},
		setTimeout: (callback, delay) => {
			assert.equal(delay, 3000);
			timers.set(++nextTimer, callback);
			return nextTimer;
		},
		clearTimeout: id => timers.delete(id),
	});
	planner.showAppMessage('Save file loaded');
	assert.equal(notification.hidden, false);
	assert.equal(text.textContent, 'Save file loaded');
	assert.equal(timers.size, 1);
	const firstTimer = nextTimer;
	planner.showAppMessage('Save file loaded');
	assert.equal(timers.has(firstTimer), false);
	assert.equal(timers.size, 1);
	timers.get(nextTimer)();
	assert.equal(notification.hidden, true);
	assert.equal(timers.size, 0);

	planner.showAppMessage('Save file loaded');
	planner.hideAppMessage();
	assert.equal(notification.hidden, true);
	assert.equal(timers.size, 0);

	planner.showAppMessage('Save file loaded');
	planner.showAppMessage('Unable to load save file', true);
	assert.equal(notification.hidden, false);
	assert.equal(text.textContent, 'Unable to load save file');
	assert.equal(timers.size, 0);
});

test('automatic week navigation highlights only its destination and restarts on repeated navigation', () => {
	const highlighted = new Set();
	const scrolls = [];
	let layoutReads = 0;
	function row() {
		const entry = {
			classList: {
				add: () => highlighted.add(entry),
				remove: () => highlighted.delete(entry),
			},
			scrollIntoView: options => scrolls.push(options),
			get offsetWidth() { layoutReads++; return 100; },
		};
		return entry;
	}
	const planner = createPlanner(undefined, {
		document: { querySelectorAll: () => [...highlighted] },
		window: { matchMedia: () => ({ matches: false }) },
	});
	const first = row();
	const second = row();
	planner.scrollToWeek(first, 'instant');
	planner.scrollToWeek(second);
	planner.scrollToWeek(second);
	assert.deepEqual([...highlighted], [second]);
	assert.deepEqual(scrolls.map(options => options.behavior), ['instant', 'smooth', 'smooth']);
	assert.ok(scrolls.every(options => options.block === 'center'));
	assert.equal(layoutReads, 3);
});

test('initial calendar positioning can skip highlighting without skipping the scroll', () => {
	let scrollBehavior;
	let highlighted = false;
	let layoutReads = 0;
	const planner = createPlanner(undefined, {
		document: { querySelectorAll: () => [] },
		window: { matchMedia: () => ({ matches: false }) },
	});
	planner.scrollToWeek({
		scrollIntoView: options => { scrollBehavior = options.behavior; },
		classList: { add() { highlighted = true; } },
		get offsetWidth() { layoutReads++; return 100; },
	}, 'instant', false);
	assert.equal(scrollBehavior, 'instant');
	assert.equal(highlighted, false);
	assert.equal(layoutReads, 0);
});

test('automatic week navigation avoids smooth scrolling with reduced motion', () => {
	let behavior;
	const planner = createPlanner(undefined, {
		document: { querySelectorAll: () => [] },
		window: { matchMedia: () => ({ matches: true }) },
	});
	planner.scrollToWeek({
		scrollIntoView: options => { behavior = options.behavior; },
		classList: { add() {}, remove() {} },
		offsetWidth: 100,
	});
	assert.equal(behavior, 'instant');
});

test('regular days cover every visible week across calendar years', () => {
	const planner = createPlanner();
	planner.state.regularDays = [1, 3, 5];
	planner.state.weeksBack = 52;
	planner.state.weeksForward = 52;
	planner.state.showHolidays = false;
	const sundays = planner.getWeekSundays();
	assert.ok(sundays[0].getFullYear() < sundays.at(-1).getFullYear());
	for (const sunday of sundays) {
		assert.equal(planner.evaluateWeek(sunday).inOfficeDays, 3);
	}
});

function dayCell(dateKey) {
	const status = {
		children: [],
		replaceChildren() { this.children = []; },
		appendChild(child) { this.children.push(child); },
	};
	return {
		status,
		dataset: { date: dateKey },
		classList: { add() {}, remove() {} },
		attributes: {},
		setAttribute(name, value) { this.attributes[name] = value; },
		querySelector: selector => selector === '.day-status' ? status : {},
		querySelectorAll: () => [],
		appendChild() {},
	};
}

test('native day tooltips show the full date and every effective status', () => {
	const planner = createPlanner();
	const cases = [
		['2027-01-04', 'default', 'Work from home'],
		['2027-01-04', 'in-office', 'In office'],
		['2027-01-04', 'vacation', 'Out of office'],
		['2027-01-02', 'weekend', 'Weekend'],
		['2027-01-01', 'default', 'MSFT holiday'],
		['2027-01-01', 'in-office', 'In office'],
		['2027-01-01', 'vacation', 'MSFT holiday'],
		['2027-01-02', 'in-office', 'In office'],
		['2027-01-02', 'vacation', 'Out of office'],
		['2027-01-04', 'work-from-home', 'Work from home'],
		['2027-01-01', 'work-from-home', 'Work from home'],
		['2027-01-02', 'work-from-home', 'Work from home'],
	];
	for (const [key, state, status] of cases) {
		planner.state.dayStates[key] = state;
		const cell = dayCell(key);
		const date = new Date(key + 'T12:00:00');
		planner.updateDayCellClass(cell, date);
		const fullDate = date.toLocaleDateString(undefined, {
			weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
		});
		const holiday = key === '2027-01-01' ? "\nNew Year's Day" : '';
		assert.equal(cell.title, fullDate + '\nMarked as: ' + status + holiday);
		assert.equal(cell.attributes['aria-label'], cell.title.replaceAll('\n', ', '));
	}
});

test('day tooltips refresh after marking changes and hiding holidays', () => {
	const planner = createPlanner();
	const cell = dayCell('2027-01-01');
	const date = new Date(2027, 0, 1);
	planner.updateDayCellClass(cell, date);
	assert.match(cell.title, /Marked as: MSFT holiday\nNew Year's Day$/);
	planner.state.showHolidays = false;
	planner.updateDayCellClass(cell, date);
	assert.match(cell.title, /Marked as: Work from home$/);
	planner.state.markMode = 'in-office';
	planner.handleDayClick('2027-01-01');
	planner.updateDayCellClass(cell, date);
	assert.match(cell.title, /Marked as: In office$/);
});

test('expanding the visible range inherits the saved recurring schedule', () => {
	const planner = createPlanner();
	planner.state.regularDays = [2];
	planner.state.showHolidays = false;
	planner.saveState();
	const reloaded = createPlanner(planner.saved());
	reloaded.state.weeksBack = 52;
	reloaded.state.weeksForward = 52;
	for (const sunday of reloaded.getWeekSundays()) {
		assert.equal(reloaded.evaluateWeek(sunday).inOfficeDays, 1);
	}
});

test('recurrence crosses December and January without a year cutoff', () => {
	const planner = createPlanner();
	planner.state.regularDays = [2];
	assert.equal(planner.getDayState(new Date(2026, 11, 29)), 'in-office');
	assert.equal(planner.getDayState(new Date(2027, 0, 5)), 'in-office');
});

test('manual removals and vacation override recurrence and persist', () => {
	const planner = createPlanner();
	planner.state.markMode = 'work-from-home';
	planner.state.regularDays = [2];
	planner.handleDayClick('2027-01-05');
	assert.equal(planner.getDayState(new Date(2027, 0, 5)), 'work-from-home');
	const reloaded = createPlanner(planner.saved());
	reloaded.state.markMode = 'work-from-home';
	assert.equal(reloaded.getDayState(new Date(2027, 0, 5)), 'work-from-home');
	reloaded.state.dayStates['2027-01-12'] = 'vacation';
	assert.equal(reloaded.getDayState(new Date(2027, 0, 12)), 'vacation');
	reloaded.handleDayClick('2027-01-05');
	assert.equal(reloaded.getDayState(new Date(2027, 0, 5)), 'in-office');
});

test('recurring weekends can be manually unmarked', () => {
	const planner = createPlanner();
	planner.state.markMode = 'work-from-home';
	planner.state.regularDays = [0];
	assert.equal(planner.getDayState(new Date(2027, 0, 3)), 'in-office');
	planner.handleDayClick('2027-01-03');
	assert.equal(planner.getDayState(new Date(2027, 0, 3)), 'work-from-home');
	planner.handleDayClick('2027-01-03');
	assert.equal(planner.getDayState(new Date(2027, 0, 3)), 'in-office');
});

test('holidays are excluded when shown without hiding manual selections', () => {
	const planner = createPlanner();
	planner.state.regularDays = [5];
	const holiday = new Date(2027, 0, 1);
	assert.equal(planner.getDayState(holiday), 'default');
	planner.state.showHolidays = false;
	assert.equal(planner.getDayState(holiday), 'in-office');
	planner.state.showHolidays = true;
	planner.state.dayStates['2027-01-01'] = 'in-office';
	assert.equal(planner.getDayState(holiday), 'in-office');
});

test('regular-day selections remain dynamic when company holidays are toggled', () => {
	const planner = createPlanner();
	planner.state.regularDays = [5];
	planner.state.showHolidays = false;
	planner.state.weeksBack = 52;
	planner.state.weeksForward = 52;
	planner.setWeeks();
	planner.applyRegularDay(5, true);
	const holiday = new Date(2027, 0, 1);
	const sunday = new Date(2026, 11, 27);
	assert.equal(planner.getDayState(holiday), 'in-office');
	assert.equal(planner.state.dayStates['2027-01-01'], undefined);
	assert.equal(planner.evaluateWeek(sunday).inOfficeDays, 1);
	planner.setShowHolidays(true);
	assert.equal(planner.getDayState(holiday), 'default');
	assert.equal(planner.evaluateWeek(sunday).inOfficeDays, 0);
	planner.setShowHolidays(false);
	assert.equal(planner.getDayState(holiday), 'in-office');
	assert.equal(planner.evaluateWeek(sunday).inOfficeDays, 1);
	const reloaded = createPlanner(planner.saved());
	assert.equal(reloaded.getDayState(holiday), 'in-office');
	reloaded.setShowHolidays(true);
	assert.equal(reloaded.getDayState(holiday), 'default');
});

test('holiday toggles reassess saved office entries only on recurring holiday weekdays', () => {
	const planner = createPlanner({
		regularDays: [5],
		showHolidays: false,
		dayStates: {
			'2027-01-01': 'in-office',
			'2029-11-23': 'in-office',
			'2027-12-24': 'vacation',
			'2027-12-31': 'work-from-home',
			'2027-01-18': 'in-office',
			'2027-01-08': 'in-office',
			'2026-12-25': 'default',
		},
	});
	planner.setShowHolidays(true);
	assert.equal(planner.getDayState(new Date(2027, 0, 1)), 'default');
	assert.equal(planner.state.dayStates['2027-01-01'], undefined);
	assert.equal(planner.state.dayStates['2029-11-23'], undefined);
	assert.equal(planner.getDayState(new Date(2027, 11, 24)), 'default');
	assert.equal(planner.state.dayStates['2027-12-24'], 'vacation');
	assert.equal(planner.getDayState(new Date(2027, 11, 31)), 'work-from-home');
	assert.equal(planner.getDayState(new Date(2027, 0, 18)), 'in-office');
	assert.equal(planner.getDayState(new Date(2027, 0, 8)), 'in-office');
	assert.equal(planner.state.dayStates['2026-12-25'], 'default');
	planner.setShowHolidays(false);
	assert.equal(planner.getDayState(new Date(2027, 0, 1)), 'in-office');
	assert.equal(planner.getDayState(new Date(2027, 11, 24)), 'vacation');
	assert.equal(planner.getDayState(new Date(2027, 11, 31)), 'work-from-home');
	assert.equal(planner.getDayState(new Date(2026, 11, 25)), 'default');
	assert.equal(planner.saved().showHolidays, false);
});

test('unchecking a regular day clears bulk selections but keeps vacations', () => {
	const planner = createPlanner();
	planner.state.regularDays = [2];
	planner.setWeeks();
	const sunday = planner.getWeekSundays()[0];
	const tuesday = new Date(sunday);
	tuesday.setDate(tuesday.getDate() + 2);
	planner.applyRegularDay(2, true);
	assert.equal(planner.getDayState(tuesday), 'in-office');
	planner.state.dayStates['2027-01-12'] = 'vacation';
	planner.state.regularDays = [];
	planner.applyRegularDay(2, false);
	assert.equal(planner.getDayState(tuesday), 'default');
	assert.equal(planner.getDayState(new Date(2027, 0, 12)), 'vacation');
});

test('work-from-home markings override recurrence, persist, and do not count as office days', () => {
	const planner = createPlanner();
	planner.state.regularDays = [2];
	planner.state.markMode = 'work-from-home';
	planner.handleDayClick('2027-01-05');
	assert.equal(planner.getDayState(new Date(2027, 0, 5)), 'work-from-home');
	assert.equal(planner.evaluateWeek(new Date(2027, 0, 3)).inOfficeDays, 0);
	const reloaded = createPlanner(planner.saved());
	assert.equal(reloaded.getDayState(new Date(2027, 0, 5)), 'work-from-home');
	reloaded.state.markMode = 'in-office';
	reloaded.handleDayClick('2027-01-05');
	assert.equal(reloaded.getDayState(new Date(2027, 0, 5)), 'in-office');
	planner.state.markMode = 'out-of-office';
	planner.handleDayClick('2027-01-05');
	assert.equal(planner.getDayState(new Date(2027, 0, 5)), 'vacation');
});

test('recurring schedule changes preserve explicit work-from-home markings', () => {
	const planner = createPlanner();
	planner.setWeeks();
	const sunday = planner.getWeekSundays()[0];
	const tuesday = new Date(sunday);
	tuesday.setDate(tuesday.getDate() + 2);
	const key = `${tuesday.getFullYear()}-${String(tuesday.getMonth() + 1).padStart(2, '0')}-${String(tuesday.getDate()).padStart(2, '0')}`;
	planner.state.markMode = 'work-from-home';
	planner.handleDayClick(key);
	planner.applyRegularDay(2, true);
	assert.equal(planner.getDayState(tuesday), 'work-from-home');
	planner.applyRegularDay(2, false);
	assert.equal(planner.getDayState(tuesday), 'work-from-home');
});

test('summary counts only complete windows', () => {
	const planner = createPlanner();
	for (const [back, forward, expected] of [[12, 26, 28], [1, 10, 1], [1, 9, 0], [1, 1, 0], [52, 52, 94]]) {
		planner.state.weeksBack = back;
		planner.state.weeksForward = forward;
		const sundays = planner.getWeekSundays();
		const visible = planner.getCompleteWindowSundays(sundays);
		assert.equal(visible.length, expected);
		assert.equal(planner.computeSummary(sundays).total, expected);
		for (const sunday of visible) {
			const windowStart = new Date(sunday);
			windowStart.setDate(windowStart.getDate() - 11 * 7);
			assert.ok(windowStart >= sundays[0]);
		}
		if (expected) {
			assert.equal(visible[0].getTime(), sundays[11].getTime());
			assert.equal(visible.at(-1).getTime(), sundays.at(-1).getTime());
		}
	}
});

test('the first eleven windows have insufficient data, including shorter ranges', () => {
	const planner = createPlanner();
	for (const [back, forward] of [[12, 26], [1, 10], [1, 1]]) {
		planner.state.weeksBack = back;
		planner.state.weeksForward = forward;
		planner.setWeeks();
		const sundays = planner.getWeekSundays();
		sundays.forEach((sunday, index) => {
			assert.equal(planner.getWeekWindowStatus(sunday) === 'out-of-range', index < 11);
		});
		assert.equal(sundays.filter(sunday => planner.getWeekWindowStatus(sunday) === 'out-of-range').length,
			Math.min(11, sundays.length));
	}
});

test('trailing window counts include the ending week and never include subsequent weeks', () => {
	const { planner, sundays } = attentionPlan([
		...Array(5).fill(false), ...Array(8).fill(true), false,
	]);
	assert.equal(planner.evaluateWindow(sundays[11]).passingWeeks, 7);
	assert.equal(planner.evaluateWindow(sundays[12]).passingWeeks, 8);
	assert.equal(planner.evaluateWindow(sundays[13]).passingWeeks, 8);
	const before = planner.evaluateWindow(sundays[11]).passingWeeks;
	// Only alter dates after the first window's ending week.
	sundays.slice(12).forEach(sunday => {
		const monday = new Date(sunday);
		monday.setDate(monday.getDate() + 1);
		const key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
		planner.state.dayStates[key] = 'vacation';
	});
	assert.equal(planner.evaluateWindow(sundays[11]).passingWeeks, before);
	assert.equal(planner.evaluateWindow(sundays[12]).passingWeeks, 7);
});

test('week cards label trailing windows and expose their exact Sunday-to-Saturday date bounds', () => {
	function element() {
		return {
			children: [], attributes: {},
			appendChild(child) { this.children.push(child); },
			setAttribute(name, value) { this.attributes[name] = value; },
		};
	}
	const planner = createPlanner(undefined, { document: {
		createElement: element, createElementNS: element,
	} });
	planner.state.regularDays = [1, 2, 3];
	planner.state.showHolidays = false;
	planner.setWeeks();
	const sundays = planner.getWeekSundays();
	for (const index of [0, 10, 11, sundays.length - 1]) {
		const card = element();
		planner.updateWeekInfo(sundays[index], card);
		const row = card.children[1].children[1];
		const start = new Date(sundays[index]);
		start.setDate(start.getDate() - 77);
		const end = new Date(sundays[index]);
		end.setDate(end.getDate() + 6);
		assert.equal(row.children[1].children[0].textContent, 'Window ending here:');
		assert.equal(row.children[1].children[1].textContent, 'Window:');
		assert.equal(card.children[1].children[0].children[1].children[1].textContent, 'Week:');
		assert.equal(card.children[0].children[1].textContent, planner.formatDateRange(sundays[index], 'short'));
		assert.ok(row.title.endsWith(start.toLocaleDateString() + ' to ' + end.toLocaleDateString()));
		assert.ok(row.attributes['aria-label'].startsWith('Window ending here: '));
		if (index < 11) {
			assert.equal(row.children[2].children[0].textContent, 'Not enough data');
			assert.equal(row.children[2].children[1].textContent, 'N/A');
			assert.match(row.attributes['aria-label'], /Not enough data/);
		} else assert.equal(row.children[2].textContent, '12 / 12');
	}
});

function attentionPlan(qualifying) {
	const planner = createPlanner();
	planner.state.regularDays = [1, 2, 3];
	planner.state.showHolidays = false;
	const sundays = qualifying.map((meets, index) => {
		const sunday = new Date(2026, 0, 4 + index * 7);
		if (!meets) {
			const monday = new Date(sunday);
			monday.setDate(monday.getDate() + 1);
			const key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
			planner.state.dayStates[key] = 'vacation';
		}
		return sunday;
	});
	return { planner, sundays, levels: () => [...planner.computeWeekAttention(sundays).values()] };
}

test('four weeks away constrain all eight qualifying weeks before and after, not just window starts', () => {
	const { levels } = attentionPlan([
		...Array(12).fill(true), ...Array(4).fill(false), ...Array(12).fill(true),
	]);
	assert.deepEqual(levels(), [
		...Array(4).fill('good'), ...Array(20).fill('warn'), ...Array(4).fill('good'),
	]);
});

test('a missed constrained week makes every containing failed window red, overriding yellow', () => {
	const qualifying = [...Array(8).fill(true), ...Array(4).fill(false), ...Array(8).fill(true)];
	qualifying[7] = false;
	const { planner, sundays, levels } = attentionPlan(qualifying);
	assert.deepEqual(levels(), [...Array(19).fill('fail'), 'warn']);
	planner.state.dayStates = {};
	assert.deepEqual(levels(), Array(20).fill('good'));
	// Changing the weekly requirement reevaluates the same plan without rebuilding dates.
	planner.state.daysRequired = 4;
	assert.deepEqual(levels(), Array(20).fill('fail'));
	assert.equal(planner.computeSummary(sundays).fail, 9);
});

test('attention only uses complete displayed windows, including their trailing eleven weeks', () => {
	assert.deepEqual(attentionPlan(Array(11).fill(false)).levels(), Array(11).fill('good'));
	assert.deepEqual(attentionPlan(Array(12).fill(false)).levels(), Array(12).fill('fail'));
	assert.deepEqual(attentionPlan(Array(12).fill(true)).levels(), Array(12).fill('good'));
	assert.deepEqual(attentionPlan([...Array(9).fill(true), ...Array(3).fill(false)]).levels(), Array(12).fill('good'));
	assert.deepEqual(attentionPlan([...Array(8).fill(true), ...Array(4).fill(false)]).levels(),
		Array(12).fill('warn'));
});

test('attention agrees with every containing window for varied schedules', () => {
	let seed = 42;
	for (let sample = 0; sample < 60; sample++) {
		const qualifying = Array.from({ length: sample + 1 }, () => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return seed / 2 ** 32 < 0.8;
		});
		const expected = qualifying.map((_, index) => {
			let level = 'good';
			for (let start = Math.max(0, index - 11); start <= Math.min(index, qualifying.length - 12); start++) {
				const count = qualifying.slice(start, start + 12).filter(Boolean).length;
				if (count < 8) return 'fail';
				if (count === 8) level = 'warn';
			}
			return level;
		});
		assert.deepEqual(attentionPlan(qualifying).levels(), expected);
	}
});

test('attention strips expose text alternatives and clear stale severity on updates', () => {
	const { planner } = attentionPlan([]);
	const strip = { attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
	for (const [level, text] of [['warn', /At threshold/], ['fail', /Below expectations/], ['good', /Incomplete windows are not evaluated/]]) {
		planner.updateWeekAttention(strip, level);
		assert.equal(strip.className, 'week-attention ' + level);
		assert.match(strip.title, text);
		assert.equal(strip.attributes['aria-label'], strip.title);
		assert.equal(strip.attributes.role, 'img');
	}
});

test('nonqualifying weeks retain warning and error colors regardless of OOF or WFH markings', () => {
	const { planner } = attentionPlan([...Array(8).fill(true), ...Array(4).fill(false)]);
	const strip = { attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
	for (const dayState of ['vacation', 'work-from-home', 'default', 'in-office']) {
		planner.state.dayStates['2026-03-02'] = dayState;
		for (const level of ['warn', 'fail', 'good']) {
			planner.updateWeekAttention(strip, level);
			assert.equal(strip.className, 'week-attention ' + level);
			assert.equal(strip.attributes['aria-label'], strip.title);
			if (level !== 'good') assert.match(strip.title, level === 'fail' ? /fewer than 8/ : /exactly 8/);
		}
	}
});

test('minimap shows insufficient history at the top and attention colors through the final week', () => {
	function element() {
		return {
			children: [], attributes: {}, className: '',
			get innerHTML() { return ''; },
			set innerHTML(value) { this.children = []; },
			appendChild(child) { this.children.push(child); },
			setAttribute(name, value) { this.attributes[name] = value; },
			addEventListener() {},
			get classList() { return { add: name => { this.className += ' ' + name; } }; },
		};
	}
	const minimap = element();
	const planner = createPlanner(undefined, {
		document: { createElement: element, getElementById: () => minimap },
	});
	planner.state.weeksBack = 0;
	planner.state.weeksForward = 19;
	planner.state.regularDays = [1, 2, 3];
	planner.state.showHolidays = false;
	planner.setWeeks();
	const sundays = planner.getWeekSundays();
	const key = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
	const mondayKey = sunday => {
		const monday = new Date(sunday);
		monday.setDate(monday.getDate() + 1);
		return key(monday);
	};
	sundays.slice(8, 12).forEach(sunday => { planner.state.dayStates[mondayKey(sunday)] = 'vacation'; });
	planner.state.dayStates[mondayKey(sundays[11])] = 'work-from-home';
	function checkSegments() {
		planner.updateMinimap();
		assert.equal(minimap.children.length, sundays.length);
		const levels = planner.computeWeekAttention(sundays);
		sundays.forEach((sunday, index) => {
			const level = levels.get(key(sunday));
			const attention = planner.getWeekAttentionStatus(level);
			const windowStatus = planner.getWeekWindowStatus(sunday);
			const status = windowStatus === 'out-of-range' || level === 'good' ? windowStatus : attention.status;
			const segment = minimap.children[index];
			assert.ok(segment.className.split(' ').includes('mm-' + status));
			assert.match(segment.attributes['aria-label'], /^Jump to /);
			if (status === 'warn' || status === 'fail') assert.ok(segment.title.includes(attention.description));
			assert.equal(segment.children.length, status === 'warn' || status === 'fail' ? 1 : 0);
		});
		assert.ok(minimap.children[0].className.includes('mm-current'));
		assert.equal(minimap.children[0].attributes['aria-current'], 'date');
	}
	checkSegments();
	assert.ok(minimap.children[19].className.includes('mm-warn'));
	assert.ok(minimap.children.slice(0, 11).every(segment => segment.className.includes('mm-out-of-range')));
	assert.ok(minimap.children[11].className.includes('mm-warn'));
	planner.state.dayStates[mondayKey(sundays[7])] = 'work-from-home';
	checkSegments();
	assert.ok(minimap.children[0].className.includes('mm-out-of-range'));
	assert.ok(minimap.children[8].className.includes('mm-out-of-range'));
	assert.ok(minimap.children[11].className.includes('mm-fail'));
	assert.match(minimap.children[11].title, /fewer than 8/);
	planner.state.dayStates = {};
	checkSegments();
	assert.ok(minimap.children[0].className.includes('mm-out-of-range'));
	assert.ok(minimap.children[19].className.includes('mm-good'));
	planner.state.weeksForward = 5;
	planner.setWeeks();
	planner.updateMinimap();
	assert.equal(minimap.children.length, 6);
	assert.ok(minimap.children.every(segment => segment.className.includes('mm-out-of-range')));
});

test('minimap viewport marker tracks partial weeks, boundaries, rebuilds, and preserves today', () => {
	let offset = 0;
	function element() {
		return {
			children: [], attributes: {}, className: '',
			set innerHTML(value) { this.children = []; },
			appendChild(child) { this.children.push(child); },
			setAttribute(name, value) { this.attributes[name] = value; },
			removeAttribute(name) { delete this.attributes[name]; },
			addEventListener() {},
			get classList() {
				return {
					add: name => { this.className += ' ' + name; },
					remove: name => { this.className = this.className.split(' ').filter(value => value !== name).join(' '); },
				};
			},
		};
	}
	const minimap = element();
	const planner = createPlanner(undefined, {
		document: {
			createElement: element, getElementById: () => minimap,
			querySelector: () => ({ getBoundingClientRect: () => ({ top: 100, bottom: 350 }) }),
		},
	});
	planner.state.weeksBack = 0;
	planner.state.weeksForward = 2;
	planner.setWeeks();
	planner.getWeekSundays().forEach((date, index) => {
		const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
		planner.weekElements.set(key, {
			row: { getBoundingClientRect: () => ({ top: 116 + index * 100 - offset, bottom: 208 + index * 100 - offset }) },
		});
	});
	planner.updateMinimap();
	function assertMarker(expected) {
		const marked = minimap.children.filter(segment => segment.className.split(' ').includes('mm-viewport'));
		assert.equal(marked.length, expected === null ? 0 : 1);
		if (expected !== null) {
			assert.equal(marked[0], minimap.children[expected]);
			assert.equal(marked[0].attributes['aria-description'], 'Top visible week in the calendar');
		}
		assert.ok(minimap.children[0].className.includes('mm-current'));
		assert.equal(minimap.children[0].attributes['aria-current'], 'date');
	}
	assertMarker(0);
	for (const [scroll, expected] of [[60, 0], [107, 0], [108, 1], [112, 1], [208, 2], [308, null], [0, 0]]) {
		offset = scroll;
		planner.updateMinimapViewport();
		assertMarker(expected);
	}
	offset = 150;
	planner.updateMinimapViewport();
	assert.equal(minimap.children[0].attributes['aria-description'], undefined);
	planner.updateMinimap();
	assertMarker(1);
	planner.weekElements.clear();
	planner.updateMinimapViewport();
	assertMarker(null);
});

test('attention flag sections include OOF/WFH weeks and split only at gaps or severity changes', () => {
	const { planner, sundays } = attentionPlan([
		...Array(12).fill(true), ...Array(4).fill(false), ...Array(12).fill(true),
	]);
	const ranges = planner.getAttentionRanges(sundays, planner.computeWeekAttention(sundays));
	assert.deepEqual(JSON.parse(JSON.stringify(ranges)), [{ start: 4, end: 24, level: 'warn' }]);
	const key = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
	const levels = ['warn', 'warn', 'fail', 'fail', 'good', 'warn', 'good', 'fail'];
	const dates = sundays.slice(0, levels.length);
	const sections = planner.getAttentionRanges(dates, new Map(dates.map((date, index) => [key(date), levels[index]])));
	assert.deepEqual(JSON.parse(JSON.stringify(sections)), [
		{ start: 0, end: 2, level: 'warn' }, { start: 2, end: 4, level: 'fail' },
		{ start: 5, end: 6, level: 'warn' }, { start: 7, end: 8, level: 'fail' },
	]);
	assert.equal(planner.getAttentionRanges([], new Map()).length, 0);
	assert.equal(planner.getAttentionRanges(sundays, new Map(sundays.map(date => [key(date), 'good']))).length, 0);
});

test('attention flags span their exact grid rows and refresh without removing calendar rows', () => {
	const row = { className: 'week-row' };
	const container = {
		children: [row],
		querySelectorAll() { return this.children.filter(child => child.className === 'attention-range'); },
		appendChild(child) { this.children.push(child); },
	};
	const planner = createPlanner(undefined, {
		document: {
			getElementById: () => container,
			createElement: () => ({
				style: {}, children: [], attributes: {},
				appendChild(child) { this.children.push(child); },
				setAttribute(name, value) { this.attributes[name] = value; },
				addEventListener() {},
				remove() { container.children = container.children.filter(child => child !== this); },
			}),
		},
	});
	planner.state.weeksBack = 0;
	planner.state.weeksForward = 19;
	planner.setWeeks();
	const sundays = planner.getWeekSundays();
	const key = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
	const levels = new Map(sundays.map((date, index) => [key(date), index < 4 ? 'good' : index < 12 ? 'warn' : 'fail']));
	planner.updateAttentionFlags(levels);
	assert.equal(container.children[0], row);
	assert.equal(container.children.length, 3);
	assert.equal(container.children[1].style.gridRow, '5 / 13');
	assert.equal(container.children[1].children[0].textContent, 'At threshold');
	assert.equal(container.children[1].children[0].className, 'attention-flag warn');
	assert.equal(container.children[2].style.gridRow, '13 / 21');
	assert.equal(container.children[2].children[0].textContent, 'Below target');
	assert.equal(container.children[2].children[0].attributes.role, 'note');
	assert.match(container.children[2].children[0].attributes['aria-label'], /^Below target, .+ to .+/);
	const yellowFlag = container.children[1].children[0];
	const redFlag = container.children[2].children[0];
	assert.equal(yellowFlag.tabIndex, 0);
	assert.equal(yellowFlag.children[0].textContent, 'No additional weeks can be spent WFH or OOF in this range.');
	assert.equal(redFlag.children[0].textContent, 'Weeks in this range do not meet requirements.');
	assert.equal(yellowFlag.children[0].attributes.role, 'tooltip');
	assert.equal(yellowFlag.attributes['aria-describedby'], yellowFlag.children[0].id);
	assert.equal(redFlag.attributes['aria-describedby'], redFlag.children[0].id);
	assert.notEqual(yellowFlag.children[0].id, redFlag.children[0].id);
	planner.updateAttentionFlags(levels);
	assert.equal(container.children.length, 3);
	planner.updateAttentionFlags(new Map(sundays.map(date => [key(date), 'good'])));
	assert.deepEqual(container.children, [row]);
});

test('month label ranges start with the first and end with the last full week', () => {
	const planner = createPlanner();
	const start = new Date(2026, 0, 1);
	start.setDate(start.getDate() - start.getDay());
	const sundays = Array.from({ length: 165 }, (_, index) => {
		const date = new Date(start);
		date.setDate(date.getDate() + index * 7);
		return date;
	});
	const ranges = planner.getMonthRanges(sundays);
	assert.ok(ranges.length >= 36);
	const startingWeekdays = new Set();
	const endingWeekdays = new Set();
	for (const range of ranges) {
		startingWeekdays.add(range.date.getDay());
		const lastDay = new Date(range.date.getFullYear(), range.date.getMonth() + 1, 0);
		endingWeekdays.add(lastDay.getDay());
		assert.equal(range.date.getDate(), 1);
		assert.ok(sundays[range.start] <= range.date);
		const firstSaturday = new Date(sundays[range.start]);
		firstSaturday.setDate(firstSaturday.getDate() + 6);
		assert.ok(firstSaturday >= range.date);
		const lastSunday = sundays[range.end - 1];
		const lastSaturday = new Date(lastSunday);
		lastSaturday.setDate(lastSaturday.getDate() + 6);
		assert.equal(lastSunday.getMonth(), range.date.getMonth());
		assert.equal(lastSaturday.getMonth(), range.date.getMonth());
		assert.equal(lastSaturday.getFullYear(), range.date.getFullYear());
		if (range.end < sundays.length) {
			const nextSaturday = new Date(sundays[range.end]);
			nextSaturday.setDate(nextSaturday.getDate() + 6);
			assert.ok(nextSaturday > lastDay);
		}
	}
	assert.equal(startingWeekdays.size, 7);
	assert.equal(endingWeekdays.size, 7);
	assert.ok(ranges.some(range => range.date.getFullYear() === 2028 && range.date.getMonth() === 1));
});

test('month label ranges respect clipped and empty displayed calendars', () => {
	const planner = createPlanner();
	assert.equal(planner.getMonthRanges([]).length, 0);
	assert.equal(planner.getMonthRanges([new Date(2026, 9, 11)]).length, 0);
	const sundays = [new Date(2026, 9, 25), new Date(2026, 10, 1), new Date(2026, 10, 8)];
	const ranges = planner.getMonthRanges(sundays);
	assert.equal(ranges.length, 1);
	assert.equal(ranges[0].start, 1);
	assert.equal(ranges[0].end, 3);
	assert.equal(ranges[0].date.getMonth(), 10);
	const single = planner.getMonthRanges([new Date(2026, 8, 27)]);
	assert.equal(single.length, 1);
	assert.equal(single[0].start, 0);
	assert.equal(single[0].end, 1);
	assert.equal(single[0].date.getMonth(), 9);
});

test('week ranges omit repeated months and retain month/year boundaries', () => {
	const planner = createPlanner();
	assert.equal(planner.formatDateRange(new Date(2026, 7, 16)), 'August 16 - 22');
	assert.equal(planner.formatDateRange(new Date(2026, 7, 30)), 'August 30 - September 5');
	assert.equal(planner.formatDateRange(new Date(2026, 11, 27)), 'December 27 - January 2');
	assert.equal(planner.formatDateRange(new Date(2026, 7, 16), 'short'), 'Aug 16 - 22');
	assert.equal(planner.formatDateRange(new Date(2026, 7, 30), 'short'), 'Aug 30 - Sep 5');
	assert.equal(planner.formatDateRange(new Date(2026, 11, 27), 'short'), 'Dec 27 - Jan 2');
});

test('out-of-office is the default editing tool, including after reload', () => {
	const planner = createPlanner();
	assert.equal(planner.state.markMode, 'out-of-office');
	planner.handleDayClick('2027-01-05');
	assert.equal(planner.getDayState(new Date(2027, 0, 5)), 'vacation');
	planner.state.markMode = 'in-office';
	planner.saveState();
	const reloaded = createPlanner(planner.saved());
	assert.equal(reloaded.state.markMode, 'out-of-office');
});

test('every editing tool sets the entire mixed range in both directions and persists', () => {
	for (const [mode, expected] of [['in-office', 'in-office'], ['out-of-office', 'vacation'], ['work-from-home', 'work-from-home']]) {
		for (const reverse of [false, true]) {
			const planner = createPlanner();
			planner.state.dayStates['2026-12-31'] = 'vacation';
			const start = reverse ? '2027-01-03' : '2026-12-30';
			const end = reverse ? '2026-12-30' : '2027-01-03';
			planner.applyDayRange(start, end, mode);
			const reloaded = createPlanner(planner.saved());
			for (const date of [new Date(2026, 11, 30), new Date(2026, 11, 31), new Date(2027, 0, 1), new Date(2027, 0, 2), new Date(2027, 0, 3)]) {
				const holidaySkipped = mode === 'out-of-office' && date.getMonth() === 0 && date.getDate() === 1;
				assert.equal(reloaded.getDayState(date), holidaySkipped ? 'default' : expected);
			}
			assert.equal(Object.keys(reloaded.state.dayStates).length, mode === 'out-of-office' ? 4 : 5);
		}
	}
});

test('each tool toggles matching single days back to their recurring schedule including holidays and weekends', () => {
	for (const mode of ['in-office', 'out-of-office', 'work-from-home']) {
		for (const regularDays of [[], [0, 1, 2, 3, 4, 5, 6]]) {
			for (const key of ['2027-01-01', '2027-01-02', '2027-01-05']) {
				const planner = createPlanner();
				planner.state.regularDays = regularDays;
				const date = new Date(key + 'T00:00:00');
				const resting = planner.getDayState(date);
				planner.handleDayClick(key, mode);
				const holidaySkipped = mode === 'out-of-office' && key === '2027-01-01';
				assert.equal(planner.getDayState(date), holidaySkipped ? resting : mode === 'out-of-office' ? 'vacation' : mode);
				planner.handleDayClick(key, mode);
				assert.equal(planner.getDayState(date), resting);
				assert.equal(Object.hasOwn(planner.state.dayStates, key), false);
				assert.equal(createPlanner(planner.saved()).getDayState(date), resting);
			}
		}
	}
});

test('repeating a range restores resting states rather than pinning overrides or restoring previous markings', () => {
	for (const mode of ['in-office', 'out-of-office', 'work-from-home']) {
		for (const reverse of [false, true]) {
			const planner = createPlanner();
			planner.state.regularDays = [1, 2, 3, 4, 5];
			const dates = Array.from({ length: 7 }, (_, index) => new Date(2026, 11, 30 + index));
			const resting = dates.map(date => planner.getDayState(date));
			const start = reverse ? '2027-01-05' : '2026-12-30';
			const end = reverse ? '2026-12-30' : '2027-01-05';
			planner.applyDayRange(start, end, mode);
			planner.applyDayRange(start, end, mode);
			assert.deepEqual(dates.map(date => planner.getDayState(date)), resting);
			assert.equal(Object.keys(planner.state.dayStates).length, 0);
			const reloaded = createPlanner(planner.saved());
			assert.deepEqual(dates.map(date => reloaded.getDayState(date)), resting);
		}
	}
	const planner = createPlanner();
	planner.state.regularDays = [2];
	planner.state.dayStates['2027-01-05'] = 'vacation';
	planner.handleDayClick('2027-01-05', 'work-from-home');
	planner.handleDayClick('2027-01-05', 'work-from-home');
	assert.equal(planner.getDayState(new Date(2027, 0, 5)), 'in-office');
	assert.equal(Object.hasOwn(planner.state.dayStates, '2027-01-05'), false);
});

test('OOF spans skip holidays and can reset across them while preserving other explicit holiday markings', () => {
	for (const reverse of [false, true]) {
		const planner = createPlanner();
		const start = reverse ? '2027-01-04' : '2026-12-31';
		const end = reverse ? '2026-12-31' : '2027-01-04';
		planner.applyDayRange(start, end, 'out-of-office');
		assert.equal(planner.getDayState(new Date(2027, 0, 1)), 'default');
		assert.equal(Object.hasOwn(planner.state.dayStates, '2027-01-01'), false);
		assert.equal(planner.getDayState(new Date(2026, 11, 31)), 'vacation');
		planner.applyDayRange(start, end, 'out-of-office');
		assert.equal(Object.keys(planner.state.dayStates).length, 0);
		for (const explicit of ['in-office', 'work-from-home']) {
			planner.state.dayStates['2027-01-01'] = explicit;
			planner.applyDayRange(start, end, 'out-of-office');
			assert.equal(planner.getDayState(new Date(2027, 0, 1)), explicit);
			planner.applyDayRange(start, end, 'out-of-office');
			assert.equal(planner.state.dayStates['2027-01-01'], explicit);
		}
	}
	const planner = createPlanner({ dayStates: { '2027-01-01': 'vacation' } });
	assert.equal(planner.getDayState(new Date(2027, 0, 1)), 'default');
	assert.equal(planner.state.dayStates['2027-01-01'], 'vacation');
	planner.setShowHolidays(false);
	assert.equal(planner.getDayState(new Date(2027, 0, 1)), 'vacation');
	planner.setShowHolidays(true);
	assert.equal(planner.getDayState(new Date(2027, 0, 1)), 'default');
	const hidden = createPlanner({ showHolidays: false });
	hidden.applyDayRange('2026-12-31', '2027-01-02', 'out-of-office');
	assert.equal(hidden.getDayState(new Date(2027, 0, 1)), 'vacation');
});

test('OOF holiday previews are skipped and do not stop a dotted reset preview', () => {
	const keys = ['2026-12-31', '2027-01-01', '2027-01-02'];
	const cells = new Map(keys.map(key => {
		const classes = new Set();
		return [key, { classes, classList: {
			add: (...names) => names.forEach(name => classes.add(name)),
			toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
		} }];
	}));
	const planner = createPlanner(undefined, {
		document: { querySelector: selector => cells.get(selector.match(/data-date="([^"]+)"/)[1]) },
	});
	planner.state.dayStates = { '2026-12-31': 'vacation', '2027-01-02': 'vacation' };
	planner.setDragMode('out-of-office');
	planner.applyDragHighlights(keys);
	assert.equal(cells.get('2027-01-01').classes.size, 0);
	assert.ok(cells.get('2026-12-31').classes.has('drag-reset'));
	assert.ok(cells.get('2027-01-02').classes.has('drag-reset'));
});

test('drag previews reset only wholly matching ranges and switch to solid for mixed ranges', () => {
	const keys = ['2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08'];
	const cells = new Map(keys.map(key => {
		const classes = new Set();
		return [key, {
			classes,
			classList: {
				add: (...names) => names.forEach(name => classes.add(name)),
				remove: (...names) => names.forEach(name => classes.delete(name)),
				toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
			},
		}];
	}));
	const planner = createPlanner(undefined, {
		document: {
			querySelector: selector => cells.get(selector.match(/data-date="([^"]+)"/)[1]),
			querySelectorAll: () => [...cells.values()].filter(cell => cell.classes.has('drag-highlight')),
		},
	});
	planner.state.showHolidays = false;
	planner.state.regularDays = [1];
	planner.state.dayStates = {
		'2027-01-05': 'in-office',
		'2027-01-06': 'vacation',
		'2027-01-07': 'work-from-home',
	};
	for (const [mode, matching] of [
		['in-office', [true, true, false, false, false]],
		['out-of-office', [false, false, true, false, false]],
		['work-from-home', [false, false, false, true, false]],
	]) {
		planner.setDragMode(mode);
		planner.applyDragHighlights(keys);
		keys.forEach(key => {
			assert.equal(cells.get(key).classes.has('drag-reset'), false);
			assert.ok(cells.get(key).classes.has('drag-' + mode));
		});
		planner.clearDragHighlights();
		assert.ok([...cells.values()].every(cell => cell.classes.size === 0));
		const matchingKeys = keys.filter((_, index) => matching[index]);
		planner.applyDragHighlights(matchingKeys);
		assert.ok(matchingKeys.every(key => cells.get(key).classes.has('drag-reset')));
		planner.applyDragHighlights(keys);
		assert.ok(keys.every(key => !cells.get(key).classes.has('drag-reset')));
		planner.clearDragHighlights();
	}
	assert.equal(planner.state.dayStates['2027-01-06'], 'vacation');
});

test('implicit WFH icons are faint while manual markings, weekends, and holidays retain their indicators', () => {
	const planner = createPlanner();
	const cell = dayCell('2027-01-04');
	const date = new Date(2027, 0, 4);
	planner.updateDayCellClass(cell, date);
	assert.equal(cell.status.children[0].attributes.class, 'icon implicit-home-icon');
	assert.equal(cell.status.children[0].children[0].attributes.href, '#icon-home');

	planner.state.dayStates['2027-01-04'] = 'work-from-home';
	planner.updateDayCellClass(cell, date);
	assert.equal(cell.status.children.length, 1);
	assert.equal(cell.status.children[0].attributes.class, 'icon');
	assert.equal(cell.status.children[0].children[0].attributes.href, '#icon-home');

	delete planner.state.dayStates['2027-01-04'];
	planner.state.regularDays = [1];
	planner.updateDayCellClass(cell, date);
	assert.equal(cell.status.children[0].children[0].attributes.href, '#icon-office');
	planner.state.regularDays = [];
	planner.updateDayCellClass(cell, date);
	assert.equal(cell.status.children[0].attributes.class, 'icon implicit-home-icon');

	const weekend = dayCell('2027-01-02');
	planner.updateDayCellClass(weekend, new Date(2027, 0, 2));
	assert.equal(weekend.status.children.length, 0);
	const holiday = dayCell('2027-01-01');
	planner.updateDayCellClass(holiday, new Date(2027, 0, 1));
	assert.equal(holiday.status.children.length, 1);
	assert.equal(holiday.status.children[0].children[0].attributes.href, '#icon-calendar');
	planner.state.showHolidays = false;
	planner.updateDayCellClass(holiday, new Date(2027, 0, 1));
	assert.equal(holiday.status.children[0].attributes.class, 'icon implicit-home-icon');
});

test('next attention navigation includes failures and warnings, wraps, and skips passing/incomplete windows', () => {
	const planner = createPlanner();
	planner.setWeeks();
	const sundays = planner.getWeekSundays();
	planner.state.regularDays = [1, 2, 3];
	planner.state.showHolidays = false;
	assert.equal(planner.getNextAttentionWeek('0000-01-01'), null);
	for (const sunday of sundays.slice(0, 5)) {
		const monday = new Date(sunday);
		monday.setDate(monday.getDate() + 1);
		const key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
		planner.state.dayStates[key] = 'default';
	}
	assert.equal(planner.getWeekWindowStatus(sundays[0]), 'out-of-range');
	assert.equal(planner.getWeekWindowStatus(sundays[11]), 'fail');
	assert.equal(planner.getWeekWindowStatus(sundays[12]), 'warn');
	assert.equal(planner.getWeekWindowStatus(sundays[13]), 'good');
	const key = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
	assert.equal(planner.getNextAttentionWeek('0000-01-01').getTime(), sundays[11].getTime());
	assert.equal(planner.getNextAttentionWeek(key(sundays[11])).getTime(), sundays[12].getTime());
	assert.equal(planner.getNextAttentionWeek(key(sundays[12])).getTime(), sundays[11].getTime());
	assert.equal(planner.getNextAttentionWeek(key(sundays.at(-1))).getTime(), sundays[11].getTime());
	planner.state.weeksBack = 1;
	planner.state.weeksForward = 1;
	planner.setWeeks();
	assert.equal(planner.getNextAttentionWeek('0000-01-01'), null);
});

test('generated app metadata matches the package manifest', () => {
	const manifest = JSON.parse(readFileSync(require.resolve('../package.json'), 'utf8'));
	const metadata = vm.runInNewContext(appInfoSource + '\nJSON.stringify(BELT_APP_INFO)');
	assert.deepEqual(JSON.parse(metadata), { version: manifest.version, publishedDate: manifest.publishedDate });
});

test('save files round-trip all persistent settings and manual markings', () => {
	const planner = createPlanner();
	planner.state.daysRequired = 4;
	planner.state.weeksBack = 52;
	planner.state.weeksForward = 40;
	planner.state.regularDays = [1, 3, 5];
	planner.state.showHolidays = false;
	planner.state.dayStates = {
		'2027-01-01': 'in-office',
		'2027-01-02': 'weekend',
		'2027-01-04': 'work-from-home',
		'2027-01-05': 'vacation',
		'2027-01-06': 'default',
	};
	const text = planner.createSaveFile();
	const file = JSON.parse(text);
	assert.equal(file.app, 'BELT Planner');
	assert.equal(file.formatVersion, 1);
	assert.equal(file.appVersion, JSON.parse(readFileSync(require.resolve('../package.json'), 'utf8')).version);
	assert.ok(Number.isFinite(Date.parse(file.savedAt)));
	assert.equal('markMode' in file.data, false);
	const restored = createPlanner();
	restored.restoreSaveFile(text);
	assert.deepEqual(restored.saved(), file.data);
	assert.equal(restored.state.markMode, 'out-of-office');
	const reloaded = createPlanner(restored.saved());
	assert.equal(reloaded.state.weeksBack, 52);
	assert.equal(reloaded.state.daysRequired, 4);
	assert.equal(reloaded.getDayState(new Date(2027, 0, 4)), 'work-from-home');
});

test('save files retain holiday and regular-day settings without individual day entries', () => {
	for (const settings of [
		{ regularDays: [2, 4, 3], showHolidays: false },
		{ regularDays: [], showHolidays: true },
		{ regularDays: [0, 6], showHolidays: true },
	]) {
		const planner = createPlanner();
		Object.assign(planner.state, settings);
		const file = JSON.parse(planner.createSaveFile());
		assert.deepEqual(file.data.dayStates, {});
		assert.deepEqual(file.data.regularDays, settings.regularDays);
		assert.equal(file.data.showHolidays, settings.showHolidays);
		const restored = createPlanner();
		restored.restoreSaveFile(JSON.stringify(file));
		const reloaded = createPlanner(restored.saved());
		assert.deepEqual(Array.from(reloaded.state.regularDays), settings.regularDays);
		assert.equal(reloaded.state.showHolidays, settings.showHolidays);
	}
});

test('save files omit recurring office entries but retain manual exceptions without mutating the plan', () => {
	const planner = createPlanner();
	planner.state.regularDays = [2, 3, 4];
	planner.state.showHolidays = true;
	planner.state.dayStates = {
		'2027-01-05': 'in-office',
		'2027-01-06': 'in-office',
		'2030-01-08': 'in-office',
		'2027-01-04': 'in-office',
		'2027-01-09': 'in-office',
		'2026-11-26': 'in-office',
		'2027-01-12': 'work-from-home',
		'2027-01-13': 'vacation',
		'2027-01-14': 'default',
		'2027-01-17': 'weekend',
	};
	planner.saveState();
	const original = JSON.parse(JSON.stringify(planner.state.dayStates));
	const savedBefore = planner.saved();
	const file = JSON.parse(planner.createSaveFile());
	assert.deepEqual(file.data.regularDays, [2, 3, 4]);
	assert.deepEqual(file.data.dayStates, {
		'2027-01-04': 'in-office',
		'2027-01-09': 'in-office',
		'2026-11-26': 'in-office',
		'2027-01-12': 'work-from-home',
		'2027-01-13': 'vacation',
		'2027-01-14': 'default',
		'2027-01-17': 'weekend',
	});
	assert.deepEqual(planner.state.dayStates, original);
	assert.deepEqual(planner.saved(), savedBefore);
	const restored = createPlanner();
	restored.restoreSaveFile(JSON.stringify(file));
	for (const key of Object.keys(original)) {
		const date = new Date(key + 'T12:00:00');
		assert.equal(restored.getDayState(date), planner.getDayState(date), key);
	}
	for (const sunday of planner.getWeekSundays()) {
		assert.equal(restored.evaluateWeek(sunday).inOfficeDays, planner.evaluateWeek(sunday).inOfficeDays);
	}
	planner.setShowHolidays(false);
	assert.equal(JSON.parse(planner.createSaveFile()).data.dayStates['2026-11-26'], undefined);
});

test('older save files with bulk office entries load and export as a compact schedule', () => {
	const planner = createPlanner();
	const legacy = JSON.parse(planner.createSaveFile());
	legacy.data.regularDays = [2];
	legacy.data.dayStates = { '2027-01-05': 'in-office', '2027-01-06': 'vacation' };
	planner.restoreSaveFile(JSON.stringify(legacy));
	assert.equal(planner.getDayState(new Date(2027, 0, 5)), 'in-office');
	assert.deepEqual(JSON.parse(planner.createSaveFile()).data.dayStates, { '2027-01-06': 'vacation' });
});

test('invalid or unsupported save files never replace the current plan or stored data', () => {
	const planner = createPlanner();
	planner.state.dayStates['2027-01-05'] = 'vacation';
	planner.saveState();
	const before = planner.createSaveFile();
	const savedBefore = planner.saved();
	const valid = JSON.parse(before);
	const invalid = [
		'not JSON',
		'null',
		'[]',
		JSON.stringify({ ...valid, app: 'Other app' }),
		JSON.stringify({ ...valid, formatVersion: 2 }),
		...[
			{ daysRequired: 0 }, { daysRequired: 2.5 }, { weeksBack: 53 }, { weeksForward: -1 },
			{ showHolidays: 'true' }, { regularDays: [7] }, { regularDays: [1, 1] },
			{ dayStates: [] }, { dayStates: { '2027-02-30': 'vacation' } },
			{ dayStates: { 'not-a-date': 'in-office' } },
			{ dayStates: { '2027-01-01': 'unknown' } },
			{ dayStates: JSON.parse('{"__proto__":"vacation"}') },
		].map(data => JSON.stringify({ ...valid, data: { ...valid.data, ...data } })),
	];
	for (const text of invalid) {
		assert.throws(() => planner.restoreSaveFile(text), /save file/i);
		assert.deepEqual(planner.saved(), savedBefore);
		assert.deepEqual(JSON.parse(planner.createSaveFile()).data, valid.data);
	}
});

test('failed local storage writes leave the current plan intact during restore', () => {
	const planner = createPlanner();
	planner.state.daysRequired = 4;
	planner.saveState();
	const before = planner.saved();
	const imported = JSON.parse(planner.createSaveFile());
	imported.data.daysRequired = 2;
	planner.failWrites(new Error('Storage is full'));
	assert.throws(() => planner.restoreSaveFile(JSON.stringify(imported)), /Storage is full/);
	assert.equal(planner.state.daysRequired, 4);
	assert.deepEqual(planner.saved(), before);
});
