// renderer.js

// ============================================================================
// 1. GLOBAL CONFIGURATION & HTML ELEMENTS
// ============================================================================
const BOARD_SIZE = 19;
const LETTERS = 'ABCDEFGHJKLMNOPQRST';

let CELL_WIDTH = 0;
let CELL_HEIGHT = 0;
let MARGIN_X = 0;
let MARGIN_Y = 0;
let boardWidth = 0;
let boardHeight = 0;

const canvas = document.getElementById('go-board');
const ctx = canvas.getContext('2d');

// ============================================================================
// 2. TEXTURES & STONE CACHING SYSTEM
// ============================================================================
const textures = {
    board: new Image(),
    black: new Image(),
    white: [new Image(), new Image(), new Image()]
};
textures.board.src = './Textures/kaya-masame.png';
textures.black.src = './Textures/slate.png';
textures.white[0].src = './Textures/shell-a.png';
textures.white[1].src = './Textures/shell-b.png';
textures.white[2].src = './Textures/shell-c.png';

textures.board.onload = () => render();

// Rebuild the stone cache if images finish loading after the initial render sweep
textures.black.onload = () => { stoneCache.cellWidth = 0; render(); };
textures.white.forEach(img => img.onload = () => { stoneCache.cellWidth = 0; render(); });

let stoneCache = { black: null, white: [null, null, null], cellWidth: 0 };

/**
 * Pre-renders stones onto off-screen canvases so they can be rapidly drawn
 * during the main render loop without recalculating shadows and gradients.
 */
function buildStoneCache() {
    if (CELL_WIDTH <= 0) return;
    stoneCache.cellWidth = CELL_WIDTH;

    const createCachedStone = (color, skinIndex) => {
        const cacheCanvas = document.createElement('canvas');
        // Add padding so the shadow blur effect doesn't get clipped at the edge of the canvas
        const padding = CELL_WIDTH * 0.5;
        cacheCanvas.width = CELL_WIDTH + (padding * 2);
        cacheCanvas.height = CELL_HEIGHT + (padding * 2);
        const cctx = cacheCanvas.getContext('2d');

        const cx = cacheCanvas.width / 2;
        const cy = cacheCanvas.height / 2;

        const radiusMultiplier = color === 'black' ? 0.495 : 0.485;
        const radiusX = CELL_WIDTH * radiusMultiplier;
        const radiusY = CELL_HEIGHT * radiusMultiplier;

        let imgToDraw = null;
        if (color === 'black' && textures.black.complete && textures.black.naturalWidth > 0) {
            imgToDraw = textures.black;
        } else if (color === 'white') {
            if (textures.white[skinIndex].complete && textures.white[skinIndex].naturalWidth > 0) {
                imgToDraw = textures.white[skinIndex];
            }
        }

        let relativeThicknessMultiplier = color === 'black' ? THEME.stoneBlackStrokeMultiplier : THEME.stoneWhiteStrokeMultiplier;
        let actualThickness = CELL_WIDTH * relativeThicknessMultiplier;

        cctx.shadowColor = THEME.stoneShadowColor;
        cctx.shadowOffsetX = CELL_WIDTH * THEME.stoneShadowOffsetXMultiplier;
        cctx.shadowOffsetY = CELL_HEIGHT * THEME.stoneShadowOffsetYMultiplier;
        cctx.shadowBlur = CELL_WIDTH * THEME.stoneShadowBlurMultiplier;

        if (imgToDraw) {
            cctx.drawImage(imgToDraw, cx - radiusX, cy - radiusY, radiusX * 2, radiusY * 2);
        } else {
            // Fallback to flat colors if images are missing
            cctx.beginPath();
            cctx.ellipse(cx, cy, radiusX, radiusY, 0, 0, 2 * Math.PI);
            cctx.fillStyle = color;
            cctx.fill();
        }

        // Reset shadow so the highlight ring isn't shadowed
        cctx.shadowColor = 'rgba(0,0,0,0)';
        cctx.shadowOffsetX = 0;
        cctx.shadowOffsetY = 0;
        cctx.shadowBlur = 0;

        if (actualThickness > 0 && radiusX > 0 && radiusY > 0) {
            let gradient = cctx.createLinearGradient(cx - radiusX, cy - radiusY, cx + radiusX, cy + radiusY);

            if (color === 'black') {
                gradient.addColorStop(0, THEME.stoneBlackStrokeTopLeft);
                gradient.addColorStop(1, THEME.stoneBlackStrokeBottomRight);
            } else {
                gradient.addColorStop(0, THEME.stoneWhiteStrokeTopLeft);
                gradient.addColorStop(1, THEME.stoneWhiteStrokeBottomRight);
            }

            cctx.beginPath();
            cctx.ellipse(cx, cy, radiusX, radiusY, 0, 0, 2 * Math.PI);
            cctx.lineWidth = actualThickness;
            cctx.strokeStyle = gradient;
            cctx.stroke();
        }
        return cacheCanvas;
    };

    stoneCache.black = createCachedStone('black', 0);
    stoneCache.white[0] = createCachedStone('white', 0);
    stoneCache.white[1] = createCachedStone('white', 1);
    stoneCache.white[2] = createCachedStone('white', 2);
}

// ============================================================================
// 3. STATE HASHING & RULES ENGINE
// ============================================================================

// Zobrist hashing allows us to generate a unique integer for every specific board position
const zobristTable = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => ({
        black: Math.floor(Math.random() * 0xFFFFFFFF),
        white: Math.floor(Math.random() * 0xFFFFFFFF)
    }))
);

function hashBoard(state) {
    let hash = 0;
    for (let x = 0; x < BOARD_SIZE; x++) {
        for (let y = 0; y < BOARD_SIZE; y++) {
            if (state[x][y] === 'black') hash ^= zobristTable[x][y].black;
            else if (state[x][y] === 'white') hash ^= zobristTable[x][y].white;
        }
    }
    return hash;
}

function getNeighbors(x, y) {
    const neighbors = [];
    if (x > 0) neighbors.push({ x: x - 1, y: y });
    if (x < BOARD_SIZE - 1) neighbors.push({ x: x + 1, y: y });
    if (y > 0) neighbors.push({ x: x, y: y - 1 });
    if (y < BOARD_SIZE - 1) neighbors.push({ x: x, y: y + 1 });
    return neighbors;
}

function getGroupAndLiberties(startX, startY, state) {
    const color = state[startX][startY];
    if (!color) return null;

    const stones = [];
    const liberties = new Set();
    const visited = new Set();
    const stack = [{ x: startX, y: startY }];

    while (stack.length > 0) {
        const { x, y } = stack.pop();
        const key = `${x},${y}`;

        if (visited.has(key)) continue;
        visited.add(key);
        stones.push({ x, y });

        const neighbors = getNeighbors(x, y);
        for (const n of neighbors) {
            const nColor = state[n.x][n.y];
            if (nColor === null) {
                liberties.add(`${n.x},${n.y}`);
            } else if (nColor === color && !visited.has(`${n.x},${n.y}`)) {
                stack.push(n);
            }
        }
    }
    return { stones, liberties: liberties.size };
}

function applyMove(state, x, y, color) {
    if (x === null || y === null) return 0;

    state[x][y] = color;
    let capturedStones = 0;
    const enemyColor = color === 'black' ? 'white' : 'black';

    const neighbors = getNeighbors(x, y);
    for (const n of neighbors) {
        if (state[n.x][n.y] === enemyColor) {
            const group = getGroupAndLiberties(n.x, n.y, state);
            if (group && group.liberties === 0) {
                group.stones.forEach(stone => {
                    state[stone.x][stone.y] = null;
                    capturedStones++;
                });
            }
        }
    }

    // Check for self-capture (suicide)
    const myGroup = getGroupAndLiberties(x, y, state);
    if (myGroup && myGroup.liberties === 0 && capturedStones === 0) {
        state[x][y] = null;
        return -1; // Move is invalid
    }
    return capturedStones;
}

// ============================================================================
// 4. GAME TREE NODE ARCHITECTURE
// ============================================================================
class GameNode {
    constructor(x, y, color, parent, boardStateSnapshot, capturedByBlack = 0, capturedByWhite = 0) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.parent = parent;
        this.children = [];
        this.moveNumber = parent ? parent.moveNumber + 1 : 0;

        if (x !== null && y !== null) {
            this.gtpCoord = parent ? LETTERS[x] + (BOARD_SIZE - y).toString() : 'Start';
        } else {
            this.gtpCoord = parent ? 'pass' : 'Start';
        }

        this.stateSnapshot = boardStateSnapshot ? boardStateSnapshot.map(row => [...row]) : Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
        this.boardHash = hashBoard(this.stateSnapshot);

        this.comment = "";
        this.markup = new Map();

        this.capturesBlack = parent ? parent.capturesBlack + capturedByBlack : 0;
        this.capturesWhite = parent ? parent.capturesWhite + capturedByWhite : 0;

        this.winrate = null;
        this.scoreLead = null;
        this.visits = 0;
        this.kataMoveInfos = null;
        this.kataOwnership = null;
    }
}

// Determines if a node is part of the absolute primary sequence of the tree
function isNodeOnMainLine(node) {
    let temp = node;
    while (temp && temp.parent) {
        if (temp.parent.children[0] !== temp) return false;
        temp = temp.parent;
    }
    return true;
}

function getFullLinePath() {
    let path = [];
    let temp = currentNode;

    // Walk backward to root
    while(temp !== null) {
        path.unshift(temp);
        temp = temp.parent;
    }

    // Walk forward down the main variation of this specific branch
    temp = currentNode.children[0];
    while(temp !== undefined) {
        path.push(temp);
        temp = temp.children[0];
    }
    return path;
}

function gtpToCoords(gtp) {
    if (!gtp || gtp.toLowerCase() === 'pass') return null;
    let letter = gtp.charAt(0).toUpperCase();
    let number = parseInt(gtp.substring(1), 10);
    let x = LETTERS.indexOf(letter);
    let y = BOARD_SIZE - number;
    if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) return null;
    return { x, y };
}

function sgfToCoords(sgfCoord) {
    if (!sgfCoord || sgfCoord === '' || sgfCoord === 'tt') return null;
    return {
        x: sgfCoord.charCodeAt(0) - 97,
        y: sgfCoord.charCodeAt(1) - 97
    };
}

// ============================================================================
// 5. APPLICATION STATE & LOCAL STORAGE
// ============================================================================
const emptyBoard = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
let rootNode = new GameNode(null, null, null, null, emptyBoard);
let currentNode = rootNode;

let undoStack = []; // Stores { parent, index, node } of deleted branches

let boardState = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
let hoverPos = null;
let currentMode = 'alternate';
let nextAlternatingColor = 'black';
let letterCase = 'lower';

let isAnalysisPaused = true;
let currentAnalysisPhase = 1;
let currentAnalysisPath = []; // Tracks the exact branch KataGo is actively evaluating
let currentAnalysisLineStr = "";
let showingScoreEstimate = false;

let currentKomi = 6.5;
let currentRules = "japanese";
let originalGameResult = "";
let isFileLinked = false;

let showScoreGraph = true;
let showWinrateGraph = true;
let showKataBubbles = true;
let isEngineMissing = false;

let activeBubbles = new Set();
let currentStoneHasScoreText = false;
let textDrawQueue = []; // Queues text layers so they are strictly drawn over all other elements

// Settings loaded/saved to the browser's localStorage
const SETTINGS_KEY = 'hoshi_settings';
let appSettings = {
    optCurrentMove: true,
    optNextMove: true,
    optAltMove: true,
    optAltNextMove: true,
    optCoordHighlight: true,
    optSaveConfirm: true,
    engineExe: './KataGo/katago.exe',
    engineNet: './KataGo/default_model.bin.gz',
    engineCfg: './KataGo/analysis_example.cfg'
};

let savedConfig = localStorage.getItem(SETTINGS_KEY);
if (savedConfig) {
    appSettings = { ...appSettings, ...JSON.parse(savedConfig) };
}

let skipSaveConfirm = !appSettings.optSaveConfirm;

