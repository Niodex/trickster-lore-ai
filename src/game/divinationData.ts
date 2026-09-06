// ---------------------------------------------------------------------------
// Ayò Àṣẹ — Narrative & Divination Engine
// Curated proverbs, intro dialogue, griot commentary pools, and the dynamic
// end-of-match divination reading synthesizer.
// ---------------------------------------------------------------------------

export type ThemeKey = 'harvest' | 'journey' | 'conflict' | 'love';

export const THEMES: { key: ThemeKey; label: string; glyph: string; blurb: string }[] = [
    { key: 'harvest',  label: 'Harvest',  glyph: '🌾', blurb: 'Abundance, patience, and what we choose to share.' },
    { key: 'journey',  label: 'Journey',  glyph: '🛤️', blurb: 'Paths taken, paths diverted, the road that remembers.' },
    { key: 'conflict', label: 'Conflict', glyph: '⚔️', blurb: 'The river that outlasts the stone.' },
    { key: 'love',     label: 'Love',     glyph: '🤝', blurb: 'Mutual exchange, balance, the cowrie strung with kin.' },
];

export interface DialogueLine {
    speaker: 'diviner' | 'trickster';
    text: string;
}

export const INTRO_DIALOGUE: DialogueLine[] = [
    {
        speaker: 'diviner',
        text: 'Come, sit where the dust is cool. The board is carved, the cowries are counted — forty-eight fates, four in each hollow.',
    },
    {
        speaker: 'trickster',
        text: 'Heh. You call them fates; I call them seeds. Scatter one and watch what sprouts in your neighbor’s bowl.',
    },
    {
        speaker: 'diviner',
        text: 'Sow counter-clockwise, child. Take only what the last shell offers you — two or three in your rival’s pit, gathered like ripe kola.',
    },
    {
        speaker: 'trickster',
        text: 'And if the old one hoards every hollow? I shall smile with only half my mouth... and feed him anyway. Even Èṣù honors the empty bowl.',
    },
    {
        speaker: 'diviner',
        text: 'Choose the pattern your reading will wear: Harvest, Journey, Conflict, or Love. The board answers whatever you dare to ask.',
    },
    {
        speaker: 'trickster',
        text: 'Pick quickly. A slow diviner feeds the goats instead of the spirits — and the goats never thank you.',
    },
];

// --- Griot commentary pools -------------------------------------------------

export type CommentaryTag = 'small_capture' | 'big_capture' | 'risky_move' | 'defensive_move' | 'turn_start';

export const GRIOT_LINES: Record<CommentaryTag, string[]> = {
    small_capture: [
        'The one who carries a single cowrie still crosses the river.',
        'A small kola nut, split well, feeds the whole compound.',
        'What the hand gathers gently, the spirit keeps.',
        'The bird that steals one grain is still called a thief — and still fed.',
        'Little and little become the elder’s necklace.',
    ],
    big_capture: [
        'The hunter who takes the whole flock must also cook all night.',
        'When the river gives, it gives in handfuls — drink deep, but remember the drought.',
        'A sudden harvest makes the neighbors pray: some for rain, some for end.',
        'The trickster grins — but a wide mouth can swallow only so much.',
        'Many cowries in one bowl make a heavy wrist.',
    ],
    risky_move: [
        'The palm tree climbed in anger is descended in shame.',
        'Who leaves his granary open invites even a holy guest to eat.',
        'The leopard pounces beautifully — until the buffalo turns.',
        'Boldness is a fine cloak, but it does not stop the rain.',
        'A full pit is a loud drum; the enemy’s hands are already itching.',
    ],
    defensive_move: [
        'The elder plants his seeds where the wind cannot count them.',
        'A quiet bowl is a guarded blessing.',
        'The tortoise wins not by speed but by never leaving home naked.',
        'To keep your seeds is to keep your words for a later market.',
        'Even the river hides its depth with a still face.',
    ],
    turn_start: [
        'The board breathes; someone must exhale first.',
        'Every hand over the cowries is a question to Àyàmo.',
        'Sow kindly — the shells remember.',
    ],
};

export function pickGriotLine(tag: CommentaryTag): string {
    const pool = GRIOT_LINES[tag];
    return pool[Math.floor(Math.random() * pool.length)];
}

// --- End-of-match divination reading generator ------------------------------

export interface MatchStats {
    winner: 'p1' | 'p2' | 'draw';
    p1Store: number;
    p2Store: number;
    p1Captures: number;
    p2Captures: number;
    maxSingleCapture: number;
    totalTurns: number;
    theme: ThemeKey;
    mode: 'ai' | 'pvp';
}

