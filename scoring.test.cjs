const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./scoring.js');

function fixture({ overs = 1, size = 3, maxBowler = 1 } = {}) {
  const players = (prefix) => Array.from({ length: size }, (_, i) => ({ id: prefix + i, name: prefix + ' Player ' + (i + 1) }));
  const teams = [
    { id: 'A', name: 'Falcons', players: players('a') },
    { id: 'B', name: 'Rovers', players: players('b') }
  ];
  const match = E.createMatch({ teams, battingFirstId: 'A', oversLimit: overs, playersPerTeam: size, maxOversPerBowler: maxBowler, format: 'Custom' });
  E.chooseBowler(match, 'b0');
  return match;
}

test('normal scoring updates batter, bowler, legal balls and strike', () => {
  const m = fixture();
  E.applyBall(m, 4);
  const x = E.currentInnings(m), s = E.summary(m);
  assert.equal(x.score, 4);
  assert.equal(x.legalBalls, 1);
  assert.equal(x.batting.a0.runs, 4);
  assert.equal(x.batting.a0.balls, 1);
  assert.equal(x.batting.a0.fours, 1);
  assert.equal(x.bowling.b0.runs, 4);
  assert.equal(x.strikerId, 'a0');
  assert.equal(s.runRate, 24);
});

test('wide adds one penalty plus completed runs and stays illegal', () => {
  const m = fixture();
  E.applyExtra(m, { kind: 'wide', runs: 2 });
  const x = E.currentInnings(m);
  assert.equal(x.score, 3);
  assert.equal(x.extras.wides, 3);
  assert.equal(x.legalBalls, 0);
  assert.equal(x.bowling.b0.runs, 3);
  assert.equal(x.batting.a0.balls, 0);
});

test('no-ball bat and leg-bye runs split credits and remain illegal', () => {
  const m = fixture();
  E.applyExtra(m, { kind: 'noBall', batRuns: 4, runningRuns: 2, runningType: 'legByes' });
  const x = E.currentInnings(m);
  assert.equal(x.score, 7);
  assert.equal(x.extras.noBalls, 1);
  assert.equal(x.extras.legByes, 2);
  assert.equal(x.batting.a0.runs, 4);
  assert.equal(x.batting.a0.balls, 0);
  assert.equal(x.bowling.b0.runs, 5);
  assert.equal(x.legalBalls, 0);
  assert.throws(() => E.applyExtra(m, { kind: 'noBall', runningRuns: 2, runningType: 'none' }), /Select byes or leg-byes/);
});

test('byes are legal, extras only and not charged to the bowler', () => {
  const m = fixture();
  E.applyExtra(m, { kind: 'bye', runs: 1 });
  const x = E.currentInnings(m);
  assert.equal(x.score, 1);
  assert.equal(x.legalBalls, 1);
  assert.equal(x.extras.byes, 1);
  assert.equal(x.batting.a0.runs, 0);
  assert.equal(x.batting.a0.balls, 1);
  assert.equal(x.bowling.b0.runs, 0);
  assert.equal(x.strikerId, 'a1');
});

test('run out counts as a wicket but is not credited to bowler; incoming batter fills vacancy', () => {
  const m = fixture();
  E.applyWicket(m, { type: 'Run out', playerId: 'a0', fielder: 'Sam' });
  let x = E.currentInnings(m);
  assert.equal(x.wickets, 1);
  assert.equal(x.bowling.b0.wickets, 0);
  assert.equal(x.bowling.b0.legalBalls, 1);
  assert.equal(x.pendingWicket.slot, 'strikerId');
  E.chooseIncoming(m, 'a2');
  x = E.currentInnings(m);
  assert.equal(x.strikerId, 'a2');
  assert.equal(x.nonStrikerId, 'a1');
  assert.equal(x.pendingWicket, null);
});

