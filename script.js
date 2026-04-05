/**
 * SEDA: ORCHESTRATOR
 * Encargado de la ingesta de párrafos, el control del scroll y la coordinación 
 * entre el parser de texto y el motor gráfico.
 */

import { analizarViaje } from './src/parser.js';
import { ASCIIOcean, LandTransition } from './src/engine.js';

// --- ESTADO GLOBAL Y CONFIGURACIÓN ---
let textoLeido = "SEDA. ";
let ultimoTextoLeido = "";
let activeOceans = [];
let activeTransitions = [];

let isTransitionLocked = false;
let frayTransitionStarted = false;
let targetFrayProgress = 0.003;   // TENSIÓN SUTIL: 0.3% inicial
let currentFrayProgress = 0.003;
const FRAY_SCROLL_SENSITIVITY = 0.00025;
const FRAY_LERP_FACTOR = 0.06;  // Lerp más fino para feedback delicado

let silkCoreP0 = null;

/**
 * PRETEXT: Sistema de medición y layout de texto en Canvas con segmentación.
 * (Localmente extendido con getCharacterPositions)
 */
window.Pretext = {
    measureCache: new Map(),

    prepareWithSegments(text, fontString) {
        const segments = [];
        let current = "";
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            current += char;
            if (char === " " || i === text.length - 1) {
                segments.push(current);
                current = "";
            }
        }
        return { segments, fontString };
    },

    layoutNextLine(prepared, start, maxWidth) {
        const { segments, fontString } = prepared;
        if (start.segmentIndex >= segments.length) return null;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = fontString;

        let lineText = "";
        let currentWidth = 0;
        let i = start.segmentIndex;

        while (i < segments.length) {
            const seg = segments[i];
            const m = ctx.measureText(seg);
            if (currentWidth + m.width > maxWidth && lineText !== "") {
                break;
            }
            lineText += seg;
            currentWidth += m.width;
            i++;
        }

        return {
            text: lineText,
            width: currentWidth,
            end: { segmentIndex: i, graphemeIndex: 0 }
        };
    },

    getCharacterPositions(lineText, startX, startY, fontString) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = fontString;

        const positions = [];
        let currentX = startX;
        for (let i = 0; i < lineText.length; i++) {
            const char = lineText[i];
            const m = ctx.measureText(char);
            positions.push({
                char,
                x: currentX + m.width / 2,
                y: startY,
                width: m.width
            });
            currentX += m.width;
        }
        return positions;
    }
};

/**
 * SILK CANVAS ENGINE
 * Reemplaza el sistema de Spans por un Canvas de alta performance.
 */
class SilkCanvas {
    constructor(textToFray, remainingText, container, limitIndex = -1) {
        this.fullText = textToFray + remainingText;
        this.limitIndex = limitIndex;
        this.cutoff = this.fullText.length;
        this.container = container;

        this.container.innerText = this.fullText;

        // SINGLETON: Limpiamos cualquier canvas de seda previo para evitar hilos fantasma
        document.querySelectorAll('.silk-overlay-canvas').forEach(el => el.remove());

        this.canvas = document.createElement('canvas');
        this.canvas.className = 'silk-overlay-canvas';
        this.ctx = this.canvas.getContext('2d');

        document.body.appendChild(this.canvas);

        this.chars = [];
        this.isInitialized = false;
        this.hasResized = false;

        // FÍSICA PREMIUM: Cadena de partículas (Verlet) para el hilo principal
        this.nodes = [];
        this.anchorNodes = []; // Segundo set para el ancla J-O
        this.nodeCount = 25; // Nodos para suavidad física
        for (let i = 0; i < this.nodeCount; i++) {
            this.nodes.push({ x: 0, y: 0, oldX: 0, oldY: 0, pinned: (i === 0) });
            this.anchorNodes.push({ x: 0, y: 0, oldX: 0, oldY: 0, pinned: (i === 0) });
        }
    }

