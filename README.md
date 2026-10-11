# Stride

Stride charts daily running distance and a configurable rolling average from a Garmin Connect activities CSV or full Garmin data export ZIP. Its monthly calendar uses activity-colored backgrounds and small colored icons, with dots for other activity types. Days with multiple activity types show a section of each background color. Summary metrics show running distance, run count, and active days. Rest days count as zero distance in the average. Your export is parsed in your browser and activity dates and running distances are saved in browser storage; they are not uploaded to a server.

## Run it locally

1. In a web browser, sign in to [Garmin Connect](https://connect.garmin.com/).
2. Open **Activities → All Activities**, scroll to the bottom of the activity list, and choose **Export CSV**. Save the CSV file.
3. Start Stride with Node.js 22 or later:

   ```sh
   npm start
   ```

4. Visit [http://localhost:3000](http://localhost:3000) and choose the CSV or ZIP file, or drop it onto the import area. CSV files must use metric distances in kilometers.

For development, use `npm run dev` to automatically restart the server when `server.js`, `package.json`, or `dev.js` changes. Changes under `public/` trigger a browser reload automatically.

For a full Garmin account data export, choose **Import → Import Garmin ZIP** and select the original ZIP, without extracting it. Stride reads all activity summary parts, including running, trail, treadmill, and other activities. Local activity dates are preserved even if your browser is in another timezone. Import runs in a worker with progress and a **Cancel import** button; cancellation leaves saved data unchanged. Reimporting merges activities with existing CSV or ZIP imports, retaining saved details when the incoming export lacks them. Multisport parent summaries are skipped to avoid counting their component activities twice.

ZIP import also reads FIT activity recordings from the nested `UploadedFiles*.zip` archives. It imports GPS routes, elevation, and heart rate, matches sessions to activity summaries by UTC start time and sport, and links routes by activity ID so multiple runs on one day remain separate. Recordings without GPS are skipped. Damaged recordings and routes with no unique activity match are counted in the import result. Wellness and account data are ignored. Routes are sampled to at most 1,000 GPS points each and appear in run details and the running heatmap.

Activity history and routes are saved in IndexedDB. Existing browser data is migrated from localStorage after a successful database transaction. You can still add or replace individual routes with **Import GPX**. Reimporting a ZIP updates matching routes without duplicating them.

The ZIP reader validates extracted entry checksums. Limits are 64 MB per summary or FIT recording, 128 MB for all summaries, 256 MB per nested recording archive, and 1 GB for all nested recording archives. Split, encrypted, and ZIP64 archives are unsupported. ZIP import needs a browser supporting `DecompressionStream("deflate-raw")`; an unsupported browser displays an error without changing existing data.

On iPhone, tap **Choose CSV or ZIP file → Choose File → Browse → Dropbox**. Install and sign in to the Dropbox app first. If Dropbox is missing, enable it in **Files → Browse → … → Edit**, as described in [Dropbox’s Files setup guide](https://help.dropbox.com/integrations/ios-files-app). The welcome picker accepts CSV and ZIP files; Stride checks the filename and validates its contents after selection.

Stride charts running and trail-running activities, and uses activity types from the export to color the calendar (including cycling, walking/hiking, swimming, strength training, and yoga). It supports Garmin CSVs with comma- or semicolon-separated columns. Mile-based imports are rejected when miles are specified in the distance or pace units; export your activities in kilometers from Garmin Connect instead. A plain `Distance` column is treated as kilometers, so miles cannot be detected when the export contains no unit labels.

Select **Import CSV** again to add activities or update existing ones. Repeated activities count once, using available details from the latest import. Matching uses Garmin activity IDs when available, or the full start time and activity type. Older saved entries without start times use matching details or a unique date/type match; date-only exports cannot reliably distinguish otherwise identical activities on the same day. Activities absent from a later export remain saved. Use **Unload data** to clear everything before importing a replacement dataset.

The browser saves imported runs on this device, so the dashboard is available after a refresh. Use the same browser and local address to see the saved data.

The runs list shows 25 runs per page, with **Previous** and **Next** controls and options for 50 or 100 runs per page. Changing the time period returns to the first page. Run-detail navigation continues through all runs in the selected period and keeps the list on the corresponding page.

The Calendar summary follows the visible month. In Runs and Patterns, the summary follows the time period selected above the content. Enable **Show rolling total** in Runs to add the cumulative distance for each rolling window to the chart. The **Import** menu contains CSV import, GPX import, and **Unload data**.

The Runs view includes a collapsible **Running heatmap** of all imported running and trail-running routes, independent of the period filter. Routes share geographic positions with north at the top. Warmer colors indicate more runs passing through the same area; each run counts once per area.

The heatmap and activity modal show OpenStreetMap backgrounds with zoom and pan controls. Maps initialize when visible. Leaflet 1.9.4 loads from unpkg, and map tiles load from OpenStreetMap; these requests reveal the viewed map area to the tile service. Activity files remain in your browser. If Leaflet cannot load, route shapes remain available without the background. Tile usage follows the [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/), including visible attribution and normal browser caching.

## Publish with GitHub Pages

The dashboard is a static site and can be published with GitHub Pages:

1. Push this repository to GitHub.
2. In the repository, open **Settings → Pages** and set the build and deployment source to **GitHub Actions**.
3. Push to the `main` or `master` branch, or run the **Deploy to GitHub Pages** workflow manually from the Actions tab.
4. Open the Pages URL shown in the workflow deployment.

The workflow publishes the `public/` directory. Each visitor imports their own Garmin CSV, ZIP, and GPX files; imported data stays in that visitor's browser and is not shared with you or other visitors.

## Development

Run the CSV, ZIP, and FIT parsers, activity merge, maps, heatmap, and training summary tests with `npm test`.
