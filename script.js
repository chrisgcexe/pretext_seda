/**
 * SEDA: ORCHESTRATOR
 * Encargado de la ingesta de párrafos, el control del scroll y la coordinación 
 * entre el parser de texto y el motor gráfico.
 */

import { analizarViaje } from './src/parser.js';
import { ASCIIOcean, LandTransition } from './src/engine.js';

let textoLeido = "SEDA. ";
let activeOceans = [];
let activeTransitions = [];
let ultimoTextoLeido = "";

/**
 * Inyecta un párrafo en el DOM o crea una zona de viaje (mar/tierra).
 */
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
        p.innerText = textoParrafo;
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

    ctx.fillStyle = '#010101ff';
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

/**
 * Bucle principal de renderizado y control de cámara.
 */
function setupScrollEngine() {
    function update() {
        const vH = window.innerHeight;

        // 1. Renderizado de Océanos Activos
        activeOceans.forEach(ocean => {
            const rect = ocean.parentTrack.getBoundingClientRect();
            if (rect.top <= vH && rect.bottom >= 0) {
                ocean.isVisible = true;
                const vesselH = ocean.vesselCanvas.offsetHeight;
                let targetY = (vH / 2) - (vesselH / 2) - rect.top;
                targetY = Math.max(0, Math.min(rect.height - vesselH, targetY));
                ocean.targetOffset = targetY;
                
                // Pasamos el texto leído actual para la estela de caracteres
                ocean.render(textoLeido);
            } else {
                ocean.isVisible = false;
            }
        });

        // 2. Transiciones 3D (Single-Active Guard)
        let primaryTrans = null;
        let minCenterDist = Infinity;

        activeTransitions.forEach(trans => {
            const rect = trans.track.getBoundingClientRect();
            const trackCenter = rect.top + rect.height / 2;
            const dist = Math.abs(vH / 2 - trackCenter);

            if (rect.top <= vH && rect.bottom >= 0) {
                trans.isVisible = true;
                const progress = Math.max(0, Math.min(1, (vH - rect.top) / (rect.height + vH)));
                trans.progress = progress;

                if (dist < minCenterDist) {
                    minCenterDist = dist;
                    primaryTrans = trans;
                }
            } else {
                trans.isVisible = false;
            }
        });

        activeTransitions.forEach(trans => {
            trans.render(trans === primaryTrans);
        });
        requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
}

/**
 * Inicialización del motor al cargar el DOM.
 */
document.addEventListener('DOMContentLoaded', () => {
    // Importamos Pretext dinámicamente o asumimos su existencia
    // Nota: Como script.js ahora es un módulo, import() funciona nativamente.
    import('https://esm.sh/@chenglou/pretext?bundle').then(pretextModule => {
        window.Pretext = pretextModule;
        const contenedor = document.getElementById('libro');
        if (!contenedor) return;
        
        contenedor.innerHTML = '';
        let ultimoElementoInyectado = null;
        
        // textoNovela viene de seda.js (global)
        if (typeof textoNovela !== 'undefined') {
            textoNovela.split(/\n\s*\n/).filter(p => p.trim() !== '').forEach((txt, index) => {
                const p = inyectarParrafo(txt.replace(/\n/g, ' ').trim(), contenedor, ultimoElementoInyectado, index);
                if (p) ultimoElementoInyectado = p;
            });
        }
        
        setupScrollEngine();
    }).catch(err => console.error("Error al cargar Pretext:", err));
});