    setup() {
        const widthCSS = this.container.offsetWidth;
        if (widthCSS <= 0) return;

        this.container.innerText = this.fullText;
        const textNode = this.container.firstChild;
        if (!textNode || textNode.nodeType !== 3) return;

        const pRect = this.container.getBoundingClientRect();
        const fontStyle = getComputedStyle(this.container);
        this.fontString = fontStyle.font;

        // RECUPERAR COLOR: Si es transparente o blanco residual, forzar el negro narrativo
        let color = fontStyle.color;
        if (color === "rgba(0, 0, 0, 0)" || color === "transparent" || color === "rgb(255, 255, 255)") {
            color = "#0d0900";
        }
        this.textColor = color;
        this.chars = [];
        /* PLACEHOLDER: La brújula se manejará por separado a futuro */
        // this.compassNode = ...
        const range = document.createRange();

        for (let i = 0; i < this.fullText.length; i++) {
            try {
                range.setStart(textNode, i);
                range.setEnd(textNode, i + 1);

                const rects = range.getClientRects();
                if (rects.length > 0) {
                    const rect = rects[0];
                    // Coordenadas locales al párrafo (sin scroll)
                    this.chars.push({
                        char: this.fullText[i],
                        homeX: rect.left + rect.width / 2 - pRect.left,
                        homeY: rect.top + rect.height / 2 - pRect.top,
                        curX: 0, curY: 0, opacity: 1,
                        isVisible: (this.fullText[i].trim() !== "")
                    });
                }
            } catch (e) {
                console.warn("Error al medir caracter en índice", i);
            }
        }

        this.totalChars = this.chars.length;
        this.isInitialized = true;
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        const vW = window.innerWidth;
        const vH = window.innerHeight;

        this.canvas.width = vW * dpr;
        this.canvas.height = vH * dpr;
        this.ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset
        this.ctx.scale(dpr, dpr);
    }

