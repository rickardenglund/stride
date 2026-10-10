# Stride

Stride charts daily running distance and a configurable rolling average from a Garmin Connect activities CSV. Its monthly calendar uses activity-colored backgrounds and small colored icons, with dots for other activity types. Days with multiple activity types show a section of each background color. Summary metrics show running distance, run count, and active days. Rest days count as zero distance in the average. Your CSV is parsed in your browser and activity dates and running distances are saved in browser storage; they are not uploaded to a server.

## Run it locally

1. In a web browser, sign in to [Garmin Connect](https://connect.garmin.com/).
2. Open **Activities → All Activities**, scroll to the bottom of the activity list, and choose **Export CSV**. Save the CSV file.
3. Start Stride with Node.js 22 or later:

   ```sh
   npm start
   ```

4. Visit [http://localhost:3000](http://localhost:3000) and choose the CSV file or drop it onto the import area. Use a metric export with distances in kilometers.

For development, use `npm run dev` to automatically restart the server when `server.js`, `package.json`, or `dev.js` changes. Changes under `public/` trigger a browser reload automatically.

On iPhone, tap **Choose CSV file → Choose File → Browse → Dropbox**. Install and sign in to the Dropbox app first. If Dropbox is missing, enable it in **Files → Browse → … → Edit**, as described in [Dropbox’s Files setup guide](https://help.dropbox.com/integrations/ios-files-app). The picker filters for CSV files; Stride also checks the `.csv` filename and validates its contents after selection.

Stride charts running and trail-running activities, and uses activity types from the export to color the calendar (including cycling, walking/hiking, swimming, strength training, and yoga). It supports Garmin CSVs with comma- or semicolon-separated columns. Mile-based imports are rejected when miles are specified in the distance or pace units; export your activities in kilometers from Garmin Connect instead. A plain `Distance` column is treated as kilometers, so miles cannot be detected when the export contains no unit labels.

Select **Import CSV** again to add activities or update existing ones. Repeated activities count once, using details from the latest import. Matching uses Garmin activity IDs when available, or the full start time and activity type. Older saved entries without start times use matching details or a unique date/type match; date-only exports cannot reliably distinguish otherwise identical activities on the same day. Activities absent from a later export remain saved. Use **Unload data** to clear everything before importing a replacement dataset.

The browser saves imported runs on this device, so the dashboard is available after a refresh. Use the same browser and local address to see the saved data.

The Calendar summary follows the visible month. In Runs and Patterns, the summary follows the time period selected above the content. Enable **Show rolling total** in Runs to add the cumulative distance for each rolling window to the chart. The **Import** menu contains CSV import, GPX import, and **Unload data**.

The Runs view includes a **Running heatmap** of all imported running and trail-running GPX routes, independent of the period filter. Routes share geographic positions with north at the top. Warmer colors indicate more runs passing through the same area; each run counts once per area. The heatmap stays in your browser and does not load an external map.

## Publish with GitHub Pages

The dashboard is a static site and can be published with GitHub Pages:

1. Push this repository to GitHub.
2. In the repository, open **Settings → Pages** and set the build and deployment source to **GitHub Actions**.
3. Push to the `main` or `master` branch, or run the **Deploy to GitHub Pages** workflow manually from the Actions tab.
4. Open the Pages URL shown in the workflow deployment.

The workflow publishes the `public/` directory. Each visitor imports their own Garmin CSV and GPX files; imported data stays in that visitor's browser and is not shared with you or other visitors.

## Development

Run the CSV parser, activity merge, training summary, and chart scale tests with `npm test`.