// ============================================================================
// 6. RESPONSIVE RESIZE LOGIC
// ============================================================================
function resizeBoard() {
    const container = document.querySelector('.board-container');
    if (!container || !canvas) return;

    const targetRatio = 1.071;
    let w = container.clientWidth;
    let h = container.clientHeight;

    let marginBaseX = w * 0.055;
    let availableW = w - (marginBaseX * 2);

    let tempCellWidth = availableW / (BOARD_SIZE - 1);
    let tempCellHeight = tempCellWidth * targetRatio;
    let marginBaseY = marginBaseX * targetRatio;

    let requiredH = (tempCellHeight * (BOARD_SIZE - 1)) + (marginBaseY * 2);

    if (requiredH > h) {
        MARGIN_Y = h * 0.055;
        let availableH = h - (MARGIN_Y * 2);
        CELL_HEIGHT = availableH / (BOARD_SIZE - 1);
        CELL_WIDTH = CELL_HEIGHT / targetRatio;
        MARGIN_X = MARGIN_Y / targetRatio;

        boardHeight = h;
        boardWidth = (CELL_WIDTH * (BOARD_SIZE - 1)) + (MARGIN_X * 2);
    } else {
        MARGIN_X = marginBaseX;
        MARGIN_Y = marginBaseY;
        CELL_WIDTH = tempCellWidth;
        CELL_HEIGHT = tempCellHeight;

        boardWidth = w;
        boardHeight = requiredH;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = boardWidth * dpr;
    canvas.height = boardHeight * dpr;
    canvas.style.width = boardWidth + 'px';
    canvas.style.height = boardHeight + 'px';

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    render();
    drawAnalysisChart();
}
window.addEventListener('resize', resizeBoard);

// ============================================================================
// 7. HORIZONTAL GAME TREE RENDERING
// ============================================================================
function syncBoardToTree() {
    if (currentNode.stateSnapshot) {
        boardState = currentNode.stateSnapshot.map(row => [...row]);
    }

    if (currentNode.color === 'black') nextAlternatingColor = 'white';
    else if (currentNode.color === 'white') nextAlternatingColor = 'black';
    else nextAlternatingColor = 'black';
}

const treeContainer = document.getElementById('tree-container');
const treeCanvas = document.getElementById('tree-canvas');
const treeCtx = treeCanvas.getContext('2d');

const TREE_CELL_SIZE = 38;
const TREE_RADIUS = 13;
const TREE_PADDING_TOP = 15;

let treeLayout = new Map();
let maxTreeCol = 0;
let maxTreeRow = 0;

function calculateTreeLayout() {
    treeLayout.clear();
    let rowEnds = [];
    maxTreeCol = 0;
    maxTreeRow = 0;

    function traverse(node, requestedRow, currentDepth) {
        let row = requestedRow;

        // Push branches down to the first available row to avoid overlaps
        while (rowEnds[row] !== undefined && rowEnds[row] >= currentDepth) {
            row++;
        }

        node.displayMoveNum = currentDepth;
        treeLayout.set(node, { col: currentDepth, row: row });
        rowEnds[row] = currentDepth;

        if (currentDepth > maxTreeCol) maxTreeCol = currentDepth;
        if (row > maxTreeRow) maxTreeRow = row;

        if (node.children.length > 0) {
            traverse(node.children[0], row, currentDepth + 1);
            for (let i = 1; i < node.children.length; i++) {
                traverse(node.children[i], row + 1, currentDepth + 1);
            }
        }
    }
    traverse(rootNode, 0, 0);
}

function updateTreeUI() {
    calculateTreeLayout();

    let logicalWidth = Math.max((maxTreeCol + 2) * TREE_CELL_SIZE, treeContainer.clientWidth);
    let logicalHeight = Math.max((maxTreeRow + 2) * TREE_CELL_SIZE + TREE_PADDING_TOP, treeContainer.clientHeight);

    const dpr = window.devicePixelRatio || 1;
    treeCanvas.width = logicalWidth * dpr;
    treeCanvas.height = logicalHeight * dpr;
    treeCanvas.style.width = logicalWidth + 'px';
    treeCanvas.style.height = logicalHeight + 'px';

    treeCtx.scale(dpr, dpr);
    treeCtx.clearRect(0, 0, logicalWidth, logicalHeight);

    treeCtx.strokeStyle = THEME.treeBranchColor;
    treeCtx.lineWidth = 2;

    // Phase 1: Draw interconnecting branch lines
    for (let [node, pos] of treeLayout.entries()) {
        if (node.parent) {
            let parentPos = treeLayout.get(node.parent);

            let startX = parentPos.col * TREE_CELL_SIZE + (TREE_CELL_SIZE / 2);
            let startY = parentPos.row * TREE_CELL_SIZE + (TREE_CELL_SIZE / 2) + TREE_PADDING_TOP;
            let endX = pos.col * TREE_CELL_SIZE + (TREE_CELL_SIZE / 2);
            let endY = pos.row * TREE_CELL_SIZE + (TREE_CELL_SIZE / 2) + TREE_PADDING_TOP;

            treeCtx.beginPath();
            treeCtx.moveTo(startX, startY);

            if (pos.row === parentPos.row) {
                treeCtx.lineTo(endX, endY);
            } else {
                // Creates a 90-degree corner for branches that step down a row
                treeCtx.lineTo(startX + (TREE_CELL_SIZE / 2), startY);
                treeCtx.lineTo(startX + (TREE_CELL_SIZE / 2), endY);
                treeCtx.lineTo(endX, endY);
            }
            treeCtx.stroke();
        }
    }

    // Phase 2: Draw the stone nodes
    for (let [node, pos] of treeLayout.entries()) {
        if (node === rootNode) continue;

        let x = pos.col * TREE_CELL_SIZE + (TREE_CELL_SIZE / 2);
        let y = pos.row * TREE_CELL_SIZE + (TREE_CELL_SIZE / 2) + TREE_PADDING_TOP;

        // Draw active node highlight aura
        if (node === currentNode) {
            treeCtx.fillStyle = '#A33C3C';
            treeCtx.beginPath();
            treeCtx.arc(x, y, TREE_RADIUS + 4, 0, 2 * Math.PI);
            treeCtx.fill();
        }

        treeCtx.fillStyle = node.color;
        treeCtx.strokeStyle = node.color === 'black' ? THEME.treeStoneBlackBorder : THEME.treeStoneWhiteBorder;
        treeCtx.lineWidth = 1.5;

        treeCtx.beginPath();
        treeCtx.arc(x, y, TREE_RADIUS, 0, 2 * Math.PI);
        treeCtx.fill();
        treeCtx.stroke();

        // Render 'R' for resign, otherwise standard move number
        if (node.displayMoveNum && node.displayMoveNum > 0) {
            treeCtx.font = "bold 11px Arial, sans-serif";
            treeCtx.fillStyle = (node.color === 'black') ? '#ffffff' : '#000000';
            treeCtx.textAlign = 'center';
            treeCtx.textBaseline = 'middle';

            let textToDraw = node.gtpCoord === 'resign' ? 'R' : String(node.displayMoveNum);
            treeCtx.fillText(textToDraw, x, y + 1);
        }
    }

    if (!isDraggingTree) {
        let pos = treeLayout.get(currentNode);
        if (pos) {
            const targetX = pos.col * TREE_CELL_SIZE + (TREE_CELL_SIZE / 2);
            const targetY = pos.row * TREE_CELL_SIZE + (TREE_CELL_SIZE / 2) + TREE_PADDING_TOP;

            treeContainer.scrollTo({
                left: targetX - (treeContainer.clientWidth / 2),
                top: targetY - (treeContainer.clientHeight / 2),
                behavior: 'smooth'
            });
        }
    }
}

// Tree Mouse Interaction Logic
let isDraggingTree = false;
let didDrag = false;
let dragStartX, dragStartY, dragScrollLeft, dragScrollTop;
let animationFrameId = null;

treeContainer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isDraggingTree = true;
    didDrag = false;
    dragStartX = e.pageX - treeContainer.offsetLeft;
    dragStartY = e.pageY - treeContainer.offsetTop;
    dragScrollLeft = treeContainer.scrollLeft;
    dragScrollTop = treeContainer.scrollTop;
});

treeContainer.addEventListener('mouseleave', () => { isDraggingTree = false; cancelAnimationFrame(animationFrameId); });
treeContainer.addEventListener('mouseup', () => { isDraggingTree = false; cancelAnimationFrame(animationFrameId); });

treeContainer.addEventListener('mousemove', (e) => {
    if (!isDraggingTree) return;

    const x = e.pageX - treeContainer.offsetLeft;
    const y = e.pageY - treeContainer.offsetTop;
    const walkX = (x - dragStartX);
    const walkY = (y - dragStartY);

    if (Math.abs(walkX) > 3 || Math.abs(walkY) > 3) didDrag = true;

    if (didDrag) {
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        animationFrameId = requestAnimationFrame(() => {
            treeContainer.scrollLeft = dragScrollLeft - walkX;
            treeContainer.scrollTop = dragScrollTop - walkY;
        });
    }
});

treeCanvas.addEventListener('click', (event) => {
    if (didDrag) return;

    const rect = treeCanvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    for (let [node, pos] of treeLayout.entries()) {
        if (node === rootNode) continue;

        let x = pos.col * TREE_CELL_SIZE + (TREE_CELL_SIZE / 2);
        let y = pos.row * TREE_CELL_SIZE + (TREE_CELL_SIZE / 2) + TREE_PADDING_TOP;
        let dist = Math.sqrt(Math.pow(mouseX - x, 2) + Math.pow(mouseY - y, 2));

        if (dist <= TREE_RADIUS + 4) {
            currentNode = node;
            syncAndRender();
            break;
        }
    }
});

// ============================================================================
// 8. DYNAMIC MARKUP HELPERS
// ============================================================================
function getNextNumber() {
    let used = new Set();
    for (let mark of currentNode.markup.values()) {
        if (mark.type === 'label' && /^\d+$/.test(mark.label)) {
            used.add(parseInt(mark.label, 10));
        }
    }
    let i = 1;
    while (used.has(i)) i++;
    return i;
}

function getNextAlpha(isUpper) {
    let used = new Set();
    let regex = isUpper ? /^[A-Z]$/ : /^[a-z]$/;
    let offset = isUpper ? 65 : 97;

    for (let mark of currentNode.markup.values()) {
        if (mark.type === 'label' && regex.test(mark.label)) {
            used.add(mark.label.charCodeAt(0) - offset);
        }
    }

    let i = 0;
    while (used.has(i)) i++;
    return i;
}

// ============================================================================
// 9. PRIMARY DRAWING & RENDER LOOP
// ============================================================================
function render() {
    if (!ctx) return;

    textDrawQueue = [];

    drawWoodBackground();
    drawGrid();
    drawStarPoints();
    drawCoordinates();

    drawPlacedStones();

    if (showingScoreEstimate) drawKataTerritory();

    // These functions queue their text data to be drawn at the very end
    drawKataSuggestions();
    drawTreeMarkers();

    // Draw all queued text strictly ON TOP of all stones, bubbles, and rings
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    for (let t of textDrawQueue) {
        ctx.globalAlpha = t.alpha;
        ctx.fillStyle = t.fillStyle;
        ctx.font = t.font;

        ctx.shadowColor = t.shadowColor;
        ctx.shadowBlur = t.shadowBlur;

        ctx.fillText(t.text, t.x, t.y);
    }
    ctx.restore();

    drawMarkup();

    if (!showingScoreEstimate) drawGhostStoneOrMarkup();
}

function drawWoodBackground() {
    if (textures.board.complete && textures.board.naturalWidth > 0) {
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(textures.board, 0, 0, boardWidth, boardHeight);
        ctx.restore();
    } else {
        ctx.fillStyle = THEME.boardColorFallback;
        ctx.fillRect(0, 0, boardWidth, boardHeight);
    }
}

function drawGrid() {
    ctx.strokeStyle = THEME.gridLineColor;
    ctx.lineWidth = Math.max(1.0, CELL_WIDTH * THEME.gridLineWidthMultiplier);

    for (let i = 0; i < BOARD_SIZE; i++) {
        const posX = MARGIN_X + (i * CELL_WIDTH);
        const posY = MARGIN_Y + (i * CELL_HEIGHT);

        ctx.beginPath(); ctx.moveTo(posX, MARGIN_Y); ctx.lineTo(posX, boardHeight - MARGIN_Y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(MARGIN_X, posY); ctx.lineTo(boardWidth - MARGIN_X, posY); ctx.stroke();
    }
}

function drawStarPoints() {
    const starPoints = [3, 9, 15];
    ctx.fillStyle = THEME.starPointColor;
    const radius = Math.max(1.5, CELL_WIDTH * 0.06);
    for (const x of starPoints) {
        for (const y of starPoints) {
            ctx.beginPath();
            ctx.arc(MARGIN_X + (x * CELL_WIDTH), MARGIN_Y + (y * CELL_HEIGHT), radius, 0, 2 * Math.PI);
            ctx.fill();
        }
    }
}

function drawCoordinates() {
    const letterFontSize = Math.max(9, Math.floor(MARGIN_X * THEME.coordLetterSizeMultiplier));
    const numberFontSize = Math.max(9, Math.floor(MARGIN_X * THEME.coordNumberSizeMultiplier));

    ctx.textBaseline = 'middle';
    const textOffsetYTop = 0.37;
    const textOffsetYBottom = 0.30;
    const textOffsetXPingPong = 0.47;

    for (let i = 0; i < BOARD_SIZE; i++) {
        const posX = MARGIN_X + (i * CELL_WIDTH);
        const posY = MARGIN_Y + (i * CELL_HEIGHT);
        const letter = LETTERS[i];
        const number = (BOARD_SIZE - i).toString();

        const isCurrentX = appSettings.optCoordHighlight && currentNode && currentNode.x === i;
        const isCurrentY = appSettings.optCoordHighlight && currentNode && currentNode.y === i;

        ctx.font = `${THEME.coordLetterFontWeight} ${letterFontSize}px ${THEME.coordLetterFontFamily}`;
        ctx.textAlign = 'center';
        ctx.fillStyle = isCurrentX ? THEME.coordTextHighlightColor : THEME.coordTextColor;

        ctx.fillText(letter, posX, MARGIN_Y * textOffsetYTop);
        ctx.fillText(letter, posX, boardHeight - (MARGIN_Y * textOffsetYBottom));

        ctx.font = `${THEME.coordNumberFontWeight} ${numberFontSize}px ${THEME.coordNumberFontFamily}`;
        ctx.fillStyle = isCurrentY ? THEME.coordTextHighlightColor : THEME.coordTextColor;

        ctx.textAlign = 'right';
        ctx.fillText(number, MARGIN_X * textOffsetXPingPong, posY);

        ctx.textAlign = 'left';
        ctx.fillText(number, boardWidth - (MARGIN_X * textOffsetXPingPong), posY);
    }
}

function drawKataTerritory() {
    if (!currentNode || !currentNode.kataOwnership) return;

    const ownership = currentNode.kataOwnership;
    let squareWidth = CELL_WIDTH * 0.45;
    let squareHeight = CELL_HEIGHT * 0.45;

    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            let val = ownership[y * BOARD_SIZE + x];

            if (Math.abs(val) > 0.15) {
                ctx.fillStyle = val > 0 ? '#000000' : '#ffffff';

                let stone = boardState[x][y];
                let isDeadStone = (stone === 'white' && val > 0) || (stone === 'black' && val < 0);

                if (!stone || isDeadStone) {
                    let alpha;
                    if (isDeadStone) {
                        alpha = 0.8;
                    } else if (Math.abs(val) > 0.5) {
                        alpha = 0.65;
                    } else {
                        alpha = 0.20;
                    }

                    ctx.globalAlpha = alpha;

                    const pixelX = MARGIN_X + (x * CELL_WIDTH) - (squareWidth / 2);
                    const pixelY = MARGIN_Y + (y * CELL_HEIGHT) - (squareHeight / 2);
                    ctx.fillRect(pixelX, pixelY, squareWidth, squareHeight);
                }
            }
        }
    }
    ctx.globalAlpha = 1.0;
}

function drawKataSuggestions() {
    activeBubbles.clear();

    if (!showKataBubbles || !currentNode) return;

    // Hide Kata bubbles until the node has received at least a 25-visit sweep.
    if (!isAnalysisPaused && currentNode.visits < 25) return;

    let isBlackToPlay = currentNode.color === 'white' || currentNode === rootNode;
    let moves = [];

    if (currentNode.kataMoveInfos && currentNode.kataMoveInfos.length > 0) {
        moves = [...currentNode.kataMoveInfos];

        moves.sort((a, b) => {
            if (isBlackToPlay) {
                if (b.winrate !== a.winrate) return b.winrate - a.winrate;
                return b.scoreLead - a.scoreLead;
            } else {
                if (a.winrate !== b.winrate) return a.winrate - b.winrate;
                return a.scoreLead - b.scoreLead;
            }
        });
    }

    let absoluteBestMove = null;
    let bestScoreLead = currentNode.scoreLead !== null ? currentNode.scoreLead : 0;

    if (moves.length > 0) {
        absoluteBestMove = moves[0];
        bestScoreLead = absoluteBestMove.scoreLead;
    }

    let bubblesToDraw = [];

    // Bypass caps: Always draw analysis data for existing children on the tree
    for (let child of currentNode.children) {
        if (child.gtpCoord.toLowerCase() === 'pass') continue;

        let existingKataData = moves.find(m => m.move === child.gtpCoord);
        if (existingKataData) {
            bubblesToDraw.push({ ...existingKataData, isChild: true });
        } else if (child.scoreLead !== null) {
            bubblesToDraw.push({
                move: child.gtpCoord,
                scoreLead: child.scoreLead,
                isUnexplored: false,
                isChild: true
            });
        }
    }

    let bubbleCap = currentNode.moveNumber <= 50 ? 40 : 12;
    let addedSuggestions = 0;

    // Bypass cap: Always show the best move
    if (absoluteBestMove && !bubblesToDraw.find(m => m.move === absoluteBestMove.move)) {
        bubblesToDraw.push({ ...absoluteBestMove, isChild: false });
        addedSuggestions++;
    }

    let lastX = currentNode.x;
    let lastY = currentNode.y;

    for (let moveInfo of moves) {
        if (moveInfo.move.toLowerCase() === 'pass') continue;
        if (bubblesToDraw.find(m => m.move === moveInfo.move)) continue;

        let loss = 0;
        if (isBlackToPlay) {
            loss = bestScoreLead - moveInfo.scoreLead;
        } else {
            loss = moveInfo.scoreLead - bestScoreLead;
        }
        if (loss < 0) loss = 0;

        if (loss <= 2.0) {
            let coords = gtpToCoords(moveInfo.move);
            if (!coords) continue;

            let isLocal = false;
            // 9x9 box means +/- 4 intersections from the center stone
            if (lastX !== null && lastY !== null) {
                if (Math.abs(coords.x - lastX) <= 4 && Math.abs(coords.y - lastY) <= 4) {
                    isLocal = true;
                }
            }

            if (isLocal) {
                // Local "Green" moves bypass the cap
                bubblesToDraw.push({ ...moveInfo, isChild: false });
            } else if (addedSuggestions < bubbleCap) {
                // Distant moves respect the cap
                bubblesToDraw.push({ ...moveInfo, isChild: false });
                addedSuggestions++;
            }
        }
    }

    bubblesToDraw = bubblesToDraw.filter(m => m.scoreLead !== null && !m.isUnexplored);

    if (bubblesToDraw.length === 0) return;

    ctx.save();

    for (let i = 0; i < bubblesToDraw.length; i++) {
        let moveInfo = bubblesToDraw[i];

        let coords = gtpToCoords(moveInfo.move);
        if (!coords || boardState[coords.x][coords.y]) continue;

        // Log bubble presence so markups drawn underneath know to hollow out their centers
        activeBubbles.add(`${coords.x},${coords.y}`);

        const px = MARGIN_X + (coords.x * CELL_WIDTH);
        const py = MARGIN_Y + (coords.y * CELL_HEIGHT);

        let loss = 0;
        if (isBlackToPlay) {
            loss = bestScoreLead - moveInfo.scoreLead;
        } else {
            loss = moveInfo.scoreLead - bestScoreLead;
        }
        if (loss < 0) loss = 0;

        let isBest = (absoluteBestMove && moveInfo.move === absoluteBestMove.move);

        if (isBest) ctx.fillStyle = THEME.bubbleBest;
        else if (loss <= 2.0) ctx.fillStyle = THEME.bubbleGood;
        else if (loss <= 4.0) ctx.fillStyle = THEME.bubbleOkay;
        else if (loss <= 7.0) ctx.fillStyle = THEME.bubbleBad;
        else ctx.fillStyle = THEME.bubbleTerrible;

        ctx.globalAlpha = 1.0;
        ctx.beginPath();
        ctx.ellipse(px, py, CELL_WIDTH * 0.495, CELL_HEIGHT * 0.495, 0, 0, 2 * Math.PI);

        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 2;

        ctx.fill();

        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        let key = `${coords.x},${coords.y}`;
        let hasPermanentSymbol = currentNode.markup.has(key);
        let isHoveringSymbol = hoverPos && hoverPos.x === coords.x && hoverPos.y === coords.y && currentMode.startsWith('mark_');

        let textAlpha = (hasPermanentSymbol || isHoveringSymbol) ? 0.5 : 1.0;
        let diffStr = isBest ? "0.0" : "-" + loss.toFixed(1);

        textDrawQueue.push({
            text: diffStr,
            x: px,
            y: py + 1,
            alpha: textAlpha,
            fillStyle: THEME.bubbleTextColor,
            font: `bold ${Math.max(11, CELL_WIDTH * 0.38)}px sans-serif`,
            shadowColor: 'rgba(0, 0, 0, 1.0)',
            shadowBlur: 4
        });
    }

    ctx.restore();
}

