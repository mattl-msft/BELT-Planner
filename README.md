# BELT Planner

A visual weekly calendar for tracking in-office days and ensuring compliance with Microsoft's Flexible Work policy — 8 qualifying weeks out of every rolling 12-week window (aka **B**est **E**ight weeks from the **L**ast **T**welve weeks).

## Features

- **Weekly calendar** — scroll through past and future weeks with day cells you click to mark
- **Regular in-office days** — set your recurring schedule and bulk-apply it
- **In office / Out of office toggle** — switch modes to mark days as in-office or out of office
- **Rolling 12-week window evaluation** — each week shows a pass/warn/fail badge based on the 12 week window starting that week
- **Summary dashboard** — sidebar totals for passing, warning, and failing windows
- **Minimap** — color-coded vertical bar for quick navigation; click a segment to jump to that week
- **Microsoft company holidays** — US holidays (2026–2030) auto-marked and excluded from counts
- **Configurable settings** — adjust required days per week, weeks displayed before/after today
- **Persistent state** — all selections saved to localStorage

## Usage

1. Open `src/index.html` in a browser.
2. Click day cells to mark them as **in-office** (green). Switch to **Out of office** mode to mark vacation days (purple).
3. Check the sidebar summary and per-week window badges to see your compliance status.
4. Expand **Settings** to adjust required days, visible range, holidays, and regular schedule.
