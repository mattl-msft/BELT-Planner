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