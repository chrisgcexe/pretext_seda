/**
 * SEDA: NARRATIVE MANAGER
 * Gestiona el estado global, el scroll y la inyección de párrafos.
 */

import { analizarViaje } from '../parser.js';
import { SilkCanvas } from '../systems/SilkSystem.js';
import { KanjiCanvas } from '../systems/KanjiSystem.js';
import { ASCIIOcean } from '../systems/OceanSystem.js';
import { LandTransition } from '../systems/LandSystem.js';

// --- ESTADO GLOBAL ---
export let textoLeido = "SEDA. ";
export let ultimoTextoLeido = "";
export let activeOceans = [];
export let activeTransitions = [];

export let isTransitionLocked = false;
export let frayTransitionStarted = false;
export let targetFrayProgress = 0.0;   // Inicia en reposo absoluto
export let currentFrayProgress = 0.0;
export const FRAY_SCROLL_SENSITIVITY = 0.00018; // De 0.00025 a 0.00018 para dar más tiempo de lectura/observación
export const FRAY_LERP_FACTOR = 0.15; // De 0.06 a 0.15 para eliminar el delay percibido en el seguimiento del scroll
export const KANJI_SCROLL_SENSITIVITY = 0.0002; // v38.4: Igualamos sensibilidad al SilkSystem para que no se sienta "rápido" o "saltón"

export let silkCoreP0 = null;
export let kanjiCore = null;
let pendingP0 = null; // Buffer para el primer párrafo secuencial
let japaneseWomanMarked = false; // Flag para marcar solo la primera mención

export let minScrollAllowed = 0;
export function setMinScrollAllowed(val) { minScrollAllowed = val; }

// --- FUNCIONES CORE ---

export function setTransitionLocked(val) { isTransitionLocked = val; }
export function setFrayTransitionStarted(val) { frayTransitionStarted = val; }

// v8.2: Límite dinámico del progreso — 0.9 para fase P0, 1.01 para fase P1
export let frayMaxProgress = 0.9;
export let frayMinProgress = 0.0; // Milestone lock (Sticky Progress)
export function setFrayMaxProgress(val) { frayMaxProgress = val; }
export function setFrayMinProgress(val) { frayMinProgress = val; }

export function updateTargetFrayProgress(delta) {
    targetFrayProgress += delta;
    // Clamping dinámico basado en hitos alcanzados
    targetFrayProgress = Math.max(frayMinProgress, Math.min(frayMaxProgress, targetFrayProgress));
}
export function updateCurrentFrayProgress(val) { currentFrayProgress = val; }

export let frayInputEnabled = true;
export function setFrayInputEnabled(val) { frayInputEnabled = val; }

export function lockScroll(e) {
    if (minScrollAllowed > 0 && window.scrollY < minScrollAllowed) {
        window.scrollTo(0, minScrollAllowed);
        e.preventDefault();
        return false;
    }

    // BLOQUEO KANJI: Si la muchacha japonesa está deshilachándose, capturamos el scroll

    if (kanjiCore && kanjiCore.isLocked) {
        e.preventDefault();
        kanjiCore.handleScroll(e.deltaY, KANJI_SCROLL_SENSITIVITY);

        if (kanjiCore.isDone) {
            setTransitionLocked(false);
        }
        return false;
    }

    if (isTransitionLocked) {
        e.preventDefault();

        // Si estamos en una transición cinemática (auto-scroll/wait), bloqueamos el input
        if (!frayInputEnabled) return false;

        // ENCIERRO: hilo roto, esperando costura manual.
        if (silkCoreP0 && silkCoreP0.isBroken && !silkCoreP0.isRepaired) {
            return false;
        }

        // BLOQUEO DE REGENERACIÓN (One-Way):
        // Si ya estamos terminando el párrafo (P1 reparado y > 1.90 de progreso),
        // prohibimos el scroll inverso para que no se regenere el texto ya consumido.
        const delta = e.deltaY * FRAY_SCROLL_SENSITIVITY;
        if (silkCoreP0 && silkCoreP0.isRepaired && targetFrayProgress > 1.90 && delta < 0) {
            return false;
        }

        // TENSIÓN: el scroll avanza el deshilachado de P0.
        updateTargetFrayProgress(delta);
    }
}