    update(progress, targetX, targetY) {
        // Inicialización diferida
        if (!this.isInitialized) {
            this.setup();
            if (!this.isInitialized) return;
        }

        if (!this.hasResized) {
            this.resize();
            this.hasResized = true;
        }

        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        const effectiveTotal = (this.limitIndex !== -1) ? this.limitIndex + 1 : this.totalChars;
        const scaledProgress = progress * effectiveTotal;
        const currentIdx = Math.floor(scaledProgress);
        const stepProgress = scaledProgress % 1;

        const pRect = this.container.getBoundingClientRect();

        // Destino global: Priorizar parámetros, fallback a la Zona Segura (Izquierda, 5%, 15%)
        const dX = (typeof targetX === 'number') ? targetX : window.innerWidth * 0.05;
        const dY = (typeof targetY === 'number') ? targetY : window.innerHeight * 0.15;

        ctx.font = this.fontString;
        ctx.fillStyle = this.textColor;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        // UNIFICACIÓN DE HILO: Buscamos el ancla principal una sola vez antes del bucle
        let mainAnchor = this.chars[Math.min(currentIdx, this.totalChars - 1)];
        if (mainAnchor && !mainAnchor.isVisible) {
            for (let k = currentIdx + 1; k < this.totalChars; k++) {
                if (this.chars[k].isVisible) { mainAnchor = this.chars[k]; break; }
            }
        }
        // Dibujamos el hilo principal ÚNICAMENTE una vez por frame con FÍSICA
        if (mainAnchor && progress > 0) {
            this.updatePhysics(dX, dY, mainAnchor.curX, mainAnchor.curY);
            this.drawSilk(ctx);
        }

        this.chars.forEach((c, i) => {
            const isFrayLimit = (i === this.chars.length - 1); // La 'J' siempre es el último nodo físico

            const sX = pRect.left + c.homeX;
            const sY = pRect.top + c.homeY;

            if (i < currentIdx) {
                // PERSISTENCIA (El Relevo): Las letras se quedan en el corner hasta que llega la siguiente.
                // La 'J' es inmortal, se queda alli siempre.
                const isLastArrived = (i === Math.floor(currentIdx) - 1);
                if (c.char === "J" || isLastArrived) {
                    c.opacity = 1;
                } else {
                    c.opacity = 0;
                }
                c.curX = dX;
                c.curY = dY;
            } else if (i === currentIdx) {
                // LA LETRA LÍDER (Conectada directamente a la seda)
                const t = stepProgress;
                const elastic = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                c.curX = sX + (dX - sX) * elastic;
                c.curY = sY + (dY - sY) * elastic;

                // LA 'J' NO SE DESVANECE NUNCA
                if (c.char === "J") {
                    c.opacity = 1;
                } else {
                    c.opacity = Math.max(0, Math.min(1, (0.95 - elastic) * 10));
                }
            } else {
                // EFECTO DAISY CHAIN: Cada letra tira de la siguiente (como un tejido)
                const distFromActive = i - currentIdx;
                if (distFromActive < 10) { // Las siguientes 10 letras sienten la tension
                    const prevChar = this.chars[i - 1];
                    const sameLine = Math.abs(prevChar.homeY - c.homeY) < 10;

                    if (sameLine) {
                        const tensionFactor = 1 - (distFromActive / 10);
                        // Transmisión de tensión lateral
                        const dragX = (prevChar.curX - sX) * (0.2 * tensionFactor);
                        const dragY = (prevChar.curY - sY) * (0.2 * tensionFactor);
                        c.curX = sX + dragX;
                        c.curY = sY + dragY;

                        // Dibujamos el "hilo de unión" del tejido solo si están en la misma línea
                        this.drawThread(ctx, prevChar.curX, prevChar.curY, c.curX, c.curY, 0.3 * tensionFactor);
                    } else {
                        // Reseteo para el inicio de una nueva línea
                        c.curX = sX;
                        c.curY = sY;
                    }
                } else {
                    c.curX = sX;
                    c.curY = sY;
                }
                c.opacity = 1;
            }

            // --- CONEXIÓN MAESTRA J-O (Hanging Thread) ---
            if (isFrayLimit && this.hangingTarget) {
                // Precisión absoluta: Seleccionamos solo la primera letra 'o' del bloque
                const range = document.createRange();
                if (this.hangingTarget.firstChild) {
                    range.setStart(this.hangingTarget.firstChild, 0);
                    range.setEnd(this.hangingTarget.firstChild, 1);
                    const rect = range.getBoundingClientRect();
                    
                    // Trigger de Tensión: Solo dibujamos si la 'J' ya se despegó de su sitio
                    const distMoved = Math.sqrt(Math.pow(c.curX - sX, 2) + Math.pow(c.curY - sY, 2));
                    
                    if (distMoved > 2) {
                        // ACTUALIZACIÓN FÍSICA: Sincronizada con el movimiento de la seda
                        this.updateAnchorPhysics(c.curX, c.curY, rect.left, rect.top + rect.height / 2);
                        this.drawAnchorSilk(ctx);
                    }
                }
            }

            if (c.opacity > 0) {
                ctx.globalAlpha = c.opacity;
                ctx.fillText(c.char, c.curX, c.curY);
            }
        });
        ctx.globalAlpha = 1;
    }

