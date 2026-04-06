/**
 * SEDA: NARRATIVE MANAGER
 * Gestiona el estado global, el scroll y la inyección de párrafos.
 */

import { analizarViaje } from '../parser.js';
import { SilkCanvas } from '../systems/SilkSystem.js';
import { ASCIIOcean } from '../systems/OceanSystem.js';
import { LandTransition } from '../systems/LandSystem.js';

// --- ESTADO GLOBAL ---
export let textoLeido = "SEDA. ";
export let ultimoTextoLeido = "";
export let activeOceans = [];
export let activeTransitions = [];

export let isTransitionLocked = false;
export let frayTransitionStarted = false;
export let targetFrayProgress = 0.003;   // TENSIÓN SUTIL: 0.3% inicial
export let currentFrayProgress = 0.003;
export const FRAY_SCROLL_SENSITIVITY = 0.00025;
export const FRAY_LERP_FACTOR = 0.06;  

export let silkCoreP0 = null;

// --- FUNCIONES CORE ---

export function setTransitionLocked(val) { isTransitionLocked = val; }
export function setFrayTransitionStarted(val) { frayTransitionStarted = val; }
export function updateTargetFrayProgress(delta) { 
    targetFrayProgress += delta;
    targetFrayProgress = Math.max(0, Math.min(1.01, targetFrayProgress));
}
export function updateCurrentFrayProgress(val) { currentFrayProgress = val; }

export function lockScroll(e) {
    if (isTransitionLocked) {
        e.preventDefault();

        // 1. EL ENCIERRO: Si el hilo se cortó y está colgando, el usuario está atrapado.
        // Ignoramos la rueda del mouse por completo. La única salida es coserlo a mano.
        if (silkCoreP0 && silkCoreP0.isBroken && !silkCoreP0.isRepaired) {
            return false;
        }

        // 2. TENSIÓN: Aplicamos la sensibilidad del scroll
        updateTargetFrayProgress(e.deltaY * FRAY_SCROLL_SENSITIVITY);

        // 3. LOS LÍMITES
        if (targetFrayProgress >= 1) {
            // MURO DE TENSIÓN: Ya no hay temporizador. 
            // Sostenemos la tensión al 100% obligando al Lerp visual a alcanzar el 0.99 para que haga SNAP.
        } else if (targetFrayProgress <= 0) {
            // ABORTO NATURAL: El usuario se arrepintió, scrolleó todo hacia arriba y soltó la tensión.
            isTransitionLocked = false;
            setFrayTransitionStarted(false);
        }
        
        return false;
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
            p.classList.add('p-initial-fray');
            const limitJ = textoParrafo.indexOf('J') + 1; 
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

            silkCoreP0 = new SilkCanvas(parteSeda, "", spanSeda, parteSeda.length - 1);
            silkCoreP0.hangingTarget = spanEstatica;
        } else {
            p.innerText = textoParrafo;
        }

        if (/H[eé]l[eé]ne/i.test(textoParrafo) && textoParrafo.includes("mujer")) p.dataset.trigger = "helene";
        if (/ojos/i.test(textoParrafo) && /oriental/i.test(textoParrafo)) p.dataset.trigger = "japanese_woman";

        contenedorPadre.appendChild(p);
        return p;
    }

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
}
