/**
 * SEDA: PARSER MODULE
 * Detección de terrenos y firmas de viaje.
 */

export const firmasViaje = {
    tierra: ["HERVÉ JONCOUR partió", "HERVÉ JONCOUR partió", "A pie, recorriendo caminos secundarios", "ochocientos kilómetros de tierra"],
    mar: ["SEIS DÍAS después", "Seis días después", "barco llamado Adel", "mil seiscientas millas de mar"]
};

/**
 * Determina el tipo de terreno basado en el texto del párrafo.
 * @param {string} texto 
 * @returns {object} { tipo: 'agua' | 'tierra' | 'normal' }
 */
export function analizarViaje(texto) {
    const esMar = firmasViaje.mar.some(f => texto.includes(f));
    const esTierra = firmasViaje.tierra.some(f => texto.includes(f));
    
    if (esMar) return { tipo: 'agua' };
    if (esTierra) return { tipo: 'tierra' };
    
    return { tipo: 'normal' };
}
