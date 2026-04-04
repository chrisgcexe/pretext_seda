/**
 * SEDA: ENGINE MODULE
 * El "corazón" gráfico: ASCII Ocean, Land Transitions y sistemas de soporte.
 */

// ATLAS DE CARACTERES: Pre-renderiza para evitar fillText masivo
export const ASCII_ATLAS = {
    canvas: null,
    charMap: new Map(),
    colors: ['#365d7e', '#9dedfacc', '#795548'], // base, luz, tierra
    init(w, h) {
        if (this.canvas) return;
        this.canvas = document.createElement('canvas');
        const chars = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";
        this.canvas.width = chars.length * w;
        this.canvas.height = h * 3; // 3 colores
        const ctx = this.canvas.getContext('2d');
        ctx.font = 'bold 17px "Courier New", monospace';
        ctx.textBaseline = 'top';
        for (let i = 0; i < chars.length; i++) {
            const char = chars[i];
            ctx.fillStyle = this.colors[0];
            ctx.fillText(char, i * w, 0);
            ctx.fillStyle = this.colors[1];
            ctx.fillText(char, i * w, h);
            ctx.fillStyle = this.colors[2];
            ctx.fillText(char, i * w, h * 2);
            this.charMap.set(char, i * w);
        }
    }
};


/**
 * Clase que gestiona el océano ASCII y sus físicas de repulsión.
 */
export class ASCIIOcean {
    constructor(canvas, vesselCanvas, effectsCanvas, parentTrack, lineInfo, vesselHeight) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.vesselCanvas = vesselCanvas;
        this.effectsCanvas = effectsCanvas;
        this.effectsCtx = effectsCanvas.getContext('2d');
        this.parentTrack = parentTrack;
        this.lineInfo = lineInfo;
        this.charSize = { w: 14, h: 22 };
        this.time = 0;
        this.isVisible = false;

        this.overflowTop = 800;
        this.waterTopGap = vesselHeight + 50;
        this.currentOffset = 0;
        this.targetOffset = 0;
        this.lastOffset = 0;
        this.isSubmerged = false;
        this.wasFullySubmerged = false;
        this.isDripping = false;
        this.drippingTimer = 0;
        this.splashes = [];
        this.droplets = [];
        this.vesselLastTop = 0;

        this.patternSize = 64;
        this.matrix = new Uint8Array(this.patternSize * this.patternSize);
        const points = [];
        for (let i = 0; i < 25; i++) {
            points.push({ x: Math.random() * 64, y: Math.random() * 64 });
        }

        for (let y = 0; y < this.patternSize; y++) {
            for (let x = 0; x < this.patternSize; x++) {
                const wx = x + Math.sin(y * 0.2) * 2;
                const wy = y + Math.cos(x * 0.2) * 2;
                let d1 = 1000, d2 = 1000;
                points.forEach(p => {
                    for (let ox = -64; ox <= 64; ox += 64) {
                        for (let oy = -64; oy <= 64; oy += 64) {
                            const dx = Math.abs(wx - (p.x + ox));
                            const dy = Math.abs(wy - (p.y + oy));
                            const dist = dx + dy;
                            if (dist < d1) { d2 = d1; d1 = dist; }
                            else if (dist < d2) { d2 = dist; }
                        }
                    }
                });
                const val = d2 - d1;
                this.matrix[y * this.patternSize + x] = val < 0.9 ? 1 : 0;
            }
        }

        this.numRows = Math.ceil(canvas.height / this.charSize.h);
        this.numCols = Math.ceil(canvas.width / this.charSize.w);
        const totalParticles = this.numRows * this.numCols;

        this.vx = new Float32Array(totalParticles);
        this.vy = new Float32Array(totalParticles);
        this.ox = new Float32Array(totalParticles);
        this.oy = new Float32Array(totalParticles);

        this.noiseTopBuffer = new Float32Array(this.numCols);
        this.noiseBotBuffer = new Float32Array(this.numCols);
        this.shoreWaveBuffer = new Float32Array(this.numCols);

