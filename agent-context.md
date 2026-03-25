# Project Overview

## Project description

At work we now have a new requirement to come into the office at least three days each week. To account for vacation and other time off, a rolling window of 12 weeks is looked at where weeks either meet or don't meet in-office requirements. A minimum eight in-office weeks out of 12 is required. BELT stands for "Best Eight (out of) Last Twelve".

This app will be a useful single page web app where a user can easily mark off days they took off in the recent past and days they are planning to take off in the future. The rolling 12 week window will be evaluated and let the user know if their planned time off over many months will meet the BELT requirements or not.

## Specific BELT rules

- A week starts Sunday and goes through Saturday
- The expectation is 3 days in office per week, but this will be configurable as some people have exemptions for less days.
- Days are units. Saturday and Sunday default to non-in-office days. Weekdays evaluate to either in-office or out-of-office.
- Weeks are units. Each week is evaluated, if it has the minimum number of in-office days, that week meets expectations.
- Window is a unit. It is comprised of 12 weeks. Each week in that window is evaluated. If at least 8 of the weeks in the window meet expectations, then that window meets expectations.

## App planning details

- Vertically, the app will have a header with a title, main toggle controls, and main summary data as the top row. The subsequent rows will scroll under the header, and the rows will be week-specific data.
- The summary at the top will show how many windows were evaluated, and how many met or not met expectations.
- Horizontally the week rows will be divided 1/4 column on the left for displaying data, and 3/4 column on the right for a calendar view.
- The calendar view will be a stack of weeks as rows. The current week will be default and near the top. The user can scroll down to see future weeks, or up to see past weeks.
- The data display view on the left will show the date range for that week, the breakdown of what days count as in-office. It will also show, for the 12 week window starting on that week, if the window meets expectations.
- Weekend days will default to gray and not count for in-office days. Single clicking will turn them green to count for in-office.
- Weekdays will default to white, which are not in-office.
- The user can go into a mode to mark days as vacation days in purple. They can either click individual days, or click and drag to specify start and end dates.
- The user can easily adjust the range of a vacation or block of dates forward and backward single days.
- As the user clicks to toggle various vacation days, the 1/4 column on the left updates for that week and that window starting that week, and the top level summary will also update.

## Implementation details

- Working code will be in the `src` folder. In that folder there will be a single file each for HTML, CSS, and JAVASCRIPT.
- The files should work without a server, be able to be run from a local file folder.
- Do not use any external libraries

# Agent Notes

Use this space to keep notes about this project. Future agents will read this whole doc to get up to speed, add any information here that you think will be useful to help future agents add new features.

## Architecture (v1 — March 2026)

- Three files: `src/index.html`, `src/styles.css`, `src/app.js`. No build step, no frameworks, opens from `file://`.
- All state lives in an IIFE in `app.js`. Key pieces:
  - `state.daysRequired` (number, default 3) — configurable in-office day threshold
  - `state.dayStates` (object keyed by `YYYY-MM-DD` → `"in-office"` | `"vacation"`) — only non-default days stored
  - `state.vacationMode` (boolean) — toggles between normal and vacation click behavior
- Date helpers: `toKey(date)` / `fromKey(key)` for `YYYY-MM-DD` ↔ `Date` conversion. `getSunday(date)` finds the Sunday of any date's week.
- Evaluation functions: `evaluateWeek(sunday)` returns `{ inOfficeDays, meets }`. `evaluateWindow(startSunday)` evaluates 12 consecutive weeks starting from that Sunday, returns `{ passingWeeks, meets }`.
- Rendering: `renderCalendar()` builds the full DOM once (26 weeks back + 26 weeks forward). `updateAll()` efficiently updates every week's info panel and day cell classes without rebuilding DOM.
- Persistence: `localStorage` under key `"belt-planner-state"`, saves `daysRequired` and `dayStates` on every change, loaded on init.
- Vacation drag: mousedown→mousemove→mouseup on day cells in vacation mode. Range is highlighted with `.drag-highlight` class, then all days set to vacation on mouseup.
- Vacation edge buttons: ◀/▶ buttons appear on hover at the edges of vacation blocks to extend by one day.
- Summary: computed from all windows whose 12-week span fits within the rendered range. Displayed as pass/fail badges in the sticky header.

## Key CSS decisions

- Layout: sticky header, `.week-row` uses `grid-template-columns: 1fr 3fr` for info/calendar split.
- Day cell colors: `.weekend` = gray, `.default` = white, `.in-office` = green (#27ae60), `.vacation` = purple (#9b59b6).
- Current week row gets blue border + shadow. Today's cell gets blue inset shadow.
