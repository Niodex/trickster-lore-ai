// ---------------------------------------------------------------------------
// Ayò Àṣẹ — Phaser 4 scene: board, sowing, captures, AI, procedural art.
// React <-> Phaser bridge via EventBus (App.tsx subscribes).
// ---------------------------------------------------------------------------
import * as Phaser from 'phaser';
import { AUTO, Events, Game as PhaserGame, Scale, Scene } from 'phaser';
import {
    THEMES, ThemeKey, INTRO_DIALOGUE, GRIOT_LINES, pickGriotLine,
    generateReading, saveHistoryEntry, MatchStats,
} from './divinationData';

export const GAME_WIDTH = 540;
export const GAME_HEIGHT = 960;

export const COLORS = {
    INDIGO_DEEP: 0x0d1b2a,
    INDIGO: 0x1a2a44,
    INDIGO_LIGHT: 0x2a4a6a,
    OCHRE: 0xb46b33,
    OCHRE_DARK: 0x8c5024,
    IVORY: 0xf4ecd8,
    TERRA: 0xd4a373,
    GOLD: 0xffd166,
    RED: 0xa43030,
    BLACK: 0x111111,
} as const;

export const EventBus = new Events.EventEmitter();

// Event name constants (shared with App.tsx)
export const EV = {
    PHASE_CHANGED: 'phase-changed',
    SCENE_READY: 'current-scene-ready',
    BOARD_UPDATED: 'board-state-updated',
    GRIOt: 'griot-commentary',
    GAME_FINISHED: 'game-finished',
    START_GAME: 'start-game',
    RESTART_GAME: 'restart-game',
    SELECT_PIT: 'select-pit',
    THEME_CHANGED: 'theme-changed',
    MODE_CHANGED: 'mode-changed',
    SOUND_TOGGLED: 'sound-toggled',
    MOVE_MADE: 'move-made',
} as const;

export type Phase = 'MENU' | 'INTRO' | 'PLAYING' | 'PAUSED' | 'FINISHED';
export type Mode = 'ai' | 'pvp';

// ---------------------------------------------------------------------------
// Ayò Olópón rules engine (pure logic, no Phaser)
// Board: pits[0..5] = TOP row (player 2 / AI), pits[6..11] = BOTTOM row (player 1).
// Counter-clockwise sowing from player 1's perspective: bottom row right-to-left,
// then top row left-to-right, skipping the opponent's store on the way.
// We represent sowing as a fixed ring order for each side.
// ---------------------------------------------------------------------------

interface MoveResult {
    pits: number[];
    captured: number;        // seeds captured this move
    capturePits: number[];   // pit indices captured from
    lastPit: number;
    endTurn: boolean;        // whether turn switches (always true in standard Ayò)
    grandSlam: boolean;      // whether capture was disallowed by grand-slam rule
}

function sowOrder(pitIndex: number): number[] {
    // Ring of 12 pits; sowing proceeds counter-clockwise from pitIndex.
    // For bottom row (6..11): order is 11,10,9,8,7,6 then 0,1,2,3,4,5 (top row left-to-right)
    // For top row (0..5): order is 0,1,2,3,4,5 then 11,10,9,8,7,6
    // We'll just build the ring sequence per side.
    const ring: number[] = [];
    if (pitIndex >= 6) {
        // bottom row: descending from pitIndex to 6, then 0..5? Wait:
        // bottom row indices 6..11. Counter-clockwise from player 1's view:
        // start at chosen pit, move leftward along bottom row (11->6), then
        // move to top row leftmost and move rightward (0->5).
        for (let i = pitIndex; i >= 6; i--) ring.push(i);
        for (let i = 0; i <= 5; i++) ring.push(i);
    } else {
        // top row: from chosen pit move rightward (0->5), then bottom row right-to-left (11->6).
        for (let i = pitIndex; i <= 5; i++) ring.push(i);
        for (let i = 11; i >= 6; i--) ring.push(i);
    }
    return ring;
}

