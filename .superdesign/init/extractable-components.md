> Out of date (2026-11-21): the app now uses the "telemetry" look (top bar, side nav, green accent). See ../design-system.md and ../../CLAUDE.md for the current rules; this file describes the earlier rail, tabs and blue accent.

# Extractable components
## RailNav
- Source: `src/app/app.html` (aside.rail)
- Category: layout
- Description: 68 px icon rail with 5 sections
- Extractable props: activeSection (string, default: "overview")
- Hardcoded: logo, section labels and icons
## TabBar
- Source: `src/app/app.html` (header.bar)
- Category: layout
- Description: tabs for the open section's pages, Go-to-page button, theme switch
- Extractable props: activeTab (string)
- Hardcoded: theme switch, Ctrl K hint
## Panel
- Source: `src/styles.scss` (.panel, .panel-bar)
- Category: basic
- Description: flat panel with a grey header strip
- Extractable props: title (string)
- Hardcoded: all CSS
## StatStrip
- Source: `src/app/dashboard/dashboard.html` (.strip .stat)
- Category: basic
- Description: divided strip of CPU, Memory, Uptime, Battery with thin meters
- Extractable props: none
- Hardcoded: labels, icons
