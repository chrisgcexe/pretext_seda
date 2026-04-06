/**
 * SEDA: OCEAN SYSTEM
 * Gestiona el océano ASCII y sus físicas de repulsión.
 */

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

                if (this.splashes.length > 0) {
                    for (let i = 0; i < this.splashes.length; i++) {
                        const s = this.splashes[i];
                        const dxS = cX - s.x;
                        const dyS = cY - s.y;
                        
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
                        activeStartX = this.lineInfo[lineIdx]?.startX || 120;
                    } else {
                        activeW = (this.lineInfo[numLines - 1]?.width || 0) * 0.6;
                        activeStartX = 120 + 225 - (activeW / 2);
                    }

                    const vL_col = vL + activeStartX - 40;
                    const vR_col = vL + activeStartX + activeW + 40;

                    if (cX < vL_col - vRadius || cX > vR_col + vRadius) {
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