function drawPlacedStones() {
    for (let x = 0; x < BOARD_SIZE; x++) {
        for (let y = 0; y < BOARD_SIZE; y++) {
            if (boardState[x][y]) drawSingleStone(x, y, boardState[x][y], 1.0);
        }
    }
}

function drawTreeMarkers() {
    currentStoneHasScoreText = false;
    ctx.save();

    if (currentNode.children.length > 0) {
        for (let i = 0; i < currentNode.children.length; i++) {

            if (i === 0 && !appSettings.optNextMove) continue;
            if (i > 0 && !appSettings.optAltNextMove) continue;

            let child = currentNode.children[i];
            if (child.x !== null && child.y !== null) {
                const px = MARGIN_X + (child.x * CELL_WIDTH);
                const py = MARGIN_Y + (child.y * CELL_HEIGHT);

                let actualLineWidth = 0;
                let desiredStrokeColor = '';
                let radiusMultiplier = 0.450;

                if (i === 0) {
                    actualLineWidth = THEME.markerNextMainLineWidth;
                    desiredStrokeColor = child.color === 'black' ? THEME.markerNextMainBlackColor : THEME.markerNextMainWhiteColor;
                } else {
                    actualLineWidth = THEME.markerNextAltLineWidth;
                    desiredStrokeColor = child.color === 'black' ? THEME.markerNextAltBlackColor : THEME.markerNextAltWhiteColor;
                }

                const radiusX = CELL_WIDTH * radiusMultiplier;
                const radiusY = CELL_HEIGHT * radiusMultiplier;

                if (actualLineWidth > 0 && radiusX > 0 && radiusY > 0) {
                    let desiredDash = 8;
                    let desiredGap = 2;

                    let targetPatternLength = desiredDash + desiredGap;
                    let circumference = 2 * Math.PI * Math.sqrt((radiusX*radiusX + radiusY*radiusY) / 2);

                    let patternCount = Math.max(1, Math.round(circumference / targetPatternLength));
                    let scale = circumference / (patternCount * targetPatternLength);

                    let perfectDash = desiredDash * scale;
                    let perfectGap = desiredGap * scale;

                    if (i === 0) {
                        ctx.beginPath();
                        ctx.ellipse(px, py, radiusX, radiusY, 0, 0, 2 * Math.PI);
                        ctx.lineWidth = actualLineWidth;
                        ctx.strokeStyle = desiredStrokeColor;
                        ctx.setLineDash([perfectDash, perfectGap]);

                        ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
                        ctx.shadowBlur = 3;
                        ctx.shadowOffsetX = 0;
                        ctx.shadowOffsetY = 0;

                        ctx.stroke();
                    } else {
                        // Alternate next moves have a "fatter" internal stroke
                        let fatnessBoost = 0.7;
                        let fatterLineWidth = actualLineWidth + fatnessBoost;
                        let halfThickness = fatterLineWidth / 2;

                        ctx.beginPath();
                        ctx.ellipse(px, py, radiusX, radiusY, 0, 0, 2 * Math.PI);
                        ctx.lineWidth = fatterLineWidth;
                        ctx.strokeStyle = desiredStrokeColor;
                        ctx.setLineDash([perfectDash, perfectGap]);
                        ctx.stroke();

                        // Inner/Outer bounding lines for contrast
                        let outerRX = radiusX + halfThickness;
                        let outerRY = radiusY + halfThickness;
                        let circumOuter = 2 * Math.PI * Math.sqrt((outerRX*outerRX + outerRY*outerRY) / 2);
                        let outerScale = circumOuter / circumference;

                        ctx.beginPath();
                        ctx.ellipse(px, py, outerRX, outerRY, 0, 0, 2 * Math.PI);
                        ctx.lineWidth = 0.3;
                        ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
                        ctx.setLineDash([perfectDash * outerScale, perfectGap * outerScale]);
                        ctx.stroke();

                        let innerRX = radiusX - halfThickness;
                        let innerRY = radiusY - halfThickness;
                        let circumInner = 2 * Math.PI * Math.sqrt((innerRX*innerRX + innerRY*innerRY) / 2);
                        let innerScale = circumInner / circumference;

                        ctx.beginPath();
                        ctx.ellipse(px, py, innerRX, innerRY, 0, 0, 2 * Math.PI);
                        ctx.lineWidth = 0.3;
                        ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
                        ctx.setLineDash([perfectDash * innerScale, perfectGap * innerScale]);
                        ctx.stroke();
                    }

                    ctx.setLineDash([]);
                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                }
            }
        }
    }

    if (appSettings.optAltMove && currentNode.parent && currentNode.parent.children.length > 1) {
        for (let i = 0; i < currentNode.parent.children.length; i++) {
            let sibling = currentNode.parent.children[i];

            if (sibling === currentNode) continue;

            if (sibling.x !== null && sibling.y !== null) {
                const px = MARGIN_X + (sibling.x * CELL_WIDTH);
                const py = MARGIN_Y + (sibling.y * CELL_HEIGHT);

                let actualLineWidth = THEME.markerNextAltLineWidth;
                let desiredStrokeColor = sibling.color === 'black' ? THEME.markerNextAltBlackColor : THEME.markerNextAltWhiteColor;
                let radiusMultiplier = 0.495;

                const radiusX = CELL_WIDTH * radiusMultiplier;
                const radiusY = CELL_HEIGHT * radiusMultiplier;

                if (actualLineWidth > 0 && radiusX > 0 && radiusY > 0) {
                    let fatnessBoost = 0.7;
                    let fatterLineWidth = actualLineWidth + fatnessBoost;
                    let halfThickness = fatterLineWidth / 2;

                    ctx.globalAlpha = 0.8;

                    ctx.beginPath();
                    ctx.ellipse(px, py, radiusX, radiusY, 0, 0, 2 * Math.PI);
                    ctx.lineWidth = fatterLineWidth;
                    ctx.strokeStyle = desiredStrokeColor;
                    ctx.stroke();

                    let outerRX = radiusX + halfThickness;
                    let outerRY = radiusY + halfThickness;
                    ctx.beginPath();
                    ctx.ellipse(px, py, outerRX, outerRY, 0, 0, 2 * Math.PI);
                    ctx.lineWidth = 0.3;
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
                    ctx.stroke();

                    let innerRX = radiusX - halfThickness;
                    let innerRY = radiusY - halfThickness;
                    ctx.beginPath();
                    ctx.ellipse(px, py, innerRX, innerRY, 0, 0, 2 * Math.PI);
                    ctx.lineWidth = 0.3;
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
                    ctx.stroke();

                    ctx.globalAlpha = 1.0;
                }
            }
        }
    }

    if (currentNode !== rootNode && currentNode.x !== null && currentNode.y !== null) {
        const px = MARGIN_X + (currentNode.x * CELL_WIDTH);
        const py = MARGIN_Y + (currentNode.y * CELL_HEIGHT);

        let actualLineWidth = THEME.markerCurrentLineWidth;
        const radiusX = CELL_WIDTH * 0.495;
        const radiusY = CELL_HEIGHT * 0.495;

        if (appSettings.optCurrentMove && actualLineWidth > 0 && radiusX > 0 && radiusY > 0) {
            ctx.beginPath();
            ctx.ellipse(px, py, radiusX, radiusY, 0, 0, 2 * Math.PI);
            ctx.lineWidth = actualLineWidth;
            ctx.strokeStyle = currentNode.color === 'black' ? THEME.markerCurrentBlackColor : THEME.markerCurrentWhiteColor;

            ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
            ctx.shadowBlur = 3;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;

            ctx.stroke();

            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
        }

        let scoreStr = null;

        // Calculate the relative score shift from the parent state (only if parent has sufficient visits)
        if (currentNode.parent && (currentNode.parent.visits >= 25 || isAnalysisPaused) && currentNode.parent.kataMoveInfos && currentNode.parent.kataMoveInfos.length > 0) {
            let pMoves = [...currentNode.parent.kataMoveInfos];
            let parentWasBlackToPlay = currentNode.parent.color === 'white' || currentNode.parent === rootNode;

            let absoluteBestMove = pMoves.reduce((best, current) => {
                let isBetter = false;
                if (parentWasBlackToPlay) {
                    if (current.winrate > best.winrate) isBetter = true;
                    else if (current.winrate === best.winrate && current.scoreLead > best.scoreLead) isBetter = true;
                } else {
                    if (current.winrate < best.winrate) isBetter = true;
                    else if (current.winrate === best.winrate && current.scoreLead < best.scoreLead) isBetter = true;
                }
                return isBetter ? current : best;
            });

            let bestScoreLead = absoluteBestMove.scoreLead;
            let playedMoveInfo = pMoves.find(m => m.move === currentNode.gtpCoord);

            if (playedMoveInfo) {
                let loss = 0;
                if (parentWasBlackToPlay) {
                    loss = bestScoreLead - playedMoveInfo.scoreLead;
                } else {
                    loss = playedMoveInfo.scoreLead - bestScoreLead;
                }

                if (loss < 0) loss = 0;
                scoreStr = loss <= 0.05 ? "0.0" : "-" + loss.toFixed(1);
            }
        }

        if (scoreStr === null && currentNode.scoreLead !== null && currentNode.parent && currentNode.parent.scoreLead !== null) {
            let delta = 0;

            if (currentNode.color === 'black') {
                delta = currentNode.scoreLead - currentNode.parent.scoreLead;
            } else {
                delta = currentNode.parent.scoreLead - currentNode.scoreLead;
            }

            if (Math.abs(delta) < 0.05) delta = 0.0;
            scoreStr = (delta > 0 ? "+" : "") + delta.toFixed(1);
        }

        // Hide the score on the current stone until it has received a proper 25-visit sweep
        if (scoreStr !== null && showKataBubbles && (currentNode.visits >= 25 || isAnalysisPaused)) {
            currentStoneHasScoreText = true;

            let key = `${currentNode.x},${currentNode.y}`;
            let hasPermanentSymbol = currentNode.markup.has(key);
            let isHoveringSymbol = hoverPos && hoverPos.x === currentNode.x && hoverPos.y === currentNode.y && currentMode.startsWith('mark_');

            let textAlpha = (hasPermanentSymbol || isHoveringSymbol) ? 0.5 : 1.0;

            textDrawQueue.push({
                text: scoreStr,
                x: px,
                y: py + 1,
                alpha: textAlpha,
                fillStyle: currentNode.color === 'white' ? THEME.markerTextWhite : THEME.markerTextBlack,
                font: `bold ${Math.max(10, CELL_WIDTH * 0.38)}px sans-serif`,
                shadowColor: currentNode.color === 'black' ? 'rgba(0, 0, 0, 1.0)' : 'transparent',
                shadowBlur: currentNode.color === 'black' ? 4 : 0
            });
        }
    }
    ctx.restore();
}

function drawMarkup() {
    for (let [coord, mark] of currentNode.markup.entries()) {
        let [x, y] = coord.split(',').map(Number);
        drawMarkerSymbol(x, y, boardState[x][y], mark.type, mark.label, false);
    }
}

function drawGhostStoneOrMarkup() {
    if (!hoverPos) return;

    if (['black', 'white', 'alternate'].includes(currentMode)) {
        if (!boardState[hoverPos.x][hoverPos.y]) {
            let ghostColor = getNextColorToPlay();
            drawSingleStone(hoverPos.x, hoverPos.y, ghostColor, 0.4);
        }
    }
    else if (currentMode.startsWith('mark_')) {
        let type = currentMode.split('_')[1];
        let label = '';

        if (type === 'num') {
            type = 'label';
            label = getNextNumber().toString();
        } else if (type === 'alpha') {
            type = 'label';
            let isUpper = letterCase === 'upper';
            let alphaIndex = getNextAlpha(isUpper);
            label = String.fromCharCode((isUpper ? 65 : 97) + (alphaIndex % 26));
        }

        let isGroup = isShiftDown;
        let targets = [];
        if (isGroup && boardState[hoverPos.x][hoverPos.y]) {
            let groupInfo = getGroupAndLiberties(hoverPos.x, hoverPos.y, boardState);
            if (groupInfo) targets = groupInfo.stones;
        } else {
            targets = [{x: hoverPos.x, y: hoverPos.y}];
        }

        targets.forEach(t => {
            drawMarkerSymbol(t.x, t.y, boardState[t.x][t.y], type, label, true);
        });
    }
    else if (currentMode === 'erase') {
        drawMarkerSymbol(hoverPos.x, hoverPos.y, boardState[hoverPos.x][hoverPos.y], 'erase_ghost', '', true);
    }
}

