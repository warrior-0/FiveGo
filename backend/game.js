const BOARD_SIZE = 11;
const WIN_SCORE = 5;
const CHOICE_COUNT = 3;
const DECISION_TIME_MS = 30 * 1000;
const MAX_BID = 3;
const MAIN_TIME_MS = 5 * 60 * 1000;
const TIME_CHIP_MS = 20 * 1000;
// 타임칩(횟수)은 사용하지 않음 (무제한 초읽기)


const AUGMENT_EFFECT_RULES = {
    golden_snitch: { timing: 'passive' },
    simple_is_best: { timing: 'passive' },
    counter: { timing: 'manual' },
    time_is_gold: { timing: 'passive' },
    rule_breaker: { timing: 'manual' },
    morning_evening: { timing: 'manual' }
};

function normalizeAugment(augment) {
    const effect = augment.effect;
    const rule = AUGMENT_EFFECT_RULES[effect] || {};
    const timing = augment.timing || rule.timing || 'capture-first';

    return {
        ...augment,
        effect,
        timing,
        name: augment.name || effect,
        description: augment.description || ''
    };
}

function createBoard() {
    return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

function opponent(color) {
    return color === 'black' ? 'white' : 'black';
}

function clampBid(value) {
    const bid = Number(value);

    if (!Number.isInteger(bid) || bid < 0 || bid > MAX_BID) {
        throw new Error(`입찰 점수는 0~${MAX_BID} 사이의 정수여야 합니다.`);
    }

    return bid;
}

function shuffle(array) {
    const copy = [...array];

    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }

    return copy;
}

function publicAugment(augment) {
    const normalized = normalizeAugment(augment);

    return {
        id: normalized.id,
        effect: normalized.effect,
        name: normalized.name,
        description: normalized.description,
        timing: normalized.timing,
        activationType: normalized.timing === 'manual' ? 'manual' : (normalized.timing === 'passive' ? 'passive' : 'automatic')
    };
}

function pickAugmentChoices(deck) {
    return shuffle(deck).slice(0, Math.min(CHOICE_COUNT, deck.length)).map(publicAugment);
}

function createClock() {
    return {
        black: { mainMs: MAIN_TIME_MS, chipMs: TIME_CHIP_MS, inChip: false },
        white: { mainMs: MAIN_TIME_MS, chipMs: TIME_CHIP_MS, inChip: false },
        turnStartedAt: null
    };
}

function createPlayerState({ socketId, user, deck }) {
    return {
        socketId,
        user: {
            id: user.id,
            nickname: user.nickname
        },
        deck: deck.map(publicAugment),
        choices: pickAugmentChoices(deck),
        selectedAugmentIds: [],
        startAugments: [],
        captureAugments: [],
        activeAugments: [],
        reserveAugments: [],
        triggeredAugmentIds: [],
        reserveActivated: false,
        bid: null,
        ready: false,
        handAugments: [],
        triggeredAugments: [],
        counterPending: false,
        goldenSnitchUntilTurn: null,
        extraTurn: false,
        reservePending: false
    };
}

function createGame(playerA, playerB) {
    return {
        phase: 'bidding',
        board: createBoard(),
        players: {
            black: null,
            white: null
        },
        seats: {
            a: createPlayerState(playerA),
            b: createPlayerState(playerB)
        },
        socketToSeat: {
            [playerA.socketId]: 'a',
            [playerB.socketId]: 'b'
        },
        turn: 'black',
        scores: {
            black: 0,
            white: 0
        },
        winner: null,
        clock: createClock(),
        lastMove: null,
        augmentQueue: [],
        selection: null,
        decisionDeadlineAt: Date.now() + DECISION_TIME_MS,
        turnCounts: { black: 0, white: 0 },
        log: ['입찰을 진행하세요. 더 많이 점수를 양보한 사람이 흑을 잡습니다.']
    };
}

function getSeatBySocket(game, socketId) {
    const seatKey = game.socketToSeat[socketId];
    return seatKey ? game.seats[seatKey] : null;
}

function getColorBySocket(game, socketId) {
    if (game.players.black?.socketId === socketId) return 'black';
    if (game.players.white?.socketId === socketId) return 'white';
    return null;
}