    updatePhysics(xStart, yStart, xEnd, yEnd) {
        const gravity = 0.001; // CASI CERO: Hilo de alta tensión
        const friction = 0.90;  // MAYOR AMORTIGUACIÓN: Menos latigazos

        // Iteraciones de relajación física (Stiffness)
        const iterations = 15;
        this.nodes[0].x = xStart;
        this.nodes[0].y = yStart;

        // El último nodo persigue la letra activa
        const last = this.nodes[this.nodeCount - 1];
        last.x = xEnd;
        last.y = yEnd;

        // Integración Verlet para nodos intermedios
        for (let i = 1; i < this.nodeCount - 1; i++) {
            const n = this.nodes[i];
            const vx = (n.x - n.oldX) * friction;
            const vy = (n.y - n.oldY) * friction;
            n.oldX = n.x;
            n.oldY = n.y;
            n.x += vx;
            n.y += vy + gravity;
        }

        // Restricciones de distancia (Spring constraints)
        const totalDist = Math.sqrt(Math.pow(xEnd - xStart, 2) + Math.pow(yEnd - yStart, 2));
        const segLen = totalDist / (this.nodeCount - 1);

        for (let j = 0; j < iterations; j++) {
            for (let i = 0; i < this.nodeCount - 1; i++) {
                const p1 = this.nodes[i];
                const p2 = this.nodes[i + 1];
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const diff = (segLen - dist) / (dist || 1);
                const offsetX = dx * diff * 0.5;
                const offsetY = dy * diff * 0.5;

                if (i !== 0) { p1.x -= offsetX; p1.y -= offsetY; }
                if (i + 1 !== this.nodeCount - 1) { p2.x += offsetX; p2.y += offsetY; }
            }
        }
    }

    drawSilk(ctx) {
        ctx.save();
        // ESTÉTICA BRUTALISTA: Fibra única, cruda, sólida.
        ctx.beginPath();
        ctx.strokeStyle = "#4a7a9e"; // Azul más industrial
        ctx.lineWidth = 0.8;
        ctx.globalAlpha = 0.7;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        ctx.moveTo(this.nodes[0].x, this.nodes[0].y);
        for (let i = 1; i < this.nodeCount - 1; i++) {
            const p = this.nodes[i];
            const prev = this.nodes[i - 1];
            const xc = (p.x + prev.x) / 2;
            const yc = (p.y + prev.y) / 2;
            ctx.quadraticCurveTo(prev.x, prev.y, xc, yc);
        }
        const last = this.nodes[this.nodeCount - 1];
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
        ctx.restore();
    }

    drawThread(ctx, x1, y1, x2, y2, opacity) {
        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = "#4a7a9e"; // Azul industrial brutalista
        ctx.lineWidth = 0.5;
        ctx.globalAlpha = opacity;
        // Control point casi lineal para máxima tensión
        const cpX = x1 + (x2 - x1) * 0.5;
        const cpY = y1 + (y2 - y1) * 0.48;
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(cpX, cpY, x2, y2);
        ctx.stroke();
        ctx.restore();
    }

    drawAnchorThread(ctx, x1, y1, x2, y2) {
        // (Legacy/Static, reemplazada por drawAnchorSilk)
    }

    updateAnchorPhysics(xStart, yStart, xEnd, yEnd) {
        const gravity = 0.001; 
        const friction = 0.90;  
        const iterations = 15;
        this.anchorNodes[0].x = xStart;
        this.anchorNodes[0].y = yStart;
        const last = this.anchorNodes[this.nodeCount - 1];
        last.x = xEnd;
        last.y = yEnd;

        for (let i = 1; i < this.nodeCount - 1; i++) {
            const n = this.anchorNodes[i];
            const vx = (n.x - n.oldX) * friction;
            const vy = (n.y - n.oldY) * friction;
            n.oldX = n.x;
            n.oldY = n.y;
            n.x += vx;
            n.y += vy + gravity;
        }

        const totalDist = Math.sqrt(Math.pow(xEnd - xStart, 2) + Math.pow(yEnd - yStart, 2));
        const segLen = totalDist / (this.nodeCount - 1);

        for (let j = 0; j < iterations; j++) {
            for (let i = 0; i < this.nodeCount - 1; i++) {
                const p1 = this.anchorNodes[i];
                const p2 = this.anchorNodes[i + 1];
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const diff = (segLen - dist) / (dist || 1);
                const offsetX = dx * diff * 0.5;
                const offsetY = dy * diff * 0.5;
                if (i !== 0) { p1.x -= offsetX; p1.y -= offsetY; }
                if (i + 1 !== this.nodeCount - 1) { p2.x += offsetX; p2.y += offsetY; }
            }
        }
    }

