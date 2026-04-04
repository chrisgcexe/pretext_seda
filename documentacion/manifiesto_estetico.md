# Seda: Visión y Manifiesto Estético

Este documento consolida las ideas centrales y la dirección artística del proyecto "Seda", definiendo qué hace que esta experiencia sea única frente a un sitio web común.

---

## 1. El Concepto "Ghost Ship" (Barco Fantasma)
La idea central es que el texto narrativo "flote" directamente sobre el océano ASCII, sin cajas blancas pesadas que lo encierren.

*   **Estética Sigilosa**: El texto es parte del entorno, no una capa superpuesta.
*   **Interacción Física**: Aunque el fondo es invisible, el texto "empuja" las partículas del océano mediante física de repulsión, creando una estela real.
*   **Minimalismo Brutalista**: Uso de una paleta cromática limitada y tipografía monospace (`Courier New`) para honrar la obra de Baricco.

---

## 2. El Horizonte Profundo (Deep Horizon)
Para maximizar el sentimiento de "viaje majestuoso", el texto de destino nace en el horizonte visual real.

*   **Z-Depth Extendido**: El texto de destino se materializa a una profundidad de `z=5500`, apareciendo como un monumento distante que se acerca con el scroll.
*   **Sincronía de Horizonte**: El punto de aparición coincide con la línea del horizonte del océano, eliminando saltos visuales bruscos.

---

## 3. Refinamientos: El "Efecto Seda"
Conceptos para elevar la experiencia a un nivel premium y fluido:

*   **Horizonte de Niebla (Fog Horizon)**: Uso de máscaras de degradado vertical para que el texto emerja del "vacío" de forma vaporosa en lugar de un recorte lineal duro.
*   **Inercia Física (Easing Momentum)**: Implementación de curvas `easeInOutQuart` para que el texto tenga peso; el despegue del DOM y el aterrizaje en el espacio 3D se sienten orgánicos.
*   **Volumen de Bloque (Z-Parallax)**: Micro-desfases en la profundidad Z entre líneas individuales para crear un efecto de "cinta fluida" ondulante durante el viaje.

---

## 4. Filosofía de Diseño: "Diseño por Restricción"
El motor de Seda se rige por la regla de que **la tecnología debe servir a la poesía, nunca eclipsarla**. Si un efecto técnico distrae de la lectura de la obra de Baricco, se descarta. La potencia del motor ASCII se reserva exclusivamente para los momentos de viaje y clímax emocional, manteniendo el resto de la novela en una calma tipográfica absoluta.
