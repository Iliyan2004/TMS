# GIS Team Tasks

Task management for a GIS team. Roles: **Supervisor** and **Team Lead** (both admins: assign tasks, manage users),
and **Users** (work on assigned tasks and log their own). Zero npm dependencies — needs Node >= 22.5 (built-in SQLite).

## Run
    npm start            # http://localhost:3000

## Environment variables
| Var | Purpose |
|---|---|
| `PORT` | Port to listen on (most hosts set this automatically) |
| `DATA_DIR` | Folder for the SQLite database. **Point this at a persistent volume** or data is lost on redeploy |
| `INITIAL_PASSWORD` | Temporary password for all seeded users on first run (otherwise random ones are printed to the log once). Everyone must change it at first sign-in |

On first run with an empty database the team (mudassir, abdur, iliyan, laiba, wafa, rimsha, haroon) and the
tasks from `seed/daily-report.json` are created.

## Deploy notes
Use any host that runs Node with a persistent disk (Railway, Render, Fly.io, a VPS). Start command: `npm start`.
Serve it over HTTPS.