function applyMove(pits: number[], pitIndex: number, player: 1 | 2): MoveResult {
    const seeds = pits[pitIndex];
    const newPits = [...pits];
    if (seeds <= 0) {
        return { pits: newPits, captured: 0, capturePits: [], lastPit: pitIndex, endTurn: true, grandSlam: false };
    }
    newPits[pitIndex] = 0;
    const ring = sowOrder(pitIndex);
    let lastPit = pitIndex;
    let i = 0;
    let s = seeds;
    while (s > 0) {
        lastPit = ring[i % ring.length];
        newPits[lastPit] += 1;
        s--;
        i++;
    }
    // Capture rule: last seed lands in opponent pit making count 2 or 3.
    const oppStart = player === 1 ? 0 : 6;
    const oppEnd = player === 1 ? 5 : 11;
    let captured = 0;
    const capturePits: number[] = [];
    const isOpponentPit = lastPit >= oppStart && lastPit <= oppEnd;
    if (isOpponentPit && (newPits[lastPit] === 2 || newPits[lastPit] === 3)) {
        // Walk backward along opponent's row (in sowing ring order reversed).
        // For player 1, opponent row is 0..5 sown left-to-right; backward means decreasing index.
        // For player 2, opponent row is 6..11 sown right-to-left; backward means increasing index.
        let idx = lastPit;
        const step = player === 1 ? -1 : 1;
        while (idx >= oppStart && idx <= oppEnd &&
               (newPits[idx] === 2 || newPits[idx] === 3)) {
            captured += newPits[idx];
            capturePits.push(idx);
            newPits[idx] = 0;
            idx += step;
        }
    }
    // Grand slam: if capture would take ALL opponent seeds and opponent has seeds elsewhere,
    // disallow (feed rule). Check if any opponent pit outside capturePits still has seeds.
    let grandSlam = false;
    if (captured > 0) {
        let remaining = 0;
        for (let p = oppStart; p <= oppEnd; p++) {
            if (!capturePits.includes(p)) remaining += newPits[p];
        }
        if (remaining === 0) {
            // check opponent total before capture: if capture takes everything, undo
            let totalBefore = 0;
            for (let p = oppStart; p <= oppEnd; p++) totalBefore += pits[p];
            if (captured >= totalBefore && totalBefore > 0) {
                grandSlam = true;
                // Undo capture: return seeds to pits
                for (const cp of capturePits) {
                    // we need original values; recompute by replaying? Simpler: rebuild
                    // We'll restore by re-running sow without capture.
                }
                // Rebuild without capture
                const noCap = [...pits];
                noCap[pitIndex] = 0;
                let j = 0;
                let ss = seeds;
                while (ss > 0) {
                    const lp = ring[j % ring.length];
                    noCap[lp] += 1;
                    ss--;
                    j++;
                }
                return { pits: noCap, captured: 0, capturePits: [], lastPit, endTurn: true, grandSlam: true };
            }
        }
    }
    return { pits: newPits, captured, capturePits, lastPit, endTurn: true, grandSlam: false };
}

function validMoves(pits: number[], player: 1 | 2): number[] {
    const start = player === 1 ? 6 : 0;
    const end = player === 1 ? 11 : 5;
    const moves: number[] = [];
    for (let i = start; i <= end; i++) if (pits[i] > 0) moves.push(i);
    return moves;
}

function isGameOver(pits: number[]): { over: boolean; winner: 1 | 2 | 0 } {
    const p1 = pits.slice(6, 12).reduce((a, b) => a + b, 0);
    const p2 = pits.slice(0, 6).reduce((a, b) => a + b, 0);
    if (p1 === 0) return { over: true, winner: 2 };
    if (p2 === 0) return { over: true, winner: 1 };
    return { over: false, winner: 0 };
}

// AI: heuristic — prefer max capture, avoid leaving own pits at 2/3 in opponent's reach,
// prefer feeding opponent if they are starving, otherwise random from top candidates.
function aiChooseMove(pits: number[], stores: [number, number]): number {
    const moves = validMoves(pits, 2);
    if (moves.length === 0) return -1;
    let best = moves[0];
    let bestScore = -Infinity;
    for (const m of moves) {
        const res = applyMove(pits, m, 2);
        let score = res.captured * 10;
        // Penalize leaving own row with 2/3 in pits that opponent could capture next turn.
        const after = res.pits;
        for (let i = 6; i < 12; i++) {
            if (after[i] === 2 || after[i] === 3) score -= 2;
        }
        // Reward consolidating seeds on own side.
        for (let i = 6; i < 12; i++) score += after[i] * 0.5;
        // If opponent starving (p1 total <= 2), prefer moves that feed them (avoid grand slam).
        const p1Total = after.slice(6, 12).reduce((a, b) => a + b, 0);
        if (p1Total <= 2 && res.captured > 0) score -= 20;
        score += Math.random() * 2;
        if (score > bestScore) { bestScore = score; best = m; }
    }
    return best;
}

// ---------------------------------------------------------------------------
// Texture generators (procedural, no image files needed)
// ---------------------------------------------------------------------------

function makeAdireBackground(scene: Scene): void {
    const g = scene.add.graphics();
    // deep indigo base
    g.fillStyle(COLORS.INDIGO_DEEP, 1);
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    // resist-dye circles grid
    g.fillStyle(COLORS.INDIGO_LIGHT, 0.35);
    for (let y = 0; y < GAME_HEIGHT; y += 60) {
        for (let x = 0; x < GAME_WIDTH; x += 60) {
            g.fillCircle(x + 30, y + 30, 8);
        }
    }
    // chevron bands top & bottom
    g.lineStyle(3, COLORS.OCHRE, 0.5);
    for (let x = -20; x < GAME_WIDTH + 40; x += 40) {
        g.lineBetween(x, 20, x + 20, 40);
        g.lineBetween(x + 20, 40, x + 40, 20);
        g.lineBetween(x, GAME_HEIGHT - 40, x + 20, GAME_HEIGHT - 20);
        g.lineBetween(x + 20, GAME_HEIGHT - 20, x + 40, GAME_HEIGHT - 40);
    }
    // vertical ochre side borders
    g.fillStyle(COLORS.OCHRE_DARK, 0.6);
    g.fillRect(0, 0, 12, GAME_HEIGHT);
    g.fillRect(GAME_WIDTH - 12, 0, 12, GAME_HEIGHT);
    g.generateTexture('adire_bg', GAME_WIDTH, GAME_HEIGHT);
    g.destroy();
}