test('caught dismissal records fielder and is charged to bowler; illegal caught is rejected atomically', () => {
  const m = fixture();
  assert.throws(() => E.applyWicket(m, { type: 'Caught', delivery: 'noBall', playerId: 'a0', fielder: 'Sam' }), /cannot be recorded from a no-ball/);
  assert.equal(E.currentInnings(m).events.length, 0);
  E.applyWicket(m, { type: 'Caught', playerId: 'a0', fielder: 'Sam' });
  const x = E.currentInnings(m);
  assert.equal(x.wickets, 1);
  assert.equal(x.bowling.b0.wickets, 1);
  assert.equal(x.batting.a0.dismissal.fielder, 'Sam');
});

test('six legal balls complete an over, switch ends, credit a maiden and require a new bowler', () => {
  const m = fixture({ overs: 2, maxBowler: 1 });
  for (let i = 0; i < 6; i++) E.applyBall(m, 0);
  const x = E.currentInnings(m);
  assert.equal(x.legalBalls, 6);
  assert.equal(E.summary(m).overs, '1.0');
  assert.equal(x.currentBowlerId, null);
  assert.equal(x.lastBowlerId, 'b0');
  assert.equal(x.strikerId, 'a1');
  assert.equal(x.nonStrikerId, 'a0');
  assert.equal(x.bowling.b0.maidens, 1);
  assert.throws(() => E.chooseBowler(m, 'b0'), /cannot bowl consecutive overs/);
  E.chooseBowler(m, 'b1');
  assert.equal(x.currentBowlerId, 'b1');
});

test('undo restores delivery, extras, figures, strike, event log and innings phase', () => {
  const m = fixture();
  E.applyBall(m, 1);
  E.applyExtra(m, { kind: 'wide', runs: 1 });
  E.undo(m);
  let x = E.currentInnings(m);
  assert.equal(x.score, 1);
  assert.equal(x.legalBalls, 1);
  assert.equal(x.extras.wides, 0);
  assert.equal(x.bowling.b0.runs, 1);
  assert.equal(x.events.length, 1);
  E.undo(m);
  x = E.currentInnings(m);
  assert.equal(x.score, 0);
  assert.equal(x.legalBalls, 0);
  assert.equal(x.batting.a0.balls, 0);
  assert.equal(x.bowling.b0.runs, 0);
  assert.equal(x.strikerId, 'a0');
  assert.equal(x.events.length, 0);
});

test('penalty changes team total and extras without a delivery or bowler charge; undo reverses it', () => {
  const m = fixture();
  E.applyPenalty(m, 5);
  let x = E.currentInnings(m);
  assert.equal(x.score, 5);
  assert.equal(x.extras.penalty, 5);
  assert.equal(x.legalBalls, 0);
  assert.equal(x.bowling.b0.runs, 0);
  E.undo(m);
  assert.equal(E.currentInnings(m).score, 0);
});

test('first innings completes at overs limit; reaching target wins by wickets', () => {
  const m = fixture({ size: 2 });
  E.applyBall(m, 1);
  for (let i = 0; i < 5; i++) E.applyBall(m, 0);
  assert.equal(m.phase, 'inningsBreak');
  assert.equal(m.innings[0].score, 1);
  E.startSecondInnings(m);
  assert.equal(E.currentInnings(m).teamId, 'B');
  E.chooseBowler(m, 'a0');
  E.applyBall(m, 2);
  assert.equal(m.phase, 'complete');
  assert.equal(m.result.type, 'win');
  assert.match(m.result.text, /Rovers won by 1 wicket/);
});

test('second innings does not declare a winner early and tied scores remain tied', () => {
  const m = fixture({ size: 2 });
  for (let i = 0; i < 6; i++) E.applyBall(m, 0);
  assert.equal(m.phase, 'inningsBreak');
  E.startSecondInnings(m);
  E.chooseBowler(m, 'a0');
  E.applyBall(m, 0);
  assert.equal(m.phase, 'live');
  assert.equal(m.result, null);
  for (let i = 0; i < 5; i++) E.applyBall(m, 0);
  assert.equal(m.phase, 'complete');
  assert.deepEqual(m.result, { type: 'tie', text: 'Match tied' });
});

