(function (root) {
  const MAX_RECENT = 80;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const id = () => `p_${Math.random().toString(36).slice(2, 9)}`;
  const emptyExtras = () => ({ wides: 0, noBalls: 0, byes: 0, legByes: 0, penalty: 0 });
  const overText = (legalBalls) => `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`;
  const rate = (runs, balls) => balls ? Number((runs / (balls / 6)).toFixed(2)) : 0;
  const bowlerCreditedDismissals = new Set(['Bowled', 'Caught', 'LBW', 'Stumped', 'Hit wicket']);
  const noBallDismissals = new Set(['Run out', 'Hit the ball twice', 'Obstructing the field']);
  const wideDismissals = new Set(['Run out', 'Stumped', 'Hit the ball twice', 'Obstructing the field']);

  function makeStats(players) {
    return Object.fromEntries(players.map((player) => [player.id, {
      id: player.id, name: player.name, runs: 0, balls: 0, fours: 0, sixes: 0,
      dismissal: null, status: 'yet'
    }]));
  }
  function newInnings(teamId, battingPlayers, bowlingPlayers) {
    const batting = makeStats(battingPlayers);
    const strikerId = battingPlayers[0]?.id || null;
    const nonStrikerId = battingPlayers[1]?.id || null;
    if (strikerId) batting[strikerId].status = 'batting';
    if (nonStrikerId) batting[nonStrikerId].status = 'batting';
    return {
      teamId, battingPlayers: clone(battingPlayers), bowlingPlayers: clone(bowlingPlayers),
      score: 0, wickets: 0, legalBalls: 0, extras: emptyExtras(),
      batting, bowling: {}, falls: [], events: [],
      overSummaries: [], strikerId, nonStrikerId, currentBowlerId: null,
      pendingWicket: null, inningsComplete: false, lastBowlerId: null
    };
  }
  function createMatch(settings) {
    const teams = clone(settings.teams);
    const firstTeamId = settings.battingFirstId;
    const firstBat = teams.find((team) => team.id === firstTeamId);
    const secondBat = teams.find((team) => team.id !== firstTeamId);
    const innings = newInnings(firstBat.id, firstBat.players, secondBat.players);
    return {
      id: settings.id || `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: settings.title || `${teams[0].name} vs ${teams[1].name}`,
      venue: settings.venue || '', format: settings.format || 'Custom',
      oversLimit: Number(settings.oversLimit), playersPerTeam: Number(settings.playersPerTeam),
      maxOversPerBowler: Number(settings.maxOversPerBowler), teams,
      phase: 'live', currentInnings: 0, innings: [innings], paused: false,
      result: null, playerOfMatch: null, createdAt: settings.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(), undoStack: [],
      tossWinnerId: settings.tossWinnerId || firstTeamId, tossDecision: settings.tossDecision || 'bat'
    };
  }
  function currentInnings(match) { return match.innings[match.currentInnings]; }
  function teamName(match, teamId) { return match.teams.find((team) => team.id === teamId)?.name || 'Team'; }
  function getBowlerStats(innings, player) {
    if (!innings.bowling[player.id]) innings.bowling[player.id] = {
      id: player.id, name: player.name, legalBalls: 0, runs: 0, wickets: 0,
      wides: 0, noBalls: 0, maidens: 0
    };
    return innings.bowling[player.id];
  }
  function assertLive(match) {
    if (!match || match.phase !== 'live') throw new Error('This match is not live.');
    if (match.paused) throw new Error('Resume the match before scoring.');
    const inn = currentInnings(match);
    if (inn.inningsComplete || inn.pendingWicket) throw new Error('Resolve the current innings action before scoring.');
    if (!inn.currentBowlerId) throw new Error('Select a bowler before recording a delivery.');
    if (!inn.strikerId || !inn.nonStrikerId) throw new Error('Select both batters before scoring.');
  }
  function snapshotForUndo(match) {
    const inn = clone(currentInnings(match));
    inn.events = [];
    return { phase: match.phase, currentInnings: match.currentInnings, inningsIndex: match.currentInnings, inningsState: inn, result: clone(match.result), pendingOverBowler: match.pendingOverBowler || false };
  }
  function beginEvent(match, event) {
    assertLive(match);
    const inn = currentInnings(match);
    match.undoStack.push(snapshotForUndo(match));
    const striker = inn.batting[inn.strikerId];
    const nonStriker = inn.batting[inn.nonStrikerId];
    const bowler = inn.bowlingPlayers.find((player) => player.id === inn.currentBowlerId);
    const ballNumber = inn.legalBalls;
    const stored = {
      id: `e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      innings: match.currentInnings + 1, over: Math.floor(ballNumber / 6) + 1,
      legalBall: ballNumber % 6 + 1, scoreBefore: inn.score, strikerId: striker?.id || null,
      strikerName: striker?.name || '', nonStrikerId: nonStriker?.id || null,
      nonStrikerName: nonStriker?.name || '', bowlerId: bowler?.id || null,
      bowlerName: bowler?.name || '', ...event
    };
    inn.events.push(stored);
    return { inn, striker, bowler, stored };
  }
  function settleDelivery(match, context, opts) {
    const { inn, striker, bowler, stored } = context;
    const { legal, bowlerRuns, batterRuns, extraType, extraValue, runningRuns, dismissal } = opts;
    const bowlerStats = getBowlerStats(inn, bowler);
    const batter = striker;
    const teamRuns = bowlerRuns + (opts.nonBowlerRuns || 0);
    inn.score += teamRuns;
    bowlerStats.runs += bowlerRuns;
    if (extraType && extraValue) inn.extras[extraType] += extraValue;
    if (opts.runningType && runningRuns) inn.extras[opts.runningType] += runningRuns;
    if (extraType === 'wides') bowlerStats.wides += extraValue;
    if (extraType === 'noBalls') bowlerStats.noBalls += 1;
    if (legal) {
      inn.legalBalls += 1;
      bowlerStats.legalBalls += 1;
      batter.balls += 1;
    }
    if (batterRuns) {
      batter.runs += batterRuns;
      if (batterRuns === 4) batter.fours += 1;
      if (batterRuns === 6) batter.sixes += 1;
    }
    if (batter) batter.status = 'batting';
    let rotationRuns = runningRuns + batterRuns;
    if (rotationRuns % 2) [inn.strikerId, inn.nonStrikerId] = [inn.nonStrikerId, inn.strikerId];
    stored.teamRuns = teamRuns;
    stored.bowlerRuns = bowlerRuns;
    stored.batterRuns = batterRuns;
    stored.legal = legal;
    stored.scoreAfter = inn.score;
    stored.wicketsAfter = inn.wickets;
    if (dismissal) {
      const dismissed = inn.batting[dismissal.playerId];
      if (!dismissed) throw new Error('Choose a batter in this innings.');
      const wasStriker = inn.strikerId === dismissed.id;
      const wasNonStriker = inn.nonStrikerId === dismissed.id;
      if (!wasStriker && !wasNonStriker) throw new Error('That batter is not currently at the crease.');
      const outIsWicket = dismissal.type !== 'Retired hurt';
      dismissed.dismissal = { type: dismissal.type, fielder: dismissal.fielder || '', bowler: bowler.name, over: overText(inn.legalBalls) };
      dismissed.status = dismissal.type === 'Retired hurt' ? 'retired hurt' : 'out';
      if (outIsWicket) {
        inn.wickets += 1;
        if (bowlerCreditedDismissals.has(dismissal.type)) bowlerStats.wickets += 1;
      }
      if (outIsWicket) inn.falls.push({ wicket: inn.wickets, score: inn.score, batter: dismissed.name, over: overText(inn.legalBalls), type: dismissal.type });
      if (wasStriker) inn.strikerId = null;
      else inn.nonStrikerId = null;
      const maxWickets = Math.max(0, inn.battingPlayers.length - 1);
      if (outIsWicket && inn.wickets >= maxWickets) {
        inn.pendingWicket = null;
        inn.inningsComplete = true;
      } else {
        inn.pendingWicket = { dismissedId: dismissed.id, slot: wasStriker ? 'strikerId' : 'nonStrikerId', type: dismissal.type };
      }
      stored.dismissal = clone(dismissal);
      stored.wicketsAfter = inn.wickets;
    }
    const overJustEnded = legal && inn.legalBalls > 0 && inn.legalBalls % 6 === 0;
    if (overJustEnded) {
      [inn.strikerId, inn.nonStrikerId] = [inn.nonStrikerId, inn.strikerId];
      if (inn.pendingWicket) inn.pendingWicket.slot = inn.pendingWicket.slot === 'strikerId' ? 'nonStrikerId' : 'strikerId';
      inn.lastBowlerId = inn.currentBowlerId;
      inn.currentBowlerId = null;
      const overNo = Math.ceil(inn.legalBalls / 6);
      const deliveries = inn.events.filter((item) => item.over === overNo);
      const priorScore = deliveries.length > 1 ? deliveries[0].scoreBefore || 0 : (inn.score - deliveries.reduce((sum, item) => sum + (item.teamRuns || 0), 0));
      const total = deliveries.reduce((sum, item) => sum + (item.teamRuns || 0), 0);
      const bowlerRunsThisOver = deliveries.reduce((sum, item) => sum + (item.bowlerRuns || 0), 0);
      if (deliveries.filter((item) => item.legal).length === 6 && bowlerRunsThisOver === 0) bowlerStats.maidens += 1;
      inn.overSummaries[overNo - 1] = { over: overNo, runs: total, wickets: deliveries.filter((item) => item.dismissal && item.dismissal.type !== 'Retired hurt').length, balls: deliveries.map((item) => item.label || String(item.batterRuns ?? 0)), score: inn.score, scoreStart: priorScore };
    }
    evaluateMatch(match);
    match.updatedAt = new Date().toISOString();
    return match;
  }
  function applyBall(match, batRuns) {
    const runs = Number(batRuns);
    if (!Number.isInteger(runs) || runs < 0 || runs > 6) throw new Error('Choose a score from 0 to 6.');
    const context = beginEvent(match, { kind: 'ball', label: runs === 0 ? '•' : String(runs), batRuns: runs });
    return settleDelivery(match, context, { legal: true, bowlerRuns: runs, batterRuns: runs, runningRuns: 0 });
  }
  function applyExtra(match, spec) {
    const kind = spec.kind;
    const runs = Number(spec.runs || 0);
    if (!Number.isInteger(runs) || runs < 0 || runs > 6) throw new Error('Runs must be a whole number between 0 and 6.');
    if (kind === 'wide') {
      const context = beginEvent(match, { kind: 'wide', label: runs ? `WD+${runs}` : 'WD', batRuns: 0, extraRuns: runs + 1 });
      return settleDelivery(match, context, { legal: false, bowlerRuns: runs + 1, batterRuns: 0, extraType: 'wides', extraValue: runs + 1, runningRuns: runs });
    }
    if (kind === 'noBall') {
      const batRuns = Number(spec.batRuns || 0);
      const runningRuns = Number(spec.runningRuns || 0);
      if (![batRuns, runningRuns].every((n) => Number.isInteger(n) && n >= 0 && n <= 6)) throw new Error('Runs must be whole numbers between 0 and 6.');
      const type = spec.runningType === 'legByes' ? 'legByes' : spec.runningType === 'byes' ? 'byes' : null;
      if (runningRuns && !type) throw new Error('Select byes or leg-byes for additional runs.');
      const context = beginEvent(match, { kind: 'noBall', label: `NB${batRuns ? `+${batRuns}` : ''}${runningRuns ? `+${runningRuns}${type === 'byes' ? 'B' : type === 'legByes' ? 'LB' : ''}` : ''}`, batRuns, extraRuns: 1 + runningRuns });
      return settleDelivery(match, context, { legal: false, bowlerRuns: 1 + batRuns, nonBowlerRuns: type ? runningRuns : 0, batterRuns: batRuns, extraType: 'noBalls', extraValue: 1, runningRuns, runningType: type, ...((type && runningRuns) ? { nonBowlerRuns: runningRuns, extraType: 'noBalls' } : {}) });
    }
    if (kind === 'bye' || kind === 'legBye') {
      if (runs < 1) throw new Error('Enter at least one bye or leg-bye run.');
      const category = kind === 'bye' ? 'byes' : 'legByes';
      const context = beginEvent(match, { kind, label: kind === 'bye' ? `B${runs}` : `LB${runs}`, batRuns: 0, extraRuns: runs });
      return settleDelivery(match, context, { legal: true, bowlerRuns: 0, nonBowlerRuns: runs, batterRuns: 0, extraType: category, extraValue: runs, runningRuns: runs });
    }
    throw new Error('Choose a valid extra.');
  }
  function applyWicket(match, spec) {
    const type = spec.type;
    if (!type) throw new Error('Choose a dismissal.');
    if (type === 'Caught' && !String(spec.fielder || '').trim()) throw new Error('Enter the fielder who took the catch.');
    const current = currentInnings(match);
    const playerId = spec.playerId || current.strikerId;
    if (!current.batting[playerId] || ![current.strikerId, current.nonStrikerId].includes(playerId)) throw new Error('Choose a batter at the crease.');
    const legal = spec.delivery !== 'noBall' && spec.delivery !== 'wide' && !['Timed out', 'Retired out', 'Retired hurt'].includes(type);
    if (spec.delivery === 'noBall' && !noBallDismissals.has(type) && type !== 'Run out') throw new Error(`${type} cannot be recorded from a no-ball.`);
    if (spec.delivery === 'wide' && !wideDismissals.has(type)) throw new Error(`${type} cannot be recorded from a wide.`);
    const runs = Number(spec.runs || 0);
    if (!Number.isInteger(runs) || runs < 0 || runs > 6) throw new Error('Runs must be a whole number between 0 and 6.');
    if (runs > 0 && type !== 'Run out') throw new Error('Only completed runs on a run out can be entered here.');
    let context;
    let opts;
    if (spec.delivery === 'wide') {
      context = beginEvent(match, { kind: 'wide', label: runs ? `WD+${runs}+W` : 'WD+W', batRuns: 0, extraRuns: runs + 1 });
      opts = { legal: false, bowlerRuns: runs + 1, batterRuns: 0, extraType: 'wides', extraValue: runs + 1, runningRuns: runs };
    } else if (spec.delivery === 'noBall') {
      context = beginEvent(match, { kind: 'noBall', label: `NB${runs ? `+${runs}` : ''}+W`, batRuns: runs, extraRuns: 1 });
      opts = { legal: false, bowlerRuns: runs + 1, batterRuns: runs, extraType: 'noBalls', extraValue: 1, runningRuns: runs };
    } else if (['Timed out', 'Retired out', 'Retired hurt'].includes(type)) {
      context = beginEvent(match, { kind: 'wicket', label: type === 'Retired hurt' ? 'RH' : 'W', batRuns: 0 });
      opts = { legal: false, bowlerRuns: 0, batterRuns: 0, runningRuns: 0 };
    } else {
      context = beginEvent(match, { kind: 'wicket', label: runs ? `${runs}+W` : 'W', batRuns: runs });
      opts = { legal: true, bowlerRuns: runs, batterRuns: runs, runningRuns: 0 };
    }
    opts.dismissal = { type, playerId, fielder: spec.fielder || '' };
    return settleDelivery(match, context, opts);
  }
  function applyPenalty(match, runs) {
    const delta = Number(runs);
    if (!Number.isInteger(delta) || delta < -100 || delta > 100 || delta === 0) throw new Error('Enter a non-zero whole number between -100 and 100.');
    if (!match || match.phase !== 'live' || match.paused) throw new Error('Penalty runs can only be added to a live match.');
    const inn = currentInnings(match);
    if (inn.pendingWicket || inn.inningsComplete) throw new Error('Resolve the current innings action first.');
    match.undoStack.push(snapshotForUndo(match));
    const event = { id: `e_${Date.now()}`, kind: 'penalty', label: delta > 0 ? `P+${delta}` : `P${delta}`, innings: match.currentInnings + 1, over: Math.floor(inn.legalBalls / 6) + 1, legal: false, teamRuns: delta, bowlerRuns: 0, batterRuns: 0, scoreBefore: inn.score, scoreAfter: inn.score + delta };
    inn.score += delta;
    inn.extras.penalty += delta;
    inn.events.push(event);
    evaluateMatch(match);
    match.updatedAt = new Date().toISOString();
    return match;
  }
  function chooseIncoming(match, playerId, slot) {
    const inn = currentInnings(match);
    if (!inn.pendingWicket) throw new Error('There is no incoming batter to select.');
    const player = inn.batting[playerId];
    if (!player || !['yet', 'retired hurt'].includes(player.status)) throw new Error('Choose an unused batter or a retired hurt batter returning to play.');
    const targetSlot = slot || inn.pendingWicket.slot;
    if (targetSlot !== inn.pendingWicket.slot) throw new Error('The incoming batter must fill the vacant end.');
    inn[targetSlot] = playerId;
    player.status = 'batting';
    inn.pendingWicket = null;
    match.updatedAt = new Date().toISOString();
    return match;
  }
  function chooseBowler(match, bowlerId) {
    if (match.phase !== 'live' || match.paused) throw new Error('Resume the match before choosing a bowler.');
    const inn = currentInnings(match);
    if (inn.pendingWicket || inn.inningsComplete) throw new Error('Resolve the innings action first.');
    if (!inn.bowlingPlayers.some((player) => player.id === bowlerId)) throw new Error('Choose a player from the bowling team.');
    if (inn.lastBowlerId === bowlerId && inn.legalBalls % 6 === 0 && inn.legalBalls > 0) throw new Error('The previous bowler cannot bowl consecutive overs.');
    const stats = getBowlerStats(inn, inn.bowlingPlayers.find((player) => player.id === bowlerId));
    if (stats.legalBalls >= match.maxOversPerBowler * 6) throw new Error(`${stats.name} has reached the ${match.maxOversPerBowler}-over limit.`);
    inn.currentBowlerId = bowlerId;
    match.updatedAt = new Date().toISOString();
    return match;
  }
  function swapBatters(match, strikerId, nonStrikerId) {
    const inn = currentInnings(match);
    if (inn.pendingWicket || inn.inningsComplete) throw new Error('Resolve the current innings action first.');
    if (!inn.batting[strikerId] || !inn.batting[nonStrikerId] || strikerId === nonStrikerId) throw new Error('Select two different batters.');
    inn.strikerId = strikerId;
    inn.nonStrikerId = nonStrikerId;
    match.updatedAt = new Date().toISOString();
    return match;
  }
  function undo(match) {
    const snapshot = match.undoStack.pop();
    if (!snapshot) throw new Error('There is no scoring action to undo.');
    const oldInn = currentInnings(match);
    const previousEvents = oldInn.events.slice(0, -1);
    match.phase = snapshot.phase;
    match.currentInnings = snapshot.currentInnings;
    match.innings[ snapshot.inningsIndex ] = { ...clone(snapshot.inningsState), events: previousEvents };
    match.result = clone(snapshot.result);
    match.pendingOverBowler = snapshot.pendingOverBowler;
    match.updatedAt = new Date().toISOString();
    return match;
  }
  function completeInnings(match) {
    const inn = currentInnings(match);
    inn.inningsComplete = true;
    inn.currentBowlerId = null;
    if (match.currentInnings === 0) match.phase = 'inningsBreak';
    else finishResult(match);
  }
  function evaluateMatch(match) {
    if (match.phase !== 'live') return;
    const inn = currentInnings(match);
    const maxWickets = Math.max(0, inn.battingPlayers.length - 1);
    const oversDone = inn.legalBalls >= match.oversLimit * 6;
    const allOut = inn.wickets >= maxWickets;
    if (match.currentInnings === 1 && inn.score >= match.innings[0].score + 1) {
      inn.inningsComplete = true;
      finishResult(match);
      return;
    }
    if (oversDone || allOut) completeInnings(match);
  }
  function finishResult(match) {
    const first = match.innings[0];
    const second = match.innings[1];
    if (!second) { match.phase = 'inningsBreak'; return; }
    match.phase = 'complete';
    if (second.score === first.score) match.result = { type: 'tie', text: 'Match tied' };
    else if (second.score > first.score) {
      const wicketsLeft = Math.max(0, second.battingPlayers.length - 1 - second.wickets);
      match.result = { type: 'win', winnerId: second.teamId, text: `${teamName(match, second.teamId)} won by ${wicketsLeft} wicket${wicketsLeft === 1 ? '' : 's'}` };
    } else {
      const margin = first.score - second.score;
      match.result = { type: 'win', winnerId: first.teamId, text: `${teamName(match, first.teamId)} won by ${margin} run${margin === 1 ? '' : 's'}` };
    }
    match.updatedAt = new Date().toISOString();
  }
  function startSecondInnings(match) {
    if (match.phase !== 'inningsBreak') throw new Error('The first innings must be complete.');
    const first = match.innings[0];
    const batting = match.teams.find((team) => team.id !== first.teamId);
    const bowling = match.teams.find((team) => team.id === first.teamId);
    match.innings.push(newInnings(batting.id, batting.players, bowling.players));
    match.currentInnings = 1;
    match.phase = 'live';
    match.undoStack = [];
    match.updatedAt = new Date().toISOString();
    return match;
  }
  function abandon(match) {
    if (match.phase === 'complete') throw new Error('This match is already complete.');
    match.phase = 'complete';
    match.result = { type: 'abandoned', text: 'Match abandoned' };
    match.updatedAt = new Date().toISOString();
    return match;
  }
  function correctState(match, values) {
    assertLiveCorrection(match);
    const inn = currentInnings(match);
    const score = Number(values.score);
    const wickets = Number(values.wickets);
    if (!Number.isInteger(score) || score < 0 || !Number.isInteger(wickets) || wickets < 0 || wickets > inn.battingPlayers.length - 1) throw new Error('Enter a valid score and wicket count.');
    const extras = { ...inn.extras };
    for (const key of Object.keys(extras)) {
      const next = Number(values[key] ?? extras[key]);
      if (!Number.isInteger(next) || next < 0) throw new Error('Extras must be whole numbers of zero or more.');
      extras[key] = next;
    }
    match.undoStack.push(snapshotForUndo(match));
    const delta = score - inn.score;
    const event = { id: `e_${Date.now()}`, kind: 'correction', label: 'EDIT', innings: match.currentInnings + 1, over: Math.floor(inn.legalBalls / 6) + 1, legal: false, teamRuns: delta, bowlerRuns: 0, batterRuns: 0, scoreBefore: inn.score, scoreAfter: score };
    inn.events.push(event);
    inn.score = score;
    inn.wickets = wickets;
    inn.extras = extras;
    inn.battingPlayers.forEach((player) => {
      const stats = inn.batting[player.id];
      if (stats.status === 'out' && wickets === 0) { stats.status = 'yet'; stats.dismissal = null; }
    });
    evaluateMatch(match);
    match.updatedAt = new Date().toISOString();
    return match;
  }
  function assertLiveCorrection(match) {
    if (match.phase !== 'live' || match.paused) throw new Error('Corrections are available during a live match.');
    if (currentInnings(match).pendingWicket) throw new Error('Choose the incoming batter before editing the score.');
  }
  function summary(match, inningsIndex = match.currentInnings) {
    const inn = match.innings[inningsIndex];
    if (!inn) return null;
    const bowlers = Object.values(inn.bowling).map((b) => ({ ...b, overs: overText(b.legalBalls), economy: b.legalBalls ? Number((b.runs / (b.legalBalls / 6)).toFixed(2)) : 0 }));
    const batting = inn.battingPlayers.map((p) => ({ ...inn.batting[p.id], strikeRate: inn.batting[p.id].balls ? Number((inn.batting[p.id].runs * 100 / inn.batting[p.id].balls).toFixed(2)) : 0 }));
    return {
      teamId: inn.teamId, team: teamName(match, inn.teamId), score: inn.score, wickets: inn.wickets,
      legalBalls: inn.legalBalls, overs: overText(inn.legalBalls), runRate: rate(inn.score, inn.legalBalls),
      extras: clone(inn.extras), batting, bowling: bowlers, events: clone(inn.events),
      falls: clone(inn.falls), overSummaries: clone(inn.overSummaries),
      striker: inn.batting[inn.strikerId] || null, nonStriker: inn.batting[inn.nonStrikerId] || null,
      bowler: inn.bowling[inn.currentBowlerId] || null,
      partnershipRuns: inn.events.slice().reverse().find((event) => event.dismissal && event.dismissal.type !== 'Retired hurt')?.scoreAfter
        ? inn.score - (inn.events.slice().reverse().find((event) => event.dismissal && event.dismissal.type !== 'Retired hurt').scoreAfter || 0)
        : inn.score,
      target: inningsIndex === 1 ? match.innings[0].score + 1 : null
    };
  }
  const api = { createMatch, currentInnings, teamName, applyBall, applyExtra, applyWicket, applyPenalty, chooseIncoming, chooseBowler, swapBatters, undo, startSecondInnings, abandon, correctState, summary, overText, rate, bowlerCreditedDismissals };
  root.CricketEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