        ASCII_ATLAS.init(this.charSize.w, this.charSize.h);
    }

    render(recentText) {
        if (!this.isVisible) return;

        const { ctx, canvas, charSize, matrix, patternSize, vesselCanvas, effectsCanvas, numRows, numCols } = this;
        let dpi = window.devicePixelRatio || 1;
        if (dpi > 2.0) dpi = 2.0;
        const rect = canvas.getBoundingClientRect();

        const targetW = Math.floor(rect.width * dpi);
        const targetH = Math.floor(rect.height * dpi);
        if (canvas.width !== targetW) { canvas.width = targetW; effectsCanvas.width = targetW; }
        if (canvas.height !== targetH) { canvas.height = targetH; effectsCanvas.height = targetH; }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        this.effectsCtx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        this.effectsCtx.save();
        ctx.scale(dpi, dpi);
        this.effectsCtx.scale(dpi, dpi);

        ctx.font = 'bold 17px "Courier New", monospace';
        this.time += 0.35;
        const vH = window.innerHeight;

        const viewportTop = -rect.top;
        const viewportBottom = viewportTop + vH;
        const startR = Math.max(0, Math.floor((viewportTop - 400) / charSize.h));
        const endR = Math.min(numRows, Math.ceil((viewportBottom + 400) / charSize.h));

        const surfTime = this.time * 0.06;
        const textLen = recentText.length;
        const shift = Math.floor(this.time);
        const patternMask = patternSize - 1;

        for (let c = 0; c < numCols; c++) {
            const wave1 = Math.sin(c * 0.12 + surfTime) * 0.8;
            const wave2 = Math.sin(c * 0.05 - surfTime * 1.5) * 1.2;
            const wave3 = Math.sin(c * 0.25 + surfTime * 2) * 0.3;
            const nT = wave1 + wave2 + wave3;
            this.noiseTopBuffer[c] = nT;
            this.noiseBotBuffer[c] = Math.sin(c * 0.10 + surfTime) * 0.6 + Math.sin(c * 0.06 + surfTime * 1.1) * 0.9;
            this.shoreWaveBuffer[c] = (nT * charSize.h * 1.3 + Math.sin(c * 0.19 + surfTime * 1.4) * charSize.h * 0.5);
        }

        this.currentOffset += (this.targetOffset - this.currentOffset) * 0.08;
        vesselCanvas.style.transform = `translateY(${this.currentOffset}px)`;

        const vRect = vesselCanvas.getBoundingClientRect();
        const vL = vRect.left - rect.left;
        const vT = vRect.top - rect.top;

        const vesselW = (this.lineInfo[0]?.width || 300) + 80;
        const power = 3.5;
        const spring = 0.032;
        const friction = 0.88;
        const vRadius = Math.max(70, Math.min(125, vesselW * 0.28));
        const vRadiusSq = vRadius * vRadius;
        const PADDING = 120;
        const LINE_H = 26;
        const numLines = this.lineInfo ? this.lineInfo.length : 0;
        const boxTop = vT + 60;
        const boxBot = vT + PADDING + numLines * LINE_H + 30;
        const waterLineFull = this.overflowTop + this.waterTopGap;

        const hullLeft = vL + 80;
        const hullRight = vL + 120 + (this.lineInfo[0]?.width || 300) + 40;

        const currentSubmerged = boxBot > waterLineFull + 20;
        const fullySubmerged = boxTop > waterLineFull;
        const fullyOut = boxBot <= waterLineFull + 20;

        if (currentSubmerged && !this.isSubmerged) {
            this.splashes.push({ x: vL + 120 + 300, y: waterLineFull, r: 0, maxR: 300, force: 15, life: 1.0 });
            for (let i = 0; i < 12; i++) {
                const spread = Math.random();
                const charL = recentText[Math.floor(Math.random() * textLen)] || ' ';
                const charR = recentText[Math.floor(Math.random() * textLen)] || ' ';
                this.droplets.push({
                    x: hullLeft - Math.random() * 20, y: waterLineFull - Math.random() * 10,
                    vx: -(spread * 3.5 + 0.5), vy: -(Math.random() * 7 + 3),
                    life: 1.2 + Math.random() * 0.6, char: charL, bright: Math.random() > 0.5, drip: false
                });
                this.droplets.push({
                    x: hullRight + Math.random() * 20, y: waterLineFull - Math.random() * 10,
                    vx: (spread * 3.5 + 0.5), vy: -(Math.random() * 7 + 3),
                    life: 1.2 + Math.random() * 0.6, char: charR, bright: Math.random() > 0.5, drip: false
                });
            }
        }

        if (!fullySubmerged && this.wasFullySubmerged) {
            for (let i = 0; i < 20; i++) {
                const xPos = hullLeft + Math.random() * (hullRight - hullLeft);
                this.droplets.push({
                    x: xPos, y: waterLineFull,
                    vx: (Math.random() - 0.5) * 6, vy: -(Math.random() * 8 + 4),
                    life: 1.5 + Math.random() * 0.5,
                    char: recentText[Math.floor(Math.random() * textLen)] || ' ',
                    bright: true, drip: false
                });
            }
        }

        const vesselDeltaY = boxTop - this.vesselLastTop;
        if (vesselDeltaY < -1 && !fullySubmerged && boxTop > waterLineFull - 100) {
            if (Math.random() > 0.6) {
                this.droplets.push({
                    x: hullLeft + Math.random() * (hullRight - hullLeft),
                    y: boxTop,
                    vx: (Math.random() - 0.5) * 1.5, vy: vesselDeltaY * 0.8,
                    life: 1.0, char: recentText[Math.floor(Math.random() * textLen)] || ' ',
                    bright: Math.random() > 0.5, drip: false, cling: true
                });
            }
        }
        this.vesselLastTop = boxTop;

        if (fullyOut && !this.isDripping && this.isSubmerged) {
            this.isDripping = true;
            this.drippingTimer = 80;
        }
        if (this.isDripping) {
            this.drippingTimer--;
            if (this.drippingTimer % 4 === 0) {
                this.droplets.push({
                    x: hullLeft + Math.random() * (hullRight - hullLeft),
                    y: boxBot,
                    vx: (Math.random() - 0.5) * 0.8, vy: Math.random() * 1.5 + 0.5,
                    life: 1.4 + Math.random() * 0.4,
                    char: recentText[Math.floor(Math.random() * textLen)] || ' ',
                    bright: Math.random() > 0.5, drip: true
                });
            }
            if (this.drippingTimer <= 0) this.isDripping = false;
        }

        this.isSubmerged = currentSubmerged;
        this.wasFullySubmerged = fullySubmerged;

        for (let i = this.splashes.length - 1; i >= 0; i--) {
            const s = this.splashes[i];
            s.r += 12;
            s.life -= 0.03;
            if (s.life <= 0) this.splashes.splice(i, 1);
        }

        const hullScanTop = boxTop - vRadius;
        const hullScanBot = boxBot + vRadius;

        for (let r = startR; r < endR; r++) {
            const homeY = r * charSize.h;
            if (homeY < waterLineFull) continue;
            const distFromSurface = homeY - waterLineFull;
            const isTopShore = distFromSurface < charSize.h * 2;
            const waveFactor = isTopShore ? (1 - distFromSurface / (charSize.h * 2)) : 0;

            const rowIdx = r * numCols;
            const inHullRange = homeY > hullScanTop && homeY < hullScanBot;

            for (let c = 0; c < numCols; c++) {
                const idx = rowIdx + c;
                const homeX = c * charSize.w;
                const noiseT = this.noiseTopBuffer[c];
                const noiseB = this.noiseBotBuffer[c];

                const cX = homeX + this.ox[idx];
                const cY = homeY + this.oy[idx];

                let repulsionX = 0;
                let repulsionY = 0;

                // ── OPTIMIZACIÓN 1: Solo iterar salpicaduras si existen ──
                if (this.splashes.length > 0) {
                    for (let i = 0; i < this.splashes.length; i++) {
                        const s = this.splashes[i];
                        const dxS = cX - s.x;
                        const dyS = cY - s.y;
                        
                        // Chequeo rápido de bounding box antes de distancias complejas
                        if (Math.abs(dxS) > s.r + 50 || Math.abs(dyS) > s.r + 50) continue;

                        const dSqS = dxS * dxS + dyS * dyS;
                        const dS = Math.sqrt(dSqS);
                        const angle = Math.atan2(dyS, dxS);
                        const bump = Math.sin(angle * 3 + s.r * 0.04) * 28
                            + Math.sin(angle * 7 - s.r * 0.02) * 14
                            + Math.sin(angle * 13 + s.r * 0.06) * 7;
                        const effectiveR = s.r + bump;
                        const distToRing = Math.abs(dS - effectiveR);
                        if (distToRing < 40) {
                            const fS = (1 - distToRing / 40) * s.force * s.life;
                            repulsionX += (dxS / (dS || 1)) * fS;
                            repulsionY += (dyS / (dS || 1)) * fS;
                        }
                    }
                }

                if (inHullRange) {
                    let activeW, activeStartX;
                    const lineIdx = Math.floor((homeY - boxTop) / LINE_H);
                    if (lineIdx >= 0 && lineIdx < numLines) {
                        activeW = this.lineInfo[lineIdx]?.width || 0;
                        activeStartX = this.lineInfo[lineIdx]?.startX || PADDING;
                    } else {
                        activeW = (this.lineInfo[numLines - 1]?.width || 0) * 0.6;
                        activeStartX = PADDING + 225 - (activeW / 2);
                    }

                    const vL_col = vL + activeStartX - 40;
                    const vR_col = vL + activeStartX + activeW + 40;

                    // ── OPTIMIZACIÓN 2: Salto rápido por distancia en X ──
                    if (cX < vL_col - vRadius || cX > vR_col + vRadius) {
                        // Está demasiado lejos lateralmente, no calculamos nada pesado
                    } else {
                        const isFullyInsideX = cX > vL_col + 2 && cX < vR_col - 2;
                        const isFullyInsideY = cY > boxTop + 2 && cY < boxBot - 2;
                        if (isFullyInsideX && isFullyInsideY) continue;

                        const closestX = Math.max(vL_col, Math.min(cX, vR_col));
                        const closestY = Math.max(boxTop, Math.min(cY, boxBot));
                        const dx = cX - closestX;
                        const dy = cY - closestY;
                        const dSq = dx * dx + dy * dy;

                        if (dSq < vRadiusSq) {
                            const d = Math.sqrt(dSq) || 1;
                            const f = (1 - d / vRadius) * power;
                            repulsionX = (dx / d) * f;
                            repulsionY = (dy / d) * f;
                        }
                    }
                } else {
                    const waveT = (1.6 + noiseT) * charSize.h + waterLineFull;
                    const waveB = canvas.height - (1.6 + noiseB) * charSize.h;
                    if (homeY < waveT || homeY > waveB) {
                        if (Math.abs(this.oy[idx]) < 1 && Math.abs(this.ox[idx]) < 1) continue;
                    }
                }

                const springTargetY = isTopShore ? (this.shoreWaveBuffer[c] * waveFactor) : 0;
                this.vx[idx] += repulsionX + (0 - this.ox[idx]) * spring;
                this.vy[idx] += repulsionY + (springTargetY - this.oy[idx]) * spring;
                this.vx[idx] *= friction;
                this.vy[idx] *= friction;
                this.ox[idx] += this.vx[idx];
                this.oy[idx] += this.vy[idx];

                const mX = (c - shift) & patternMask;
                const mY = (r - shift) & patternMask;
                const patternVal = matrix[mY * patternSize + mX];

                const char = recentText[(c + r * numCols) % textLen] || ' ';
                const atlasX = ASCII_ATLAS.charMap.get(char) ?? 0;
                const atlasY = (patternVal === 1) ? charSize.h : 0;
                ctx.drawImage(ASCII_ATLAS.canvas, atlasX, atlasY, charSize.w, charSize.h, homeX + this.ox[idx], homeY + this.oy[idx], charSize.w, charSize.h);
            }
        }

        const gravity = 0.22;
        for (let i = this.droplets.length - 1; i >= 0; i--) {
            const drop = this.droplets[i];
            if (drop.cling) {
                drop.vy += 0.05;
                if (drop.life < 0.8) drop.cling = false;
            } else {
                drop.vy += drop.drip ? gravity * 0.6 : gravity;
            }
            drop.x += drop.vx;
            drop.y += drop.vy;
            drop.life -= 0.013;
            if (drop.life <= 0) { this.droplets.splice(i, 1); continue; }
            if (drop.drip && drop.y > waterLineFull + 10) { this.droplets.splice(i, 1); continue; }
            if (!drop.drip && drop.y > waterLineFull + 60) { this.droplets.splice(i, 1); continue; }

            this.effectsCtx.globalAlpha = Math.min(1, drop.life);
            const atlasX = ASCII_ATLAS.charMap.get(drop.char) ?? 0;
            const atlasY = drop.bright ? charSize.h : 0;
            this.effectsCtx.drawImage(ASCII_ATLAS.canvas, atlasX, atlasY, charSize.w, charSize.h, drop.x, drop.y, charSize.w, charSize.h);
        }
        this.effectsCtx.globalAlpha = 1;
        this.effectsCtx.restore();
        ctx.restore();
    }
}