function makeWoodBoard(scene: Scene): void {
    const W = 500, H = 300;
    const g = scene.add.graphics();
    g.fillStyle(COLORS.OCHRE_DARK, 1);
    g.fillRoundedRect(0, 0, W, H, 18);
    g.fillStyle(COLORS.OCHRE, 1);
    g.fillRoundedRect(6, 6, W - 12, H - 12, 14);
    // wood grain lines
    g.lineStyle(1, 0x6b3d18, 0.35);
    for (let i = 0; i < 10; i++) {
        const y = 20 + i * 28 + Math.sin(i) * 4;
        g.beginPath();
        g.moveTo(10, y);
        for (let x = 10; x < W - 10; x += 20) {
            g.lineTo(x, y + Math.sin(x * 0.05 + i) * 3);
        }
        g.strokePath();
    }
    // carved edge highlight
    g.lineStyle(2, 0xd98e4a, 0.7);
    g.strokeRoundedRect(8, 8, W - 16, H - 16, 12);
    g.generateTexture('wood_board', W, H);
    g.destroy();
}

function makePit(scene: Scene): void {
    const S = 72;
    const g = scene.add.graphics();
    // outer ring (carved rim)
    g.fillStyle(0x5a3212, 1);
    g.fillCircle(S / 2, S / 2, S / 2 - 2);
    // inner shadow (concave)
    g.fillStyle(COLORS.INDIGO_DEEP, 1);
    g.fillCircle(S / 2, S / 2 + 3, S / 2 - 10);
    // inner highlight (depth)
    g.fillStyle(0x0a1420, 1);
    g.fillCircle(S / 2, S / 2 + 5, S / 2 - 16);
    // rim shine
    g.lineStyle(2, 0xc98a4a, 0.6);
    g.strokeCircle(S / 2, S / 2, S / 2 - 4);
    g.generateTexture('pit', S, S);
    g.destroy();
}

function makePitHighlight(scene: Scene): void {
    const S = 84;
    const g = scene.add.graphics();
    g.lineStyle(4, COLORS.GOLD, 0.9);
    g.strokeCircle(S / 2, S / 2, S / 2 - 6);
    g.lineStyle(2, 0xffffff, 0.5);
    g.strokeCircle(S / 2, S / 2, S / 2 - 12);
    g.generateTexture('pit_glow', S, S);
    g.destroy();
}

function makeStore(scene: Scene): void {
    const W = 110, H = 220;
    const g = scene.add.graphics();
    // calabash bowl shape
    g.fillStyle(0x5a3212, 1);
    g.fillRoundedRect(0, 0, W, H, 40);
    g.fillStyle(COLORS.OCHRE_DARK, 1);
    g.fillRoundedRect(6, 6, W - 12, H - 12, 36);
    g.fillStyle(0x3a2410, 1);
    g.fillRoundedRect(16, 16, W - 32, H - 32, 28);
    // rim pattern
    g.lineStyle(2, COLORS.TERRA, 0.8);
    g.strokeRoundedRect(10, 10, W - 20, H - 20, 32);
    g.generateTexture('store', W, H);
    g.destroy();
}

function makeCowrie(scene: Scene): void {
    const W = 22, H = 16;
    const g = scene.add.graphics();
    // shell body (ivory oval)
    g.fillStyle(COLORS.IVORY, 1);
    g.fillEllipse(W / 2, H / 2, W - 2, H - 2);
    // dorsal ridge shading
    g.fillStyle(COLORS.TERRA, 0.5);
    g.fillEllipse(W / 2, H / 2 + 2, W - 8, H - 8);
    // longitudinal slit
    g.lineStyle(1.5, 0x6b4a2a, 1);
    g.beginPath();
    g.moveTo(4, H / 2);
    g.lineTo(W - 4, H / 2);
    g.strokePath();
    // teeth marks along slit
    g.lineStyle(1, 0x6b4a2a, 0.7);
    for (let x = 5; x < W - 5; x += 3) {
        g.lineBetween(x, H / 2 - 1.5, x, H / 2 + 1.5);
    }
    // highlight
    g.fillStyle(0xffffff, 0.7);
    g.fillEllipse(W / 2 - 3, H / 2 - 3, 4, 2);
    g.generateTexture('cowrie', W, H);
    g.destroy();
}

function makeSpark(scene: Scene): void {
    const S = 16;
    const g = scene.add.graphics();
    g.fillStyle(COLORS.GOLD, 1);
    g.fillCircle(S / 2, S / 2, S / 2 - 2);
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(S / 2, S / 2, S / 4);
    g.generateTexture('spark', S, S);
    g.destroy();
}

