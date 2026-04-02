// SEDA: LEGIT ASCII ART ENGINE
// No weird shit. No pixel gaps. Just text.

let textoLeido = "SEDA. ";

const firmasViaje = {
    tierra: ["HERVÉ JONCOUR partió", "HERVË JONCOUR partió", "A pie, recorriendo caminos secundarios", "ochocientos kilómetros de tierra"],
    mar: ["SEIS DÍAS después", "Seis días después", "barco llamado Adel", "mil seiscientas millas de mar"]
};

function analizarViaje(texto) {
    const esMar = firmasViaje.mar.some(f => texto.includes(f));
    const esTierra = firmasViaje.tierra.some(f => texto.includes(f));
    if (esMar) return { tipo: 'agua' };
    if (esTierra) return { tipo: 'tierra' };
    return { tipo: 'normal' };
}

class ASCIIOcean {
    constructor(canvas, vesselCanvas, parentTrack, lineInfo, vesselHeight) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.vesselCanvas = vesselCanvas;
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

        // VORONOI MATRIX
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

        // PHYSICAL STATE (Optimized with Float32Arrays)
        this.numRows = Math.ceil(canvas.height / this.charSize.h);
        this.numCols = Math.ceil(canvas.width / this.charSize.w);
        const totalParticles = this.numRows * this.numCols;

        this.vx = new Float32Array(totalParticles);
        this.vy = new Float32Array(totalParticles);
        this.ox = new Float32Array(totalParticles);
        this.oy = new Float32Array(totalParticles);

