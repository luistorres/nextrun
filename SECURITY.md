# Security Policy

nextrun handles Garmin Connect credentials at sign-in and stores the resulting Garmin session tokens, encrypted, so security reports are taken seriously.

## Reporting a vulnerability

Please do not open a public issue. Report privately through GitHub's [private vulnerability reporting](https://github.com/luistorres/nextrun/security/advisories/new) with steps to reproduce and the impact you observed.

You can expect an acknowledgement within a week. This is a one-person project, so fixes are prioritized by severity rather than on a fixed schedule.

## Scope

Only the `main` branch and the live deployment at https://nextrun.fly.dev are supported; there are no versioned releases.

In scope:

- Sign-in, session handling and the email allow-list
- Encryption and storage of Garmin tokens
- Reading or changing another user's data
- Webhook endpoints under `/api/webhooks/`

Out of scope:

- Bugs in the unofficial [`garmin-connect`](https://github.com/Pythe1337N/garmin-connect) library; report those to that project
- Denial-of-service and volumetric testing against the live deployment
