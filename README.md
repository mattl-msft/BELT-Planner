# BELT Planner

A visual weekly calendar for tracking in-office days and ensuring compliance with Microsoft's Flexible Work policy — 8 qualifying weeks out of every rolling 12-week window (aka **B**est **E**ight weeks from the **L**ast **T**welve weeks).

## Features

- **Fluent 2-inspired interface** — Segoe typography, Microsoft blue, neutral surfaces, inline SVG icons, and keyboard-accessible calendar controls. No external fonts or UI libraries are required.
- **First-run welcome** — when no local planner data exists, a spacious Welcome dialog with three simple illustrations explains the default WFH schedule, recommends setting regular office weekdays first, introduces click/drag editing, and explains automatic local saving and backup export through the bottom-left info button. Dismiss it using the close button, Escape, or a click outside; closing it reveals and briefly highlights the regular office-day settings. Existing saved plans do not show the welcome; clearing local data brings it back.
- **App branding** — a monoline calendar icon uses a teal-to-purple gradient, with the sidebar title in a single color blended halfway between teal and purple. The browser favicon uses the same icon; the standalone build embeds the SVG so it remains a single file.
- **Paper-like calendar** — fine, self-contained grain textures the calendar background. A full-width solid column header stays above the scrolling calendar and minimap, with a subtle bottom shadow; labels stay aligned when resizing or scrolling horizontally. Day-card fills are slightly translucent without fading their text or icons.
- **Weekly calendar** — scroll through past and future weeks with day cells you click to mark. Each week's summary has a content-sized card; month labels and day cells sit on the app background. The month/day grid has surrounding padding, equal horizontal/vertical gaps, and day cards capped at a 4:3 width-to-height ratio.
- **Native day tooltips** — hover over a day for its full date and "Marked as" status: In office, Out of office, Work from home, MSFT holiday, or Weekend. Holidays also include their name; manual office and WFH markings take precedence, but OOF does not override enabled company holidays.
- **Regular in-office days** — selected weekdays default to in-office across all visible weeks, including other calendar years and newly displayed weeks. Manual changes and out-of-office days are preserved; company holidays are excluded when shown.
- **Mark days** — choose In office, Out of office, or Work from home. Out of office is selected by default on each page load. Work-from-home markings override recurring office days, weekends, and holidays and are saved on this device. **If every day in the selected range already matches the tool, the whole range resets; otherwise the entire range is set to the selected marking.** This also applies to single-day clicks. Resetting removes overrides, restoring WFH or regular office days (and normal weekend/holiday behavior), not previous manual markings. Ranges are inclusive and work forward or backward across weeks. To change a regular office day to WFH, use the WFH tool; using the office tool on an already-regular office day leaves its resting schedule intact.
- **Active tool cursor** — a small colored office, away, or home icon follows the pointer over calendar days to show the current editing tool.
- **Drag preview** — the entire range uses dotted outlines only when every day already matches the tool and the range will reset. Mixed ranges use solid outlines throughout because every day will receive the selected marking. Previews update as the range changes, keep the tool's color, and clear when the drag completes or the window loses focus.
- **OOF and holidays** — OOF edits and previews skip enabled company holidays, and those dates do not prevent an otherwise fully OOF range from resetting. Existing saved OOF markings on holidays display as holidays while the holiday setting is enabled, without deleting saved data. OOF extension buttons skip holidays to reach the next eligible date. With holidays hidden, OOF applies normally; explicit office and WFH markings are unchanged.
- **Work-from-home indicators** — default WFH weekdays show a faint home icon and light border; explicitly marked WFH days use a darker home icon and gray border matching the WFH legend swatch. Weekends and company holidays retain their own indicators.
- **Rolling 12-week window evaluation** — each summary card has aligned **This week:** and **Window starting here:** status rows with colored icons, labels, and counts. This week compares in-office days with the requirement; Window starting here counts qualifying weeks in the 12-week window starting that week. Hover over Window starting here for its dates.
- **Multi-week attention strip** — a thin column immediately right of the weekly summary considers all complete displayed windows containing each week. Yellow spans every week in a window with exactly 8 qualifying weeks; no additional qualifying weeks can be missed. Red spans every week in a window below 8, taking priority over yellow. Otherwise the pole is transparent. WFH and OOF weeks retain their range's yellow/red color rather than using day-marking colors. A four-week vacation and the 8 qualifying weeks before and after it form a continuous yellow range. Strips update as days or settings change, including the final 11 rows when they belong to earlier complete windows. Incomplete or undisplayed windows do not contribute; hover text and accessible labels explain the window status. The minimap mirrors these per-week statuses; existing Window counts, overview totals, and Next error or warning navigation remain start-of-window based.
- **Summary dashboard** — sidebar totals for passing, warning, and failing windows, on the same light-gray textured background as the calendar.
- **Collapsible sidebar** — use the arrow beside the app title to collapse the left bar into a compact rail with the app icon, an expand arrow, stacked status icons and counts, and the bottom About/info button. Settings and text labels are hidden while collapsed; hover over counts for their status names. Expanding restores the existing settings and selections. The calendar and minimap resize without changing the plan; the sidebar starts expanded on page load.
- **Sidebar motion** — expanding slides open over 160 ms while fading in full-width, clipped content, avoiding text reflow during the transition. Reduced-motion preferences disable the slide and fade.
- **Pinned attention flags** — each contiguous warning/error section has a yellow **At threshold** or red **Below target** flag extending right from its vertical strip. It starts at the section's earliest week, sticks below the calendar column header while scrolling through that section, and scrolls away at the section's end. WFH and OOF weeks inside the section do not interrupt its color or flag. A severity change starts a new section and flag; flags refresh immediately after edits or range/settings changes without blocking day editing.
- **Flag explanations** — hover over or keyboard-focus an attention flag to extend it directly below with a single-line italic bubble matching the flag's color and styling: yellow says “No additional weeks can be spent WFH or OOF in this range.” and red says “Weeks in this range do not meet requirements.” Move away or blur to hide it, or press Escape to dismiss it.
- **Minimap** — a wider vertical bar for quick navigation, using the same per-week yellow/red window statuses as the attention strip across all affected weeks, with no WFH/OOF color overrides. Yellow segments have a dark `!` marker; red segments have a white `×`. Hover text and accessible labels explain the window status. Outside affected ranges, segments remain light green for passing complete windows or gray for insufficient data. A dark-blue right-pointing triangle on the left marks the current week. A separate gray left-pointing arrow, matching the calendar scrollbar thumb, follows the top visible week on the right (including a partially visible week), updating on scrolling, navigation, resize, and calendar rebuilds. Click a segment to jump to that week. Segments and markers scale to fit the window height without a separate scrollbar.
- **Incomplete windows** — the final 11 weeks have a question-mark icon and "Not enough data" for Window status. Their strips and minimap segments still show any attention status inherited from earlier complete windows; otherwise minimap segments are light gray. Their individual Week status is still evaluated, but incomplete windows are excluded from overview totals. Increase the range in Settings to evaluate more windows; ranges shorter than 12 weeks show all windows as incomplete.
- **Calendar toolbar** — the Calendar title, Go to: Today navigation, and Edit days controls share the main header. Info buttons explain weekly/window evaluation and show editing instructions with the color legend on hover, focus, or click. Return to the current week with one click. Calendar days and minimap segments also support keyboard navigation.
- **Next error or warning** — jump forward through below-target or at-threshold 12-week windows, wrapping to the first when needed. Today resets the starting point to the current week. Passing and incomplete windows are skipped; the button is disabled when no matching windows exist.
- **Navigation highlight** — navigation briefly sweeps a broad, mostly transparent teal-to-purple gradient wave behind the entire destination week, including Today, Next error or warning, minimap jumps, and calendar rebuilds. Initial positioning when the app opens does not flash the current week. Cards and text remain above the wave. Reduced-motion mode uses instant scrolling and a stationary fade instead.
- **Microsoft company holidays** — United States (1010) holidays (2026–2030) auto-marked. An info button beside the holiday setting opens a dialog explaining BELT's current Puget Sound scope and that more holiday options will be added if more regions implement BELT / RTO rules. Toggling holidays reassesses In office entries on holiday dates that match regular office weekdays: those dates follow the recurring schedule and holiday setting, while explicit WFH and out-of-office markings remain unchanged. Regular-day selections are evaluated dynamically rather than saved as individual office overrides.
- **Configurable settings** — adjust required days per week, weeks displayed before/after today (12 weeks before and 38 weeks after by default).
- **Persistent state** — all selections saved to localStorage.
- **About and backups** — the info button beside "Data saved locally" opens app version, publication date, contact details, and a save-file download. Save files keep the regular office schedule once, omitting individual In office entries already covered by that schedule while preserving manual exceptions (including office days on enabled holidays). Older files with bulk office entries still load. Drop one downloaded JSON save file anywhere on the app to replace the current plan and settings. Files are validated before loading; invalid files or failed storage writes leave the existing plan unchanged. Save files stay local and are not uploaded.
- **Save-file confirmation** — loading a save file shows "Save file loaded" in the upper right. It closes automatically after three seconds or can be dismissed manually; error messages remain visible until dismissed.
- **Clear local data** — in the About dialog, click "Clear all locally saved data" once to turn the button red and show "Are you sure?", then click it again to erase BELT Planner's local data and reload with defaults. Closing the dialog (using its close button, Escape, or a click outside) cancels confirmation. Other apps' local storage and downloaded save files are not deleted.

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
release: 1.0.0). For a build without publishing, update both manually, then
run `npm run build`.
The build regenerates `src/app-info.js` and embeds the same metadata in the
standalone page. Keep the generated metadata file with the source so opening
`src/index.html` directly also displays the correct release information.