function makeDivinerPortrait(scene: Scene): void {
    const W = 180, H = 220;
    const g = scene.add.graphics();
    // background panel
    g.fillStyle(COLORS.INDIGO, 1);
    g.fillRoundedRect(0, 0, W, H, 12);
    g.lineStyle(3, COLORS.OCHRE, 1);
    g.strokeRoundedRect(4, 4, W - 8, H - 8, 10);
    // head (dark brown)
    g.fillStyle(0x3a2418, 1);
    g.fillEllipse(W / 2, 80, 70, 80);
    // cap (indigo adire)
    g.fillStyle(COLORS.INDIGO_DEEP, 1);
    g.fillEllipse(W / 2, 48, 80, 36);
    g.fillStyle(COLORS.IVORY, 0.8);
    for (let x = W / 2 - 30; x <= W / 2 + 30; x += 12) {
        g.fillCircle(x, 48, 2);
    }
    // eyes (calm, half-lidded)
    g.fillStyle(0x1a1008, 1);
    g.fillRect(W / 2 - 22, 78, 14, 3);
    g.fillRect(W / 2 + 8, 78, 14, 3);
    // nose
    g.lineStyle(2, 0x2a1810, 1);
    g.lineBetween(W / 2, 82, W / 2 - 3, 96);
    g.lineBetween(W / 2 - 3, 96, W / 2 + 3, 96);
    // mouth (calm line)
    g.lineStyle(2, 0x1a0a08, 1);
    g.lineBetween(W / 2 - 10, 108, W / 2 + 10, 108);
    // beard (ivory streaks)
    g.lineStyle(2, COLORS.IVORY, 0.7);
    for (let x = W / 2 - 14; x <= W / 2 + 14; x += 4) {
        g.lineBetween(x, 112, x + Math.sin(x) * 2, 124);
    }
    // robe (indigo with adire pattern)
    g.fillStyle(COLORS.INDIGO_DEEP, 1);
    g.fillRoundedRect(W / 2 - 60, 130, 120, 80, 8);
    g.fillStyle(COLORS.IVORY, 0.4);
    for (let y = 140; y < 200; y += 14) {
        for (let x = W / 2 - 50; x <= W / 2 + 50; x += 14) {
            g.fillCircle(x, y, 2);
        }
    }
    // cowrie necklace layers
    g.fillStyle(COLORS.IVORY, 1);
    for (let x = W / 2 - 36; x <= W / 2 + 36; x += 8) {
        g.fillCircle(x, 134 + Math.abs(x - W / 2) * 0.08, 3);
    }
    for (let x = W / 2 - 44; x <= W / 2 + 44; x += 8) {
        g.fillCircle(x, 144 + Math.abs(x - W / 2) * 0.1, 3);
    }
    // staff
    g.lineStyle(6, 0x5a3212, 1);
    g.lineBetween(W - 30, 30, W - 30, 210);
    g.fillStyle(COLORS.OCHRE, 1);
    g.fillEllipse(W - 30, 28, 14, 20);
    g.generateTexture('diviner', W, H);
    g.destroy();
}

function makeTricksterPortrait(scene: Scene): void {
    const W = 180, H = 220;
    const g = scene.add.graphics();
    g.fillStyle(0x2a0a0a, 1);
    g.fillRoundedRect(0, 0, W, H, 12);
    g.lineStyle(3, COLORS.RED, 1);
    g.strokeRoundedRect(4, 4, W - 8, H - 8, 10);
    // head
    g.fillStyle(0x3a2418, 1);
    g.fillEllipse(W / 2, 80, 68, 78);
    // patchwork cap (red & black)
    g.fillStyle(COLORS.RED, 1);
    g.fillEllipse(W / 2 - 18, 48, 40, 30);
    g.fillStyle(COLORS.BLACK, 1);
    g.fillEllipse(W / 2 + 18, 48, 40, 30);
    // mirror motif on cap
    g.fillStyle(0xc0c0c0, 1);
    g.fillCircle(W / 2, 44, 5);
    g.lineStyle(1, 0xffffff, 1);
    g.strokeCircle(W / 2, 44, 5);
    // white chalk over one eye (left eye)
    g.fillStyle(0xffffff, 0.95);
    g.fillEllipse(W / 2 - 18, 78, 26, 22);
    // eyes: one normal, one chalked with black pupil
    g.fillStyle(0x1a1008, 1);
    g.fillEllipse(W / 2 + 14, 78, 10, 6);
    g.fillStyle(0x000000, 1);
    g.fillCircle(W / 2 + 14, 78, 3);
    g.fillCircle(W / 2 - 18, 78, 3);
    // asymmetric grin
    g.lineStyle(3, 0x1a0a08, 1);
    g.beginPath();
    g.moveTo(W / 2 - 16, 104);
    g.lineTo(W / 2 + 4, 106);
    g.lineTo(W / 2 + 20, 98);
    g.strokePath();
    // teeth hint
    g.fillStyle(0xffffff, 1);
    g.fillRect(W / 2 + 2, 102, 3, 3);
    // patchwork robe (red & black squares)
    for (let y = 130; y < 210; y += 20) {
        for (let x = W / 2 - 60; x < W / 2 + 60; x += 20) {
            const isRed = ((x + y) / 20) % 2 < 1;
            g.fillStyle(isRed ? COLORS.RED : COLORS.BLACK, 1);
            g.fillRect(x, y, 20, 20);
        }
    }
    // cowrie + mirror motifs on robe
    g.fillStyle(COLORS.IVORY, 1);
    for (let x = W / 2 - 40; x <= W / 2 + 40; x += 20) {
        g.fillCircle(x, 150, 3);
        g.fillCircle(x, 180, 3);
    }
    g.fillStyle(0xc0c0c0, 1);
    g.fillCircle(W / 2 - 20, 165, 4);
    g.fillCircle(W / 2 + 20, 165, 4);
    // bird-topped staff
    g.lineStyle(5, 0x2a1a0a, 1);
    g.lineBetween(30, 40, 30, 210);
    g.fillStyle(COLORS.BLACK, 1);
    g.fillEllipse(30, 34, 18, 14);
    g.fillStyle(COLORS.RED, 1);
    g.fillTriangle(22, 32, 14, 34, 22, 38);
    g.fillStyle(COLORS.GOLD, 1);
    g.fillCircle(34, 30, 2);
    g.generateTexture('trickster', W, H);
    g.destroy();
}

// ---------------------------------------------------------------------------
// Audio keys (loaded from public/assets/audio)
// ---------------------------------------------------------------------------
const SFX = {
    DROP: 'sfx_drop',
    GATHER: 'sfx_gather',
    WIN: 'sfx_win',
    BUTTON: 'sfx_button',
    BGM: 'bgm_chill',
};

