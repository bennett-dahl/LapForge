# Plan addendum: Compare view – align by time or distance

This extends the **Compare two or more sessions** section of the session simplify/compare/crosshair plan.

## Requirement

- **Toggle alignment axis**: In the compare view, allow a toggle **Align by: Time | Distance**.
- When **Time**: x-axis is normalized time (0–1 per session), as in the original plan.
- When **Distance**: x-axis is normalized distance using the `log_distance` column from the export (0–1 per session, i.e. 0% to 100% of session distance).

## Data model and backend

1. **Parser / export**
   - The Pi Toolbox export (and parser) already expose whatever columns exist in the ChannelBlock header. You’ve added `log_distance` to the export, so each row will have `row["log_distance"]` (or the exact column name you use). No parser change needed unless the column name differs (e.g. `log_distance` vs `distance`); use the same key as in the export.

2. **Processed blob (stored data)**
   - When building processed data in `_process_parsed_to_stored`:
     - Keep building `times` from the time column as now.
     - If a distance column exists (e.g. `"log_distance"` in `rows[0]`), also build a parallel array `distances` (same length as `times`), and store it in the processed blob as `"distances"`.
     - Optionally store `lap_split_distances`: for each lap split time, interpolate the distance at that time from `(times, distances)` and store. That allows lap ticks on the distance-based compare chart (e.g. “Lap 2” at the right distance).
   - If a session has no distance column, the compare view uses only time alignment and hides or disables the “Distance” option for that session (or for the whole compare if any session lacks distance).

3. **Compare route**
   - For each session, return both:
     - `times` and (if present) `distances`
     - `times_norm` (0–1 by time) and, when distance exists, `distances_norm` (0–1 by distance)
   - So the front-end can switch without a new request: it already has both series; it just switches which x values (and optionally which lap tick positions) are used.

## Frontend (compare view)

- **Toggle**: “Align by: [Time] [Distance]” (e.g. two links or a small segmented control).
- **Behavior**:
  - **Time**: use `times_norm` for x; lap ticks from time-based lap splits (mapped into 0–1).
  - **Distance**: use `distances_norm` for x; lap ticks from `lap_split_distances` normalized (if stored), or hide lap ticks when in distance mode if not.
- **Zoom and y-bounds**: unchanged; they apply to whichever axis is selected (same x range 0–1, same y min/max).
- If any session in the comparison has no `distances`, either:
  - disable the “Distance” option and show a short note (“Distance alignment requires all sessions to have distance data”), or
  - allow Distance but only for sessions that have it (others could show “No distance” or be skipped in distance mode). Prefer: require all to have distance to enable Distance, to keep one consistent x-axis.

## Session detail (single-session chart)

- No change: the single-session pressure chart remains time-based (x = time, lap labels from time). Distance is only used in the compare view for alignment.

## Summary

| Item | Action |
|------|--------|
| Export / parser | Use existing `log_distance` (or your column name); no change unless column name differs. |
| `_process_parsed_to_stored` | If `log_distance` (or equivalent) in rows: build `distances`, store in blob; optionally compute and store `lap_split_distances`. |
| Compare API | Return both `times_norm` and `distances_norm` (and lap tick data for both) per session when available. |
| Compare UI | Toggle “Align by: Time \| Distance”; use corresponding x and lap ticks; disable Distance if any session lacks distance data. |

This keeps the existing time-aligned compare behaviour and adds an optional, toggleable distance-aligned view using `log_distance`.