test('all available wickets end the innings; final-over dismissal swaps the incoming role correctly', () => {
  const m = fixture({ size: 3, overs: 2 });
  for (let i = 0; i < 5; i++) E.applyBall(m, 0);
  E.applyWicket(m, { type: 'Run out', playerId: 'a0' });
  assert.equal(m.phase, 'live');
  assert.equal(E.currentInnings(m).pendingWicket.slot, 'nonStrikerId');
  E.chooseIncoming(m, 'a2');
  assert.equal(E.currentInnings(m).strikerId, 'a1');
  assert.equal(E.currentInnings(m).nonStrikerId, 'a2');
});

test('last wicket ends the innings and an under-par chase awards runs to first innings team', () => {
  const m = fixture({ size: 2 });
  E.applyBall(m, 1);
  for (let i = 0; i < 5; i++) E.applyBall(m, 0);
  E.startSecondInnings(m);
  E.chooseBowler(m, 'a0');
  E.applyWicket(m, { type: 'Run out', playerId: 'b0' });
  assert.equal(m.phase, 'complete');
  assert.equal(m.result.type, 'win');
  assert.match(m.result.text, /Falcons won by 1 run/);
});

test('manual total corrections are undoable and do not change balls', () => {
  const m = fixture();
  E.applyBall(m, 1);
  E.correctState(m, { score: 6, wickets: 0, byes: 2, legByes: 0, wides: 1, noBalls: 0, penalty: 0 });
  assert.equal(E.currentInnings(m).score, 6);
  assert.equal(E.currentInnings(m).extras.wides, 1);
  assert.equal(E.currentInnings(m).legalBalls, 1);
  E.undo(m);
  assert.equal(E.currentInnings(m).score, 1);
  assert.equal(E.currentInnings(m).extras.wides, 0);
});

test('illegal deliveries do not advance the over; byes do not charge bowler runs', () => {
  const m = fixture({ overs: 2, maxBowler: 1 });
  for (let i = 0; i < 4; i++) E.applyBall(m, 0);
  E.applyExtra(m, { kind: 'wide', runs: 0 });
  E.applyExtra(m, { kind: 'noBall', batRuns: 0 });
  E.applyExtra(m, { kind: 'bye', runs: 1 });
  assert.equal(E.currentInnings(m).legalBalls, 5);
  E.applyExtra(m, { kind: 'bye', runs: 1 });
  const x = E.currentInnings(m);
  assert.equal(x.legalBalls, 6);
  assert.equal(x.bowling.b0.legalBalls, 6);
  assert.equal(x.bowling.b0.runs, 2);
  assert.equal(x.bowling.b0.maidens, 0);
});

test('retired hurt is not a wicket, uses no ball, and batter can return', () => {
  const m = fixture({ size: 3, overs: 2 });
  E.applyWicket(m, { type: 'Retired hurt', playerId: 'a0' });
  let x = E.currentInnings(m);
  assert.equal(x.wickets, 0);
  assert.equal(x.legalBalls, 0);
  assert.equal(x.pendingWicket.dismissedId, 'a0');
  E.chooseIncoming(m, 'a2');
  E.applyWicket(m, { type: 'Run out', playerId: 'a2' });
  E.chooseIncoming(m, 'a0');
  x = E.currentInnings(m);
  assert.equal(x.strikerId, 'a0');
  assert.equal(x.batting.a0.status, 'batting');
});

test('opening batters are shown at the crease before the first ball', () => {
  const m = fixture();
  const s = E.summary(m);
  assert.equal(s.batting[0].status, 'batting');
  assert.equal(s.batting[1].status, 'batting');
});

test('caught dismissal requires a fielder name before it changes the innings', () => {
  const m = fixture();
  assert.throws(() => E.applyWicket(m, { type: 'Caught', playerId: 'a0' }), /Enter the fielder/);
  assert.equal(E.currentInnings(m).events.length, 0);
  assert.equal(E.currentInnings(m).wickets, 0);
});