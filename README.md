# Stride

A small, private dashboard that reads your Strava running activities and charts daily distance alongside its 7-day rolling average. Rest days count as zero distance in the average.

## Run it locally

1. Create an API application at [strava.com/settings/api](https://www.strava.com/settings/api).
2. Set the app's **Authorization Callback Domain** to `localhost`.
3. Copy `.env.example` to `.env` and enter the app's client ID and client secret. Keep the secret private.
4. Start the app with Node.js 18 or later:

   ```sh
   npm start
   ```

5. Visit [http://localhost:3000](http://localhost:3000) and connect to Strava.

The callback URL must match the one configured in the app: `http://localhost:3000/auth/callback`. The app requests `activity:read_all` access so it can include your historical runs. It reads run and trail-run activities for the selected 30-day, 90-day, 6-month, or 1-year period.

OAuth tokens are stored in `.strava-token.json` on the machine running the app, which is excluded from Git. The app makes Strava API requests from the local server; your client secret is never sent to the browser.