const THEME_METAPHORS: Record<ThemeKey, {
    opening: string[];
    body: string[];
    advice: string[];
    closing: string[];
}> = {
    harvest: {
        opening: [
            'The board was a farm this day, and your hands were weather.',
            'Àyàmo sees the field you planted in cowrie and dust.',
        ],
        body: [
            'What you gathered in one sweep — {maxCapture} shells at once — was the season’s sudden rain.',
            'You moved {turns} times; every farmer is judged at the end, not at the first sowing.',
            'The pits you left full were not wasted — they are seed-corn for the next cycle.',
        ],
        advice: [
            'Share the biggest bowl first; the compound that eats together outlasts the one that hoards.',
            'Do not chase every cluster. A patient harvester lets the last row ripen.',
            'Count your blessings the way you counted cowries — slowly, out loud, twice.',
        ],
        closing: [
            'Harvest is coming. Your part is to keep your hands clean for it.',
            'The granary of your year is half full already; the rest is your choice.',
        ],
    },
    journey: {
        opening: [
            'The board was a road this day, and each pit a village you passed through.',
            'Èṣù Onanke — the opener of ways — walked your sowing with you.',
        ],
        body: [
            'Your boldest stride took {maxCapture} shells at once; the road remembers such steps.',
            'In {turns} turns you changed direction often; a traveler who never turns never arrives.',
            'The pits you skipped were not lost — some paths are saved for the return.',
        ],
        advice: [
            'When two roads look equal, take the one that passes your rival’s bowl. Curiosity is a compass.',
            'Pack light: the traveler who carries every pit arrives exhausted and empty-handed.',
            'Ask the elder before crossing; the river that looks shallow has swallowed hats before.',
        ],
        closing: [
            'A journey you fear is a journey already half-done.',
            'Your road is long, but the cowries have counted it for you.',
        ],
    },
    conflict: {
        opening: [
            'The board was a wrestling ring this day; the dust was your witness.',
            'Àyàmo watched two hands argue in the language of shells.',
        ],
        body: [
            'Your single greatest strike seized {maxCapture} — the blow that turned the match.',
            '{turns} exchanges were traded; the patient fighter is counted twice, once for hits and once for lessons.',
            'The pits you defended quietly were the walls of your compound.',
        ],
        advice: [
            'Do not answer every insult. The river does not argue with the stone — it simply outlasts it.',
            'Strike where the count is two or three, never where the count is one: a single shell guards nothing.',
            'If your rival is starving, feed them. A dead enemy tells you nothing about your next battle.',
        ],
        closing: [
            'Victory in the small ring is practice for victory in the big one.',
            'The fight you avoid today is the fight you win tomorrow.',
        ],
    },
    love: {
        opening: [
            'The board was a conversation this day, spoken in the tongue of cowries.',
            'Àyàmo saw two hands reach for the same shells, and called it love or war.',
        ],
        body: [
            'Your most generous moment gave you {maxCapture} at once — a gift the bowl returned doubled.',
            'In {turns} exchanges you learned the rhythm of the other hand.',
            'The empty pit is not loneliness; it is the space a partner fills.',
        ],
        advice: [
            'Feed the empty bowl before you fill your own — love begins where hunger ends.',
            'Do not take everything in one sweep. A necklace strung too fast tangles.',
            'The cowrie that returns to its first pit is the heart that comes home.',
        ],
        closing: [
            'What you sow in another’s bowl, you reap in your own.',
            'Two hands make one prayer; the board has taught them the gesture.',
        ],
    },
};

function pick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

function fill(s: string, stats: MatchStats): string {
    return s
        .replace('{maxCapture}', String(stats.maxSingleCapture))
        .replace('{turns}', String(stats.totalTurns));
}

export function generateReading(stats: MatchStats): string[] {
    const t = THEME_METAPHORS[stats.theme];
    const margin = Math.abs(stats.p1Store - stats.p2Store);
    const lines: string[] = [];

    lines.push(pick(t.opening));

    // Outcome framing
    let outcome: string;
    if (stats.winner === 'draw') {
        outcome = 'The match ended balanced — neither bowl overflowed, and the spirits call that a quiet blessing.';
    } else if (margin >= 12) {
        outcome = 'The victory came dominant, like a river in flood; the losing side will remember the waterline.';
    } else if (margin >= 5) {
        outcome = 'The victory came clear but not cruel — the kind of win that keeps a friend at the table.';
    } else {
        outcome = 'The victory was narrow, a single kola’s width; such wins teach more than crowns.';
    }
    lines.push(outcome);

    // Body metaphors (2)
    const bodyPool = [...t.body];
    lines.push(fill(bodyPool.splice(Math.floor(Math.random() * bodyPool.length), 1)[0], stats));
    if (bodyPool.length) {
        lines.push(fill(bodyPool.splice(Math.floor(Math.random() * bodyPool.length), 1)[0], stats));
    }

    // Advice (1-2)
    lines.push(pick(t.advice));
    if (Math.random() < 0.4) {
        const second = pick(t.advice.filter(a => a !== lines[lines.length - 1]));
        lines.push(second);
    }

    lines.push(pick(t.closing));

    return lines;
}

// --- History / localStorage -------------------------------------------------

export interface HistoryEntry {
    date: string;
    winner: 'p1' | 'p2' | 'draw';
    p1Store: number;
    p2Store: number;
    theme: ThemeKey;
    mode: 'ai' | 'pvp';
    reading: string[];
}

const HISTORY_KEY = 'ayo_ase_divination_history';

export function loadHistory(): HistoryEntry[] {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
    } catch {
        return [];
    }
}

export function saveHistoryEntry(e: HistoryEntry): HistoryEntry[] {
    try {
        const h = [e, ...loadHistory()].slice(0, 12);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
        return h;
    } catch {
        return loadHistory();
    }
}