function drawSingleStone(x, y, color, opacity) {
    if (!stoneCache.black || stoneCache.cellWidth !== CELL_WIDTH) {
        buildStoneCache();
    }

    const px = MARGIN_X + (x * CELL_WIDTH);
    const py = MARGIN_Y + (y * CELL_HEIGHT);

    ctx.globalAlpha = opacity;

    let cachedImg = null;
    if (color === 'black') {
        cachedImg = stoneCache.black;
    } else {
        const skinIndex = (x * 31 + y * 17) % 3;
        cachedImg = stoneCache.white[skinIndex];
    }

    if (cachedImg) {
        ctx.drawImage(cachedImg, px - (cachedImg.width / 2), py - (cachedImg.height / 2));
    }

    ctx.globalAlpha = 1.0;
}

function drawMarkerSymbol(x, y, stoneColor, markType, labelText, isGhost) {
    const pixelX = MARGIN_X + (x * CELL_WIDTH);
    const pixelY = MARGIN_Y + (y * CELL_HEIGHT);

    ctx.save();

    let drawColor;
    if (isGhost) {
        drawColor = stoneColor ? (stoneColor === 'black' ? THEME.markupBlackStone : THEME.markupWhiteStone) : THEME.markupGhostActive;
        ctx.globalAlpha = THEME.markupGhostAlpha;
    } else {
        drawColor = stoneColor ? (stoneColor === 'black' ? THEME.markupBlackStone : THEME.markupWhiteStone) : THEME.gridLineColor;
        ctx.globalAlpha = 1.0;
    }

    ctx.strokeStyle = drawColor;
    ctx.fillStyle = drawColor;
    ctx.lineWidth = THEME.markupLineWidth;

    let sx = CELL_WIDTH * 0.25;
    let sy = CELL_HEIGHT * 0.25;

    let isText = (markType === 'label');
    let finalLabel = labelText;

    if (isText) {
        ctx.font = `bold ${Math.max(10, CELL_WIDTH * 0.45)}px sans-serif`;
    }

    let hasBubble = activeBubbles.has(`${x},${y}`);
    let hasScoreTextOnStone = (currentNode && x === currentNode.x && y === currentNode.y && currentStoneHasScoreText);

    // Hollows out the board intersection visually so text/symbols are readable over the grid
    if (!stoneColor && !hasBubble) {
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(pixelX, pixelY, CELL_WIDTH * 0.35, CELL_HEIGHT * 0.35, 0, 0, 2 * Math.PI);
        ctx.clip();

        if (textures.board.complete && textures.board.naturalWidth > 0) {
            ctx.drawImage(textures.board, 0, 0, boardWidth, boardHeight);
        } else {
            ctx.fillStyle = THEME.boardColorFallback;
            ctx.fill();
        }
        ctx.restore();
    }

    ctx.beginPath();
    let isShape = true;

    if (markType === 'tri') {
        const shiftY = sy * 0.2;
        ctx.moveTo(pixelX, pixelY - sy + shiftY);
        ctx.lineTo(pixelX + sx * 0.866, pixelY + sy * 0.5 + shiftY);
        ctx.lineTo(pixelX - sx * 0.866, pixelY + sy * 0.5 + shiftY);
        ctx.closePath();
    } else if (markType === 'sq') {
        ctx.rect(pixelX - sx * 0.8, pixelY - sy * 0.8, sx * 1.6, sy * 1.6);
    } else if (markType === 'o') {
        ctx.ellipse(pixelX, pixelY, sx, sy, 0, 0, 2 * Math.PI);
    } else if (markType === 'x') {
        ctx.moveTo(pixelX - sx, pixelY - sy);
        ctx.lineTo(pixelX + sx, pixelY + sy);
        ctx.moveTo(pixelX + sx, pixelY - sy);
        ctx.lineTo(pixelX - sx, pixelY + sy);
    } else {
        isShape = false;
    }

    if (isShape) {
        // High contrast backing outline if drawn over KataBubbles
        if (hasBubble || (stoneColor === 'white' && hasScoreTextOnStone)) {
            ctx.lineWidth = THEME.markupLineWidth + 1.5;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
            ctx.stroke();

            ctx.lineWidth = THEME.markupLineWidth;
            ctx.strokeStyle = drawColor;
        } else if (stoneColor === 'black' && hasScoreTextOnStone) {
            ctx.lineWidth = THEME.markupLineWidth + 1.5;
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
            ctx.stroke();

            ctx.lineWidth = THEME.markupLineWidth;
            ctx.strokeStyle = drawColor;
        }
        ctx.stroke();
    } else if (markType === 'label' || markType === 'erase_ghost') {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (isGhost) {
            ctx.globalAlpha = 1.0;

            ctx.beginPath();
            ctx.ellipse(pixelX, pixelY, CELL_WIDTH * 0.40, CELL_HEIGHT * 0.40, 0, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.fill();

            if (markType === 'label') {
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = 'rgba(255, 255, 255, 1.0)';
                ctx.strokeText(finalLabel, pixelX, pixelY + 1);

                ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
                ctx.fillText(finalLabel, pixelX, pixelY + 1);
            }
        } else {
            // Frosted glass backing for markup drawn over White stones displaying score
            if (stoneColor === 'white' && hasScoreTextOnStone) {
                ctx.beginPath();
                ctx.ellipse(pixelX, pixelY, CELL_WIDTH * 0.40, CELL_HEIGHT * 0.40, 0, 0, 2 * Math.PI);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.fill();
            }

            if (hasBubble || (stoneColor === 'white' && hasScoreTextOnStone)) {
                ctx.lineWidth = 2;
                ctx.strokeStyle = 'rgba(255, 255, 255, 1)';
                ctx.strokeText(finalLabel, pixelX, pixelY + 1);
            } else if (stoneColor === 'black' && hasScoreTextOnStone) {
                ctx.lineWidth = 2;
                ctx.strokeStyle = 'rgba(0, 0, 0, 1)';
                ctx.strokeText(finalLabel, pixelX, pixelY + 1);
            }

            ctx.fillStyle = drawColor;
            ctx.fillText(finalLabel, pixelX, pixelY + 1);
        }
    }

    ctx.restore();
}

function isLineEnded() {
    if (!currentNode) return false;
    if (currentNode.gtpCoord === 'resign') return true;
    if (currentNode.gtpCoord === 'pass' && currentNode.parent && currentNode.parent.gtpCoord === 'pass') return true;
    return false;
}

let passPopoverTimeout = null;
function showPassPopover() {
    const popover = document.getElementById('pass-popover');
    if (!popover) return;
    popover.classList.add('active');

    if (passPopoverTimeout) clearTimeout(passPopoverTimeout);
    passPopoverTimeout = setTimeout(() => {
        popover.classList.remove('active');
    }, 2000);
}

function getNextColorToPlay() {
    if (currentMode === 'black') return 'black';
    if (currentMode === 'white') return 'white';
    return nextAlternatingColor;
}

// ============================================================================
// 10. MOUSE & KEYBOARD INTERACTION LOGIC
// ============================================================================

// Prevent Focus Stealing: Blurs any clicked button immediately so the Spacebar
// hotkey doesn't accidentally trigger the button again.
document.addEventListener('mouseup', (e) => {
    let clickedButton = e.target.closest('button');
    if (clickedButton) {
        clickedButton.blur();
    }
});

let lastHoverKey = null;
let isErasing = false;

// Global Shift Tracker: Used to dynamically switch single-stone placement
// into group-selection mode for markup tools.
let isShiftDown = false;

document.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') {
        if (!isShiftDown) { isShiftDown = true; render(); }
    }
});

document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
        isShiftDown = false;
        render();
    }
});

// Drag-Eraser Logic
canvas.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    if (currentMode === 'erase' && hoverPos) {
        isErasing = true;
        let key = `${hoverPos.x},${hoverPos.y}`;
        if (currentNode.markup.has(key)) {
            currentNode.markup.delete(key);
            render();
        }
    }
});

document.addEventListener('mouseup', () => {
    isErasing = false;
});

canvas.addEventListener('mousemove', (event) => {
    if (isShiftDown !== event.shiftKey) { isShiftDown = event.shiftKey; render(); }
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const gridX = Math.round((mouseX - MARGIN_X) / CELL_WIDTH);
    const gridY = Math.round((mouseY - MARGIN_Y) / CELL_HEIGHT);

    if (gridX >= 0 && gridX < BOARD_SIZE && gridY >= 0 && gridY < BOARD_SIZE) {
        const currentKey = `${gridX},${gridY}`;
        if (currentKey !== lastHoverKey) {
            hoverPos = { x: gridX, y: gridY };
            lastHoverKey = currentKey;

            // Handle continuous drag-erasing
            if (isErasing && currentMode === 'erase') {
                if (currentNode.markup.has(currentKey)) {
                    currentNode.markup.delete(currentKey);
                }
            }
            render();
        }
    } else if (hoverPos !== null) {
        hoverPos = null;
        lastHoverKey = null;
        render();
    }
});

canvas.addEventListener('mouseleave', () => {
    hoverPos = null;
    lastHoverKey = null;
    render();
});

// Main Board Click Handler
canvas.addEventListener('click', (event) => {
    if (!hoverPos || isLineEnded()) return;

    // Handle Stone Placement
    if (['black', 'white', 'alternate'].includes(currentMode)) {
        if (boardState[hoverPos.x][hoverPos.y]) return;

        const color = getNextColorToPlay();
        let testBoard = boardState.map(row => [...row]);
        const captures = applyMove(testBoard, hoverPos.x, hoverPos.y, color);

        if (captures === -1) return;

        const newBoardHash = hashBoard(testBoard);
        if (currentNode && currentNode.parent && currentNode.parent.boardHash === newBoardHash) return;

        let existingChild = currentNode.children.find(c => c.x === hoverPos.x && c.y === hoverPos.y && c.color === color);

        if (existingChild) {
            currentNode = existingChild;
        } else {
            let capB = color === 'black' ? Math.max(0, captures) : 0;
            let capW = color === 'white' ? Math.max(0, captures) : 0;
            let newNode = new GameNode(hoverPos.x, hoverPos.y, color, currentNode, testBoard, capB, capW);
            currentNode.children.push(newNode);
            currentNode = newNode;
        }

        syncAndRender();
    }
    // Handle Tool Markup Placement
    else if (currentMode.startsWith('mark_')) {
        let isGroup = event.shiftKey;
        let typeKey = currentMode.split('_')[1];

        let targets = [];
        if (isGroup && boardState[hoverPos.x][hoverPos.y]) {
            let groupInfo = getGroupAndLiberties(hoverPos.x, hoverPos.y, boardState);
            if (groupInfo) targets = groupInfo.stones;
        } else {
            targets = [{x: hoverPos.x, y: hoverPos.y}];
        }

        let clickedKey = `${hoverPos.x},${hoverPos.y}`;
        let existingMarkOnClicked = currentNode.markup.get(clickedKey);

        let newType = typeKey;
        let newLabel = '';

        if (newType === 'num') {
            newType = 'label';
            newLabel = getNextNumber().toString();
        } else if (newType === 'alpha') {
            newType = 'label';
            let isUpper = letterCase === 'upper';
            let alphaIndex = getNextAlpha(isUpper);
            newLabel = String.fromCharCode((isUpper ? 65 : 97) + (alphaIndex % 26));
        }

        let isErasing = (existingMarkOnClicked && existingMarkOnClicked.type === newType);

        for (let t of targets) {
            let key = `${t.x},${t.y}`;
            if (isErasing) {
                let mark = currentNode.markup.get(key);
                if (mark && mark.type === newType) {
                    currentNode.markup.delete(key);
                }
            } else {
                currentNode.markup.set(key, { type: newType, label: newLabel });
            }
        }

        render();
    }
});


// ============================================================================
// 11. TOOL & UI COMPONENT MANAGEMENT
// ============================================================================
function setTool(toolName) {
    currentMode = toolName;
    document.querySelectorAll('.tool-btn').forEach(btn => {
        if (btn.dataset.tool === toolName) btn.classList.add('active-tool');
        else btn.classList.remove('active-tool');
    });
    render();
}

document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (btn.id === 'btn-clear-markup') {
            showConfirmModal(
                "Clear Markup",
                "Are you sure you want to clear all markup on this move?",
                "Clear Markup",
                btn,
                () => {
                    currentNode.markup.clear();
                    render();
                }
            );
            return;
        }

        if (btn.id === 'btn-toggle-analysis') return;

        const targetBtn = e.target.closest('.tool-btn');
        if (targetBtn && targetBtn.dataset.tool) {
            // Specialized logic for the dual-case Alphabet tool
            if (targetBtn.dataset.tool === 'mark_alpha' && currentMode === 'mark_alpha') {
                letterCase = letterCase === 'lower' ? 'upper' : 'lower';
                targetBtn.classList.toggle('is-upper', letterCase === 'upper');
            }
            setTool(targetBtn.dataset.tool);
        }
    });
});

// Analysis UI Toggles
document.getElementById('toggle-bubbles').addEventListener('click', function() {
    showKataBubbles = !showKataBubbles;
    if (showKataBubbles) {
        this.classList.add('active-action');
    } else {
        this.classList.remove('active-action');
    }
    render();
});

document.getElementById('toggle-score-graph').addEventListener('click', (e) => {
    showScoreGraph = !showScoreGraph;
    e.target.classList.toggle('active-action', showScoreGraph);
    drawAnalysisChart();
});

document.getElementById('toggle-wr-graph').addEventListener('click', (e) => {
    showWinrateGraph = !showWinrateGraph;
    e.target.classList.toggle('active-action', showWinrateGraph);
    drawAnalysisChart();
});

document.getElementById('btn-toggle-analysis').addEventListener('click', () => {
    isAnalysisPaused = !isAnalysisPaused;
    if (!isAnalysisPaused) {
        requestAnalysis();
    } else if (currentQueryId && window.electronAPI) {
        window.electronAPI.sendAnalysisQuery({ id: "cancel_" + Date.now(), action: "terminate", terminateId: currentQueryId });
    }
    updateAnalysisUI();
    render();
    drawAnalysisChart();
});

