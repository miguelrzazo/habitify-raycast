# Habitify Raycast

A Raycast extension for Habitify that lets you inspect today's habits, mark them complete, undo today's log, and open a habit statistics view.

## Features
- View today's Habitify habits in Raycast.
- Mark a habit as completed.
- Undo today's log for a habit.
- See basic habit statistics in a detail view.

## Requirements
- macOS
- Raycast installed
- A paid Habitify account with API access enabled
- Habitify API key from **Settings > API**
- A logged-in Raycast CLI session if you want to run `ray lint` / `ray build`

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Open the extension in Raycast development mode:
   ```bash
   npm run dev
   ```
3. In Raycast preferences for the extension, paste your Habitify API key.

## Usage
- Run **Today Habits** from Raycast.
- Select a habit to complete or undo it.
- Open the detail view to see basic stats.

## Development
- `npm run lint` — validate the extension.
- `npm run build` — build a submission-ready bundle.

## Notes
- The extension talks to the Habitify v2 REST API at `https://api.habitify.me/v2`.
- Authentication uses the `X-API-Key` header.
- Habitify API access requires a paid plan.