/**
 * Clase que gestiona las transiciones cinematográficas 3D de tierra.
 */
export class LandTransition {
    constructor(fromText, toText, container, fromElement, toElement) {
        this.fromText = fromText;
        this.toText = toText;
        this.container = container;
        this.fromElement = fromElement;
        this.toElement = toElement;
        this.track = document.createElement('div');
        this.track.className = 'zona-viaje transicion-tierra';
        this.track.style.height = '550vh';

        this.canvas = document.createElement('canvas');
        this.canvas.className = 'effects-top';
        this.canvas.style.position = 'fixed';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100vw';
        this.canvas.style.height = '100vh';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.zIndex = '20';
        this.canvas.style.display = 'none';

        this.track.appendChild(this.canvas);
        container.appendChild(this.track);

        this.linesFrom = [];
        this.linesTo = [];
        this.dust = [];
        this.progress = 0;
        this.prevProgress = 0;
        this.isVisible = false;
        this.ctx = this.canvas.getContext('2d');
        this.hasScrolledOnGround = false; // Estado para activación de polvo

        this.initLayout();
    }

    initLayout() {
        const viewW = window.innerWidth;
        const PADDING = viewW < 768 ? Math.floor(viewW * 0.08) : 120;
        const MAX_WIDTH = Math.min(580, viewW - (PADDING * 2));
        const FONT_SIZE = viewW < 768 ? 14 : 16;
        const fontString = `${FONT_SIZE}px "Courier New", monospace`;

        const prepFrom = window.Pretext.prepareWithSegments(this.fromText, fontString);
        let cur = { segmentIndex: 0, graphemeIndex: 0 };
        while (true) {
            const line = window.Pretext.layoutNextLine(prepFrom, cur, MAX_WIDTH);
            if (!line) break;
            this.linesFrom.push({ text: line.text, width: line.width });
            cur = line.end;
        }

        const prepTo = window.Pretext.prepareWithSegments(this.toText, fontString);
        cur = { segmentIndex: 0, graphemeIndex: 0 };
        while (true) {
            const line = window.Pretext.layoutNextLine(prepTo, cur, MAX_WIDTH);
            if (!line) break;
            this.linesTo.push({ text: line.text, width: line.width });
            cur = line.end;
        }
    }

