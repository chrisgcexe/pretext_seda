/**
 * SEDA: MAIN ORCHESTRATOR
 * Punto de entrada de la aplicación. Coordina los módulos y el engine loop.
 */

import './src/utils/pretext.js'; // Carga window.Pretext

// Apagamos la restauración automática del scroll del navegador
if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
}

import { 
    activeOceans, 
    activeTransitions, 
    textoLeido, 
    isTransitionLocked, 
    targetFrayProgress, 
    currentFrayProgress, 
    silkCoreP0,
    FRAY_LERP_FACTOR,
    setTransitionLocked,
    setFrayTransitionStarted,
    setFrayMaxProgress,
    setFrayMinProgress,
    setFrayInputEnabled,
    updateCurrentFrayProgress,
    updateTargetFrayProgress,
    lockScroll,
    inyectarParrafo,
    minScrollAllowed,
    setMinScrollAllowed
} from './src/managers/NarrativeManager.js';


// --- STATE MACHINE (v8.3) ---
// Fases: 'P0_FRAY' → 'SCROLL_TO_P1' → 'WAIT_P1' → 'P1_FRAY' → 'BROKEN' → 'DONE'
let frayPhase = 'P0_FRAY';

let lastScrollY = window.scrollY;

// Auto-scroll state
let autoScrollFrom  = 0;    // scrollY inicial del auto-scroll
let autoScrollTo    = 0;    // scrollY objetivo (P1 centrado)
let autoScrollT0    = 0;    // timestamp de inicio
const AUTO_SCROLL_MS = 950;  // De 1400 a 950 para más dinamismo
const WAIT_P1_MS     = 1000; // De 2000 a 1000 para reducir el bloqueo percibido en el segundo párrafo
let waitP1T0         = 0;    // timestamp de inicio del wait

/**
 * ENGINE LOOP
 */