        // Noise & Shore Wave pre-allocation
        this.noiseTopBuffer = new Float32Array(this.numCols);
        this.noiseBotBuffer = new Float32Array(this.numCols);
        this.shoreWaveBuffer = new Float32Array(this.numCols);
    }

    render() {
        if (!this.isVisible) return;

        const { ctx, canvas, charSize, matrix, patternSize, vesselCanvas, numRows, numCols } = this;
        const dpi = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();

        const targetW = Math.floor(rect.width * dpi);
        const targetH = Math.floor(rect.height * dpi);
        if (canvas.width !== targetW) canvas.width = targetW;
        if (canvas.height !== targetH) canvas.height = targetH;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.scale(dpi, dpi);

        ctx.font = 'bold 17px "Courier New", monospace';
        this.time += 0.35;
        const vH = window.innerHeight;

        // CAMERA CULLING
        const viewportTop = -rect.top;
        const viewportBottom = viewportTop + vH;
        const startR = Math.max(0, Math.floor((viewportTop - 400) / charSize.h));
        const endR = Math.min(numRows, Math.ceil((viewportBottom + 400) / charSize.h));

        const surfTime = this.time * 0.06;
        const colorBase = '#365d7e';   // azul oscuro
        const colorLuz = '#9dedfacc'; // cian claro, ligero alpha
        const recentText = textoLeido.slice(-5000) || "SEDA ";
        const textLen = recentText.length;
        const shift = Math.floor(this.time);
        const patternMask = patternSize - 1; // 63

        // PRE-CALCULATE NOISE PER COLUMN (Enhanced Waves)
        for (let c = 0; c < numCols; c++) {
            const wave1 = Math.sin(c * 0.12 + surfTime) * 0.8;
            const wave2 = Math.sin(c * 0.05 - surfTime * 1.5) * 1.2;
            const wave3 = Math.sin(c * 0.25 + surfTime * 2) * 0.3; // Micro-ondas
            const nT = wave1 + wave2 + wave3;
            this.noiseTopBuffer[c] = nT;
            this.noiseBotBuffer[c] = Math.sin(c * 0.10 + surfTime) * 0.6 + Math.sin(c * 0.06 + surfTime * 1.1) * 0.9;

            // PRE-CALCULAR ONDA DE ORILLA: Unificada con el ruido
            this.shoreWaveBuffer[c] = (nT * charSize.h * 1.3 + Math.sin(c * 0.19 + surfTime * 1.4) * charSize.h * 0.5);
        }

        // POSITION VESSEL
        this.currentOffset += (this.targetOffset - this.currentOffset) * 0.08;
        vesselCanvas.style.transform = `translateY(${this.currentOffset}px)`;

        const vRect = vesselCanvas.getBoundingClientRect();
        const vL = vRect.left - rect.left;
        const vT = vRect.top - rect.top;

        const power = 3.5;
        const spring = 0.04;
        const friction = 0.88;
        const vRadius = 110;
        const vRadiusSq = vRadius * vRadius;
        const PADDING = 120;
        const LINE_H = 26;
        const numLines = this.lineInfo ? this.lineInfo.length : 0;
        const boxTop = vT + 60;
        const boxBot = vT + PADDING + numLines * LINE_H + 30;
        const waterLineFull = this.overflowTop + this.waterTopGap;

        // Hull edges (usadas en todos los eventos de agua)
        const hullLeft = vL + 80;
        const hullRight = vL + 120 + (this.lineInfo[0]?.width || 300) + 40;

        // ESTADOS DE INMERSION
        const currentSubmerged = boxBot > waterLineFull + 20;       // fondo debajo del agua
        const fullySubmerged = boxTop > waterLineFull;             // todo el casco sumergido
        const fullyOut = boxBot <= waterLineFull + 20;       // completamente fuera

        // ── ENTRADA: el fondo cruza la superficie ──────────────────────────────
        if (currentSubmerged && !this.isSubmerged) {
            this.splashes.push({
                x: vL + 120 + 300,
                y: waterLineFull,
                r: 0, maxR: 300, force: 15, life: 1.0
            });
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

        // ── SALIDA PARCIAL: el tope emerge mientras el fondo sigue dentro ──────
        if (!fullySubmerged && this.wasFullySubmerged) {
            // Letras disparadas hacia arriba desde la línea de agua
            for (let i = 0; i < 14; i++) {
                const xPos = hullLeft + Math.random() * (hullRight - hullLeft);
                this.droplets.push({
                    x: xPos, y: waterLineFull,
                    vx: (Math.random() - 0.5) * 4,
                    vy: -(Math.random() * 7 + 3),
                    life: 1.3 + Math.random() * 0.5,
                    char: recentText[Math.floor(Math.random() * textLen)] || ' ',
                    bright: Math.random() > 0.5,
                    drip: false
                });
            }
        }

        // ── SALIDA TOTAL: el fondo cruza la superficie hacia arriba ────────────
        if (fullyOut && !this.isDripping && this.isSubmerged) {
            // Arrancar el goteo desde el fondo del casco
            this.isDripping = true;
            this.drippingTimer = 80; // frames de goteo
        }
        if (this.isDripping) {
            this.drippingTimer--;
            if (this.drippingTimer % 4 === 0) {
                this.droplets.push({
                    x: hullLeft + Math.random() * (hullRight - hullLeft),
                    y: boxBot,
                    vx: (Math.random() - 0.5) * 0.8,
                    vy: Math.random() * 1.5 + 0.5, // cae hacia abajo
                    life: 1.4 + Math.random() * 0.4,
                    char: recentText[Math.floor(Math.random() * textLen)] || ' ',
                    bright: Math.random() > 0.5,
                    drip: true
                });
            }
            if (this.drippingTimer <= 0) this.isDripping = false;
        }

        this.isSubmerged = currentSubmerged;
        this.wasFullySubmerged = fullySubmerged;

        // UPDATE SPLASHES
        for (let i = this.splashes.length - 1; i >= 0; i--) {
            const s = this.splashes[i];
            s.r += 12; // Velocidad de expansión de la onda
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

                // Repulsión por Splash (forma irregular)
                for (let i = 0; i < this.splashes.length; i++) {
                    const s = this.splashes[i];
                    const dxS = cX - s.x;
                    const dyS = cY - s.y;
                    const dS = Math.sqrt(dxS * dxS + dyS * dyS);
                    // Ruido angular: deforma el radio esperado según el ángulo
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

                if (inHullRange) {
                    let activeW, activeStartX;
                    const lineIdx = Math.floor((homeY - boxTop) / LINE_H);
                    if (lineIdx >= 0 && lineIdx < numLines) {
                        activeW = this.lineInfo[lineIdx]?.width || 0;
                        activeStartX = this.lineInfo[lineIdx]?.startX || PADDING;
                    } else {
                        activeW = (this.lineInfo[numLines - 1]?.width || 0) * 0.6;
                        activeStartX = PADDING + 225 - (activeW / 2); // 225 is 450/2
                    }

                    const vL_col = vL + activeStartX - 40;
                    const vR_col = vL + activeStartX + activeW + 40;

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
                } else {
                    const waveT = (1.6 + noiseT) * charSize.h + waterLineFull;
                    const waveB = canvas.height - (1.6 + noiseB) * charSize.h;
                    if (homeY < waveT || homeY > waveB) {
                        if (Math.abs(this.oy[idx]) < 3 && Math.abs(this.ox[idx]) < 3) continue;
                    }
                }

                // FÍSICA DE SUPERFICIE
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

                ctx.fillStyle = (patternVal === 1) ? colorLuz : colorBase;
                const char = recentText[(c + r * numCols) % textLen] || ' ';
                ctx.fillText(char, homeX + this.ox[idx], homeY + this.oy[idx]);
            }
        }

        // GOTAS Y SALPICADURAS
        const gravity = 0.22;
        for (let i = this.droplets.length - 1; i >= 0; i--) {
            const drop = this.droplets[i];
            drop.vy += drop.drip ? gravity * 0.6 : gravity; // gotas caen más despacio
            drop.x += drop.vx;
            drop.y += drop.vy;
            drop.life -= 0.013;
            // Culling distinto para gotas hacia arriba vs hacia abajo
            if (drop.life <= 0) { this.droplets.splice(i, 1); continue; }
            if (drop.drip && drop.y > waterLineFull + 10) { this.droplets.splice(i, 1); continue; }
            if (!drop.drip && drop.y > waterLineFull + 30) { this.droplets.splice(i, 1); continue; }

            ctx.globalAlpha = Math.min(1, drop.life);
            ctx.fillStyle = drop.bright ? colorLuz : colorBase;
            ctx.fillText(drop.char, drop.x, drop.y);
        }
        ctx.globalAlpha = 1;

        ctx.restore();
    }
}