// ---------------------------------------------------------------------------
// The Game Scene
// ---------------------------------------------------------------------------
export class Game extends Scene {
    private pits: number[] = [];
    private stores: [number, number] = [0, 0];
    private currentTurn: 1 | 2 = 1;
    private mode: Mode = 'ai';
    private theme: ThemeKey = 'harvest';
    private phase: Phase = 'MENU';
    private pitImages: Phaser.GameObjects.Image[] = [];
    private pitGlows: Phaser.GameObjects.Image[] = [];
    private seedImages: Phaser.GameObjects.Image[][] = [];
    private storeTexts: Phaser.GameObjects.Text[] = [];
    private turnText!: Phaser.GameObjects.Text;
    private captureTexts: Phaser.GameObjects.Text[] = [];
    private busy = false;
    private lastMove: { from: number; to: number; captured: number[] } | null = null;
    private stats = { p1Captures: 0, p2Captures: 0, maxSingleCapture: 0, totalTurns: 0 };
    private bgm?: Phaser.Sound.BaseSound;
    private muted = false;
    private boardContainer!: Phaser.GameObjects.Container;

    constructor() { super('Game'); }

    preload() {
        this.load.audio(SFX.DROP, 'assets/audio/sfx_collect.mp3');
        this.load.audio(SFX.GATHER, 'assets/audio/sfx_powerup.mp3');
        this.load.audio(SFX.WIN, 'assets/audio/sfx_win.mp3');
        this.load.audio(SFX.BUTTON, 'assets/audio/sfx_button.mp3');
        this.load.audio(SFX.BGM, 'assets/audio/bgm_chill.mp3');
    }

    create() {
        makeAdireBackground(this);
        makeWoodBoard(this);
        makePit(this);
        makePitHighlight(this);
        makeStore(this);
        makeCowrie(this);
        makeSpark(this);
        makeDivinerPortrait(this);
        makeTricksterPortrait(this);

        this.add.image(0, 0, 'adire_bg').setOrigin(0).setDepth(-10);

        this.boardContainer = this.add.container(GAME_WIDTH / 2, 520);
        this.buildBoard();

        // Character portraits (small, flanking top)
        this.add.image(70, 180, 'diviner').setScale(0.55).setDepth(2);
        this.add.image(GAME_WIDTH - 70, 180, 'trickster').setScale(0.55).setDepth(2);

        // Title
        this.add.text(GAME_WIDTH / 2, 60, 'AYÒ ÀṢẸ', {
            fontFamily: 'Georgia, serif', fontSize: '44px', color: '#ffd166',
            fontStyle: 'bold', stroke: '#0d1b2a', strokeThickness: 6,
        }).setOrigin(0.5).setDepth(5);
        this.add.text(GAME_WIDTH / 2, 100, 'Yoruba Mancala Divination', {
            fontFamily: 'Georgia, serif', fontSize: '16px', color: '#f4ecd8',
            fontStyle: 'italic',
        }).setOrigin(0.5).setDepth(5);

        // Turn indicator
        this.turnText = this.add.text(GAME_WIDTH / 2, 740, 'YOUR TURN', {
            fontFamily: 'Georgia, serif', fontSize: '22px', color: '#ffd166',
            fontStyle: 'bold', stroke: '#0d1b2a', strokeThickness: 4,
        }).setOrigin(0.5).setDepth(6);

        // Keyboard controls
        this.input.keyboard?.addKeys('ONE,TWO,THREE,FOUR,FIVE,SIX,SPACE,ENTER,ESC,M');
        this.input.keyboard?.on('keydown-ESC', () => this.togglePause());
        this.input.keyboard?.on('keydown-M', () => this.toggleMute());
        for (let i = 0; i < 6; i++) {
            const keyName = ['ONE','TWO','THREE','FOUR','FIVE','SIX'][i];
            this.input.keyboard?.on(`keydown-${keyName}`, () => {
                if (this.phase === 'PLAYING' && this.currentTurn === 1 && !this.busy) {
                    this.tryMove(6 + i);
                }
            });
        }

        // EventBus listeners
        EventBus.on(EV.START_GAME, this.onStartGame, this);
        EventBus.on(EV.RESTART_GAME, this.onRestart, this);
        EventBus.on(EV.SELECT_PIT, this.onSelectPit, this);
        EventBus.on(EV.THEME_CHANGED, this.onThemeChanged, this);
        EventBus.on(EV.MODE_CHANGED, this.onModeChanged, this);
        EventBus.on(EV.PHASE_CHANGED, this.onExternalPhase, this);
        EventBus.on(EV.SOUND_TOGGLED, this.onExternalMute, this);

        this.events.once('shutdown', () => {
            EventBus.off(EV.START_GAME, this.onStartGame, this);
            EventBus.off(EV.RESTART_GAME, this.onRestart, this);
            EventBus.off(EV.SELECT_PIT, this.onSelectPit, this);
            EventBus.off(EV.THEME_CHANGED, this.onThemeChanged, this);
            EventBus.off(EV.MODE_CHANGED, this.onModeChanged, this);
            EventBus.off(EV.PHASE_CHANGED, this.onExternalPhase, this);
            EventBus.off(EV.SOUND_TOGGLED, this.onExternalMute, this);
            this.input.keyboard?.removeAllListeners();
            this.time.removeAllEvents();
            this.tweens.killAll();
            this.sound.stopAll();
        });

        EventBus.emit(EV.SCENE_READY, this);
        EventBus.emit(EV.PHASE_CHANGED, 'MENU' as Phase);
    }