    drawAnchorSilk(ctx) {
        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = "#4a7a9e"; // Azul industrial
        ctx.lineWidth = 0.8;
        ctx.globalAlpha = 0.7;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        ctx.moveTo(this.anchorNodes[0].x, this.anchorNodes[0].y);
        for (let i = 1; i < this.nodeCount - 1; i++) {
            const p = this.anchorNodes[i];
            const prev = this.anchorNodes[i - 1];
            const xc = (p.x + prev.x) / 2;
            const yc = (p.y + prev.y) / 2;
            ctx.quadraticCurveTo(prev.x, prev.y, xc, yc);
        }
        const last = this.anchorNodes[this.nodeCount - 1];
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
        ctx.restore();
    }
}

/**
 * LOGICA DE SOPORTE (Scroll, Ingesta, Triggers)
 */
function lockScroll(e) {
    if (isTransitionLocked) {
        e.preventDefault();
        targetFrayProgress += e.deltaY * FRAY_SCROLL_SENSITIVITY;
        targetFrayProgress = Math.max(0, Math.min(1.01, targetFrayProgress));

        if (targetFrayProgress >= 1 || targetFrayProgress <= 0) {
            isTransitionLocked = false;
            if (targetFrayProgress <= 0) frayTransitionStarted = false;
        }
        return false;
    }
}

window.addEventListener('wheel', lockScroll, { passive: false });
window.addEventListener('touchmove', lockScroll, { passive: false });