let activeOceans = [];

function inyectarParrafo(textoParrafo, contenedorPadre) {
    const info = analizarViaje(textoParrafo);
    textoLeido += textoParrafo + " ";

    if (info.tipo !== 'agua') {
        const p = document.createElement('p');
        p.classList.add('normal-text');
        if (info.tipo === 'tierra') p.style.color = '#8b4513';
        p.innerText = textoParrafo;
        contenedorPadre.appendChild(p);
        return;
    }

    // Configuración de texto para Viaje (Párrafo Normal)
    const FONT_SIZE = 16;
    const LINE_HEIGHT = 26;
    // Ajustes responsivos para el ancho del barco y márgenes
    const isMobile = window.innerWidth < 768;
    const MAX_WIDTH = Math.min(580, window.innerWidth - (isMobile ? 40 : 80));
    const PADDING = isMobile ? 30 : 120; // Margen blanco más pequeño en celular

    const fontString = `${FONT_SIZE}px "Courier New", monospace`;
    const prepared = window.Pretext.prepareWithSegments(textoParrafo, fontString);
    const linesArray = [];
    let cur = { segmentIndex: 0, graphemeIndex: 0 };
    while (true) {
        const line = window.Pretext.layoutNextLine(prepared, cur, MAX_WIDTH);
        if (!line) break;
        linesArray.push(line);
        cur = line.end;
    }

    const textHeight = (linesArray.length * LINE_HEIGHT);
    const lineInfo = [];

    let track = document.createElement('div');
    track.classList.add('zona-viaje', 'viaje-agua');

    const trueWidth = MAX_WIDTH + PADDING * 2;
    const trueHeight = textHeight + PADDING * 2;
    const trackHeight = trueHeight + window.innerHeight * 2.5;

    let asciiCanvas = document.createElement('canvas');
    asciiCanvas.className = "ascii-bg";
    asciiCanvas.style.top = "-800px";
    // Dimensiones de píxeles reales (Crucial para el motor de partículas)
    asciiCanvas.width = window.innerWidth;
    asciiCanvas.height = trackHeight + 800;

    let textCanvas = document.createElement('canvas');
    const dpi = window.devicePixelRatio || 1;
    textCanvas.width = trueWidth * dpi;
    textCanvas.height = trueHeight * dpi;

    // EVITAR EL DOWNSCALING
    textCanvas.style.width = `${trueWidth}px`;
    textCanvas.style.height = `${trueHeight}px`;
    textCanvas.classList.add('hilo-narrativo');

    let ctx = textCanvas.getContext('2d');
    ctx.scale(dpi, dpi);
    ctx.clearRect(0, 0, MAX_WIDTH + PADDING * 2, textHeight + PADDING * 2);

    // FONDO ORGÁNICO (Párrafo Dientes de Sierra simple)
    ctx.textBaseline = 'top';
    ctx.font = fontString;

    if (linesArray.length > 0) {
        linesArray.forEach(line => {
            const w = ctx.measureText(line.text).width;
            lineInfo.push({ width: w, startX: PADDING });
        });

        ctx.fillStyle = '#fdfcf0';

        // Bloques por línea (Casco en sierra) — +1px de solapamiento para evitar rendijas sub-píxel
        linesArray.forEach((line, i) => {
            const h = Math.floor(PADDING + i * LINE_HEIGHT);
            ctx.fillRect(lineInfo[i].startX - 40, h, lineInfo[i].width + 80, LINE_HEIGHT + 1);
        });

        // Remates planos
        ctx.fillRect(lineInfo[0].startX - 40, Math.floor(PADDING - LINE_HEIGHT), lineInfo[0].width + 80, LINE_HEIGHT + 1);
        const lastI = linesArray.length - 1;
        ctx.fillRect(lineInfo[lastI].startX - 40, Math.floor(PADDING + (lastI + 1) * LINE_HEIGHT), lineInfo[lastI].width + 80, LINE_HEIGHT + 1);
    }

    // Dibujado del texto centrado en su formato
    ctx.fillStyle = '#010101ff';
    linesArray.forEach((line, i) => {
        const h = PADDING + i * LINE_HEIGHT;
        ctx.fillText(line.text, lineInfo[i].startX, h);
    });

    // CÁMARA DE VIDEOJUEGO: Track de 200vh para permitir centrado sticky
    track.style.height = (trueHeight + window.innerHeight * 2.5) + "px";
    track.appendChild(asciiCanvas);
    track.appendChild(textCanvas);
    contenedorPadre.appendChild(track);

    const ocean = new ASCIIOcean(asciiCanvas, textCanvas, track, lineInfo, trueHeight);
    activeOceans.push(ocean);
}