    private buildBoard() {
        // Wood board panel
        this.boardContainer.add(this.add.image(0, 0, 'wood_board'));

        // Stores on left (P2/AI) and right (P1)
        const storeL = this.add.image(-260, 0, 'store').setScale(0.8);
        const storeR = this.add.image(260, 0, 'store').setScale(0.8);
        this.boardContainer.add([storeL, storeR]);

        const storeLabelL = this.add.text(-260, -110, 'SPIRIT', {
            fontFamily: 'Georgia, serif', fontSize: '12px', color: '#f4ecd8', fontStyle: 'bold',
        }).setOrigin(0.5);
        const storeLabelR = this.add.text(260, -110, 'YOU', {
            fontFamily: 'Georgia, serif', fontSize: '12px', color: '#ffd166', fontStyle: 'bold',
        }).setOrigin(0.5);
        this.boardContainer.add([storeLabelL, storeLabelR]);

        this.storeTexts = [
            this.add.text(-260, 0, '0', {
                fontFamily: 'Georgia, serif', fontSize: '36px', color: '#f4ecd8', fontStyle: 'bold',
                stroke: '#0d1b2a', strokeThickness: 4,
            }).setOrigin(0.5),
            this.add.text(260, 0, '0', {
                fontFamily: 'Georgia, serif', fontSize: '36px', color: '#ffd166', fontStyle: 'bold',
                stroke: '#0d1b2a', strokeThickness: 4,
            }).setOrigin(0.5),
        ];
        this.boardContainer.add(this.storeTexts);

        // Pits: top row (0..5) at y=-70, bottom row (6..11) at y=+70
        this.pitImages = [];
        this.pitGlows = [];
        this.seedImages = [];
        this.captureTexts = [];
        const xStart = -175, xStep = 70;
        for (let i = 0; i < 12; i++) {
            const isTop = i < 6;
            const col = isTop ? i : 11 - i; // bottom row visually reversed (right-to-left sowing)
            const x = xStart + col * xStep;
            const y = isTop ? -70 : 70;
            const pit = this.add.image(x, y, 'pit');
            const glow = this.add.image(x, y, 'pit_glow').setVisible(false);
            this.boardContainer.add([pit, glow]);
            this.pitImages[i] = pit;
            this.pitGlows[i] = glow;
            this.seedImages[i] = [];
            const cap = this.add.text(x, y + 48, ' ', {
                fontFamily: 'Georgia, serif', fontSize: '14px', color: '#ffd166', fontStyle: 'bold',
            }).setOrigin(0.5).setVisible(false);
            this.boardContainer.add(cap);
            this.captureTexts[i] = cap;

            // Interactive hit area
            pit.setInteractive(new Phaser.Geom.Circle(36, 36, 36), Phaser.Geom.Circle.Contains);
            pit.on('pointerdown', () => {
                if (this.phase === 'PLAYING' && this.currentTurn === 1 && !this.busy) {
                    this.tryMove(i);
                }
            });
        }
    }

    private resetBoard() {
        this.pits = new Array(12).fill(4);
        this.stores = [0, 0];
        this.currentTurn = 1;
        this.lastMove = null;
        this.busy = false;
        this.stats = { p1Captures: 0, p2Captures: 0, maxSingleCapture: 0, totalTurns: 0 };
        for (let i = 0; i < 12; i++) {
            this.clearSeeds(i);
            this.pitGlows[i].setVisible(false);
            this.captureTexts[i].setVisible(false);
        }
        this.renderSeeds();
        this.updateStoreTexts();
        this.updateTurnText();
        this.emitBoard();
    }

    private onStartGame(payload: { mode: Mode; theme: ThemeKey }) {
        this.mode = payload.mode;
        this.theme = payload.theme;
        this.resetBoard();
        this.setPhase('PLAYING');
        this.playBgm();
        this.showGlow();
    }

    private onRestart() {
        this.resetBoard();
        this.setPhase('PLAYING');
        this.showGlow();
    }

    private onSelectPit(payload: { pitIndex: number }) {
        if (this.phase === 'PLAYING' && this.currentTurn === 1 && !this.busy) {
            this.tryMove(payload.pitIndex);
        }
    }

    private onThemeChanged(t: ThemeKey) { this.theme = t; }
    private onModeChanged(m: Mode) { this.mode = m; }

    // React-driven phase sync (pause button, return-to-menu). Guarded so the
    // scene's own setPhase() emission does not re-enter or double-emit.
    private onExternalPhase(p: Phase) {
        if (p === this.phase) return;
        this.phase = p;
        if (p === 'PAUSED') {
            this.time.removeAllEvents();
            this.tweens.pauseAll();
        } else if (p === 'PLAYING') {
            this.tweens.resumeAll();
            if (this.currentTurn === 2 && this.mode === 'ai' && !this.busy) {
                this.time.delayedCall(700, () => this.aiTurn());
            }
        }
    }

    // React-driven mute sync (HUD speaker button). Guarded against re-entry
    // from the scene's own toggleMute() emission.
    private onExternalMute(m: boolean) {
        if (m === this.muted) return;
        this.muted = m;
        this.sound.mute = m;
    }

    private setPhase(p: Phase) {
        this.phase = p;
        EventBus.emit(EV.PHASE_CHANGED, p);
    }

