# Stride

Stride charts daily running distance and a 7-day rolling average from a Garmin Connect activities CSV. Its monthly calendar marks activity dates with colors by activity type. Rest days count as zero distance in the average. Your CSV is parsed in your browser and activity dates and running distances are saved in browser storage; they are not uploaded to a server.

## Run it locally

1. In a web browser, sign in to [Garmin Connect](https://connect.garmin.com/).
2. Open **Activities → All Activities**, scroll to the bottom of the activity list, and choose **Export CSV**. Save the CSV file.
3. Start Stride with Node.js 22 or later:

   ```sh
   npm start
   ```

4. Visit [http://localhost:3000](http://localhost:3000) and choose the CSV file.

For development, use `npm run dev` to automatically restart the server when `server.js`, `package.json`, or `dev.js` changes. Changes under `public/` trigger a browser reload automatically.

Stride charts running and trail-running activities, and uses activity types from the export to color the calendar (including cycling, walking/hiking, swimming, strength training, and yoga). It supports Garmin CSVs with comma- or semicolon-separated columns. Mile-based imports are rejected when miles are specified in the distance or pace units; export your activities in kilometers from Garmin Connect instead. A plain `Distance` column is treated as kilometers, so miles cannot be detected when the export contains no unit labels. Select **Import CSV** again whenever you want to replace the saved data with an updated export.

The browser saves imported runs on this device, so the dashboard is available after a refresh. Use the same browser and local address to see the saved data.

## Publish with GitHub Pages

The dashboard is a static site and can be published with GitHub Pages:

1. Push this repository to GitHub.
2. In the repository, open **Settings → Pages** and set the build and deployment source to **GitHub Actions**.
3. Push to the `main` or `master` branch, or run the **Deploy to GitHub Pages** workflow manually from the Actions tab.
4. Open the Pages URL shown in the workflow deployment.

The workflow publishes the `public/` directory. Each visitor imports their own Garmin CSV and GPX files; imported data stays in that visitor's browser and is not shared with you or other visitors.

## Development

Run the CSV parser tests with `npm test`.