function inyectarParrafo(textoParrafo, contenedorPadre, ultimoElementoInyectado, index) {
    const info = analizarViaje(textoParrafo);

    // TRANSICIÓN 3D: Detectamos si pasamos de normal/mar a TIERRA
    if (info.tipo === 'tierra' && ultimoTextoLeido !== "" && analizarViaje(ultimoTextoLeido).tipo !== 'tierra') {
        const trans = new LandTransition(ultimoTextoLeido, textoParrafo, contenedorPadre, ultimoElementoInyectado, null);
        trans.track.id = `parrafo-viaje-${index}`;
        trans.track.setAttribute('data-index', index);
        activeTransitions.push(trans);
    }
    ultimoTextoLeido = textoParrafo;
    textoLeido += textoParrafo + " ";

    if (info.tipo === 'tierra') {
        const p = document.createElement('p');
        p.id = `parrafo-${index}`;
        p.setAttribute('data-index', index);
        p.classList.add('normal-text');
        p.innerText = textoParrafo;
        p.style.visibility = 'hidden';

        // TAG TRIGGER (Universal)
        if (/H[eé]l[eé]ne/i.test(textoParrafo) && textoParrafo.includes("mujer")) p.dataset.trigger = "helene";
        if (/ojos/i.test(textoParrafo) && /oriental/i.test(textoParrafo)) p.dataset.trigger = "japanese_woman";

        contenedorPadre.appendChild(p);

        const trans = activeTransitions[activeTransitions.length - 1];
        if (trans) trans.toElement = p;
        return p;
    }

    if (info.tipo !== 'agua') {
        const p = document.createElement('p');
        p.id = `parrafo-${index}`;
        p.setAttribute('data-index', index);
        p.classList.add('normal-text');

        // --- EFECTO DESHILACHADO (Párrafo 1) ---
        if (index === 0) {
            p.classList.add('p-initial-fray');

            // PARTICIÓN FÍSICA: Dividimos por la "J" para que sea el ancla
            const limitJ = textoParrafo.indexOf('J') + 1; // Incluimos la 'J' en la seda
            const parteSeda = textoParrafo.substring(0, limitJ);
            const parteEstatica = textoParrafo.substring(limitJ);

            const spanSeda = document.createElement('span');
            spanSeda.className = 'silk-part';

            const spanEstatica = document.createElement('span');
            spanEstatica.className = 'static-part';
            spanEstatica.innerText = parteEstatica;
            spanEstatica.style.color = '#0d0900';

            p.appendChild(spanSeda);
            p.appendChild(spanEstatica);

            silkCoreP0 = new SilkCanvas(parteSeda, "", spanSeda, parteSeda.length - 1);
            silkCoreP0.hangingTarget = spanEstatica;
        } else {
            p.innerText = textoParrafo;
        }

        // TAG TRIGGER (Universal)
        if (/H[eé]l[eé]ne/i.test(textoParrafo) && textoParrafo.includes("mujer")) p.dataset.trigger = "helene";
        if (/ojos/i.test(textoParrafo) && /oriental/i.test(textoParrafo)) p.dataset.trigger = "japanese_woman";

        contenedorPadre.appendChild(p);
        return p;
    }

    // --- CONFIGURACIÓN DE ZONA DE AGUA (ASCII OCEAN) ---
    const viewW = window.innerWidth;
    const isMobile = viewW < 768;
    const PADDING = isMobile ? Math.floor(viewW * 0.08) : 120;
    const MAX_WIDTH = Math.min(580, viewW - (PADDING * 2));
    const FONT_SIZE = isMobile ? Math.max(13, Math.min(16, viewW / 25)) : 16;
    const LINE_HEIGHT = Math.floor(FONT_SIZE * 1.6);
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
    asciiCanvas.width = window.innerWidth;
    asciiCanvas.height = trackHeight + 800;

    let effectsCanvas = document.createElement('canvas');
    effectsCanvas.className = "effects-top";
    effectsCanvas.style.top = "-800px";
    effectsCanvas.width = window.innerWidth;
    effectsCanvas.height = trackHeight + 800;

    let textCanvas = document.createElement('canvas');
    const dpi = window.devicePixelRatio || 1;
    textCanvas.width = trueWidth * dpi;
    textCanvas.height = trueHeight * dpi;
    textCanvas.style.width = `${trueWidth}px`;
    textCanvas.style.height = `${trueHeight}px`;
    textCanvas.classList.add('hilo-narrativo');

    let ctx = textCanvas.getContext('2d');
    ctx.scale(dpi, dpi);
    ctx.textBaseline = 'top';
    ctx.font = fontString;

    if (linesArray.length > 0) {
        linesArray.forEach(line => {
            const w = ctx.measureText(line.text).width;
            lineInfo.push({ width: w, startX: PADDING });
        });
    }

    ctx.fillStyle = '#111';
    linesArray.forEach((line, i) => {
        const h = PADDING + i * LINE_HEIGHT;
        ctx.fillText(line.text, lineInfo[i].startX, h);
    });

    track.style.height = (trueHeight + window.innerHeight * 2.5) + "px";
    track.appendChild(asciiCanvas);
    track.appendChild(textCanvas);
    track.appendChild(effectsCanvas);
    contenedorPadre.appendChild(track);

    const ocean = new ASCIIOcean(asciiCanvas, textCanvas, effectsCanvas, track, lineInfo, trueHeight);
    ocean.parentTrack.id = `parrafo-${index}`;
    ocean.parentTrack.setAttribute('data-index', index);
    activeOceans.push(ocean);
}

/* 
window.memoTriggers = {
    activate(key) {
        if (localStorage.getItem(`seda_trigger_${key}`)) return;
        localStorage.setItem(`seda_trigger_${key}`, "true");
        
        const node = document.getElementById(`node-${key}`);
        if (node) {
            node.classList.add(`active-${key}`);
            node.animate([
                { filter: 'blur(0px) brightness(1)', r: 10 },
                { filter: 'blur(10px) brightness(3)', r: 25 },
                { filter: 'blur(0px) brightness(1)', r: 5 }
            ], { duration: 1000, easing: 'ease-out' });

            const flash = document.createElement('div');
            flash.style.cssText = `
                position: fixed; top:0; left:0; width:100vw; height:100vh;
                background: ${key === "helene" ? "rgba(74, 144, 226, 0.1)" : "rgba(208, 2, 27, 0.1)"};
                pointer-events: none; z-index: 999;
                transition: opacity 1.5s ease-out; opacity: 1;
            `;
            document.body.appendChild(flash);
            setTimeout(() => {
                flash.style.opacity = '0';
                setTimeout(() => flash.remove(), 1600);
            }, 50);
        }
    }
};

const triggerObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const key = entry.target.dataset.trigger;
            if (key) window.memoTriggers.activate(key);
        }
    });
}, { threshold: 0.8 });
*/