function submitBid(game, socketId, bid) {
    if (game.phase !== 'bidding') {
        throw new Error('이미 입찰이 종료되었습니다.');
    }

    const seat = getSeatBySocket(game, socketId);

    if (!seat) {
        throw new Error('참가자가 아닙니다.');
    }

    seat.bid = clampBid(bid);

    game.log.push(`${seat.user.nickname} 입찰 완료`);

    const seats = Object.values(game.seats);

    if (seats.every((candidate) => candidate.bid !== null)) {
        resolveBids(game);
    }
}

function bidPower(seat) {
    return seat.bid;
}

function resolveBids(game) {
    const [firstKey, secondKey] = Object.keys(game.seats);
    const first = game.seats[firstKey];
    const second = game.seats[secondKey];
    const firstPower = bidPower(first);
    const secondPower = bidPower(second);

    let blackSeatKey;

    if (firstPower > secondPower) {
        blackSeatKey = firstKey;
    } else if (secondPower > firstPower) {
        blackSeatKey = secondKey;
    } else {
        blackSeatKey = Math.random() < 0.5 ? firstKey : secondKey;
        game.log.push('입찰이 같아서 흑/백을 랜덤으로 결정했습니다.');
    }

    const whiteSeatKey = blackSeatKey === firstKey ? secondKey : firstKey;

    game.players.black = game.seats[blackSeatKey];
    game.players.white = game.seats[whiteSeatKey];

    game.scores.white = game.players.black.bid;
    game.scores.black = 0;
    game.phase = 'augment-selection';
    startInitialAugmentSelection(game);

    game.log.push(`흑: ${game.players.black.user.nickname}, 백: ${game.players.white.user.nickname}`);
    game.log.push(`백은 ${game.scores.white}점으로 시작합니다.`);
}

function resetDecisionTimer(game) {
    game.decisionDeadlineAt = Date.now() + DECISION_TIME_MS;
}

function isManualAugment(augment) {
    return augment.timing === 'manual' || augment.activationType === 'manual';
}

function isPassiveAugment(augment) {
    return augment.timing === 'passive' || augment.activationType === 'passive';
}

function enqueueOrHandAugment(game, color, augment, source = 'choices') {
    const player = game.players[color];

    if (isManualAugment(augment)) {
        player.handAugments.push(augment);
        game.log.push(`${player.user.nickname}의 ${augment.name}이(가) 손패에 추가되었습니다.`);
        return;
    }

    if (isPassiveAugment(augment)) {
        game.augmentQueue.push({ color, augment, source });
        game.log.push(`${player.user.nickname}의 ${augment.name}이(가) 발동 큐에 추가되었습니다.`);
    }
}

function currentSelectionStep(game) {
    if (!game.selection) return null;
    return game.selection.steps[game.selection.index] || null;
}

function startInitialAugmentSelection(game) {
    game.selection = {
        type: 'initial',
        index: 0,
        steps: [
            { color: 'white', mode: 'choose', count: 1, source: 'choices' },
            { color: 'black', mode: 'choose', count: 1, source: 'choices' },
            { color: 'white', mode: 'choose', count: 1, source: 'choices' }
        ]
    };
    resetDecisionTimer(game);
}

function selectedChoiceIds(player) {
    return new Set(player.selectedAugmentIds);
}

function availableAugmentChoices(player, source) {
    const selected = selectedChoiceIds(player);
    const base = source === 'reserve' ? player.reserveAugments : player.choices;
    return base.filter((augment) => !selected.has(augment.id));
}

function selectAugments(game, socketId, selectedAugmentIds) {
    if (game.phase !== 'augment-selection') {
        throw new Error('증강 선택 단계가 아닙니다.');
    }

    const step = currentSelectionStep(game);

    if (!step) {
        throw new Error('현재 선택할 증강이 없습니다.');
    }

    const color = getColorBySocket(game, socketId);

    if (!color) {
        throw new Error('참가자가 아닙니다.');
    }

    if (color !== step.color) {
        throw new Error(`${step.color === 'black' ? '흑' : '백'}의 증강 선택 차례입니다.`);
    }

    applyAugmentSelection(game, color, selectedAugmentIds || []);
}

