# CricketScore Pro

A responsive, local-first cricket scoring desk. Open `index.html` in a modern browser to start a match; no build step or server is required. Match settings, scorecards and ball-by-ball events are saved in that browser's local storage.

## Use

1. Set team names and player lists, overs, team size, bowler limit, format and toss decision.
2. Select the opening bowler.
3. Record runs, extras or a dismissal. Select a new bowler after each over and an incoming batter after a wicket.
4. Review the innings scorecards, history and result. Print or download the scorecard as CSV.

The score engine is kept separate from the interface in `scoring.js`. The app uses browser storage rather than a backend or account.

## Scoring tests

With Node.js 18 or newer, from this folder run:

```sh
node --test scoring.test.cjs
```

The tests cover scoring and extras, legal-ball counting, wicket attribution, strike and over transitions, undo, innings completion, ties and chase results.