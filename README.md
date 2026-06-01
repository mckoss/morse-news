# Morse News

A small, no-bundler Morse code practice site that sends daily news headlines as CW audio using Farnsworth timing.

## Run

```bash
npm install
npm start
```

Open <http://localhost:3000> on a desktop, or from a phone on the same network using the host machine's LAN IP and port 3000.

## Features

- Daily-ish cached headline feed at `/api/headlines`
- Generic source mix: NPR, AP via RSSHub, ScienceDaily, NASA
- Mobile-friendly practice interface
- 5, 10, 15, and 20 WPM effective copy speeds
- Farnsworth timing: characters at 20 WPM, spacing stretched for slower selected speeds
- 5/10/15 minute sessions
- Adjustable sidetone frequency

## Notes

This intentionally avoids a build step. The frontend is plain HTML/CSS/JS and the server is a small Express app.