function setupScrollEngine() {
    function update() {
        const vH = window.innerHeight;

        activeOceans.forEach(ocean => {
            const rect = ocean.parentTrack.getBoundingClientRect();

            if (rect.top <= vH && rect.bottom >= 0) {
                ocean.isVisible = true;

                // MODO CÁMARA DE VIDEOJUEGO (Sticky Centered)
                // Queremos que el barco se mantenga en el centro de la pantalla (vH/2)
                // mientras el contenedor esté cruzando esa línea.
                const vesselH = ocean.vesselCanvas.offsetHeight;
                let targetY = (vH / 2) - (vesselH / 2) - rect.top;

                // Clampeamos el offset para que el barco no se salga de su mar (el contenedor)
                targetY = Math.max(0, Math.min(rect.height - vesselH, targetY));

                ocean.targetOffset = targetY;
                ocean.render();
            } else {
                ocean.isVisible = false;
            }
        });
        requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
}

document.addEventListener('DOMContentLoaded', () => {
    import('https://esm.sh/@chenglou/pretext?bundle').then(pretextModule => {
        window.Pretext = pretextModule;
        const contenedor = document.getElementById('libro');
        contenedor.innerHTML = '';
        textoNovela.split(/\n\s*\n/).filter(p => p.trim() !== '').forEach(txt => {
            inyectarParrafo(txt.replace(/\n/g, ' ').trim(), contenedor);
        });
        setupScrollEngine();
    }).catch(err => console.error(err));
});