/**
 * ENGINE LOOP
 */
function setupScrollEngine() {
    function update() {
        const vH = window.innerHeight;

        // 1. Océanos
        activeOceans.forEach(ocean => {
            const rect = ocean.parentTrack.getBoundingClientRect();
            if (rect.top <= vH && rect.bottom >= 0) {
                ocean.isVisible = true;
                const vesselH = ocean.vesselCanvas.offsetHeight;
                let targetY = (vH / 2) - (vesselH / 2) - rect.top;
                targetY = Math.max(0, Math.min(rect.height - vesselH, targetY));
                ocean.targetOffset = targetY;
                ocean.render(textoLeido);
            } else ocean.isVisible = false;
        });

        // 2. Transiciones 3D
        let primaryTrans = null;
        let minCenterDist = Infinity;
        activeTransitions.forEach(trans => {
            const rect = trans.track.getBoundingClientRect();
            const trackCenter = rect.top + rect.height / 2;
            const dist = Math.abs(vH / 2 - trackCenter);

            if (rect.top <= vH && rect.bottom >= 0) {
                trans.isVisible = true;
                trans.progress = Math.max(0, Math.min(1, (vH - rect.top) / (rect.height + vH)));
                if (dist < minCenterDist) { minCenterDist = dist; primaryTrans = trans; }
            } else trans.isVisible = false;
        });
        activeTransitions.forEach(trans => trans.render(trans === primaryTrans));

        // 3. Brújula (Compass) - PLACEHOLDER: Comentado para independizar seda
        // if (typeof window.updateCompass === 'function') window.updateCompass();

        // 4. SilkCanvas (Párrafo 1)
        const pInitial = document.querySelector('.p-initial-fray');
        if (pInitial && silkCoreP0) {
            const rect = pInitial.getBoundingClientRect();
            if (rect.top < vH && rect.bottom > 0) {
                // Disparador de bloqueo
                if (!frayTransitionStarted && rect.top < vH * 0.4 && rect.top > 0) {
                    isTransitionLocked = true;
                    frayTransitionStarted = true;
                }
                // Destino: Zona Segura (Superior Izquierda, 5%, 15%)
                const finalDX = window.innerWidth * 0.05;
                const finalDY = window.innerHeight * 0.15;

                // Suavizado del progreso por scroll
                currentFrayProgress += (targetFrayProgress - currentFrayProgress) * FRAY_LERP_FACTOR;
                silkCoreP0.update(currentFrayProgress, finalDX, finalDY);
            }
        }

        requestAnimationFrame(update);
    }
    update();
}

/**
 * INITIALIZATION
 */
document.addEventListener('DOMContentLoaded', () => {
    const libro = document.getElementById('libro');
    if (!libro) return;

    libro.innerHTML = '';
    let lastElement = null;

    if (typeof textoNovela !== 'undefined') {
        const fragments = textoNovela.split(/\n\s*\n/).filter(p => p.trim() !== '');
        fragments.forEach((txt, i) => {
            const p = inyectarParrafo(txt.replace(/\n/g, ' ').trim(), libro, lastElement, i);
            if (p) {
                lastElement = p;
                // triggerObserver está comentado (PLACEHOLDER)
                // if (p.dataset && p.dataset.trigger) triggerObserver.observe(p);
            }
        });
    }

    setupScrollEngine();

    // Limpieza agresiva: Nos aseguramos de que no exista el elemento en el DOM
    const leftoverCompass = document.getElementById('narrative-compass');
    if (leftoverCompass) leftoverCompass.remove();

    console.log("SEDA: Silk Mechanic Calibrated (v1.2)");
});