function drawAnalysisChart() {
    const chartCont = document.getElementById('analysis-chart-container');
    const chartCanvas = document.getElementById('analysis-chart');
    const path = getFullLinePath();

    chartCont.style.display = 'block';

    const rect = chartCanvas.getBoundingClientRect();
    const logicalW = rect.width || 380;
    const logicalH = rect.height || 85;

    const dpr = window.devicePixelRatio || 1;
    chartCanvas.width = logicalW * dpr;
    chartCanvas.height = logicalH * dpr;

    const chartCtx = chartCanvas.getContext('2d');
    chartCtx.scale(dpr, dpr);
    chartCtx.clearRect(0, 0, logicalW, logicalH);

    const padL = 0;
    const padR = 0;
    const padT = 3;
    const padB = 5;
    const chartW = logicalW - padL - padR;
    const chartH = logicalH - padT - padB;
    const centerY = padT + (chartH / 2);

    let maxAbsScore = 5;
    for (let i = 0; i < path.length; i++) {
        if (path[i].scoreLead !== null) {
            let absScore = Math.abs(path[i].scoreLead);
            if (absScore > maxAbsScore) maxAbsScore = absScore;
        }
    }
    maxAbsScore = Math.ceil(maxAbsScore / 5) * 5;

    const stepX = chartW / Math.max(1, path.length - 1);

    // Score Graph Layer
    if (showScoreGraph) {
        chartCtx.beginPath();
        chartCtx.moveTo(padL, centerY);
        for (let i = 0; i < path.length; i++) {
            let score = path[i].scoreLead || 0;
            score = Math.max(-maxAbsScore, Math.min(maxAbsScore, score));
            let y = centerY - (score / maxAbsScore) * (chartH / 2);
            chartCtx.lineTo(padL + (i * stepX), y);
        }
        chartCtx.lineTo(padL + (path.length - 1) * stepX, centerY);
        chartCtx.closePath();

        let grad = chartCtx.createLinearGradient(0, padT, 0, padT + chartH);
        grad.addColorStop(0, '#241c17');
        grad.addColorStop(0.5, '#241c17');
        grad.addColorStop(0.5, '#e0d5c1');
        grad.addColorStop(1, '#e0d5c1');

        chartCtx.fillStyle = grad;
        chartCtx.fill();

        chartCtx.beginPath();
        chartCtx.moveTo(padL, centerY);
        chartCtx.lineTo(padL + chartW, centerY);
        chartCtx.strokeStyle = THEME.chartCenterLine;
        chartCtx.lineWidth = 1;
        chartCtx.stroke();

        chartCtx.beginPath();
        for (let i = 0; i < path.length; i++) {
            let score = path[i].scoreLead || 0;
            score = Math.max(-maxAbsScore, Math.min(maxAbsScore, score));
            let y = centerY - (score / maxAbsScore) * (chartH / 2);
            if (i === 0) chartCtx.moveTo(padL + i * stepX, y);
            else chartCtx.lineTo(padL + i * stepX, y);
        }
        chartCtx.strokeStyle = THEME.chartScoreLine;
        chartCtx.lineWidth = 1;
        chartCtx.stroke();
    } else {
        chartCtx.beginPath();
        chartCtx.moveTo(padL, centerY);
        chartCtx.lineTo(padL + chartW, centerY);
        chartCtx.strokeStyle = THEME.chartCenterLine;
        chartCtx.lineWidth = 1;
        chartCtx.stroke();
    }

    // Winrate Graph Layer
    if (showWinrateGraph) {
        chartCtx.beginPath();
        for (let i = 0; i < path.length; i++) {
            let wr = path[i].winrate !== null ? path[i].winrate : 0.5;
            let y = padT + chartH - (wr * chartH);
            if (i === 0) chartCtx.moveTo(padL + i * stepX, y);
            else chartCtx.lineTo(padL + i * stepX, y);
        }
        chartCtx.strokeStyle = THEME.chartWinrateLine;
        chartCtx.lineWidth = 1.2;
        chartCtx.stroke();
    }

    // Current Move Indicator Tracker
    let currentIndex = path.indexOf(currentNode);
    if (currentIndex !== -1) {
        let x = padL + (currentIndex * stepX);

        if (currentIndex === path.length - 1) {
            x -= 1;
        }

        chartCtx.beginPath();
        chartCtx.moveTo(x, padT);
        chartCtx.lineTo(x, padT + chartH);
        chartCtx.strokeStyle = THEME.chartCurrentMoveLine;
        chartCtx.lineWidth = 1.5;
        chartCtx.setLineDash([3, 3]);
        chartCtx.stroke();
        chartCtx.setLineDash([]);
    }

    // Y-Axis Annotations
    chartCtx.fillStyle = '#bdaea6';
    chartCtx.font = 'bold 9px sans-serif';
    chartCtx.textAlign = 'left';

    chartCtx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    chartCtx.shadowBlur = 3;
    chartCtx.shadowOffsetX = 1;
    chartCtx.shadowOffsetY = 1;

    chartCtx.textBaseline = 'top';
    chartCtx.fillText(`+${maxAbsScore}`, padL + 4, padT + 2);

    chartCtx.textBaseline = 'bottom';
    chartCtx.fillText(`-${maxAbsScore}`, padL + 4, padT + chartH - 2);

    chartCtx.shadowColor = 'transparent';
    chartCtx.shadowBlur = 0;
    chartCtx.shadowOffsetX = 0;
    chartCtx.shadowOffsetY = 0;
}

function updateAnalysisUI() {
    const box = document.getElementById('analysis-box');
    const statusTextEl = document.getElementById('analysis-status');
    const chartCont = document.getElementById('analysis-chart-container');
    const wrContainer = document.getElementById('winrate-bar-container');
    const wrBlack = document.getElementById('winrate-bar-black');
    const wrWhite = document.getElementById('winrate-bar-white');
    const pwrBtn = document.getElementById('btn-toggle-analysis');
    const missingBanner = document.getElementById('engine-missing-banner');

    if (!box || !statusTextEl || !chartCont || !wrContainer) return;

    // --- NEW: Engine Missing State Override ---
    if (isEngineMissing) {
        box.classList.add('active');
        statusTextEl.innerText = 'Engine Offline';
        missingBanner.style.display = 'flex';
        wrContainer.style.display = 'none';
        chartCont.style.display = 'none';
        pwrBtn.disabled = true;
        pwrBtn.style.opacity = '0.5';
        return;
    } else {
        if (missingBanner) missingBanner.style.display = 'none';
        wrContainer.style.display = 'flex';
        pwrBtn.disabled = false;
        pwrBtn.style.opacity = '1';
    }

    let statusText = '';

    const setEmptyWinrate = () => {
        wrBlack.style.width = '50%';
        wrWhite.style.width = '50%';
        wrBlack.innerText = '';
        wrWhite.innerText = '';
    };

    if (isAnalysisPaused) {
        box.classList.remove('active');
        statusText = 'Analysis Paused';

        pwrBtn.style.color = '';
        pwrBtn.style.borderColor = '';
        pwrBtn.classList.remove('active-tool');

        pwrBtn.innerHTML = `<svg viewBox="0 0 24 24" style="width: 12px; height: 12px; fill: currentColor; margin-left: 2px;"><polygon points="6,4 20,12 6,20"></polygon></svg>`;
        pwrBtn.title = 'Resume Analysis (Space)';

        setEmptyWinrate();
    } else {
        box.classList.add('active');

        pwrBtn.style.color = '';
        pwrBtn.style.borderColor = '';
        pwrBtn.classList.add('active-tool');

        pwrBtn.innerHTML = `<svg viewBox="0 0 24 24" style="width: 12px; height: 12px; fill: currentColor;"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
        pwrBtn.title = 'Pause Analysis (Space)';

        // Provide the user with feedback on what depth KataGo is currently sweeping
        if (!isNodeOnMainLine(currentNode)) {
            statusText = 'Deep pondering move (1000 visits)...';
        } else if (currentAnalysisPhase === 1) {
            statusText = 'Initializing...';
        } else if (currentAnalysisPhase === 1.5) {
            statusText = 'Evaluating branch (1 visit)...';
        } else if (currentAnalysisPhase === 2) {
            statusText = 'Main line: Fast sweep (25 visits)...';
        } else if (currentAnalysisPhase === 3) {
            statusText = 'Main line: Refining graph (50 visits)...';
        } else {
            statusText = 'Deep pondering move (1000 visits)...';
        }

        if (currentNode.winrate !== null) {
            let wr = currentNode.winrate;
            let score = currentNode.scoreLead;

            let bWrStr = (wr * 100).toFixed(1) + '%';
            let wWrStr = ((1 - wr) * 100).toFixed(1) + '%';

            let bScoreStr = score > 0 ? `+${score.toFixed(1)}` : score.toFixed(1);
            let wScoreStr = score < 0 ? `+${Math.abs(score).toFixed(1)}` : `-${score.toFixed(1)}`;

            wrBlack.style.width = `${wr * 100}%`;
            wrWhite.style.width = `${(1 - wr) * 100}%`;

            if (wr >= 0.5) {
                wrBlack.innerText = `${bWrStr} (${bScoreStr})`;
                wrWhite.innerText = '';
            } else {
                wrBlack.innerText = '';
                wrWhite.innerText = `${wWrStr} (${wScoreStr})`;
            }
        } else {
            setEmptyWinrate();
        }
    }

    statusTextEl.innerText = statusText;
    chartCont.style.display = 'block';
    drawAnalysisChart();
}

// Chart Interaction
document.getElementById('analysis-chart').addEventListener('click', (e) => {
    const path = getFullLinePath();
    if (path.length < 2) return;

    const chartCanvas = document.getElementById('analysis-chart');
    const rect = chartCanvas.getBoundingClientRect();

    const padL = 0;
    const padR = 0;
    const chartW = rect.width - padL - padR;

    const x = e.clientX - rect.left - padL;
    const stepX = chartW / Math.max(1, path.length - 1);

    let clickedIndex = Math.round(x / stepX);
    clickedIndex = Math.max(0, Math.min(path.length - 1, clickedIndex));

    currentNode = path[clickedIndex];
    syncAndRender();
});

// Score Estimator Flow
document.getElementById('btn-score').addEventListener('click', () => {
    if (showingScoreEstimate) {
        showingScoreEstimate = false;
        document.getElementById('score-popup').style.display = 'none';
        document.getElementById('btn-score').classList.remove('active-action');
        document.getElementById('btn-score').innerText = "Score";
        render();
        requestAnalysis();
        return;
    }

    // Intercept click if engine is missing
    if (isEngineMissing) {
        document.getElementById('score-popup-text').innerHTML =
            `<div style="color: #ef4444; margin-bottom: 8px;">` +
            `<svg viewBox="0 0 24 24" style="width: 28px; height: 28px; fill: none; stroke: currentColor; stroke-width: 2;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>` +
            `</div>` +
            `<strong style="font-size: 1.05rem; color: var(--text-main);">Engine Required</strong><br><br>` +
            `<span style="color: var(--text-muted); font-size: 0.9rem;">KataGo is required to calculate score estimates.<br>Please configure your engine paths in the Options menu.</span>`;

        document.getElementById('score-popup').style.display = 'block';
        return;
    }

    showingScoreEstimate = true;
    document.getElementById('btn-score').classList.add('active-action');

    // If KataGo has already analyzed this node's ownership, show it instantly
    if (currentNode && currentNode.kataOwnership) {
        document.getElementById('btn-score').innerText = "Score";
        updateScorePopup();
        render();
    } else {
        // Otherwise, wake KataGo up and request an ownership pass
        document.getElementById('btn-score').innerText = "Estimating...";
        if (isAnalysisPaused) {
            isAnalysisPaused = false;
        }
        requestAnalysis();
    }
});

document.getElementById('close-score-popup').addEventListener('click', () => {
    showingScoreEstimate = false;
    document.getElementById('score-popup').style.display = 'none';
    document.getElementById('btn-score').classList.remove('active-action');
    document.getElementById('btn-score').innerText = "Score";
    render();
    requestAnalysis();
});

function updateScorePopup() {
    if (!showingScoreEstimate || !currentNode || !currentNode.kataOwnership) return;

    const popup = document.getElementById('score-popup');
    const ownership = currentNode.kataOwnership;

    let bTerritory = 0;
    let wTerritory = 0;
    let bDead = 0;
    let wDead = 0;

    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            let val = ownership[y * BOARD_SIZE + x];
            let stone = boardState[x][y];

            if (val > 0.5) {
                if (!stone) bTerritory++;
                else if (stone === 'white') { bTerritory++; wDead++; }
            } else if (val < -0.5) {
                if (!stone) wTerritory++;
                else if (stone === 'black') { wTerritory++; bDead++; }
            }
        }
    }

    let totalBlack = bTerritory + currentNode.capturesBlack + wDead;
    let totalWhite = wTerritory + currentNode.capturesWhite + bDead + currentKomi;

    let actualLead = (totalBlack - totalWhite);
    let text = actualLead > 0 ? `Black leads by ${actualLead.toFixed(1)} points` : `White leads by ${Math.abs(actualLead).toFixed(1)} points`;

    document.getElementById('score-popup-text').innerHTML =
        `<strong style="font-size: 1.1rem; color: var(--accent);">${text}</strong><br><br>` +
        `<div style="display: flex; justify-content: space-between; text-align: left; margin-bottom: 10px; border-top: 1px solid var(--border-color); border-bottom: 1px solid var(--border-color); padding: 10px 0;">` +
        `<div style="flex: 1;"><strong>Black</strong><br>Territory: ${bTerritory}<br>Captures: ${currentNode.capturesBlack}<br>Dead W Stones: ${wDead}<br><br><strong>Total: ${totalBlack}</strong></div>` +
        `<div style="flex: 1; border-left: 1px solid var(--border-color); padding-left: 10px;"><strong>White</strong><br>Territory: ${wTerritory}<br>Captures: ${currentNode.capturesWhite}<br>Dead B Stones: ${bDead}<br>Komi: ${currentKomi}<br><strong>Total: ${totalWhite}</strong></div>` +
        `</div>`;

    popup.style.display = 'block';
}

// ============================================================================
// 12. HOTKEY MANAGEMENT
// ============================================================================
document.addEventListener('keydown', (e) => {
    // Prevent hotkeys from firing while the user is typing in text boxes
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

    const key = e.key.toLowerCase();
    const shift = e.shiftKey;
    const ctrl = e.ctrlKey || e.metaKey;

    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'pageup', 'pagedown', 'home', 'end'].includes(key)) {
        e.preventDefault();
    }

    // Spacebar: Toggle Analysis
    if (key === ' ' && !shift) {
        e.preventDefault();
        isAnalysisPaused = !isAnalysisPaused;

        if (!isAnalysisPaused) {
            requestAnalysis();
        } else {
            if (currentQueryId && window.electronAPI) {
                window.electronAPI.sendAnalysisQuery({
                    id: "cancel_" + Date.now(),
                    action: "terminate",
                    terminateId: currentQueryId
                });
            }
        }

        updateAnalysisUI();
        render();
        drawAnalysisChart();
        return;
    }

    // Tool Hotkeys
    if (key === '1') setTool('black');
    if (key === '2') setTool('white');
    if (key === '3') setTool('alternate');
    if (key === 'q') setTool('mark_tri');
    if (key === 'w') setTool('mark_sq');
    if (key === 'e') setTool('mark_o');
    if (key === 'r') setTool('mark_x');

    if (key === 'a') {
        if (currentMode === 'mark_alpha') {
            letterCase = letterCase === 'lower' ? 'upper' : 'lower';
            document.getElementById('btn-alpha').classList.toggle('is-upper', letterCase === 'upper');
        }
        setTool('mark_alpha');
    }

    if (key === 's') setTool('mark_num');
    if (key === 'z' && !ctrl) setTool('erase');

    if (key === 'c' && !ctrl && !shift) {
        document.getElementById('btn-score').click();
    }

    // File Operation Hotkeys
    if (ctrl) {
        if (key === 'n') {
            e.preventDefault();
            document.getElementById('btn-new').click();
        }
        if (key === 'o') {
            e.preventDefault();
            document.getElementById('btn-open').click();
        }
        if (key === 's') {
            e.preventDefault();
            if (shift) {
                document.getElementById('btn-save-as').click();
            } else {
                document.getElementById('btn-save').click();
            }
        }
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (currentNode !== rootNode && !optionsOverlay.classList.contains('active')) {
            let fakeAnchor = null;

            // 1. Get the node's exact pixel position from the tree layout
            const pos = treeLayout.get(currentNode);
            const container = document.getElementById('tree-container');

            if (pos && container) {
                const treeX = pos.col * TREE_CELL_SIZE + (TREE_CELL_SIZE / 2);
                const treeY = pos.row * TREE_CELL_SIZE + (TREE_CELL_SIZE / 2) + TREE_PADDING_TOP;

                // 2. Adjust for container scrolling to get the absolute screen coordinates
                const rect = container.getBoundingClientRect();
                const screenX = rect.left + treeX - container.scrollLeft;
                const screenY = rect.top + treeY - container.scrollTop;

                // 3. Create a fake DOM element so showConfirmModal can measure its bounding box
                fakeAnchor = {
                    getBoundingClientRect: () => ({
                        top: screenY - TREE_RADIUS,
                        left: screenX - TREE_RADIUS,
                        bottom: screenY + TREE_RADIUS,
                        right: screenX + TREE_RADIUS,
                        width: TREE_RADIUS * 2,
                        height: TREE_RADIUS * 2
                    })
                };
            }

            showConfirmModal(
                "Delete Node",
                "Permanently remove this move and all its variations?",
                "Delete",
                fakeAnchor, // It will now perfectly anchor above the hovered tree node
                () => deleteNode(currentNode)
            );
        }
        return;
    }

    if (ctrl && key === 'z') {
        performUndo();
    }

    // Tree Navigation Hotkeys
    if (key === 'arrowleft') {
        if (ctrl) {
            currentNode = rootNode;
            syncAndRender();
        } else if (shift) {
            traverseBack(15);
        } else {
            traverseBack(1);
        }
    }

    if (key === 'arrowright') {
        if (ctrl) {
            while(currentNode.children.length > 0) currentNode = currentNode.children[0];
            syncAndRender();
        } else if (shift) {
            traverseForward(15);
        } else {
            traverseForward(1);
        }
    }

    if (key === 'pageup') traverseBack(15);
    if (key === 'pagedown') traverseForward(15);

    if (key === 'home') {
        currentNode = rootNode;
        syncAndRender();
    }

    if (key === 'end') {
        while(currentNode.children.length > 0) currentNode = currentNode.children[0];
        syncAndRender();
    }

    if (key === 'arrowup' || key === 'arrowdown') {
        if (key === 'arrowup' && shift) {
            // Warp back up to the primary branch intersection
            let temp = currentNode;
            while (temp && temp.parent) {
                if (temp.parent.children[0] !== temp) {
                    currentNode = temp.parent.children[0];
                    syncAndRender();
                    break;
                }
                temp = temp.parent;
            }
        } else if (currentNode.parent && currentNode.parent.children.length > 1) {
            // Cycle through alternative realities/variations
            const siblings = currentNode.parent.children;
            const currentIndex = siblings.indexOf(currentNode);

            if (key === 'arrowup' && currentIndex > 0) {
                currentNode = siblings[currentIndex - 1];
                syncAndRender();
            } else if (key === 'arrowdown' && currentIndex < siblings.length - 1) {
                currentNode = siblings[currentIndex + 1];
                syncAndRender();
            }
        }
    }
});