function applyAugmentSelection(game, color, selectedAugmentIds) {
    const step = currentSelectionStep(game);
    const player = game.players[color];
    const selected = selectedAugmentIds.map(Number);
    const availableChoices = availableAugmentChoices(player, step.source);
    const required = Math.min(availableChoices.length, step.count);
    const choiceIds = new Set(availableChoices.map((augment) => augment.id));

    if (selected.length !== required) {
        throw new Error(`${color === 'black' ? '흑' : '백'}은 증강 ${required}개를 선택해야 합니다.`);
    }

    if (new Set(selected).size !== selected.length || selected.some((id) => !choiceIds.has(id))) {
        throw new Error('선택할 수 없는 증강입니다.');
    }

    for (const id of selected) {
        const augment = availableChoices.find((candidate) => candidate.id === id);
        player.selectedAugmentIds.push(id);
        player.activeAugments.push(augment);
        enqueueOrHandAugment(game, color, augment, step.source);
        game.log.push(`${color === 'black' ? '흑' : '백'} ${augment.name} 선택 완료`);
    }

    if (step.source === 'reserve') {
        const chosen = new Set(selected);
        const remaining = availableChoices.filter((augment) => !chosen.has(augment.id));

        for (const augment of remaining) {
            player.selectedAugmentIds.push(augment.id);
            player.activeAugments.push(augment);
            enqueueOrHandAugment(game, color, augment, step.source);
        }

        player.reserveAugments = [];
        player.captureAugments = [];
        player.reserveActivated = true;
        player.reservePending = false;
    }

    advanceAugmentSelection(game);
}

function advanceAugmentSelection(game) {
    game.selection.index += 1;

    if (currentSelectionStep(game)) {
        resetDecisionTimer(game);
        return;
    }

    if (game.selection.type === 'initial') {
        prepareAugments(game, 'black');
        prepareAugments(game, 'white');
        game.phase = 'playing';
        game.selection = null;
        game.decisionDeadlineAt = null;
        processAugmentQueue(game, { type: 'start' });
        checkWinner(game);

        if (!game.winner) {
            startTurnClock(game);
            game.log.push('게임을 시작합니다. 기본 시간 5분 후 20초 초읽기가 시작됩니다.');
            resolveTurnAvailability(game);
        }
        return;
    }

    game.phase = 'playing';
    game.selection = null;
    game.decisionDeadlineAt = null;
    processAugmentQueue(game, { type: 'reserve' });
}

function prepareAugments(game, color) {
    const player = game.players[color];
    const selected = new Set(player.selectedAugmentIds);

    player.reserveAugments = player.choices.filter((augment) => !selected.has(augment.id));
    player.startAugments = player.activeAugments;
    player.captureAugments = player.reserveAugments;
    player.ready = true;
}
function canFireAugment(augment, event) {
    if (augment.timing === 'manual') return event.type === 'manual';
    if (augment.timing === 'passive') return event.type === 'start' || event.type === 'reserve';
    return false;
}

function markAugmentTriggered(player, augment) {
    if (!player.triggeredAugmentIds.includes(augment.id)) {
        player.triggeredAugmentIds.push(augment.id);
    }
    if (!player.triggeredAugments.some((entry) => entry.id === augment.id)) {
        player.triggeredAugments.push(augment);
    }
    player.handAugments = player.handAugments.filter((entry) => entry.id !== augment.id);
}