    private togglePause() {
        if (this.phase === 'PLAYING') {
            this.setPhase('PAUSED');
        } else if (this.phase === 'PAUSED') {
            this.setPhase('PLAYING');
        }
    }

    private toggleMute() {
        this.muted = !this.muted;
        this.sound.mute = this.muted;
        EventBus.emit(EV.SOUND_TOGGLED, this.muted);
    }

    private playBgm() {
        if (this.bgm) { this.bgm.stop(); }
        if (this.cache.audio.exists(SFX.BGM)) {
            this.bgm = this.sound.add(SFX.BGM, { loop: true, volume: 0.35 });
            this.bgm.play();
        }
    }

    private safePlay(key: string, vol = 0.6) {
        if (this.cache.audio.exists(key)) this.sound.play(key, { volume: vol });
    }

    // --- Rendering seeds -----------------------------------------------------

    private clearSeeds(i: number) {
        for (const img of this.seedImages[i]) img.destroy();
        this.seedImages[i] = [];
    }

    private renderSeeds() {
        for (let i = 0; i < 12; i++) {
            this.clearSeeds(i);
            this.placeSeeds(i, this.pits[i]);
        }
    }

    private placeSeeds(i: number, count: number) {
        const pit = this.pitImages[i];
        const px = pit.x, py = pit.y;
        const n = Math.min(count, 12);
        for (let k = 0; k < n; k++) {
            const angle = (k / Math.max(n, 1)) * Math.PI * 2;
            const r = n <= 1 ? 0 : 14 + (k % 2) * 6;
            const x = px + Math.cos(angle) * r;
            const y = py + Math.sin(angle) * r * 0.6;
            const img = this.add.image(x, y, 'cowrie').setRotation(angle).setScale(0.9);
            this.boardContainer.add(img);
            this.seedImages[i].push(img);
        }
        if (count > 12) {
            const t = this.add.text(px, py - 30, `+${count - 12}`, {
                fontFamily: 'Georgia, serif', fontSize: '14px', color: '#ffd166', fontStyle: 'bold',
                stroke: '#0d1b2a', strokeThickness: 3,
            }).setOrigin(0.5);
            this.boardContainer.add(t);
            this.seedImages[i].push(t as unknown as Phaser.GameObjects.Image);
        }
    }

    private updateStoreTexts() {
        this.storeTexts[0].setText(String(this.stores[0]));
        this.storeTexts[1].setText(String(this.stores[1]));
    }

    private updateTurnText() {
        if (this.currentTurn === 1) {
            this.turnText.setText('YOUR TURN');
            this.turnText.setColor('#ffd166');
        } else {
            this.turnText.setText('SPIRIT THINKS...');
            this.turnText.setColor('#f4ecd8');
        }
    }

    private emitBoard() {
        EventBus.emit(EV.BOARD_UPDATED, {
            pits: [...this.pits],
            stores: [...this.stores] as [number, number],
            currentTurn: this.currentTurn,
            lastMove: this.lastMove,
        });
    }

    private showGlow() {
        for (let i = 0; i < 12; i++) this.pitGlows[i].setVisible(false);
        if (this.currentTurn === 1 && this.phase === 'PLAYING') {
            for (const m of validMoves(this.pits, 1)) {
                this.pitGlows[m].setVisible(true);
                this.tweens.add({
                    targets: this.pitGlows[m],
                    alpha: { from: 0.4, to: 1 },
                    duration: 700, yoyo: true, repeat: -1,
                });
            }
        }
    }

    // --- Move execution with sowing animation --------------------------------

    private tryMove(pitIndex: number) {
        if (this.pits[pitIndex] <= 0) return;
        if (this.currentTurn === 1 && pitIndex < 6) return;
        if (this.currentTurn === 2 && pitIndex >= 6) return;
        this.busy = true;
        for (let i = 0; i < 12; i++) {
            this.pitGlows[i].setVisible(false);
            this.tweens.killTweensOf(this.pitGlows[i]);
        }
        this.executeMoveAnimated(pitIndex, this.currentTurn);
    }

    private executeMoveAnimated(pitIndex: number, player: 1 | 2) {
        const seeds = this.pits[pitIndex];
        const ring = sowOrder(pitIndex);
        const newPits = [...this.pits];
        newPits[pitIndex] = 0;
        this.clearSeeds(pitIndex);

        let i = 0;
        let s = seeds;
        const step = () => {
            if (s <= 0) {
                // finalize: capture check
                this.pits = newPits;
                const lastPit = ring[(i - 1) % ring.length];
                this.resolveCapture(lastPit, player, () => {
                    this.afterMove();
                });
                return;
            }
            const target = ring[i % ring.length];
            newPits[target] += 1;
            this.placeSeeds(target, 1); // add one visual seed
            this.safePlay(SFX.DROP, 0.35);
            i++;
            s--;
            this.time.delayedCall(110, step);
        };
        this.time.delayedCall(150, step);
    }