function setupScrollEngine() {
    function update() {
        const vH = window.innerHeight;
        const currentScrollY = window.scrollY;
        const scrollDelta = currentScrollY - lastScrollY;
        lastScrollY = currentScrollY;

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

        // 3. SilkCanvas — State Machine v8.2
        const p1 = document.getElementById('parrafo-1');
        const pInitial = document.querySelector('.p-initial-fray');
        if (pInitial && silkCoreP0 && p1) {

            const finalDX = window.innerWidth * 0.05;
            const finalDY = window.innerHeight * 0.15;

            // --- SISTEMA DE COLISIONES GHOST SHIP (v12.5) ---
            // Actualizamos siempre los rectángulos para que la seda reaccione al entorno móvil.
            const allRects = [];
            document.querySelectorAll('.normal-text').forEach(el => {
                // El OBJETIVO de la amnistía es el párrafo al que queremos conectar (P1)
                const isTarget = (el === p1); 
                
                const staticPart = el.querySelector('.static-part');
                if (staticPart) {
                    const rects = Array.from(staticPart.getClientRects());
                    if (rects.length > 0) {
                        const r1 = rects[0];
                        allRects.push({ 
                            top: r1.top - 5, 
                            bottom: r1.bottom, 
                            left: r1.left, 
                            right: r1.right,
                            isTarget: isTarget 
                        });
                        if (rects.length > 1) {
                            const last = rects.slice(1);
                            allRects.push({
                                top: last[0].top - 5,
                                bottom: last[last.length - 1].bottom,
                                left: Math.min(...last.map(r => r.left)),
                                right: Math.max(...last.map(r => r.right)),
                                isTarget: isTarget
                            });
                        }
                    }
                } else {
                    const r = el.getBoundingClientRect();
                    allRects.push({ 
                        top: r.top - 5, 
                        bottom: r.bottom, 
                        left: r.left, 
                        right: r.right,
                        isTarget: isTarget 
                    });
                }
            });
            silkCoreP0.setCollisionRects(allRects);

            // ============================================================
            // STATE MACHINE v8.3
            // ============================================================

            if (frayPhase === 'P0_FRAY') {
                // Scroll bloqueado. El deltaY deshilacha P0 (progress 0 → 0.9).
                if (currentFrayProgress >= 0.899) {
                    // P0 terminado PERFECTAMENTE: forzamos el progreso a 0.9 para detonar 
                    // el Handover Cinematográfico del hilo antes de mover la cámara.
                    updateTargetFrayProgress(0.9 - targetFrayProgress);
                    updateCurrentFrayProgress(0.9);

                    // Calculamos el target para centrar P1
                    const rectP1now = p1.getBoundingClientRect();
                    autoScrollFrom = window.scrollY;
                    autoScrollTo   = window.scrollY + rectP1now.top + rectP1now.height / 2 - vH / 2;
                    autoScrollT0   = Date.now();
                    
                    frayPhase = 'SCROLL_TO_P1';
                    setFrayMaxProgress(1.01); 
                    setFrayMinProgress(0.9); // SELLAMOS P0: No se puede des-deshilachar el primer párrafo
                    setFrayInputEnabled(false); 
                    console.log('SEDA: P0 done → Handover ejecutado → SCROLL_TO_P1', autoScrollTo);
                }
            }

            else if (frayPhase === 'SCROLL_TO_P1') {
                // Scroll bloqueado. Animamos el scroll automáticamente hacia P1.
                // El usuario no puede interferir (lock activo).
                const elapsed = Date.now() - autoScrollT0;
                const t = Math.min(1, elapsed / AUTO_SCROLL_MS);
                // Ease in-out cúbico: suave inicio y suave frenado
                const ease = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;
                window.scrollTo(0, autoScrollFrom + (autoScrollTo - autoScrollFrom) * ease);

                if (t >= 1) {
                    frayPhase = 'WAIT_P1';
                    waitP1T0 = Date.now();
                    console.log('SEDA: P1 centrado → WAIT_P1 (2s)');
                }
            }

            else if (frayPhase === 'WAIT_P1') {
                // Scroll bloqueado, P1 centrado, esperando 2s antes de habilitar fray.
                if (Date.now() - waitP1T0 >= WAIT_P1_MS) {
                    frayPhase = 'P1_FRAY';
                    setFrayTransitionStarted(true);
                    setFrayInputEnabled(true); // DEVOLVEMOS control al usuario
                    console.log('SEDA: WAIT done → P1_FRAY');
                }
            }

            else if (frayPhase === 'P1_FRAY') {
                // Scroll bloqueado. El deltaY deshilacha P1 (progress 0.9 → 1.0).
                if (silkCoreP0.isBroken) {
                    frayPhase = 'BROKEN';
                    // EVITAR TELETRANSPORTACIÓN (POPPING ASQUEROSO): 
                    // Si el usuario siguió scrolleando fuerte durante o justo después del quiebre, 
                    // la inercia del scroll deja el targetFrayProgress en 1.01. Al reconectar, 
                    // el sistema asume que ya adelantó texto y lo teletransporta 30% del camino instantáneamente.
                    // Anclar esto a 1.0 garantiza un frame estático inmaculado al momento de costura.
                    updateTargetFrayProgress(1.0 - targetFrayProgress);
                    updateCurrentFrayProgress(1.0);
                    console.log('SEDA: P1 broken → BROKEN (J→O needed)');
                }
            }

            else if (frayPhase === 'BROKEN') {
                // Scroll bloqueado hasta que el usuario cose J con O.
                 if (silkCoreP0.isRepaired) {
                     frayPhase = 'POST_REPAIR_CONSUME';
                     setFrayMaxProgress(2.0); 
                     setFrayMinProgress(1.0); // SELLAMOS P1 pre-corte: No se puede volver al estado roto/fray1
                     
                     // La transparencia del texto ahora se maneja internamente en transitionToState(REPAIRED)
                     console.log('SEDA: Repaired → POST_REPAIR_CONSUME');
                 }
            }

            else if (frayPhase === 'POST_REPAIR_CONSUME') {
                // El hilo deshilacha libremente el resto de P1
                if (silkCoreP0.relayTriggered) {
                    if (currentFrayProgress >= 1.99 && minScrollAllowed === 0) {
                        setMinScrollAllowed(window.scrollY);
                        setTransitionLocked(false); // AHORA liberamos el scroll real de la página
                        console.log('SEDA: Hélene alcanzada y P1 consumido. Scroll blocked at', minScrollAllowed);
                        frayPhase = 'DONE';
                    }
                }
            }

            // DONE: scroll libre, no hay nada que hacer

            // ============================================================
            // LERP + RENDER
            // ============================================================
            const newProg = currentFrayProgress + (targetFrayProgress - currentFrayProgress) * FRAY_LERP_FACTOR;
            updateCurrentFrayProgress(newProg);
            silkCoreP0.update(newProg, finalDX, finalDY);
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
            }
        });
    }

    window.scrollTo(0, 0);

    // FASE INICIAL: P0_FRAY — scroll bloqueado, progress limitado a 0.9 (solo P0)
    setTransitionLocked(true);
    setFrayMaxProgress(0.9);

    setupScrollEngine();

    window.addEventListener('wheel', lockScroll, { passive: false });
    window.addEventListener('touchmove', lockScroll, { passive: false });

    const leftoverCompass = document.getElementById('narrative-compass');
    if (leftoverCompass) leftoverCompass.remove();

    console.log("SEDA: Modular Engine Active (v2.0)");
});