function fireAugment(game, entry, event) {
    const { color, augment } = entry;
    const player = game.players[color];
    const enemy = opponent(color);

    if (player.triggeredAugmentIds.includes(augment.id)) return false;

    if (augment.effect === 'golden_snitch') {
        const duration = event.type === 'reserve' || entry.source === 'reserve' ? 7 : 20;
        player.goldenSnitchUntilTurn = game.turnCounts[color] + duration;
        game.log.push(`${player.user.nickname}의 ${augment.name} 발동: 자신의 ${duration}턴 안에 상대 돌을 따내면 +999점`);
    } else if (augment.effect === 'simple_is_best') {
        game.scores[color] += 1;
        game.log.push(`${player.user.nickname}의 ${augment.name} 발동: 1점 획득`);
    } else if (augment.effect === 'counter') {
        if (event.type !== 'manual') return false;
        game.scores[color] = Math.max(0, game.scores[color] - 1);
        player.counterPending = true;
        game.log.push(`${player.user.nickname}의 ${augment.name} 발동: 내 점수 -1, 다음 상대 증강 효과를 가로챕니다.`);
    } else if (augment.effect === 'time_is_gold') {
        reduceClockByHalf(game.clock[enemy]);
        game.log.push(`${player.user.nickname}의 ${augment.name} 발동: 상대 남은 생각시간 50% 감소`);
    } else if (augment.effect === 'rule_breaker') {
        if (event.type !== 'manual') return false;
        game.scores[enemy] += 3;
        player.extraTurn = true;
        game.log.push(`${player.user.nickname}의 ${augment.name} 발동: 상대 3점 획득, 내 차례를 한 번 더 진행`);
    } else if (augment.effect === 'morning_evening') {
        if (event.type !== 'manual') return false;
        game.scores[enemy] += 4;
        game.scores[color] += 3;
        game.log.push(`${player.user.nickname}의 ${augment.name} 발동: 상대 4점 획득, 내 점수 3점 획득`);
    } else {
        return false;
    }

    markAugmentTriggered(player, augment);
    checkWinner(game);
    return true;
}

function reduceClockByHalf(clockEntry) {
    clockEntry.mainMs = Math.floor(clockEntry.mainMs / 2);
    clockEntry.chipMs = Math.floor(clockEntry.chipMs / 2);
}

function activateAugment(game, socketId, augmentId) {
    if (game.phase !== 'playing') throw new Error('플레이 중에만 증강을 발동할 수 있습니다.');
    if (game.winner) throw new Error('이미 종료된 게임입니다.');

    const color = getColorBySocket(game, socketId);
    if (!color) throw new Error('참가자가 아닙니다.');

    const player = game.players[color];
    const augment = player.handAugments.find((entry) => entry.id === Number(augmentId));
    if (!augment) throw new Error('발동할 수 없는 증강입니다.');

    const counterColor = opponent(color);
    const counterPlayer = game.players[counterColor];
    if (counterPlayer.counterPending && augment.effect !== 'counter') {
        counterPlayer.counterPending = false;
        markAugmentTriggered(player, augment);
        game.log.push(`${counterPlayer.user.nickname}의 카운터 적용: ${player.user.nickname}의 ${augment.name} 효과를 대신 받습니다.`);
        return fireAugment(game, { color: counterColor, augment }, { type: 'manual' });
    }

    return fireAugment(game, { color, augment }, { type: 'manual' });
}

function processAugmentQueue(game, event) {
    if (game.augmentQueue.length > 0) {
        game.log.push(`증강 대기열 확인 중... (총 ${game.augmentQueue.length}개)`);
    }

    const toRemoveIndices = [];

    for (let index = 0; index < game.augmentQueue.length; index += 1) {
        if (game.winner) break;

        const entry = game.augmentQueue[index];
        const player = game.players[entry.color];

        if (!canFireAugment(entry.augment, event)) {
            // 발동 조건이 아니면 그냥 넘어감 (로그는 생략하여 노이즈 감소)
            continue;
        }

        game.log.push(`[${colorName(entry.color)}] ${entry.augment.name} 조건 확인...`);

        const counterColor = opponent(entry.color);
        const counterPlayer = game.players[counterColor];
        
        // 카운터 처리
        if (counterPlayer.counterPending && entry.augment.effect !== 'counter') {
            counterPlayer.counterPending = false;
            markAugmentTriggered(player, entry.augment);
            game.log.push(`${counterPlayer.user.nickname}의 카운터! ${player.user.nickname}의 ${entry.augment.name} 효과를 가로챕니다.`);
            entry.color = counterColor;
        }

        if (fireAugment(game, entry, event)) {
            toRemoveIndices.push(index);
        } else {
            game.log.push(`- ${entry.augment.name}: 발동 조건 미충족으로 다음 증강을 검사합니다.`);
        }
    }

    // 발동된 증강들 제거 (뒤에서부터 제거해야 인덱스가 꼬이지 않음)
    for (let i = toRemoveIndices.length - 1; i >= 0; i--) {
        game.augmentQueue.splice(toRemoveIndices[i], 1);
    }
}

