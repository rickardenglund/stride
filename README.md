# Stride

Stride charts daily running distance and a 7-day rolling average from a Garmin Connect activities CSV. Its monthly calendar marks activity dates with colors by activity type. Rest days count as zero distance in the average. Your CSV is parsed in your browser and activity dates and running distances are saved in browser storage; they are not uploaded to a server.

## Run it locally

1. In a web browser, sign in to [Garmin Connect](https://connect.garmin.com/).
2. Open **Activities → All Activities**, scroll to the bottom of the activity list, and choose **Export CSV**. Save the CSV file.
3. Start Stride with Node.js 18 or later:

   ```sh
   npm start
   ```

4. Visit [http://localhost:3000](http://localhost:3000) and choose the CSV file.

For development, use `npm run dev` to automatically restart the server when server files change. Browser-side changes such as styles and scripts will normally update on browser refresh; Node's watch mode does not automatically reload the browser.

Stride charts running and trail-running activities, and uses activity types from the export to color the calendar (including cycling, walking/hiking, swimming, strength training, and yoga). It supports Garmin CSVs with comma- or semicolon-separated columns. If the distance column specifies miles, Stride converts them to kilometers automatically. A plain `Distance` column is treated as kilometers. Select **Import CSV** again whenever you want to replace the saved data with an updated export.

The browser saves imported runs on this device, so the dashboard is available after a refresh. Use the same browser and local address to see the saved data.

## Development

Run the CSV parser tests with `npm test`.