// ============================================================================
// 13. MENUS, MODALS, & POPOVERS
// ============================================================================
const contextMenu = document.getElementById('context-menu');
const infoPopover = document.getElementById('info-popover');
const infoIcon = document.getElementById('open-info-modal');
const commentsPopover = document.getElementById('comments-info-popover');
const commentsIcon = document.getElementById('open-comments-info');
let nodeTargetedByContext = null;

// Ensures the result tag in the UI reflects a resignation if it exists on the main line
function updateResultFromMainLine() {
    let temp = rootNode;

    while (temp.children.length > 0) {
        temp = temp.children[0];
    }

    const resultInput = document.getElementById('result-input');
    const revealBtn = document.getElementById('reveal-result-btn');
    if (!resultInput || !revealBtn) return;

    if (temp.gtpCoord === 'resign') {
        const winner = temp.color === 'black' ? 'W' : 'B';
        resultInput.value = `${winner}+Resign`;
        revealBtn.style.display = 'block';
    } else {
        // Restores the original SGF file result if the resignation node is deleted
        resultInput.value = originalGameResult;

        if (originalGameResult !== "") {
            revealBtn.style.display = 'block';
        } else {
            revealBtn.style.display = 'none';
        }
    }
}

const resultInput = document.getElementById('result-input');
const revealBtn = document.getElementById('reveal-result-btn');

if (revealBtn && resultInput) {
    revealBtn.addEventListener('click', () => {
        if (resultInput.value !== "") revealBtn.style.display = 'none';
    });

    resultInput.addEventListener('click', () => {
        if (resultInput.value !== "") revealBtn.style.display = 'block';
    });
}

// Global click-away listener to close popups
document.addEventListener('click', (e) => {
    contextMenu.style.display = 'none';

    if (infoPopover.style.display === 'block' && !infoPopover.contains(e.target) && e.target !== infoIcon) {
        infoPopover.style.display = 'none';
    }

    if (commentsPopover.style.display === 'block' && !commentsPopover.contains(e.target) && e.target !== commentsIcon) {
        commentsPopover.style.display = 'none';
    }

    const confirmOverlay = document.getElementById('confirm-modal-overlay');
    const modalBox = document.querySelector('.modal-box');
    if (confirmOverlay.classList.contains('active')) {
        if (!modalBox.contains(e.target) && !e.target.closest('#btn-clear-markup')) {
            closeConfirmModal();
        }
    }
});

infoIcon.addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = infoIcon.getBoundingClientRect();

    infoPopover.style.position = 'fixed';
    infoPopover.style.bottom = 'auto';
    infoPopover.style.top = `${rect.bottom + 10}px`;
    infoPopover.style.left = 'auto';
    infoPopover.style.right = `${window.innerWidth - rect.right}px`;

    infoPopover.style.display = infoPopover.style.display === 'block' ? 'none' : 'block';
    commentsPopover.style.display = 'none';
});

commentsIcon.addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = commentsIcon.getBoundingClientRect();

    commentsPopover.style.position = 'fixed';
    commentsPopover.style.top = 'auto';
    commentsPopover.style.bottom = `${window.innerHeight - rect.top + 10}px`;
    commentsPopover.style.left = 'auto';
    commentsPopover.style.right = `${window.innerWidth - rect.right}px`;

    commentsPopover.style.display = commentsPopover.style.display === 'block' ? 'none' : 'block';
    infoPopover.style.display = 'none';
});

treeCanvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const rect = treeCanvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    nodeTargetedByContext = null;

    for (let [node, pos] of treeLayout.entries()) {
        if (node === rootNode) continue;
        let x = pos.col * TREE_CELL_SIZE + (TREE_CELL_SIZE / 2);
        let y = pos.row * TREE_CELL_SIZE + (TREE_CELL_SIZE / 2) + TREE_PADDING_TOP;
        let dist = Math.sqrt(Math.pow(mouseX - x, 2) + Math.pow(mouseY - y, 2));

        if (dist <= TREE_RADIUS + 4) {
            nodeTargetedByContext = node;
            break;
        }
    }

    if (nodeTargetedByContext) {
        contextMenu.style.display = 'block';

        let menuWidth = contextMenu.offsetWidth;
        let menuHeight = contextMenu.offsetHeight;
        let posX = event.pageX;
        let posY = event.pageY;

        // Prevent the menu from bleeding off-screen
        if (posX + menuWidth > window.innerWidth) posX = event.pageX - menuWidth;
        if (posY + menuHeight > window.innerHeight) posY = window.innerHeight - menuHeight;

        contextMenu.style.left = `${posX}px`;
        contextMenu.style.top = `${posY}px`;
    }
});

document.getElementById('ctx-delete').addEventListener('click', () => { if (nodeTargetedByContext) deleteNode(nodeTargetedByContext); });
document.getElementById('ctx-make-main').addEventListener('click', () => {
    if (nodeTargetedByContext && nodeTargetedByContext.parent) {
        let tempNode = nodeTargetedByContext;
        let treeWasChanged = false;

        // Walk up the tree, restructuring the array so this branch is first
        while (tempNode && tempNode.parent) {
            const parent = tempNode.parent;
            const index = parent.children.indexOf(tempNode);

            if (index > 0) {
                parent.children.splice(index, 1);
                parent.children.unshift(tempNode);
                treeWasChanged = true;
            }
            tempNode = parent;
        }

        if (treeWasChanged) {
            updateResultFromMainLine();
            syncAndRender();
        }
    }
});

function deleteNode(targetNode) {
    if (targetNode === rootNode) return;

    const parent = targetNode.parent;
    const index = parent.children.indexOf(targetNode);

    // 1. Save to Undo Stack before splicing out the node
    if (index > -1) {
        undoStack.push({ parent: parent, index: index, node: targetNode });
        if (undoStack.length > 20) undoStack.shift(); // Keep memory clean

        parent.children.splice(index, 1);
    }

    let temp = currentNode;
    let needsFallback = false;
    while(temp !== null) {
        if (temp === targetNode) needsFallback = true;
        temp = temp.parent;
    }

    if (needsFallback) currentNode = parent;
    isFileLinked = false;

    updateResultFromMainLine();
    syncAndRender();
}

function performUndo() {
    if (undoStack.length === 0) return;

    // Pop the last deleted node and splice it back into its exact original spot
    const lastDeleted = undoStack.pop();
    lastDeleted.parent.children.splice(lastDeleted.index, 0, lastDeleted.node);

    currentNode = lastDeleted.node;
    isFileLinked = false;

    updateResultFromMainLine();
    syncAndRender();
}

// Reusable Confirmation Dialog System
let pendingConfirmCallback = null;
const confirmOverlay = document.getElementById('confirm-modal-overlay');
const confirmTitle = document.getElementById('confirm-modal-title');
const confirmMessage = document.getElementById('confirm-modal-message');
const confirmBtnYes = document.getElementById('confirm-modal-yes');
const confirmBtnCancel = document.getElementById('confirm-modal-cancel');
const modalBox = document.querySelector('.modal-box');
const cbContainer = document.getElementById('confirm-modal-checkbox-container');
const cbInput = document.getElementById('confirm-modal-checkbox');

function showConfirmModal(title, message, confirmText, anchorElement, onConfirm, showCheckbox = false, xOffset = null) {
    confirmTitle.innerText = title;
    confirmMessage.innerText = message;
    confirmBtnYes.innerText = confirmText;
    pendingConfirmCallback = onConfirm;

    if (showCheckbox) {
        cbContainer.style.display = 'flex';
        cbInput.checked = false;
    } else {
        cbContainer.style.display = 'none';
    }

    confirmOverlay.classList.add('active');

    // Anchor the dialog to a specific button if provided, otherwise center it
    if (anchorElement) {
        const rect = anchorElement.getBoundingClientRect();
        const boxRect = modalBox.getBoundingClientRect();

        let topPos = rect.top - boxRect.height - 12;
        let leftPos = rect.left + (rect.width / 2) - (boxRect.width / 2);

        if (xOffset !== null) {
            leftPos = rect.left + xOffset;
        }

        if (topPos < 10) topPos = rect.bottom + 12;
        if (leftPos < 10) leftPos = 10;
        if (leftPos + boxRect.width > window.innerWidth) leftPos = window.innerWidth - boxRect.width - 10;

        modalBox.style.top = `${topPos}px`;
        modalBox.style.left = `${leftPos}px`;
    } else {
        modalBox.style.top = `${(window.innerHeight - boxRect.height) / 2}px`;
        modalBox.style.left = `${(window.innerWidth - boxRect.width) / 2}px`;
    }
}

function closeConfirmModal() {
    confirmOverlay.classList.remove('active');
    pendingConfirmCallback = null;
}

confirmBtnCancel.addEventListener('click', closeConfirmModal);

confirmBtnYes.addEventListener('click', () => {
    if (pendingConfirmCallback) pendingConfirmCallback(cbInput.checked);
    closeConfirmModal();
});

// ============================================================================
// 14. SGF PARSING & DATA EXTRACTION
// ============================================================================
const commentBox = document.getElementById('node-comment');
commentBox.addEventListener('input', (e) => {
    currentNode.comment = e.target.value;
});

function parseSGF(sgfText) {
    // SGFs often use newlines for formatting. We only remove carriage returns to preserve them.
    sgfText = sgfText.replace(/\r/g, "");

    let pos = 0;
    let stack = [];

    boardState = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
    nextAlternatingColor = 'black';
    rootNode = new GameNode(null, null, null, null, boardState);
    let currentParent = rootNode;

    // Clear all metadata fields before loading the new game
    document.getElementById('player-b-name').value = "";
    document.getElementById('player-b-rank').value = "";
    document.getElementById('player-w-name').value = "";
    document.getElementById('player-w-rank').value = "";
    document.querySelector('.game-title-input').value = "";
    document.getElementById('info-date').value = "";
    document.getElementById('info-place').value = "";
    document.getElementById('info-event').value = "";
    document.getElementById('info-round').value = "";
    document.getElementById('info-rules').value = "";
    document.getElementById('info-time').value = "";
    document.getElementById('info-overtime').value = "";
    document.getElementById('info-komi').value = "6.5";
    document.getElementById('result-input').value = "";
    document.getElementById('reveal-result-btn').style.display = 'none';
    document.getElementById('info-summary').value = "";
    document.getElementById('info-annotator').value = "";
    document.getElementById('info-copyright').value = "";
    currentRules = 'japanese';
    currentKomi = 6.5;
    originalGameResult = "";
    isFileLinked = false;

    // State Machine Parser
    while (pos < sgfText.length) {
        let char = sgfText[pos];

        if (char === '(') {
            stack.push(currentParent);
            pos++;
        } else if (char === ')') {
            currentParent = stack.pop();
            pos++;
        } else if (char === ';') {
            pos++;
            let nodeProps = {};

            // Extract all properties attached to this node
            while (pos < sgfText.length && sgfText[pos] !== ';' && sgfText[pos] !== '(' && sgfText[pos] !== ')') {
                while (pos < sgfText.length && /\s/.test(sgfText[pos])) pos++;
                if (sgfText[pos] === ';' || sgfText[pos] === '(' || sgfText[pos] === ')') break;

                let keyMatch = sgfText.substring(pos).match(/^[A-Z]+/);
                if (!keyMatch) { pos++; continue; }
                let key = keyMatch[0];
                pos += key.length;

                let values = [];
                while (pos < sgfText.length && /\s/.test(sgfText[pos])) pos++;

                while (pos < sgfText.length && sgfText[pos] === '[') {
                    pos++;
                    let valStart = pos;
                    while (pos < sgfText.length) {
                        if (sgfText[pos] === ']' && sgfText[pos-1] !== '\\') break;
                        pos++;
                    }
                    values.push(sgfText.substring(valStart, pos));
                    pos++;

                    while (pos < sgfText.length && /\s/.test(sgfText[pos])) pos++;
                }
                nodeProps[key] = values;
            }

            if (Object.keys(nodeProps).length > 0) {
                if (nodeProps['PB']) document.getElementById('player-b-name').value = nodeProps['PB'][0];
                if (nodeProps['BR']) document.getElementById('player-b-rank').value = nodeProps['BR'][0];
                if (nodeProps['PW']) document.getElementById('player-w-name').value = nodeProps['PW'][0];
                if (nodeProps['WR']) document.getElementById('player-w-rank').value = nodeProps['WR'][0];
                if (nodeProps['GN']) document.querySelector('.game-title-input').value = nodeProps['GN'][0];

                if (nodeProps['DT']) document.getElementById('info-date').value = nodeProps['DT'][0];
                if (nodeProps['PC']) document.getElementById('info-place').value = nodeProps['PC'][0];
                if (nodeProps['EV']) document.getElementById('info-event').value = nodeProps['EV'][0];
                if (nodeProps['RO']) document.getElementById('info-round').value = nodeProps['RO'][0];

                if (nodeProps['RU']) {
                    document.getElementById('info-rules').value = nodeProps['RU'][0];
                    let ru = nodeProps['RU'][0].toLowerCase();
                    if (ru.includes('chinese')) currentRules = 'chinese';
                    else if (ru.includes('korean')) currentRules = 'korean';
                    else if (ru.includes('aga')) currentRules = 'aga';
                    else currentRules = 'japanese';
                }

                if (nodeProps['TM']) document.getElementById('info-time').value = nodeProps['TM'][0];
                if (nodeProps['OT']) document.getElementById('info-overtime').value = nodeProps['OT'][0];

                if (nodeProps['KM']) {
                    document.getElementById('info-komi').value = nodeProps['KM'][0];
                    let parsedKomi = parseFloat(nodeProps['KM'][0]);

                    if (!isNaN(parsedKomi)) {
                        if (parsedKomi === 3.75 || parsedKomi === 375) parsedKomi = 7.5;
                        else if (parsedKomi === 2.75 || parsedKomi === 275) parsedKomi = 5.5;

                        currentKomi = Math.round(parsedKomi * 2) / 2;
                        currentKomi = Math.max(-150, Math.min(150, currentKomi));
                        document.getElementById('info-komi').value = currentKomi;
                    }
                }

                if (nodeProps['GC']) document.getElementById('info-summary').value = nodeProps['GC'][0].replace(/\\\]/g, ']');
                if (nodeProps['AN']) document.getElementById('info-annotator').value = nodeProps['AN'][0];
                if (nodeProps['CP']) document.getElementById('info-copyright').value = nodeProps['CP'][0];

                if (nodeProps['RE']) {
                    originalGameResult = nodeProps['RE'][0];
                    document.getElementById('result-input').value = nodeProps['RE'][0];
                    document.getElementById('reveal-result-btn').style.display = 'block';
                }
            }

            let isResignNode = nodeProps['N'] && nodeProps['N'][0] === 'Resign';

            if (nodeProps['B'] || nodeProps['W'] || isResignNode) {
                let color = 'black';
                let c = null;

                if (isResignNode) {
                    color = currentParent.color === 'black' ? 'white' : 'black';
                    if (currentParent === rootNode) color = 'black';
                } else {
                    color = nodeProps['B'] ? 'black' : 'white';
                    c = sgfToCoords(nodeProps['B'] ? nodeProps['B'][0] : nodeProps['W'][0]);
                }

                let testBoard = currentParent.stateSnapshot.map(row => [...row]);

                let capturedCount = 0;
                if (!isResignNode) {
                    capturedCount = applyMove(testBoard, c ? c.x : null, c ? c.y : null, color);
                }

                let capB = color === 'black' ? Math.max(0, capturedCount) : 0;
                let capW = color === 'white' ? Math.max(0, capturedCount) : 0;

                let newNode = new GameNode(c ? c.x : null, c ? c.y : null, color, currentParent, testBoard, capB, capW);

                if (isResignNode) {
                    newNode.gtpCoord = 'resign';
                }

                if (nodeProps['C']) newNode.comment = nodeProps['C'][0].replace(/\\\]/g, ']');

                const extractSgfMarkup = (propKey, markType) => {
                    if (nodeProps[propKey]) {
                        nodeProps[propKey].forEach(val => {
                            let mc = sgfToCoords(val);
                            if (mc) newNode.markup.set(`${mc.x},${mc.y}`, { type: markType, label: '' });
                        });
                    }
                };

                extractSgfMarkup('TR', 'tri');
                extractSgfMarkup('SQ', 'sq');
                extractSgfMarkup('CR', 'o');
                extractSgfMarkup('MA', 'x');

                if (nodeProps['LB']) {
                    nodeProps['LB'].forEach(val => {
                        let parts = val.split(':');
                        if (parts.length === 2) {
                            let mc = sgfToCoords(parts[0]);
                            if (mc) newNode.markup.set(`${mc.x},${mc.y}`, { type: 'label', label: parts[1] });
                        }
                    });
                }

                currentParent.children.push(newNode);
                currentParent = newNode;
            }
        } else {
            pos++;
        }
    }

    currentNode = rootNode;
    isAnalysisPaused = false;
    currentAnalysisPhase = 1;
    currentAnalysisLineStr = "";

    syncAndRender();
}