## Publish to VibeHub

Install PowerShell 7 (`pwsh`) in addition to Node.js and npm. Have your
VibeHub API key ready, then run:

```sh
npm run publish
```

The command reads `VIBEHUB_API_KEY` and `VIBEHUB_PROJECT_ID` from the `.env`
file beside `publish-vibehub.ps1`, regardless of your working directory.
Environment variables override values from the file. If no API key is
configured, it prompts securely; the project ID defaults to `mattl-beltplanner`.
The file accepts `NAME=value`, single/double quotes, optional `export`, and
comments. Values are treated literally, not executed or interpolated.
Malformed VibeHub entries stop publishing before changing the version.
Never commit API keys; `.env` is ignored by Git and is not packaged for upload.
It then:

1. Increments the patch version in `package.json` without creating a Git
   commit or tag, and sets `publishedDate` to today's local date.
2. Runs `npm run build`, refreshing both `src/app-info.js` and `dist/index.html`.
3. Zips the contents of `dist` (with `index.html` at the archive root) and
   uploads a new version to the existing
   [BELT Planner VibeHub app](https://vibehub.microsoft.com/app/mattl-beltplanner)
   using VibeHub's external push API. The temporary ZIP is removed afterward.

Build, packaging, and upload errors stop the command with a nonzero exit code.
Version/date changes remain in the working tree even if a later step fails;
each invocation bumps the patch again. Review and commit the release metadata
after a successful publish. This command is for `npm run publish`, not
`npm publish` to the npm registry.

To validate the release workflow locally without uploading to VibeHub:

```powershell
pwsh -NoProfile -File .\tests\publish-vibehub.tests.ps1
```