function colorName(color) {
    return color === 'black' ? '흑' : '백';
}

function startReserveSelectionIfNeeded(game, capturedColor) {
    const player = game.players[capturedColor];

    if (player.reserveActivated || player.reservePending || player.reserveAugments.length === 0) return false;

    player.reservePending = true;
    game.phase = 'augment-selection';
    game.selection = {
        type: 'reserve',
        index: 0,
        steps: [{ color: capturedColor, mode: 'choose', count: 1, source: 'reserve' }]
    };
    resetDecisionTimer(game);
    game.log.push(`${player.user.nickname}의 대기 증강 선택이 필요합니다.`);
    return true;
}
function neighbors(x, y) {
    return [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1]
    ].filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < BOARD_SIZE && ny < BOARD_SIZE);
}

function groupAndLiberties(board, x, y) {
    const color = board[y][x];
    const seen = new Set([`${x},${y}`]);
    const stones = [];
    const liberties = new Set();
    const stack = [[x, y]];

    while (stack.length) {
        const [cx, cy] = stack.pop();
        stones.push([cx, cy]);

        for (const [nx, ny] of neighbors(cx, cy)) {
            if (board[ny][nx] === null) {
                liberties.add(`${nx},${ny}`);
            } else if (board[ny][nx] === color && !seen.has(`${nx},${ny}`)) {
                seen.add(`${nx},${ny}`);
                stack.push([nx, ny]);
            }
        }
    }

    return { stones, liberties: liberties.size };
}


function cloneBoard(board) {
    return board.map((row) => [...row]);
}

function evaluateMove(board, color, x, y) {
    if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE || board[y][x]) {
        return { legal: false, captured: 0 };
    }

    const nextBoard = cloneBoard(board);
    const enemy = opponent(color);
    let captured = 0;

    nextBoard[y][x] = color;

    for (const [nx, ny] of neighbors(x, y)) {
        if (nextBoard[ny][nx] === enemy) {
            const group = groupAndLiberties(nextBoard, nx, ny);

            if (group.liberties === 0) {
                captured += group.stones.length;

                for (const [gx, gy] of group.stones) {
                    nextBoard[gy][gx] = null;
                }
            }
        }
    }

    const own = groupAndLiberties(nextBoard, x, y);

    if (own.liberties === 0 && captured === 0) {
        return { legal: false, captured: 0 };
    }

    return { legal: true, captured };
}

function findMove(game, color, predicate = () => true) {
    for (let y = 0; y < BOARD_SIZE; y += 1) {
        for (let x = 0; x < BOARD_SIZE; x += 1) {
            const result = evaluateMove(game.board, color, x, y);

            if (result.legal && predicate(result)) {
                return { x, y, captured: result.captured };
            }
        }
    }

    return null;
}

function hasLegalMove(game, color) {
    return Boolean(findMove(game, color));
}

function hasCapturingMove(game, color) {
    return Boolean(findMove(game, color, (result) => result.captured > 0));
}



function resolveTurnAvailability(game) {
    if (game.phase !== 'playing' || game.winner) return;

    const current = game.turn;
    const next = opponent(current);

    if (hasLegalMove(game, current)) {
        startTurnClock(game);
        return;
    }

    if (hasLegalMove(game, next)) {
        game.log.push(`${current === 'black' ? '흑' : '백'}은 둘 수 있는 수가 없어 자동 패스되었습니다.`);
        game.turn = next;
        startTurnClock(game);
        return;
    }
}

function applyCaptureAugments(game, capturedColor, capturingColor, capturedCount) {
    if (capturedCount <= 0) return { scoreDelta: capturedCount, skipTurn: false, selectionPending: false };

    let scoreDeltaRef = { value: capturedCount };
    const event = {
        type: 'capture',
        capturedColor,
        capturingColor,
        capturedCount,
        currentCapturerScore: game.scores[capturingColor],
        currentCapturedScore: game.scores[capturedColor],
        scoreDeltaRef
    };


    const selectionPending = startReserveSelectionIfNeeded(game, capturedColor);

    return { scoreDelta: scoreDeltaRef.value, skipTurn: false, selectionPending };
}