// ============================================================================
// 15. KATAGO ANALYSIS ENGINE COMMUNICATION
// ============================================================================
let analysisTimeout = null;
let currentQueryId = null;
let queryPriority = 0;

function requestAnalysis() {
    if (analysisTimeout) clearTimeout(analysisTimeout);
    analysisTimeout = setTimeout(() => {
        sendAnalysisQuery();
    }, 150);
}

function sendAnalysisQuery() {
    if (!window.electronAPI || isAnalysisPaused) return;

    if (currentQueryId) {
        window.electronAPI.sendAnalysisQuery({
            id: "cancel_" + Date.now(),
            action: "terminate",
            terminateId: currentQueryId
        });
    }

    currentQueryId = "analysis_" + Date.now();
    queryPriority++;

    let rawPath = getFullLinePath();
    let fullPath = rawPath.filter(n => n.gtpCoord !== 'resign');

    currentAnalysisLineStr = fullPath.map(n => n.boardHash).join('');

    let currentIndex = fullPath.indexOf(currentNode);
    if (currentIndex === -1 && currentNode.gtpCoord === 'resign') {
        currentIndex = fullPath.indexOf(currentNode.parent);
    }

    let needs1 = [];
    let needs25 = [];
    let needs50 = [];

    for (let i = 1; i < fullPath.length; i++) {
        if (fullPath[i].gtpCoord.toLowerCase() === 'pass') continue;
        if (fullPath[i].visits < 1) needs1.push(i);
        else if (fullPath[i].visits < 25) needs25.push(i);
        else if (fullPath[i].visits < 50) needs50.push(i);
    }

    // Phase 1.5 Interceptor: Sweeps siblings/variations with a 1-visit pass
    let variationToEvaluate = null;
    if (needs1.length === 0) {
        if (currentNode.parent) {
            for (let child of currentNode.parent.children) {
                if (child.gtpCoord.toLowerCase() === 'pass' || child.gtpCoord === 'resign' || child === currentNode) continue;
                if (child.scoreLead === null) { variationToEvaluate = child; break; }
            }
        }
        if (!variationToEvaluate) {
            for (let child of currentNode.children) {
                if (child.gtpCoord.toLowerCase() === 'pass' || child.gtpCoord === 'resign') continue;
                if (child.scoreLead === null) { variationToEvaluate = child; break; }
            }
        }
    }

    let turnsToAnalyze = [currentIndex];
    let currentPhaseMaxVisits = 1000;
    let includeOwnership = false;
    let targetPath = fullPath;

    if (showingScoreEstimate) {
        turnsToAnalyze = [currentIndex];
        currentPhaseMaxVisits = 1000;
        includeOwnership = true;
        targetPath = fullPath;
    } else {
        // Step-ladder analysis: Sweeps the whole line, then slowly deepens it
        if (needs1.length > 0) {
            currentAnalysisPhase = 1;
            currentPhaseMaxVisits = 1;
            turnsToAnalyze = [...new Set([currentIndex, ...needs1])];
            targetPath = fullPath;
        } else if (variationToEvaluate) {
            currentAnalysisPhase = 1.5;
            currentPhaseMaxVisits = 1;

            let varPath = [];
            let temp = variationToEvaluate;
            while(temp !== null) {
                if (temp.gtpCoord !== 'resign') {
                    varPath.unshift(temp);
                }
                temp = temp.parent;
            }
            targetPath = varPath;
            turnsToAnalyze = [varPath.length - 1];
        } else if (needs25.length > 0) {
            currentAnalysisPhase = 2;
            currentPhaseMaxVisits = 25;
            turnsToAnalyze = [...new Set([currentIndex, ...needs25])];
            targetPath = fullPath;
        } else if (needs50.length > 0) {
            currentAnalysisPhase = 3;
            currentPhaseMaxVisits = 50;
            turnsToAnalyze = [...new Set([currentIndex, ...needs50])];
            targetPath = fullPath;
        } else {
            currentAnalysisPhase = 4;
            currentPhaseMaxVisits = 1000;
            turnsToAnalyze = [currentIndex];
            targetPath = fullPath;
        }

        let parentIndex = turnsToAnalyze[0] - 1;
        if (targetPath === fullPath && parentIndex >= 0 && fullPath[parentIndex].scoreLead === null && !turnsToAnalyze.includes(parentIndex)) {
            turnsToAnalyze.push(parentIndex);
        }

        includeOwnership = (currentAnalysisPhase === 4);
    }

    currentAnalysisPath = targetPath;

    let kataMoves = targetPath.slice(1).map(node => {
        let gtpColor = node.color === 'black' ? 'B' : 'W';
        return [gtpColor, node.gtpCoord];
    });

    let query = {
        id: currentQueryId,
        priority: queryPriority,
        moves: kataMoves,
        rules: currentRules,
        komi: currentKomi,
        boardXSize: BOARD_SIZE,
        boardYSize: BOARD_SIZE,
        includeOwnership: includeOwnership,
        analyzeTurns: turnsToAnalyze,
        maxVisits: currentPhaseMaxVisits
    };

    window.electronAPI.sendAnalysisQuery(query);
}

let lastRenderTime = 0;
let pendingRender = false;

if (window.electronAPI) {
    const handleKataGoData = (dataPayload) => {
        let dataArray = Array.isArray(dataPayload) ? dataPayload : [dataPayload];

        // 1. Check for missing engine error first
        for (let data of dataArray) {
            if (data.error === "engine_missing") {
                isEngineMissing = true;
                isAnalysisPaused = true;
                updateAnalysisUI();
                return;
            }
        }

        if (isAnalysisPaused && !showingScoreEstimate) return;

        let rawPath = getFullLinePath();
        let fullPath = rawPath.filter(n => n.gtpCoord !== 'resign');

        let shouldUpdateText = false;

        for (let data of dataArray) {
            if (data.id && data.id !== currentQueryId) continue;

            if (data.turnNumber !== undefined) {
                let targetNode = currentAnalysisPath[data.turnNumber];

                if (targetNode && data.rootInfo) {
                    targetNode.winrate = data.rootInfo.winrate;
                    targetNode.scoreLead = data.rootInfo.scoreLead;
                    targetNode.visits = data.rootInfo.visits;

                    if (data.moveInfos) targetNode.kataMoveInfos = data.moveInfos;
                    if (data.ownership) targetNode.kataOwnership = data.ownership;

                    // Backpropagation: Update the parent node's preview bubble
                    if (targetNode.parent && targetNode.gtpCoord) {
                        if (!targetNode.parent.kataMoveInfos) {
                            targetNode.parent.kataMoveInfos = [];
                        }

                        let parentMoveData = targetNode.parent.kataMoveInfos.find(m => m.move === targetNode.gtpCoord);

                        if (parentMoveData) {
                            parentMoveData.winrate = data.rootInfo.winrate;
                            parentMoveData.scoreLead = data.rootInfo.scoreLead;
                            parentMoveData.visits = data.rootInfo.visits;
                        } else {
                            targetNode.parent.kataMoveInfos.push({
                                move: targetNode.gtpCoord,
                                winrate: data.rootInfo.winrate,
                                scoreLead: data.rootInfo.scoreLead,
                                visits: data.rootInfo.visits
                            });
                        }
                    }

                    shouldUpdateText = true;
                }
            }
        }

        let promotePhase = false;

        if (!showingScoreEstimate) {
            if (currentAnalysisPhase === 1) {
                promotePhase = fullPath.slice(1).every(n => n.visits >= 1 || n.gtpCoord.toLowerCase() === 'pass');
            } else if (currentAnalysisPhase === 1.5) {
                promotePhase = true;
            } else if (currentAnalysisPhase === 2) {
                promotePhase = fullPath.slice(1).every(n => n.visits >= 25 || n.gtpCoord.toLowerCase() === 'pass');
            } else if (currentAnalysisPhase === 3) {
                promotePhase = fullPath.slice(1).every(n => n.visits >= 50 || n.gtpCoord.toLowerCase() === 'pass');
            }
        }

        if (promotePhase) {
            requestAnalysis();
        }

        if (showingScoreEstimate && currentNode && currentNode.kataOwnership) {
            document.getElementById('btn-score').innerText = "Score";
            updateScorePopup();
        }

        if (shouldUpdateText) {
            let now = Date.now();
            if (now - lastRenderTime > 100) {
                updateAnalysisUI();
                render();
                drawAnalysisChart();
                lastRenderTime = now;
                pendingRender = false;
            } else if (!pendingRender) {
                pendingRender = true;
                setTimeout(() => {
                    updateAnalysisUI();
                    render();
                    drawAnalysisChart();
                    lastRenderTime = Date.now();
                    pendingRender = false;
                }, 100);
            }
        }
    };

    if (window.electronAPI.onAnalysisDataBatch) {
        window.electronAPI.onAnalysisDataBatch(handleKataGoData);
    } else if (window.electronAPI.onAnalysisData) {
        window.electronAPI.onAnalysisData(handleKataGoData);
    }

    document.getElementById('btn-open').addEventListener('click', () => window.electronAPI.openSgf());
    window.electronAPI.onSgfData((sgfText) => parseSGF(sgfText));

    if (window.electronAPI.onFileLinked) {
        window.electronAPI.onFileLinked(() => {
            isFileLinked = true;
        });
    }
}

// ============================================================================
// 16. TREE NAVIGATION CONTROLS
// ============================================================================
function traverseBack(steps) {
    for(let i = 0; i < steps; i++) {
        if(currentNode.parent) currentNode = currentNode.parent;
        else break;
    }
    syncAndRender();
}

function traverseForward(steps) {
    for(let i = 0; i < steps; i++) {
        if(currentNode.children.length > 0) currentNode = currentNode.children[0];
        else break;
    }
    syncAndRender();
}

function syncAndRender() {
    syncBoardToTree();

    if (showingScoreEstimate) {
        document.getElementById('score-popup').style.display = 'none';
        document.getElementById('btn-score').innerText = "Estimating...";
    }

    if (!isAnalysisPaused || showingScoreEstimate) {
        requestAnalysis();
    }

    commentBox.value = currentNode.comment || '';

    let gameTitle = document.querySelector('.game-title-input').value.trim();
    let isGameActive = rootNode.children.length > 0 || gameTitle !== '';

    let bCapStr = isGameActive ? currentNode.capturesBlack : '-';
    let wCapStr = isGameActive ? currentNode.capturesWhite : '-';

    document.getElementById('black-captures').innerText = `Captures: ${bCapStr}`;
    document.getElementById('white-captures').innerText = `Captures: ${wCapStr}`;

    let ended = isLineEnded();
    document.getElementById('btn-pass').disabled = ended;
    document.getElementById('btn-resign').disabled = ended;

    if (currentNode.gtpCoord === 'pass') {
        showPassPopover();
    } else {
        const popover = document.getElementById('pass-popover');
        if (popover) popover.classList.remove('active');
    }

    updateAnalysisUI();
    render();
    drawAnalysisChart();
    updateTreeUI();
    updateNewButtonState();
}

document.getElementById('nav-start').addEventListener('click', () => { currentNode = rootNode; syncAndRender(); });
document.getElementById('nav-back15').addEventListener('click', () => traverseBack(15));
document.getElementById('nav-back').addEventListener('click', () => traverseBack(1));
document.getElementById('nav-fw').addEventListener('click', () => traverseForward(1));
document.getElementById('nav-fw15').addEventListener('click', () => traverseForward(15));
document.getElementById('nav-end').addEventListener('click', () => {
    while(currentNode.children.length > 0) currentNode = currentNode.children[0];
    syncAndRender();
});

// ============================================================================
// 17. WINDOW CONTROLS
// ============================================================================
document.getElementById('win-min').addEventListener('click', () => {
    if (window.electronAPI) window.electronAPI.minimizeWindow();
});

document.getElementById('win-max').addEventListener('click', () => {
    if (window.electronAPI) window.electronAPI.maximizeWindow();
});

document.getElementById('win-close').addEventListener('click', () => {
    if (window.electronAPI) window.electronAPI.closeWindow();
});