    private resolveCapture(lastPit: number, player: 1 | 2, done: () => void) {
        const oppStart = player === 1 ? 0 : 6;
        const oppEnd = player === 1 ? 5 : 11;
        const isOpp = lastPit >= oppStart && lastPit <= oppEnd;
        const count = this.pits[lastPit];
        if (!isOpp || (count !== 2 && count !== 3)) { done(); return; }
        const step = player === 1 ? -1 : 1;
        const capturePits: number[] = [];
        let idx = lastPit;
        while (idx >= oppStart && idx <= oppEnd &&
               (this.pits[idx] === 2 || this.pits[idx] === 3)) {
            capturePits.push(idx);
            idx += step;
        }
        // Grand slam check
        let remaining = 0;
        for (let p = oppStart; p <= oppEnd; p++) {
            if (!capturePits.includes(p)) remaining += this.pits[p];
        }
        let totalBefore = 0;
        for (let p = oppStart; p <= oppEnd; p++) totalBefore += this.pits[p];
        const totalCapture = capturePits.reduce((a, p) => a + this.pits[p], 0);
        if (remaining === 0 && totalBefore > 0 && totalCapture >= totalBefore) {
            // Grand slam — no capture (feed rule)
            done();
            return;
        }
        // Animate captures one pit at a time
        let ci = 0;
        const doCapture = () => {
            if (ci >= capturePits.length) {
                this.safePlay(SFX.GATHER, 0.6);
                this.stats[player === 1 ? 'p1Captures' : 'p2Captures'] += totalCapture;
                if (totalCapture > this.stats.maxSingleCapture) this.stats.maxSingleCapture = totalCapture;
                this.lastMove = { from: -1, to: lastPit, captured: capturePits };
                // griot commentary
                const tag = totalCapture >= 4 ? 'big_capture' : 'small_capture';
                EventBus.emit(EV.GRIOt, { quote: pickGriotLine(tag), tag, character: player === 1 ? 'diviner' : 'trickster' });
                this.emitBoard();
                done();
                return;
            }
            const p = capturePits[ci];
            const amt = this.pits[p];
            this.stores[player === 1 ? 1 : 0] += amt;
            this.pits[p] = 0;
            this.clearSeeds(p);
            this.captureTexts[p].setText(`+${amt}`).setVisible(true).setAlpha(1);
            this.tweens.add({
                targets: this.captureTexts[p],
                y: this.captureTexts[p].y - 30, alpha: 0, duration: 800,
                onComplete: () => { this.captureTexts[p].setVisible(false); this.captureTexts[p].y += 30; },
            });
            // spark burst
            this.burstSparks(this.pitImages[p].x, this.pitImages[p].y);
            this.updateStoreTexts();
            ci++;
            this.time.delayedCall(260, doCapture);
        };
        doCapture();
    }

    private burstSparks(x: number, y: number) {
        for (let k = 0; k < 8; k++) {
            const s = this.add.image(x, y, 'spark').setScale(0.8);
            this.boardContainer.add(s);
            const angle = (k / 8) * Math.PI * 2;
            this.tweens.add({
                targets: s,
                x: x + Math.cos(angle) * 40,
                y: y + Math.sin(angle) * 40,
                alpha: 0, scale: 0.2,
                duration: 500,
                onComplete: () => s.destroy(),
            });
        }
    }

    private afterMove() {
        this.stats.totalTurns++;
        this.updateStoreTexts();
        this.renderSeeds();
        this.emitBoard();
        const over = isGameOver(this.pits);
        if (over.over) {
            this.finishGame(over.winner);
            return;
        }
        this.currentTurn = this.currentTurn === 1 ? 2 : 1;
        this.updateTurnText();
        this.busy = false;
        this.showGlow();
        if (this.currentTurn === 2 && this.mode === 'ai') {
            this.time.delayedCall(700, () => this.aiTurn());
        }
    }

    private aiTurn() {
        if (this.phase !== 'PLAYING') return;
        // If AI has no seeds, game over already handled.
        const m = aiChooseMove(this.pits, this.stores);
        if (m < 0) { this.finishGame(1); return; }
        this.tryMove(m);
    }

    private finishGame(winner: 1 | 2 | 0) {
        this.busy = true;
        this.safePlay(SFX.WIN, 0.7);
        const stats: MatchStats = {
            winner: winner === 1 ? 'p1' : winner === 2 ? 'p2' : 'draw',
            p1Store: this.stores[1],
            p2Store: this.stores[0],
            p1Captures: this.stats.p1Captures,
            p2Captures: this.stats.p2Captures,
            maxSingleCapture: this.stats.maxSingleCapture,
            totalTurns: this.stats.totalTurns,
            theme: this.theme,
            mode: this.mode,
        };
        const reading = generateReading(stats);
        saveHistoryEntry({
            date: new Date().toISOString(),
            winner: stats.winner,
            p1Store: stats.p1Store,
            p2Store: stats.p2Store,
            theme: stats.theme,
            mode: stats.mode,
            reading,
        });
        EventBus.emit(EV.GAME_FINISHED, { ...stats, reading });
        this.setPhase('FINISHED');
    }

    update(_time: number, _delta: number) {
        // Per-frame: nothing needed; all logic is event/timer driven.
    }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
const StartGame = (parent: string) => {
    const config: Phaser.Types.Core.GameConfig = {
        type: AUTO,
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
        parent,
        backgroundColor: '#0d1b2a',
        scale: {
            mode: Scale.FIT,
            autoCenter: Scale.CENTER_BOTH,
        },
        physics: {
            default: 'arcade',
            arcade: { gravity: { x: 0, y: 0 } },
        },
        scene: [Game],
    };
    const game = new PhaserGame(config);
    if (typeof window !== 'undefined') {
        (window as any).__PHASER_GAME__ = game;
        (window as any).__PHASER_EVENT_BUS__ = EventBus;
    }
    return game;
};

export default StartGame;