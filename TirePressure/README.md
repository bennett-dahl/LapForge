# 992 Cup Tire Pressure Analysis Tool

Desktop (localhost) app to ingest Pi Toolbox Versioned ASCII exports, view tire pressure over time with lap splits, and manage starting pressures for a 27 psi target.

## Run (offline)

```bash
# From project root
pip install -r requirements.txt
python -m TirePressure.app
```

Then open **http://127.0.0.1:5000** in a browser.

## Features

- **Car/Driver**: Manage multiple car–driver combinations; sessions and tire sets are scoped per entry.
- **Upload**: Pi Toolbox .txt export → parse → save as session (P1/P2/P3/Qual/Race 1/Race 2) with roll-out pressures, ambient/track temp, tire set.
- **Sessions**: List by car/driver; open a session to see pressure chart (PSI/Bar toggle), lap splits, target line (27 psi / 1.86 bar), qual/race summary, roll-out and morning pressures.
- **Tire sets**: Set morning pressures (FL, FR, RL, RR) per tire set; these are the recommended starting pressures (stagger) for race.
- **Charts**: Pressure vs session time with lap boundaries and target line; unit toggle PSI/Bar.
- **Compare**: Stack multiple sessions; **saved comparisons** let you name and reopen the same session set from the Compare page (stored in SQLite).

## Data

- SQLite DB: `TirePressure/data/tire_pressure.db`
- Uploaded files copied to: `TirePressure/data/uploads/<session_id>.txt`

## Plan

See the project plan (992 Cup Tire Pressure Tool) for full spec and ToDo list.