// ============================================================================
// 18. DRAG AND DROP FILE LOGIC
// ============================================================================
const dragOverlay = document.getElementById('drag-overlay');
let dragCounter = 0;

document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (e.dataTransfer.types.includes('Files')) dragOverlay.classList.add('active');
});

document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) dragOverlay.classList.remove('active');
});

document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dragOverlay.classList.remove('active');

    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].name.toLowerCase().endsWith('.sgf')) {
        const file = files[0];

        // 1. Immediately sever ties with any previously opened SGF to prevent silent corruption
        if (window.electronAPI && window.electronAPI.resetFilePath) {
            window.electronAPI.resetFilePath();
        }

        // 2. Securely extract the file path using the preload helper
        let droppedFilePath = file.path;
        if (window.electronAPI && window.electronAPI.getFilePath) {
            droppedFilePath = window.electronAPI.getFilePath(file);
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            // 3. Parse the SGF (internally sets isFileLinked = false)
            parseSGF(event.target.result);

            // 4. Send the securely extracted path to main.js to lock it in for saving
            if (window.electronAPI && window.electronAPI.setFilePath && droppedFilePath) {
                window.electronAPI.setFilePath(droppedFilePath);
            }
        };
        reader.readAsText(file);
    }
});

// --- PASS & RESIGN ACTIONS ---
document.getElementById('btn-pass').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.target.blur();

    if (isLineEnded()) return;

    const color = getNextColorToPlay();
    let testBoard = boardState.map(row => [...row]);
    let existingChild = currentNode.children.find(c => c.gtpCoord === 'pass' && c.color === color);

    if (existingChild) {
        currentNode = existingChild;
    } else {
        let newNode = new GameNode(null, null, color, currentNode, testBoard, 0, 0);
        newNode.gtpCoord = 'pass';
        currentNode.children.push(newNode);
        currentNode = newNode;
    }
    syncAndRender();
});

document.getElementById('btn-resign').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.target.blur();

    if (isLineEnded()) return;

    showConfirmModal(
        "Resign Game",
        "Are you sure you want to record a resignation? This will end the branch.",
        "Resign",
        e.target,
        () => {
            const color = getNextColorToPlay();
            let testBoard = boardState.map(row => [...row]);

            let newNode = new GameNode(null, null, color, currentNode, testBoard, 0, 0);
            newNode.gtpCoord = 'resign';
            currentNode.children.push(newNode);
            currentNode = newNode;

            updateResultFromMainLine();
            syncAndRender();
        }
    );
});

// ============================================================================
// 19. SGF GENERATION & SAVING
// ============================================================================
function generateSGF() {
    let sgf = `(;GM[1]FF[4]CA[UTF-8]SZ[${BOARD_SIZE}]`;

    const addProp = (key, val) => {
        if (val && val.trim() !== '') sgf += `${key}[${val.replace(/\]/g, '\\]')}]`;
    };

    addProp('GN', document.querySelector('.game-title-input').value);
    addProp('PB', document.getElementById('player-b-name').value);
    addProp('PW', document.getElementById('player-w-name').value);
    addProp('BR', document.getElementById('player-b-rank').value);
    addProp('WR', document.getElementById('player-w-rank').value);
    addProp('DT', document.getElementById('info-date').value);
    addProp('PC', document.getElementById('info-place').value);
    addProp('EV', document.getElementById('info-event').value);
    addProp('RO', document.getElementById('info-round').value);
    addProp('RU', document.getElementById('info-rules').value);
    addProp('TM', document.getElementById('info-time').value);
    addProp('OT', document.getElementById('info-overtime').value);
    addProp('KM', document.getElementById('info-komi').value);
    addProp('RE', document.getElementById('result-input').value);
    addProp('GC', document.getElementById('info-summary').value);
    addProp('AN', document.getElementById('info-annotator').value);
    addProp('CP', document.getElementById('info-copyright').value);

    const coordsToSgf = (x, y) => (x === null || y === null) ? '' : String.fromCharCode(x + 97) + String.fromCharCode(y + 97);

    const getNodeProps = (node) => {
        let props = '';
        if (node.comment) props += `C[${node.comment.replace(/\]/g, '\\]')}]`;

        let tr=[], sq=[], cr=[], ma=[], lb=[];
        for (let [coord, mark] of node.markup.entries()) {
            let [x, y] = coord.split(',').map(Number);
            let sc = coordsToSgf(x, y);
            if (mark.type === 'tri') tr.push(sc);
            else if (mark.type === 'sq') sq.push(sc);
            else if (mark.type === 'o') cr.push(sc);
            else if (mark.type === 'x') ma.push(sc);
            else if (mark.type === 'label') lb.push(`${sc}:${mark.label}`);
        }
        if (tr.length) props += `TR[${tr.join('][')}]`;
        if (sq.length) props += `SQ[${sq.join('][')}]`;
        if (cr.length) props += `CR[${cr.join('][')}]`;
        if (ma.length) props += `MA[${ma.join('][')}]`;
        if (lb.length) props += `LB[${lb.join('][')}]`;
        return props;
    };

    sgf += getNodeProps(rootNode);

    const buildTree = (node) => {
        if (node.children.length === 0) return '';
        let treeStr = '';

        for (let i = 0; i < node.children.length; i++) {
            let child = node.children[i];
            let branchStr = '';

            if (node.children.length > 1) branchStr += '(';
            branchStr += ';';

            if (child.gtpCoord === 'resign') {
                branchStr += `N[Resign]`;
            } else if (child.color === 'black') {
                branchStr += `B[${coordsToSgf(child.x, child.y)}]`;
            } else if (child.color === 'white') {
                branchStr += `W[${coordsToSgf(child.x, child.y)}]`;
            }

            branchStr += getNodeProps(child);
            branchStr += buildTree(child);

            if (node.children.length > 1) branchStr += ')';
            treeStr += branchStr;
        }
        return treeStr;
    };

    sgf += buildTree(rootNode);
    sgf += ')';
    return sgf;
}

function getDynamicFilename() {
    let name = document.querySelector('.game-title-input').value.trim();

    if (!name) {
        let pb = document.getElementById('player-b-name').value.trim() || 'Black';
        let pw = document.getElementById('player-w-name').value.trim() || 'White';
        if (pb !== 'Black' || pw !== 'White') {
            name = `${pb} vs ${pw}`;
        } else {
            name = "New Game";
        }
    }
    return name.replace(/[<>:"/\\|?*]+/g, '') + '.sgf';
}

document.getElementById('btn-save').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.target.blur();

    const executeSave = () => {
        if (window.electronAPI && window.electronAPI.saveSgf) {
            window.electronAPI.saveSgf(generateSGF(), getDynamicFilename());
        }
    };

    if (!isFileLinked || skipSaveConfirm) {
        executeSave();
    } else {
        showConfirmModal(
            "Save Game",
            "Are you sure you want to overwrite your current save?",
            "Save",
            e.target.closest('.split-btn-group'),
            (dontShowAgain) => {
                if (dontShowAgain) {
                    skipSaveConfirm = true;
                    appSettings.optSaveConfirm = false;
                    localStorage.setItem(SETTINGS_KEY, JSON.stringify(appSettings));

                    let optCheckbox = document.getElementById('opt-save-confirm');
                    if (optCheckbox) optCheckbox.checked = false;
                }
                executeSave();
            },
            true
        );
    }
});

document.getElementById('btn-save-as').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.target.blur();

    if (window.electronAPI && window.electronAPI.saveAsSgf) {
        window.electronAPI.saveAsSgf(generateSGF(), getDynamicFilename());
    }
});

// ============================================================================
// 20. OPTIONS MODAL & APP SETTINGS
// ============================================================================
const optionsOverlay = document.getElementById('options-modal-overlay');

const aboutOverlay = document.getElementById('about-modal-overlay');

document.getElementById('btn-about').addEventListener('click', (e) => {
    e.stopPropagation();
    aboutOverlay.classList.add('active');
});

document.getElementById('btn-about-close').addEventListener('click', () => {
    aboutOverlay.classList.remove('active');
});

function bootEngine() {
    if (window.electronAPI && window.electronAPI.startEngine) {
        window.electronAPI.startEngine({
            exe: appSettings.engineExe,
            net: appSettings.engineNet,
            cfg: appSettings.engineCfg
        });
    }
}

document.getElementById('btn-options-bottom').addEventListener('click', (e) => {
    e.stopPropagation();

    document.getElementById('opt-current-move').checked = appSettings.optCurrentMove;
    document.getElementById('opt-coord-highlight').checked = appSettings.optCoordHighlight;
    document.getElementById('opt-next-move').checked = appSettings.optNextMove;
    document.getElementById('opt-alt-move').checked = appSettings.optAltMove;
    document.getElementById('opt-alt-next-move').checked = appSettings.optAltNextMove;
    document.getElementById('opt-save-confirm').checked = appSettings.optSaveConfirm;

    document.getElementById('opt-engine-exe').value = appSettings.engineExe;
    document.getElementById('opt-engine-network').value = appSettings.engineNet;
    document.getElementById('opt-engine-config').value = appSettings.engineCfg;

    optionsOverlay.classList.add('active');
});

document.getElementById('btn-browse-exe').addEventListener('click', async (e) => {
    e.preventDefault();
    if (window.electronAPI && window.electronAPI.chooseEngineFile) {
        const currentPath = document.getElementById('opt-engine-exe').value;
        const filePath = await window.electronAPI.chooseEngineFile(currentPath);
        if (filePath) document.getElementById('opt-engine-exe').value = filePath;
    }
});

document.getElementById('btn-browse-net').addEventListener('click', async (e) => {
    e.preventDefault();
    if (window.electronAPI && window.electronAPI.chooseNetworkFile) {
        const currentPath = document.getElementById('opt-engine-network').value;
        const filePath = await window.electronAPI.chooseNetworkFile(currentPath);
        if (filePath) document.getElementById('opt-engine-network').value = filePath;
    }
});

document.getElementById('btn-browse-cfg').addEventListener('click', async (e) => {
    e.preventDefault();
    if (window.electronAPI && window.electronAPI.chooseConfigFile) {
        const currentPath = document.getElementById('opt-engine-config').value;
        const filePath = await window.electronAPI.chooseConfigFile(currentPath);
        if (filePath) document.getElementById('opt-engine-config').value = filePath;
    }
});

document.getElementById('options-modal-cancel').addEventListener('click', () => {
    optionsOverlay.classList.remove('active');
});

document.getElementById('options-modal-save').addEventListener('click', () => {
    appSettings.optCurrentMove = document.getElementById('opt-current-move').checked;
    appSettings.optCoordHighlight = document.getElementById('opt-coord-highlight').checked;
    appSettings.optNextMove = document.getElementById('opt-next-move').checked;
    appSettings.optAltMove = document.getElementById('opt-alt-move').checked;
    appSettings.optAltNextMove = document.getElementById('opt-alt-next-move').checked;
    appSettings.optSaveConfirm = document.getElementById('opt-save-confirm').checked;

    appSettings.engineExe = document.getElementById('opt-engine-exe').value;
    appSettings.engineNet = document.getElementById('opt-engine-network').value;
    appSettings.engineCfg = document.getElementById('opt-engine-config').value;

    localStorage.setItem(SETTINGS_KEY, JSON.stringify(appSettings));

    skipSaveConfirm = !appSettings.optSaveConfirm;

    isEngineMissing = false;
    bootEngine();

    optionsOverlay.classList.remove('active');
    render();
});

document.addEventListener('click', (e) => {
    if (optionsOverlay.classList.contains('active')) {
        const optBox = optionsOverlay.querySelector('.modal-box');
        if (!optBox.contains(e.target) && !e.target.closest('#btn-options-bottom')) {
            optionsOverlay.classList.remove('active');
        }
    }

    if (aboutOverlay.classList.contains('active')) {
        const aboutBox = aboutOverlay.querySelector('.modal-box');
        if (!aboutBox.contains(e.target) && !e.target.closest('#btn-about')) {
            aboutOverlay.classList.remove('active');
        }
    }
});

// ============================================================================
// 21. NEW GAME & INITIALIZATION
// ============================================================================
function checkIsGameBlank() {
    let hasMoves = rootNode.children.length > 0;
    let hasComments = rootNode.comment && rootNode.comment.trim() !== '';
    let hasMarkup = rootNode.markup && rootNode.markup.size > 0;

    let hasMetadata =
        document.querySelector('.game-title-input').value.trim() !== '' ||
        document.getElementById('player-b-name').value.trim() !== '' ||
        document.getElementById('player-w-name').value.trim() !== '';

    return !hasMoves && !hasComments && !hasMarkup && !hasMetadata;
}

function updateNewButtonState() {
    const btnNew = document.getElementById('btn-new');
    if (btnNew) {
        btnNew.disabled = checkIsGameBlank();
    }
}

document.getElementById('btn-new').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.target.blur();

    if (checkIsGameBlank()) return;

    showConfirmModal(
        "New Game",
        "Are you sure you want to start a new game? Any unsaved changes will be lost.",
        "New Game",
        e.target.closest('.split-btn-group'),
        () => {
            boardState = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
            nextAlternatingColor = 'black';
            rootNode = new GameNode(null, null, null, null, boardState);
            currentNode = rootNode;

            document.getElementById('player-b-name').value = "";
            document.getElementById('player-b-rank').value = "";
            document.getElementById('player-w-name').value = "";
            document.getElementById('player-w-rank').value = "";
            document.querySelector('.game-title-input').value = "";
            document.getElementById('info-date').value = "";
            document.getElementById('info-place').value = "";
            document.getElementById('info-event').value = "";
            document.getElementById('info-round').value = "";
            document.getElementById('info-rules').value = "";
            document.getElementById('info-time').value = "";
            document.getElementById('info-overtime').value = "";
            document.getElementById('info-komi').value = "6.5";
            document.getElementById('result-input').value = "";
            document.getElementById('reveal-result-btn').style.display = 'none';
            document.getElementById('info-summary').value = "";
            document.getElementById('info-annotator').value = "";
            document.getElementById('info-copyright').value = "";

            currentRules = 'japanese';
            currentKomi = 6.5;
            originalGameResult = "";
            isFileLinked = false;

            if (window.electronAPI && window.electronAPI.resetFilePath) {
                window.electronAPI.resetFilePath();
            }

            isAnalysisPaused = true;
            currentAnalysisPhase = 1;
            currentAnalysisLineStr = "";
            if (currentQueryId && window.electronAPI) {
                window.electronAPI.sendAnalysisQuery({ id: "cancel_" + Date.now(), action: "terminate", terminateId: currentQueryId });
            }

            syncAndRender();
        },
        false,
        -25
    );
});

setTool('alternate');
updateTreeUI();
resizeBoard();

// Initial Engine Configuration Pass
if (window.electronAPI && window.electronAPI.getDefaultEnginePaths) {
    window.electronAPI.getDefaultEnginePaths().then(defaultPaths => {
        // If the user's settings still contain relative dummy paths, upgrade them
        // to the dynamic absolute paths before booting the engine.
        if (appSettings.engineExe === './KataGo/katago.exe') appSettings.engineExe = defaultPaths.exe;
        if (appSettings.engineNet === './KataGo/default_model.bin.gz') appSettings.engineNet = defaultPaths.net;
        if (appSettings.engineCfg === './KataGo/analysis_example.cfg') appSettings.engineCfg = defaultPaths.cfg;

        bootEngine();
    });
} else {
    bootEngine();
}

updateNewButtonState();

document.querySelectorAll('.info-input, .comments-box').forEach(el => {
    el.addEventListener('input', updateNewButtonState);
});

document.fonts.ready.then(() => {
    render();
});