    render(isCurrent = true) {
        if (!this.isVisible || !isCurrent) {
            this.canvas.style.display = 'none';
            if (!isCurrent && this.progress >= 0.9) {
                if (this.toElement) {
                    this.toElement.style.visibility = 'visible';
                    this.toElement.style.opacity = '1';
                    this.toElement.style.pointerEvents = 'auto';
                }
            }
            return;
        }
        this.canvas.style.display = 'block';

        const { canvas, ctx, progress } = this;
        const dpi = Math.min(2.0, window.devicePixelRatio || 1);
        const rect = { width: window.innerWidth, height: window.innerHeight };

        if (canvas.width !== rect.width * dpi || canvas.height !== rect.height * dpi) {
            canvas.width = rect.width * dpi;
            canvas.height = rect.height * dpi;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.scale(dpi, dpi);

        const w = rect.width;
        const h = rect.height;
        const centerX = w / 2;
        const centerY = h / 2;
        const vH = window.innerHeight;

        let rotationX = 0;
        let groundY = 0;
        let opacity3D = 1;
        let tiltProgress = 0;
        const deltaProgress = Math.abs(progress - this.prevProgress);
        this.prevProgress = progress;
        const isMoving = deltaProgress > 0.0001;

        const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

        // ── TRAQUETEO RÍTMICO ACTUALIZADO (RHYTHMIC RATTLE) ──
        // Emula el galope o el movimiento de una carreta con oscilación rítmica
        const rattleFreq = Date.now() * 0.075;
        const rattleBase = (deltaProgress > 0.0001) ? (2 + Math.sin(rattleFreq) * 2) * (1 - progress) : 0;
        const jitterX = (Math.random() - 0.5) * rattleBase + Math.sin(rattleFreq * 0.5) * (rattleBase * 0.3);
        const jitterY = (Math.random() - 0.5) * rattleBase + Math.cos(rattleFreq * 0.5) * (rattleBase * 0.3);

        let dollyFrom = progress * 2200;
        const h_unit = this.linesFrom.length * 32;
        const w_max = this.linesFrom.length > 0 ? Math.max(...this.linesFrom.map(l => l.width)) : 0;
        const numRepeats = 5;
        const h_total = h_unit * numRepeats;
        const zArrival = 5800;
        const dollyTo = progress * (zArrival - 500);

        const fromStyle = this.fromElement ? window.getComputedStyle(this.fromElement) : null;
        const fromWeight = fromStyle ? fromStyle.fontWeight : '400';
        const fromSize = fromStyle ? parseFloat(fromStyle.fontSize) : 16;

        if (this.fromElement) {
            const fromRect = this.fromElement.getBoundingClientRect();
            const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
            const handoverThreshold = vH * 0.15;

            if (fromRect.bottom > handoverThreshold) {
                this.fromElement.style.visibility = 'visible';
                opacity3D = 0;
                tiltProgress = 0;
            } else {
                this.fromElement.style.visibility = 'hidden';
                opacity3D = 1;
                const exitDist = 400;
                const rawTilt = Math.max(0, Math.min(1, (handoverThreshold - fromRect.bottom) / exitDist));
                tiltProgress = easeOutQuart(rawTilt);
                rotationX = (85 * tiltProgress) * (Math.PI / 180);
                const initialY = fromRect.top + (fromRect.height / 2) - centerY;
                const targetGroundY = 220;
                groundY = initialY * (1 - tiltProgress) + targetGroundY * tiltProgress;
            }
        } else {
            tiltProgress = 1;
            rotationX = 85 * (Math.PI / 180);
            groundY = 220;
        }
        
        ctx.textBaseline = 'middle';
        const toStyle = this.toElement ? window.getComputedStyle(this.toElement) : null;
        const targetColor = toStyle ? toStyle.color : 'rgb(13, 9, 0)';
        const targetFontSize = toStyle ? parseFloat(toStyle.fontSize) : 16;
        const targetWeight = toStyle ? toStyle.fontWeight : '400';
        const lineH = toStyle ? parseFloat(toStyle.lineHeight) : 32;

        const transitionStart = 0.82;
        const handoverEnd = 0.99;
        const handoverRange = handoverEnd - transitionStart;

        let didSaveFrom = false;
        if (this.linesFrom.length > 0) {
            const corners = [
                { x: -w_max / 2, y_rel: -h_total + (h_unit / 2) },
                { x: w_max / 2, y_rel: -h_total + (h_unit / 2) },
                { x: w_max / 2, y_rel: h_unit / 2 + 40 },
                { x: -w_max / 2, y_rel: h_unit / 2 + 40 }
            ];

            const projected = corners.map(p => {
                const y1 = groundY + p.y_rel * Math.cos(rotationX);
                const z1 = -p.y_rel * Math.sin(rotationX);
                const zFinal = z1 + 1000 - dollyFrom;
                if (zFinal <= 1) return null;
                const fovScale = 700 / zFinal;
                return { x: centerX + p.x * fovScale, y: centerY + y1 * fovScale };
            }).filter(p => p !== null);

            if (projected.length === 4) {
                const alphaDist = Math.max(0, 1 - (progress * 1.1));
                ctx.globalAlpha = opacity3D * alphaDist;
                ctx.save();
                didSaveFrom = true;
                ctx.beginPath();
                ctx.moveTo(projected[0].x, projected[0].y);
                ctx.lineTo(projected[1].x, projected[1].y);
                ctx.lineTo(projected[2].x, projected[2].y);
                ctx.lineTo(projected[3].x, projected[3].y);
                ctx.closePath();
                ctx.clip();
            }
        }

        ctx.textAlign = 'center';
        for (let j = numRepeats - 1; j >= 0; j--) {
            const y_offset = -j * h_unit;
            this.linesFrom.forEach((line, i) => {
                const y_rel = (i - this.linesFrom.length / 2) * 32 + y_offset;
                const y1 = groundY + y_rel * Math.cos(rotationX);
                const z1 = -y_rel * Math.sin(rotationX);
                const zFinal = z1 + 1000 - dollyFrom;
                if (zFinal <= 1 || zFinal > 4800) return;
                const fovScale = 700 / zFinal;
                const x_proj = centerX + jitterX;
                const y_proj = centerY + y1 * fovScale + jitterY;
                let alphaDist = 1.0;
                if (progress > transitionStart) {
                    alphaDist = Math.max(0, 1 - (progress - transitionStart) / (handoverEnd - transitionStart));
                }
                const zMid = z1 + 1000 - dollyFrom;
                const distanceFade = Math.max(0, Math.min(1, (4000 - zMid) / 200));
                ctx.globalAlpha = opacity3D * alphaDist * Math.min(1, zFinal / 200) * (0.8 * distanceFade);
                const padX = 8;
                const padY = 16;
                const lineCorners = [
                    { x: -line.width / 2 - padX, y_rel: y_rel - padY },
                    { x: line.width / 2 + padX, y_rel: y_rel - padY },
                    { x: line.width / 2 + padX, y_rel: y_rel + padY },
                    { x: -line.width / 2 - padX, y_rel: y_rel + padY }
                ];
                const lineProj = lineCorners.map(p => {
                    const py1 = groundY + p.y_rel * Math.cos(rotationX);
                    const pz1 = -p.y_rel * Math.sin(rotationX);
                    const pzFinal = pz1 + 1000 - dollyFrom;
                    if (pzFinal <= 1) return null;
                    const pScale = 700 / pzFinal;
                    return { x: centerX + p.x * pScale + jitterX, y: centerY + py1 * pScale + jitterY };
                }).filter(p => p !== null);
                if (lineProj.length === 4) {
                    ctx.beginPath();
                    ctx.moveTo(lineProj[0].x, lineProj[0].y);
                    ctx.lineTo(lineProj[1].x, lineProj[1].y);
                    ctx.lineTo(lineProj[2].x, lineProj[2].y);
                    ctx.lineTo(lineProj[3].x, lineProj[3].y);
                    ctx.closePath();
                    ctx.fillStyle = '#fdfcf0';
                    ctx.fill();
                }
                const fs = Math.floor(fromSize * fovScale);
                if (fs < 2) return;
                const fromR = Math.floor(13 + (139 - 13) * tiltProgress);
                const fromG = Math.floor(9 + (69 - 9) * tiltProgress);
                const fromB = Math.floor(0 + (19 - 0) * tiltProgress);
                ctx.font = `${fromWeight} ${fs}px "Courier New", monospace`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle'; // Alineación innegociable
                ctx.fillStyle = `rgb(${fromR}, ${fromG}, ${fromB})`;
                ctx.fillText(line.text, x_proj, y_proj);
            });
        }
        if (didSaveFrom) ctx.restore();

        // ── ACTUALIZAR Y RENDERIZAR POLVO (Gatillo Seguro) ──
        const isStableOnGround = (tiltProgress >= 0.88 && progress > 0.22);
        if (isStableOnGround) this.hasScrolledOnGround = true; 
        
        this.updateDust(deltaProgress, centerX, groundY, dollyFrom, w_max, tiltProgress, isStableOnGround);
        this.renderDust(ctx, centerX, centerY, groundY, dollyFrom, jitterX, jitterY);

        if (this.toElement) {
            if (progress < transitionStart) {
                this.toElement.style.visibility = 'hidden';
                this.toElement.style.opacity = '0';
                this.toElement.style.pointerEvents = 'none';
            } else if (progress >= handoverEnd) {
                this.toElement.style.visibility = 'visible';
                this.toElement.style.opacity = '1';
                this.toElement.style.pointerEvents = 'auto';
            } else {
                const fadeProgress = (progress - transitionStart) / handoverRange;
                const easedFade = easeInOutCubic(Math.min(1, Math.max(0, fadeProgress)));
                this.toElement.style.visibility = 'visible';
                this.toElement.style.opacity = easedFade;
                this.toElement.style.pointerEvents = 'auto';
            }
        }

        if (progress >= 0.999 || progress <= 0) {
            this.canvas.style.display = 'none';
            return;
        } else {
            this.canvas.style.display = 'block';
        }

        const rawFactor = progress > transitionStart ? (progress - transitionStart) / (1 - transitionStart) : 0;
        const flattenFactor = easeInOutCubic(rawFactor);
        ctx.textAlign = 'left';

        ctx.save();
        let horizonClipY = 0;
        if (this.fromElement) {
            const fromRect = this.fromElement.getBoundingClientRect();
            horizonClipY = Math.max(0, fromRect.bottom);
        } else {
            horizonClipY = centerY + (groundY * 0.5);
        }
        ctx.beginPath();
        ctx.rect(0, horizonClipY, w, h - horizonClipY);
        ctx.clip();

        let didSaveTo = false;
        if (this.linesTo.length > 0) {
            const h_unit_to = lineH;
            const h_total_to = this.linesTo.length * h_unit_to;
            const w_max_to = Math.max(...this.linesTo.map(l => l.width)) + 120;
            const corners_to = [
                { x: -w_max_to / 2, y_rel: -h_total_to / 2 - 40 },
                { x: w_max_to / 2, y_rel: -h_total_to / 2 - 40 },
                { x: w_max_to / 2, y_rel: h_total_to / 2 + 40 },
                { x: -w_max_to / 2, y_rel: h_total_to / 2 + 40 }
            ];
            const projected_to = corners_to.map(p => {
                const zFinal = zArrival - dollyTo;
                if (zFinal <= 1) return null;
                const scale = Math.min(1.0, 700 / zFinal);
                const x3 = centerX + p.x * scale;
                const y3 = centerY + p.y_rel * scale;
                const toRect = this.toElement.getBoundingClientRect();
                const x_anchor = toRect.left + (window.innerWidth < 768 ? window.innerWidth * 0.08 : 0);
                const y_anchor = toRect.top;
                let xf = x_anchor + (w_max_to - 120) / 2 + p.x;
                let yf = y_anchor + (p.y_rel + h_total_to / 2);
                return { x: x3 * (1 - flattenFactor) + xf * flattenFactor + jitterX, y: y3 * (1 - flattenFactor) + yf * flattenFactor + jitterY };
            }).filter(p => p !== null);

            if (projected_to.length === 4) {
                const pHandover = progress > transitionStart ? (progress - transitionStart) / handoverRange : 0;
                const plateAlpha = Math.min(1, progress * 4) * (1 - easeInOutCubic(Math.min(1, pHandover)));
                ctx.globalAlpha = Math.max(0, plateAlpha);
                ctx.save();
                didSaveTo = true;
                ctx.beginPath();
                ctx.moveTo(projected_to[0].x, projected_to[0].y);
                ctx.lineTo(projected_to[1].x, projected_to[1].y);
                ctx.lineTo(projected_to[2].x, projected_to[2].y);
                ctx.lineTo(projected_to[3].x, projected_to[3].y);
                ctx.closePath();
                ctx.clip();
            }
        }

        this.linesTo.forEach((line, i) => {
            const y_rel = (i - this.linesTo.length / 2) * lineH;
            const zFinal = zArrival - dollyTo;
            if (zFinal <= 1) return;
            const scale = Math.min(1.0, 700 / zFinal);
            let x_flat = centerX - line.width / 2;
            let y_flat = centerY + y_rel;
            if (this.toElement) {
                const toRect = this.toElement.getBoundingClientRect();
                x_flat = toRect.left;
                y_flat = toRect.top + i * lineH + lineH / 2;
            }
            const buildingStretch = 1 + (2.0 * Math.pow(1 - progress, 1.5));
            const y_stretched = y_rel * buildingStretch;
            const textBlockHeight = this.linesTo.length * lineH;
            const y_3d_bottom_offset = (textBlockHeight / 2) * (buildingStretch - 1);
            const y_3d_pos = (groundY + y_stretched) - y_3d_bottom_offset;
            let x_flat_center = centerX;
            if (this.toElement) {
                const toRect = this.toElement.getBoundingClientRect();
                x_flat_center = toRect.left + line.width / 2;
            }
            const x_3d = centerX - (line.width * scale) / 2;
            const x_3d_adj = x_3d + (x_flat_center - centerX) * (1 - progress); 
            const y_3d = centerY + y_3d_pos * scale;
            const x_proj = x_3d_adj * (1 - flattenFactor) + x_flat * flattenFactor + jitterX;
            const y_proj = y_3d * (1 - flattenFactor) + y_flat * flattenFactor + jitterY;
            const finalScale = scale * (1 - flattenFactor) + 1.0 * flattenFactor;
            const match = targetColor.match(/\d+/g);
            const r = match ? parseInt(match[0]) : 13;
            const g = match ? parseInt(match[1]) : 9;
            const b = match ? parseInt(match[2]) : 0;
            let canvasAlpha = Math.min(1, Math.pow(Math.max(0, (progress - 0.05) * 1.5), 1.2));
            if (progress > transitionStart) {
                const pHandover = (progress - transitionStart) / handoverEnd;
                canvasAlpha *= (1 - easeInOutCubic(Math.min(1, pHandover)));
            }
            const padX = 8;
            const padY = lineH / 2;
            const lCornersTo = [
                { x: -line.width / 2 - padX, y_rel: -padY },
                { x: line.width / 2 + padX, y_rel: -padY },
                { x: line.width / 2 + padX, y_rel: +padY },
                { x: -line.width / 2 - padX, y_rel: +padY }
            ];
            const lProjTo = lCornersTo.map(p => {
                const zF = zArrival - dollyTo;
                const pScale = Math.min(1.0, 700 / Math.max(1, zF));
                const px3 = centerX + p.x * pScale;
                const py3 = centerY + (y_3d_pos + p.y_rel) * pScale;
                const pxf = x_flat + (line.width / 2) + p.x;
                const pyf = y_flat + p.y_rel;
                return { x: px3 * (1 - flattenFactor) + pxf * flattenFactor, y: py3 * (1 - flattenFactor) + pyf * flattenFactor };
            }).filter(p => p !== null);
            if (lProjTo.length === 4) {
                ctx.save();
                ctx.globalAlpha = Math.min(1, canvasAlpha * 2);
                ctx.beginPath();
                ctx.moveTo(lProjTo[0].x, lProjTo[0].y);
                ctx.lineTo(lProjTo[1].x, lProjTo[1].y);
                ctx.lineTo(lProjTo[2].x, lProjTo[2].y);
                ctx.lineTo(lProjTo[3].x, lProjTo[3].y);
                ctx.closePath();
                ctx.fillStyle = '#fdfcf0';
                ctx.fill();
                ctx.restore();
            }
            ctx.globalAlpha = canvasAlpha;
            ctx.font = `${targetWeight} ${Math.floor(targetFontSize * finalScale)}px "Courier New", monospace`;
            const horizonFade = Math.min(1, (3000 - zFinal) / 500);
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${horizonFade})`;
            ctx.fillText(line.text, x_proj, y_proj);
        });
        if (didSaveTo) ctx.restore();
        ctx.restore();
        ctx.restore();
    }

    updateDust(delta, centerX, groundY, dollyFrom, w_max, tiltProgress, isStableOnGround) {
        const source = this.fromText;
        const rotationX = (85 * tiltProgress) * (Math.PI / 180);
        const h_unit = (this.linesFrom.length || 1) * 32;
        const numRepeats = 8;

        if (isStableOnGround) {
            // 1. Emisión ambiental "Fricción y Viento" (ROAD_DUST)
            if (Math.random() > 0.1) { // Mayor densidad de partículas
                const useTo = (this.progress > 0.45 && this.linesTo.length > 0 && Math.random() > 0.5);
                const pool = useTo ? this.linesTo : this.linesFrom;
                if (pool.length > 0) {
                    const i = Math.floor(Math.random() * pool.length);
                    const j = Math.floor(Math.random() * numRepeats);
                    const lineText = pool[i].text || " ";
                    const yPaper = (i - pool.length / 2) * 32 - j * h_unit;
                    
                    const rotS = useTo ? (85 * (1 - this.progress)) * (Math.PI / 180) : rotationX;
                    const pZ = -yPaper * Math.sin(rotS);
                    const zFinal = pZ + 1000 - dollyFrom;

                    if (zFinal > 120 && zFinal < 4600) { // Mayor span (cobertura)
                        const charIdx = Math.floor(Math.random() * lineText.length);
                        const charWidth = (pool[i].width || w_max) / lineText.length;
                        const exactX = (charIdx - lineText.length / 2) * charWidth;
                        
                        this.dust.push({
                            type: 'ROAD_DUST',
                            x: exactX,
                            y: 0, 
                            z: pZ,
                            vx: 0.4 + Math.random() * 1.2, // Muy lento inicial (fricción)
                            ax: 0.15 + Math.random() * 0.25, // Aceleración inicial suave
                            vy: 0,
                            vz: 0,
                            char: lineText[charIdx] || '.',
                            life: 1.2, // Más vida para ver el arrastre
                            rot: Math.random() * 6.28, 
                            vRot: (Math.random() > 0.5 ? 1 : -1) * (0.1 + Math.random() * 0.2), // Mucha rotación (rodar)
                            flutter: Math.random() * 6.28,
                            scaleMult: 1.0
                        });
                    }
                }
            }

            // 2. Nube de Estela (WAK_CLOUD) - Impulsiva (Ataque)
            const isMoving = delta > 0.0001;
            if (this.hasScrolledOnGround && isMoving && this.progress < 0.98 && Math.random() > 0.3) {
                const num = Math.min(4, Math.ceil(delta * 1200)); 
                const baseZ = (dollyFrom - 450) + (Math.random() - 0.5) * 200; 

                for (let i = 0; i < num; i++) {
                    if (Math.random() > 0.4) continue; 
                    const char = source[Math.floor(Math.random() * source.length)] || ' ';
                    if (char === ' ') continue;
                    this.dust.push({
                        type: 'WAK_CLOUD',
                        x: (Math.random() - 0.5) * (w_max + 150),
                        y: 0,
                        z: baseZ + (Math.random() - 0.5) * 300,
                        vx: (Math.random() - 0.5) * 4, 
                        vy: -2 - Math.random() * 5, // Salto impulsivo (Ataque)
                        vz: (Math.random() - 0.5) * 2,
                        char: char,
                        life: 0.7 + Math.random() * 0.3, 
                        rot: Math.random() * 6.28,
                        vRot: (Math.random() - 0.5) * 0.2,
                        growth: 1.04 + Math.random() * 0.03, // Expansión rápida
                        flutter: Math.random() * 6.28,
                        scaleMult: 0.8 + Math.random() * 0.4
                    });
                }
            }
        }

        // Físicas Unificadas
        for (let i = this.dust.length - 1; i >= 0; i--) {
            const p = this.dust[i];
            
            // Aceleración y Viento no lineal (ROAD_DUST)
            if (p.type === 'ROAD_DUST') {
                // Aceleración progresiva (se dispara al final o lejos del centro)
                const edgeBoost = (Math.abs(p.x) > w_max * 0.4 || p.life < 0.5) ? 1.5 : 1.0;
                p.vx += (p.ax || 0.1) * edgeBoost;
                
                p.flutter = (p.flutter || 0) + 0.12;
                // Wobble orgánico (Viento no lineal - Perlin style)
                p.z += Math.sin(p.flutter) * 1.2;
                p.x += Math.cos(p.flutter * 0.5) * 0.7;
            }
            
            p.x += (p.vx || 0);
            
            // Flutter orgánico (Solo para WAK_CLOUD)
            if (p.type === 'WAK_CLOUD') {
                p.flutter = (p.flutter || 0) + 0.15;
                p.x += Math.sin(p.flutter) * 0.8; 
            }

            p.y += (p.vy || 0);
            p.z += (p.vz || 0);
            p.rot += (p.vRot || 0);

            // Desvanecimiento orgánico
            p.life -= (p.type === 'WAK_CLOUD' ? 0.035 : 0.015);

            if (p.type === 'WAK_CLOUD') p.scaleMult *= p.growth;

            const zF = (p.z || 0) + 1000 - dollyFrom;
            if (p.life <= 0 || zF < -300 || zF > 5000) this.dust.splice(i, 1);
        }

        if (this.dust.length > 300) this.dust.splice(0, 50);
    }

    renderDust(ctx, centerX, centerY, groundY, dollyFrom, jX, jY) {
        const chars = this.dust;
        ctx.save();
        
        for (let i = 0; i < chars.length; i++) {
            const p = chars[i];
            const zFinal = (p.z || 0) + 1000 - dollyFrom;

            if (zFinal <= 40 || zFinal > 5000) continue;
            
            const fov = 700 / zFinal;
            const x_proj = centerX + (p.x || 0) * fov + jX;
            const y_proj = centerY + (groundY + (p.y || 0)) * fov + jY;

            if (isNaN(x_proj) || isNaN(y_proj)) continue;

            const scale = fov * (p.scaleMult || 1.0);
            ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.5));
            
            ctx.save();
            ctx.translate(x_proj, y_proj);
            ctx.rotate(p.rot || 0);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle'; 

            if (p.type === 'ROAD_DUST') {
                // SINCRO DE TAMAÑO CON EL PISO (16px base)
                ctx.font = `bold ${Math.floor(16 * scale)}px "Courier New", monospace`;
                ctx.fillStyle = '#8B4513'; 
                ctx.fillText(p.char, 0, 0);
            } else {
                const atlasX = ASCII_ATLAS.charMap.get(p.char) ?? 0;
                const cw = 14, ch = 22;
                ctx.drawImage(ASCII_ATLAS.canvas, atlasX, ch * 2, cw, ch, -(cw * scale) / 2, -(ch * scale) / 2, cw * scale, ch * scale);
            }
            ctx.restore();
        }
        ctx.restore();
    }
}