function startTurnClock(game, now = Date.now()) {
    if (game.phase !== 'playing' || game.winner) {
        game.clock.turnStartedAt = null;
        return;
    }

    const color = game.turn;
    const clockEntry = game.clock[color];
    
    // 턴이 시작될 때, 이미 초읽기 중이라면 초읽기 시간을 초기화
    if (clockEntry.mainMs <= 0) {
        clockEntry.chipMs = TIME_CHIP_MS;
        clockEntry.inChip = true;
    }
    
    game.clock.turnStartedAt = now;
}

function applyTurnClock(game, now = Date.now()) {
    if (game.phase !== 'playing' || game.winner || !game.clock.turnStartedAt) return false;

    const color = game.turn;
    const clockEntry = game.clock[color];
    const elapsedMs = now - game.clock.turnStartedAt;
    
    let remainingElapsed = elapsedMs;

    // 1. 본시간 차감
    if (clockEntry.mainMs > 0) {
        const spentMain = Math.min(clockEntry.mainMs, remainingElapsed);
        clockEntry.mainMs -= spentMain;
        remainingElapsed -= spentMain;
    }

    // 2. 초읽기 처리
    if (remainingElapsed > 0) {
        clockEntry.inChip = true;
        clockEntry.chipMs -= remainingElapsed;
    }

    game.clock.turnStartedAt = now;

    if (clockEntry.chipMs <= 0) {
        game.winner = opponent(color);
        game.phase = 'finished';
        game.clock.turnStartedAt = null;
        game.log.push(`${color === 'black' ? '흑' : '백'} 시간패: ${opponent(color) === 'black' ? '흑' : '백'} 승리`);
        return true;
    }

    return false;
}

function publicClockState(game) {
    const snapshot = JSON.parse(JSON.stringify(game.clock));

    if (game.phase === 'playing' && !game.winner && snapshot.turnStartedAt) {
        const now = Date.now();
        let elapsedMs = now - snapshot.turnStartedAt;
        const color = game.turn;
        const clockEntry = snapshot[color];

        if (clockEntry.mainMs > 0) {
            const spentMain = Math.min(clockEntry.mainMs, elapsedMs);
            clockEntry.mainMs -= spentMain;
            elapsedMs -= spentMain;
        }

        if (elapsedMs > 0) {
            clockEntry.inChip = true;
            clockEntry.chipMs = Math.max(0, clockEntry.chipMs - elapsedMs);
        }
    }

    return snapshot;
}

function checkWinner(game) {
    const blackWon = game.scores.black >= WIN_SCORE;
    const whiteWon = game.scores.white >= WIN_SCORE;

    if (blackWon && whiteWon) {
        if (game.scores.black > game.scores.white) {
            game.winner = 'black';
            game.log.push(`양측 모두 5점 도달, 점수가 더 높은 흑 승리 (${game.scores.black} vs ${game.scores.white})`);
        } else if (game.scores.white > game.scores.black) {
            game.winner = 'white';
            game.log.push(`양측 모두 5점 도달, 점수가 더 높은 백 승리 (${game.scores.white} vs ${game.scores.black})`);
        } else {
            game.winner = 'black';
            game.log.push(`양측 모두 5점 동점(${game.scores.black})이므로 흑 승리 판정`);
        }
    } else if (blackWon) {
        game.winner = 'black';
        game.log.push(`흑 ${game.scores.black}점 도달: 흑 승리`);
    } else if (whiteWon) {
        game.winner = 'white';
        game.log.push(`백 ${game.scores.white}점 도달: 백 승리`);
    }

    if (game.winner) {
        game.phase = 'finished';
        game.clock.turnStartedAt = null;
    }
}

