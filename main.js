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
    frayTransitionStarted, 
    targetFrayProgress, 
    currentFrayProgress, 
    silkCoreP0,
    FRAY_LERP_FACTOR,
    setTransitionLocked,
    setFrayTransitionStarted,
    updateCurrentFrayProgress,
    lockScroll,
    inyectarParrafo
} from './src/managers/NarrativeManager.js';

import { SilkBridge } from './src/systems/SilkBridge.js';

let activeBridges = [];

// --- ESTADO FÍSICO (v6.6): PÁRRAFOS ELÁSTICOS ---
let lastScrollY = window.scrollY;
let p1VerticalVelocity = 0;
let p1VerticalOffset = 0;
const P1_STIFFNESS = 0.04; 
const P1_DAMPING = 0.85; // ESTABILIZACIÓN MÁS RÁPIDA (v6.15)
const P1_OFFSET_LIMIT = 50; // RANGO MÁS SUTIL (v6.15)

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

        // 3. SilkCanvas (Párrafo 1)
        const pInitial = document.querySelector('.p-initial-fray');
        if (pInitial && silkCoreP0) {
            const rect = pInitial.getBoundingClientRect();
            if (rect.top < vH && rect.bottom > -vH) {
                // FIX 4: Solo bloqueamos la transición si NO está reparada
                if (!frayTransitionStarted && rect.top < vH * 0.4 && rect.top > 0 && !silkCoreP0.isRepaired) {
                    setTransitionLocked(true);
                    setFrayTransitionStarted(true);
                }

                // NUEVO FIX: Desbloqueo INMEDIATO apenas se cose el hilo. Cero lag.
                if (silkCoreP0.isRepaired && isTransitionLocked) {
                    setTransitionLocked(false);
                }

                // --- HITBOXES DE PRECISIÓN (v5.4) ---
                // El hilo cae en el vacío pero choca con el texto restante.
                let allRects = [];
                if (silkCoreP0.isRepaired) {
                    const obstacles = document.querySelectorAll('.normal-text');
                    
                    obstacles.forEach(el => {
                        if (el.classList.contains('p-initial-fray')) {
                            const staticPart = el.querySelector('.static-part');
                            if (staticPart) {
                                const rects = Array.from(staticPart.getClientRects());
                                if (rects.length > 0) {
                                    // BLOQUE 1: La primera línea (el Notch)
                                    const r1 = rects[0];
                                    allRects.push({ top: r1.top - 5, bottom: r1.bottom, left: r1.left, right: r1.right });

                                    // BLOQUE 2: Todo el resto del párrafo unificado (v5.9)
                                    if (rects.length > 1) {
                                        const lastRects = rects.slice(1);
                                        const bodyTop = lastRects[0].top;
                                        const bodyBottom = lastRects[lastRects.length - 1].bottom;
                                        const bodyLeft = Math.min(...lastRects.map(r => r.left));
                                        const bodyRight = Math.max(...lastRects.map(r => r.right));
                                        allRects.push({ top: bodyTop - 5, bottom: bodyBottom, left: bodyLeft, right: bodyRight });
                                    }
                                }
                            }
                        } else {
                            const r = el.getBoundingClientRect();
                            allRects.push({ top: r.top - 5, bottom: r.bottom, left: r.left, right: r.right });
                        }
                    });
                    
                    silkCoreP0.setCollisionRects(allRects);
                }

                const finalDX = window.innerWidth * 0.05;
                const finalDY = window.innerHeight * 0.15;

                const newProg = currentFrayProgress + (targetFrayProgress - currentFrayProgress) * FRAY_LERP_FACTOR;
                updateCurrentFrayProgress(newProg);
                silkCoreP0.update(newProg, finalDX, finalDY);

                // --- MECÁNICA DE HILOS DE CONEXIÓN (v6.0) ---
                // Si el hilo inicial se reparó, extendemos el puente al siguiente párrafo.
                if (silkCoreP0.isRepaired) {
                    const repairAge = Date.now() - silkCoreP0.repairStartTime;
                    
                    // Esperamos a que el párrafo termine de subir (1.1s) para que el puente nazca con calma
                    if (repairAge > 1100 && activeBridges.length === 0) {
                        const p1 = document.getElementById('parrafo-1');
                        if (p1) {
                            const bridge = new SilkBridge(pInitial, p1, document.getElementById('libro'));
                            activeBridges.push(bridge);
                            console.log("SEDA: Puente de conexión (v6.0) establecido.");
                        }
                    }
                }

                // --- MECÁNICA DE PÁRRAFOS ELÁSTICOS (v6.12: ZONA DE SILENCIO) ---
                const p1 = document.getElementById('parrafo-1');
                if (p1 && silkCoreP0.isRepaired) {
                    const p1Rect = p1.getBoundingClientRect();
                    const p1Center = p1Rect.top + p1Rect.height / 2;
                    
                    // Zonas de Disparo Precisas (v6.16)
                    const isEntering = p1Rect.top > vH * 0.7; // Solo Disparador de Entrada (Fondo)
                    
                    if (isEntering) {
                        // REBOTE ACTIVO (Solo Entrada)
                        p1VerticalVelocity += scrollDelta * 0.3; // IMPULSO MÁS FINO (v6.15)
                        
                        // Resolución de Muelle (Ley de Hooke)
                        const springForce = -p1VerticalOffset * P1_STIFFNESS;
                        p1VerticalVelocity += springForce;
                        p1VerticalVelocity *= P1_DAMPING;
                        p1VerticalOffset += p1VerticalVelocity;
                        
                        // Límite de seguridad
                        p1VerticalOffset = Math.max(-P1_OFFSET_LIMIT, Math.min(P1_OFFSET_LIMIT, p1VerticalOffset));
                    } else {
                        // ZONA DE LECTURA ESTABLE (Centro)
                        // Apagado suave de la física para evitar micro-rebotes
                        p1VerticalVelocity *= 0.6;
                        p1VerticalOffset *= 0.6;
                        // Si el offset es mínimo, lo matamos a cero para quietud absoluta
                        if (Math.abs(p1VerticalOffset) < 0.1) {
                            p1VerticalOffset = 0;
                            p1VerticalVelocity = 0;
                        }
                    }

                    // Aplicación visual (v6.6)
                    p1.style.transform = `translateY(${p1VerticalOffset.toFixed(2)}px)`;
                }

                // Actualizamos todos los puentes activos
                activeBridges.forEach(bridge => {
                    // v6.9: Excluimos el propio párrafo destino para que el hilo entre limpio "por arriba"
                    const filteredRects = allRects.filter(r => {
                        // Si el rect pertenece al párrafo destino (p1), lo ignoramos para el puente
                        const p1Rect = p1.getBoundingClientRect();
                        return !(Math.abs(r.top - (p1Rect.top - 5)) < 1 && Math.abs(r.left - p1Rect.left) < 1);
                    });

                    if (typeof allRects !== 'undefined' ) {
                        bridge.setCollisionRects(filteredRects);
                    }
                    // Comunicamos el desplazamiento al puente para efectos visuales (v6.12)
                    if (typeof bridge.setStress === 'function') {
                        bridge.setStress(p1VerticalOffset);
                    }
                    bridge.update();
                });
            } else if (silkCoreP0.isRepaired) {
                // Si el párrafo inicial sale de pantalla, aún debemos actualizar los puentes vinculados.
                activeBridges.forEach(bridge => bridge.update());
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
            }
        });
    }

    // Doble seguro: Forzamos el viewport al inicio absoluto
    window.scrollTo(0, 0);

    setupScrollEngine();

    window.addEventListener('wheel', lockScroll, { passive: false });
    window.addEventListener('touchmove', lockScroll, { passive: false });

    const leftoverCompass = document.getElementById('narrative-compass');
    if (leftoverCompass) leftoverCompass.remove();

    console.log("SEDA: Modular Engine Active (v2.0)");
});
