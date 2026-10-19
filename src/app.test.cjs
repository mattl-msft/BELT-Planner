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
		document: {
			createElement: () => ({ appendChild() {}, setAttribute() {}, addEventListener() {} }),
			createElementNS: () => ({
				children: [], attributes: {},
				appendChild(child) { this.children.push(child); },
				setAttribute(name, value) { this.attributes[name] = value; },
			}),
		},
		localStorage: {
			getItem: () => stored,
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
			state, getDayState, getWeekSundays, evaluateWeek,
			applyRegularDay, setShowHolidays, handleDayClick, saveState, loadState, updateDayCellClass,
			getCompleteWindowSundays, computeSummary,
			formatDateRange, getWeekWindowStatus,
			applyDayRange,
			getNextAttentionWeek,
			createSaveFile, parseSaveFile, restoreSaveFile,
			scrollToWeek,
			setWeeks: () => { weekSundays = getWeekSundays(); },
		};
		updateAll = function () {};
		return;
		// Boot
	`), context);
	context.planner.loadState();
	return {
		...context.planner,
		saved: () => JSON.parse(stored),
		failWrites: error => { writeError = error; },
	};
}

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

test('automatic week navigation avoids smooth scrolling with reduced motion', () => {
	let behavior;
	const planner = createPlanner(undefined, {
		document: { querySelectorAll: () => [] },
		window: { matchMedia: () => ({ matches: true }) },
	});
	planner.scrollToWeek({
		scrollIntoView: options => { behavior = options.behavior; },
		classList: { add() {} },
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
		['2027-01-01', 'vacation', 'Out of office'],
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
	planner.state.markMode = 'in-office';
	planner.state.regularDays = [2];
	planner.handleDayClick('2027-01-05');
	assert.equal(planner.getDayState(new Date(2027, 0, 5)), 'default');
	const reloaded = createPlanner(planner.saved());
	reloaded.state.markMode = 'in-office';
	assert.equal(reloaded.getDayState(new Date(2027, 0, 5)), 'default');
	reloaded.state.dayStates['2027-01-12'] = 'vacation';
	assert.equal(reloaded.getDayState(new Date(2027, 0, 12)), 'vacation');
	reloaded.handleDayClick('2027-01-05');
	assert.equal(reloaded.getDayState(new Date(2027, 0, 5)), 'in-office');
});

test('recurring weekends can be manually unmarked', () => {
	const planner = createPlanner();
	planner.state.markMode = 'in-office';
	planner.state.regularDays = [0];
	assert.equal(planner.getDayState(new Date(2027, 0, 3)), 'in-office');
	planner.handleDayClick('2027-01-03');
	assert.equal(planner.getDayState(new Date(2027, 0, 3)), 'weekend');
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
	assert.equal(planner.getDayState(new Date(2027, 11, 24)), 'vacation');
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
			const windowEnd = new Date(sunday);
			windowEnd.setDate(windowEnd.getDate() + 11 * 7);
			assert.ok(windowEnd <= sundays.at(-1));
		}
		if (expected) {
			assert.equal(visible.at(-1).getTime(), sundays.at(-12).getTime());
		}
	}
});

test('the final eleven windows have insufficient data, including shorter ranges', () => {
	const planner = createPlanner();
	for (const [back, forward] of [[12, 26], [1, 10], [1, 1]]) {
		planner.state.weeksBack = back;
		planner.state.weeksForward = forward;
		planner.setWeeks();
		const sundays = planner.getWeekSundays();
		const completeCount = Math.max(0, sundays.length - 11);
		sundays.forEach((sunday, index) => {
			assert.equal(planner.getWeekWindowStatus(sunday) === 'out-of-range', index >= completeCount);
		});
		assert.equal(sundays.filter(sunday => planner.getWeekWindowStatus(sunday) === 'out-of-range').length,
			Math.min(11, sundays.length));
	}
});

test('week ranges omit repeated months and retain month/year boundaries', () => {
	const planner = createPlanner();
	assert.equal(planner.formatDateRange(new Date(2026, 7, 16)), 'August 16 - 22');
	assert.equal(planner.formatDateRange(new Date(2026, 7, 30)), 'August 30 - September 5');
	assert.equal(planner.formatDateRange(new Date(2026, 11, 27)), 'December 27 - January 2');
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

test('every editing tool marks inclusive ranges in both directions and persists', () => {
	for (const [mode, expected] of [['in-office', 'in-office'], ['out-of-office', 'vacation'], ['work-from-home', 'work-from-home']]) {
		for (const reverse of [false, true]) {
			const planner = createPlanner();
			planner.state.dayStates['2026-12-31'] = 'vacation';
			const start = reverse ? '2027-01-03' : '2026-12-30';
			const end = reverse ? '2026-12-30' : '2027-01-03';
			planner.applyDayRange(start, end, mode);
			const reloaded = createPlanner(planner.saved());
			for (const date of [new Date(2026, 11, 30), new Date(2026, 11, 31), new Date(2027, 0, 1), new Date(2027, 0, 2), new Date(2027, 0, 3)]) {
				assert.equal(reloaded.getDayState(date), expected);
			}
			assert.equal(Object.keys(reloaded.state.dayStates).length, 5);
		}
	}
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
	assert.equal(planner.getWeekWindowStatus(sundays[0]), 'fail');
	assert.equal(planner.getWeekWindowStatus(sundays[1]), 'warn');
	assert.equal(planner.getWeekWindowStatus(sundays[2]), 'good');
	const key = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
	assert.equal(planner.getNextAttentionWeek('0000-01-01').getTime(), sundays[0].getTime());
	assert.equal(planner.getNextAttentionWeek(key(sundays[0])).getTime(), sundays[1].getTime());
	assert.equal(planner.getNextAttentionWeek(key(sundays[1])).getTime(), sundays[0].getTime());
	assert.equal(planner.getNextAttentionWeek(key(sundays.at(-1))).getTime(), sundays[0].getTime());
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