function placeStone(game, color, x, y) {
    if (game.phase !== 'playing') throw new Error('아직 착수할 수 없습니다.');
    if (game.winner) throw new Error('이미 종료된 게임입니다.');
    if (applyTurnClock(game)) throw new Error('시간이 모두 소진되었습니다.');
    if (game.turn !== color) throw new Error('상대 차례입니다.');
    if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE || game.board[y][x]) throw new Error('둘 수 없는 위치입니다.');

    game.board[y][x] = color;
    game.lastMove = { x, y, color };
    game.turnCounts[color] += 1;

    let captured = 0;
    const enemy = opponent(color);

    for (const [nx, ny] of neighbors(x, y)) {
        if (game.board[ny][nx] === enemy) {
            const group = groupAndLiberties(game.board, nx, ny);

            if (group.liberties === 0) {
                captured += group.stones.length;

                for (const [gx, gy] of group.stones) {
                    game.board[gy][gx] = null;
                }
            }
        }
    }

    const own = groupAndLiberties(game.board, x, y);

    if (own.liberties === 0 && captured === 0) {
        game.board[y][x] = null;
        game.turnCounts[color] -= 1;
        throw new Error('자살수는 둘 수 없습니다.');
    }

    const result = applyCaptureAugments(game, enemy, color, captured);
    game.scores[color] += result.scoreDelta;

    if (result.selectionPending) {
        game.turn = enemy;
        game.clock.turnStartedAt = null;
    }

    if (captured > 0) {
        game.log.push(`${color === 'black' ? '흑' : '백'}이 ${captured}개를 포획했습니다.`);
        if (game.players[color].goldenSnitchUntilTurn !== null && game.turnCounts[color] <= game.players[color].goldenSnitchUntilTurn) {
            game.scores[color] += 999;
            game.log.push(`${game.players[color].user.nickname}의 골든 스니치 조건 달성: +999점`);
        }
    }

    checkWinner(game);

    if (!game.winner && !result.selectionPending) {
        game.turn = game.players[color].extraTurn ? color : enemy;
        game.players[color].extraTurn = false;
        resolveTurnAvailability(game);
    }

    return { captured, scoreDelta: result.scoreDelta };
}

function publicGameState(game) {
    const revealBids = game.phase !== 'bidding';
    const revealAugments = game.phase !== 'bidding';
    const publicSeat = (seat) => {
        if (!seat) return null;

        return {
            ...seat,
            bid: revealBids || seat.bid === null ? seat.bid : 'submitted',
            selectedAugmentIds: revealAugments ? seat.selectedAugmentIds : [],
            startAugments: revealAugments ? seat.startAugments : [],
            captureAugments: revealAugments ? seat.captureAugments : [],
            triggeredAugmentIds: revealAugments ? seat.triggeredAugmentIds : [],
            activeAugments: revealAugments ? seat.activeAugments : [],
            reserveAugments: revealAugments ? seat.reserveAugments : [],
            reserveActivated: revealAugments ? seat.reserveActivated : false,
            reservePending: revealAugments ? seat.reservePending : false,
            handAugments: revealAugments ? seat.handAugments : [],
            triggeredAugments: revealAugments ? seat.triggeredAugments : [],
            goldenSnitchRemainingTurns: seat.goldenSnitchUntilTurn !== null ? Math.max(0, seat.goldenSnitchUntilTurn - game.turnCounts[color]) : undefined
        };
    };

    return {
        phase: game.phase,
        board: game.board,
        players: {
            black: publicSeat(game.players.black),
            white: publicSeat(game.players.white)
        },
        seats: {
            a: publicSeat(game.seats.a),
            b: publicSeat(game.seats.b)
        },
        turn: game.turn,
        scores: game.scores,
        winner: game.winner,
        turnCounts: game.turnCounts,
        clock: publicClockState(game),
        lastMove: game.lastMove,
        augmentQueue: revealAugments ? game.augmentQueue : [],
        selection: game.selection,
        decisionDeadlineAt: game.decisionDeadlineAt,
        timeRule: {
            mainMs: MAIN_TIME_MS,
            chipMs: TIME_CHIP_MS
        },
        log: game.log.slice(-20)
    };
}

module.exports = {
    BOARD_SIZE,
    WIN_SCORE,
    MAIN_TIME_MS,
    TIME_CHIP_MS,
    MAX_BID,
    AUGMENT_EFFECT_RULES,
    createGame,
    applyTurnClock,
    getColorBySocket,
    hasCapturingMove,
    hasLegalMove,
    placeStone,
    publicGameState,
    resolveTurnAvailability,
    DECISION_TIME_MS,
    currentSelectionStep,
    availableAugmentChoices,
    applyAugmentSelection,
    activateAugment,
    resetDecisionTimer,
    selectAugments,
    submitBid
};
