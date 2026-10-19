# BELT Planner

A visual weekly calendar for tracking in-office days and ensuring compliance with Microsoft's Flexible Work policy — 8 qualifying weeks out of every rolling 12-week window (aka **B**est **E**ight weeks from the **L**ast **T**welve weeks).

## Features

- **Fluent 2-inspired interface** — Segoe typography, Microsoft blue, neutral surfaces, inline SVG icons, and keyboard-accessible calendar controls. No external fonts or UI libraries are required.
- **App branding** — a monoline calendar icon uses a teal-to-purple gradient, with the sidebar title in a single color blended halfway between teal and purple. The browser favicon uses the same icon; the standalone build embeds the SVG so it remains a single file.
- **Paper-like calendar** — fine, self-contained grain textures the calendar background. A full-width solid column header stays above the scrolling calendar and minimap, with a subtle bottom shadow; labels stay aligned when resizing or scrolling horizontally. Day-card fills are slightly translucent without fading their text or icons.
- **Weekly calendar** — scroll through past and future weeks with day cells you click to mark. Each week's summary has a content-sized card; month labels and day cells sit on the app background. The month/day grid has surrounding padding, equal horizontal/vertical gaps, and day cards capped at a 4:3 width-to-height ratio.
- **Native day tooltips** — hover over a day for its full date and "Marked as" status: In office, Out of office, Work from home, MSFT holiday, or Weekend. Holidays also include their name; manual office or out-of-office markings take precedence.
- **Regular in-office days** — selected weekdays default to in-office across all visible weeks, including other calendar years and newly displayed weeks. Manual changes and out-of-office days are preserved; company holidays are excluded when shown.
- **Mark days** — choose In office, Out of office, or Work from home. Out of office is selected by default on each page load. Work-from-home markings override recurring office days, weekends, and holidays and are saved on this device. **Click and drag with any editing tool to mark an inclusive date range, forward or backward across weeks.**
- **Active tool cursor** — a small colored office, away, or home icon follows the pointer over calendar days to show the current editing tool.
- **Work-from-home indicators** — default WFH weekdays show a faint home icon; explicitly marked WFH days keep the darker icon. Weekends and company holidays retain their own indicators.
- **Rolling 12-week window evaluation** — each summary card has aligned Week and Window status rows with colored icons, labels, and counts. Week compares in-office days with the requirement; Window counts qualifying weeks in the 12-week window starting that week. Hover over Window for its dates.
- **Summary dashboard** — sidebar totals for passing, warning, and failing windows.
- **Minimap** — a wider vertical bar for quick navigation, with white `!` (golden-orange warning) and `×` (below-target) markers as well as colors and a subdued green for passing windows. A solid right-pointing triangle beside a segment marks the current week and matches its height. Click a segment to jump to that week. Segments and markers scale to fit the window height without a separate scrollbar.
- **Incomplete windows** — the final 11 weeks have a question-mark icon and "Not enough data" for Window status, plus gray minimap segments. Their individual Week status is still evaluated, but incomplete windows are excluded from overview totals. Increase the range in Settings to evaluate more windows; ranges shorter than 12 weeks show all windows as incomplete.
- **Calendar toolbar** — the Calendar title, Go to: Today navigation, and Edit days controls share the main header. Info buttons explain weekly/window evaluation and show editing instructions with the color legend on hover, focus, or click. Return to the current week with one click. Calendar days and minimap segments also support keyboard navigation.
- **Next error or warning** — jump forward through below-target or at-threshold 12-week windows, wrapping to the first when needed. Today resets the starting point to the current week. Passing and incomplete windows are skipped; the button is disabled when no matching windows exist.
- **Navigation highlight** — automatic scrolling briefly sweeps a broad, mostly transparent teal-to-purple gradient wave behind the entire destination week, including Today, Next error or warning, minimap jumps, and calendar rebuilds. Cards and text remain above the wave. Reduced-motion mode uses instant scrolling and a stationary fade instead.
- **Microsoft company holidays** — US holidays (2026–2030) auto-marked. Toggling holidays reassesses In office entries on holiday dates that match regular office weekdays: those dates follow the recurring schedule and holiday setting, while explicit WFH and out-of-office markings remain unchanged. Regular-day selections are evaluated dynamically rather than saved as individual office overrides.
- **Configurable settings** — adjust required days per week, weeks displayed before/after today.
- **Persistent state** — all selections saved to localStorage.
- **About and backups** — the info button beside "Data saved locally" opens app version, publication date, contact details, and a save-file download. Save files keep the regular office schedule once, omitting individual In office entries already covered by that schedule while preserving manual exceptions (including office days on enabled holidays). Older files with bulk office entries still load. Drop one downloaded JSON save file anywhere on the app to replace the current plan and settings. Files are validated before loading; invalid files or failed storage writes leave the existing plan unchanged. Save files stay local and are not uploaded.

The filled office, home, and out-of-office (Door Arrow Right) icons are from [Microsoft Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons), used under the MIT license. Their license notice is included in the HTML and retained in the standalone build.

## Usage

Open `src/index.html` in a browser.

## Build

With Node.js and npm installed, run:

```sh
npm run build
```

This creates `dist/index.html` with the CSS and JavaScript embedded inline.
Open or share that single file; no server, dependencies, or `npm install` step
is required. Re-run the command after changing the source files. The generated
`dist` folder is ignored by Git.

The app version and `publishedDate` are tracked in `package.json` (initial
release: 1.0.0). Update both for a new release, then run `npm run build`.
The build regenerates `src/app-info.js` and embeds the same metadata in the
standalone page. Keep the generated metadata file with the source so opening
`src/index.html` directly also displays the correct release information.
