const AUGMENT_CATALOG = [
    {
        code: 'initiative',
        effectKey: 'bid_bonus',
        timing: 'bid',
        name: '선공 집착',
        description: '흑을 가져가기 위한 입찰 계산에 +1을 더합니다. 시작 증강이나 피포획 발동 증강으로 쓰이지 않고, 색 결정에만 영향을 줍니다.'
    },
    {
        code: 'shield',
        effectKey: 'capture_score_reduce',
        timing: 'capture-first',
        name: '방패진',
        description: '내 돌이 처음 잡히는 순간 1회 발동합니다. 그 포획으로 상대가 얻는 점수를 1점 줄입니다. 한 번에 여러 개가 잡혀도 총 획득 점수에서 1점만 줄고, 점수는 0점 아래로 내려가지 않습니다.'
    },
    {
        code: 'revenge',
        effectKey: 'gain_one_on_captured',
        timing: 'capture-first',
        name: '복수의 수',
        description: '내 돌이 처음 잡히는 순간 1회 발동합니다. 내가 즉시 1점을 얻습니다. 실제 보드에서 상대 돌을 제거하지는 않고, 포획 점수만 추가되는 반격형 증강입니다.'
    },
    {
        code: 'focus',
        effectKey: 'start_gain_one',
        timing: 'start',
        name: '집중',
        description: '시작 증강으로 선택하면 게임 시작 전에 즉시 1점을 얻습니다. 5점 승리 조건에 바로 반영되므로, 백의 입찰 보정 점수와 합쳐 빠른 승리를 노릴 수 있습니다.'
    },
    {
        code: 'pressure',
        effectKey: 'skip_capturer_next_turn',
        timing: 'capture-first',
        name: '압박',
        description: '내 돌이 처음 잡히는 순간 1회 발동합니다. 상대의 다음 턴을 건너뛰게 만들어, 돌을 잡은 플레이어가 한 번 더 둡니다.'
    },
    {
        code: 'extra_choice',
        effectKey: 'extra_start_choice',
        timing: 'start',
        name: '넓은 선택지',
        description: '증강 선택 단계에서 시작 증강 선택 수를 1개 늘립니다. 흑은 1개 대신 2개, 백은 2개 대신 3개를 시작 증강으로 선택합니다.'
    },
    {
        code: 'comeback',
        effectKey: 'gain_one_if_behind',
        timing: 'capture-first',
        name: '역전 감각',
        description: '내 돌이 처음 잡히는 순간 1회 발동합니다. 발동 시점에 내 점수가 상대보다 낮으면 내가 1점을 얻습니다. 동점이거나 앞서고 있으면 효과 없이 소모됩니다.'
    },
    {
        code: 'stone_tax',
        effectKey: 'reduce_leader_at_four',
        timing: 'capture-first',
        name: '끝내기 견제',
        description: '내 돌이 처음 잡히는 순간 1회 발동합니다. 상대가 이미 4점 이상이면 상대 점수를 1점 깎습니다.'
    }
];

module.exports = { AUGMENT_CATALOG };