export function inyectarParrafo(textoParrafo, contenedorPadre, ultimoElementoInyectado, index) {
    const info = analizarViaje(textoParrafo);

    if (info.tipo === 'tierra' && ultimoTextoLeido !== "" && analizarViaje(ultimoTextoLeido).tipo !== 'tierra') {
        const trans = new LandTransition(ultimoTextoLeido, textoParrafo, contenedorPadre, ultimoElementoInyectado, null);
        trans.track.id = `parrafo-viaje-${index}`;
        trans.track.setAttribute('data-index', index);
        trans.canvas.id = `camino-${activeTransitions.length + 1}`;
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

        if (index === 0) {
            // PÁRRAFO 0: 100% SEDA (v7.0)
            p.classList.add('p-initial-fray');
            const spanSeda = document.createElement('span');
            spanSeda.className = 'silk-part';
            // Guardamos la referencia para cuando llegue P1
            pendingP0 = { el: p, span: spanSeda, text: textoParrafo };

            p.appendChild(spanSeda);
            contenedorPadre.appendChild(p);
            return p;
        }

        if (index === 1 && pendingP0) {
            // PÁRRAFO 1: PUNTO DE CORTE (v7.0)
            p.classList.add('p-initial-fray');

            const limitJ = textoParrafo.lastIndexOf('J') + 1;
            const parteSeda = textoParrafo.substring(0, limitJ);
            const parteEstatica = textoParrafo.substring(limitJ);

            const spanSeda = document.createElement('span');
            spanSeda.className = 'silk-part';

            const spanEstatica = document.createElement('span');
            spanEstatica.className = 'static-part';
            spanEstatica.innerHTML = `<span id="target-o" style="display: inline-block; width: 1ch; text-align: left; transform-origin: center center; transition: transform 0.1s;">${parteEstatica.charAt(0)}</span>${parteEstatica.substring(1)}`;
            spanEstatica.style.color = '#0d0900';

            p.appendChild(spanSeda);
            p.appendChild(spanEstatica);
            contenedorPadre.appendChild(p);

            // INICIALIZACIÓN COMBINADA: El hilo atraviesa P0 y el inicio de P1
            const fullSilkText = pendingP0.text + " " + (index === 1 ? parteSeda : "") + parteEstatica;
            const elements = [
                { el: pendingP0.span, text: pendingP0.text + " " },
                { el: spanSeda, text: parteSeda },
                { el: spanEstatica, text: parteEstatica }
            ];

            silkCoreP0 = new SilkCanvas(elements, fullSilkText, (pendingP0.text + " " + parteSeda).length - 1);
            silkCoreP0.hangingTarget = spanEstatica;

            pendingP0 = null; // Limpiamos buffer
            return p;
        }

        // Párrafos normales
        p.innerText = textoParrafo;

        if (/H[eé]l[eé]ne/i.test(textoParrafo) && (textoParrafo.includes("mujer") || textoParrafo.includes("esposa"))) p.dataset.trigger = "helene";

        // Marcado de la Mujer Japonesa (primera mención p13/p14 aprox)
        if (textoParrafo.includes("rostro de la mujer")) {
            p.dataset.trigger = "japanese_woman";
            if (!japaneseWomanMarked) {
                p.id = "japanese-woman-mention"; // ID único para anclaje narrativo
                p.classList.add('narrative-anchor-point');

                // Inserción precisa tras la frase solicitada
                p.innerText = textoParrafo.replace("rostro de la mujer", "rostro de la mujer(女)");

                // INICIALIZACIÓN KANJI SYSTEM (v1.0)
                kanjiCore = new KanjiCanvas(p);


            }
        } else if (/ojos/i.test(textoParrafo) && /oriental/i.test(textoParrafo)) {
            p.dataset.trigger = "japanese_woman"; // Mantenemos el trigger para menciones secundarias si es necesario
        }

        contenedorPadre.appendChild(p);
        return p;
    }

    // --- LÓGICA DE OCÉANO (info.tipo === 'agua') ---
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
    textCanvas.id = `barco-${activeOceans.length + 1}`;

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

    // --- MÁSCARA DE FONDO (Carcasa v4.12: Aire Ampliado) ---
    // Aumentamos el margen para que el barco se sienta más sólido
    ctx.fillStyle = '#fdfcf0';
    linesArray.forEach((line, i) => {
        const h = PADDING + i * LINE_HEIGHT;
        const x = lineInfo[i].startX;
        const w = line.width;
        // Margen Izquierdo (20px), Margen Derecho (5px - 'a ráz'), Vertical (4px)
        // Esto respeta la forma orgánica del párrafo en su lado derecho
        ctx.fillRect(x - 20, h - 4, w + 25, LINE_HEIGHT + 8);
    });

    ctx.fillStyle = '#111';
    linesArray.forEach((line, i) => {
        const h = PADDING + i * LINE_HEIGHT;
        ctx.fillText(line.text, lineInfo[i].startX, h);
    });

    asciiCanvas.id = `oceano-${activeOceans.length + 1}`;
    effectsCanvas.id = `espuma-${activeOceans.length + 1}`;

    track.style.height = (trueHeight + window.innerHeight * 2.5) + "px";
    track.appendChild(asciiCanvas);
    track.appendChild(textCanvas);
    track.appendChild(effectsCanvas);
    contenedorPadre.appendChild(track);

    const ocean = new ASCIIOcean(asciiCanvas, textCanvas, effectsCanvas, track, lineInfo, trueHeight);
    ocean.parentTrack.id = `parrafo-${index}`;
    ocean.parentTrack.setAttribute('data-index', index);
    activeOceans.push(ocean);
    return track;
}
