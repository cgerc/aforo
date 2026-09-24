Actúa como un desarrollador Frontend experto en UI/UX y maquetación web. Considerando que el proyecto utiliza backend en Node.js/Express (ESM) y frontend en HTML/CSS/JavaScript Vanilla con Tailwind CSS vía CDN, Leaflet y el SDK de Mercado Pago, necesito que repliques con máxima fidelidad visual y funcional la interfaz que te describo a continuación.

---

### 1. SISTEMA DE DISEÑO Y TOKENS VISUALES

* **Tipografía (Estilo Mercado Libre):**
  - Fuente principal: **"Proxima Nova"** (la tipografía oficial de Mercado Libre). 
  - Inclusión/Configuración:
    - Incluye la fuente en el `<head>` vía CDN o `@font-face` (puedes usar el CDN de Proxima Nova o cargar como fallback prioritario fuentes geométricas idénticas como `"Proxima Nova", -apple-system, "Helvetica Neue", Helvetica, Roboto, Arial, sans-serif`).
    - Configura Tailwind CDN (`tailwind.config`) para asignarla como `font-sans`:
      ```javascript
      tailwind.config = {
        theme: {
          extend: {
            fontFamily: {
              sans: ['"Proxima Nova"', '-apple-system', 'Helvetica Neue', 'Helvetica', 'Roboto', 'Arial', 'sans-serif'],
            }
          }
        }
      }
      ```
  - Pesos visuales: Regular (`400`), Medium/Semibold (`600`) y Bold/Extrabold (`700` a `800`).

* **Paleta de Colores:**
  - Fondo general de la página: `#F8FAF8` (blanco roto/marfil con matiz verdoso suave).
  - Verde primario (Botones principales / CTA): `#26B488` (hover: `#1FA078`).
  - Verde menta suave (Badges / Tags): `#A0E1C9` con texto verde oscuro `#1B5E4B` o blanco según contraste.
  - Texto principal (Dark): `#1E293B` / `#111827`.
  - Texto secundario / muted: `#64748B` (fondos claros) y `#E2E8F0` (sobre overlays oscuros).
  - Barra de búsqueda: Fondo `#52585B` o `#4B5563` oscuro con placeholder `#CBD5E1`.
  - Blanco puro: `#FFFFFF` (cards, texto banner, contenedores).

---

### 2. ESTRUCTURA Y COMPONENTES (HTML5 + Tailwind CDN)

#### A. Navbar / Header Superior
- **Contenedor:** `<header class="w-full bg-[#F8FAF8] h-[72px] px-6 md:px-12 flex items-center justify-between">`.
- **Logo (Izquierda):**
  - Isotipo: Icono de red/comunidad circular (formado por nodos conectados en tonos verdes) en SVG inline.
  - Texto de marca: "VIVE TICKET" en mayúsculas, tracking amplio (`tracking-[0.2em] font-bold text-slate-800 text-lg`).
- **Barra de Búsqueda (Centro-Izquierda):**
  - Contenedor con `relative flex items-center w-full max-w-[340px]`.
  - Input estilo píldora (`rounded-full bg-[#52585B] text-slate-200 placeholder-[#94A3B8] text-sm pl-11 pr-4 py-2.5 w-full focus:outline-none focus:ring-2 focus:ring-[#26B488]`).
  - Icono de lupa (`Search`) embebido en SVG inline a la izquierda (`left-3.5 absolute text-[#94A3B8]`).
  - Placeholder: `"Buscar eventos, talleres..."`.
- **Navegación y Acciones (Derecha):**
  - Enlace: `"Arriendo de espacios"` (`text-slate-800 text-sm font-medium hover:text-[#26B488] transition-colors`).
  - Botón: `"Portal de organizadores"` tipo píldora (`rounded-full bg-[#4ECCA3] hover:bg-[#3db891] text-white text-sm font-semibold px-5 py-2.5 transition-colors`).

#### B. Hero Carousel / Banner Principal
- **Contenedor:** Contenedor de ancho completo o relativo con altura aproximada de `480px` a `520px`, con `overflow-hidden relative flex items-center`.
- **Imagen y Capa Degradada:**
  - Imagen de fondo de alta resolución.
  - Overlay degradado oscuro en el tercio izquierdo: `bg-gradient-to-r from-black/85 via-black/55 to-transparent` para legibilidad.
- **Controles del Carrusel:**
  - Flechas de navegación (chevrons `<` y `>`) flotantes a los costados (`absolute top-1/2 -translate-y-1/2 text-white/70 hover:text-white cursor-pointer`).
- **Bloque de Contenido (Alineado a la izquierda, padding `px-8 md:px-16 max-w-2xl text-white`):**
  1. **Badge de categoría:**
     - Etiqueta píldora: `<span class="inline-block bg-[#8CD7BF] text-white text-xs font-bold uppercase tracking-wider px-3.5 py-1 rounded-full mb-3">EDUCACIÓN</span>`.
  2. **Título del Evento:**
     - `"Taller de iniciación al latín"` (`text-3xl md:text-4xl font-extrabold text-white leading-tight mb-3`).
  3. **Metadatos e Iconos (SVGs inline limpios):**
     - Fecha/Hora: SVG de reloj (`Clock`) + `<span class="text-sm font-medium text-slate-100">22/08/2026 – 10:00 hrs</span>`.
     - Ubicación/Precio: SVG de pin (`MapPin`) + `<span class="text-sm font-medium text-slate-100">Avenida Santa Isabel 1240 (PROVIDENCIA) — Desde $40.000 CLP</span>`.
  4. **Descripción breve:**
     - Párrafo descriptivo: `"Descubre las bases del latín y conecta con el origen de nuestra lengua en este taller práctico de iniciación..."` (`text-sm text-slate-200 line-clamp-2 mb-6`).
  5. **Botón CTA:**
     - `"Comprar entradas"`: Píldora (`rounded-full bg-[#26B488] hover:bg-[#1FA078] text-white font-bold px-7 py-3 text-sm transition-all shadow-md active:scale-95`).

#### C. Sección de Contenido Inferior
- **Encabezado:**
  - Título `"Salud mental"` (`text-2xl font-black text-slate-900`).
  - Badge al lado: `"MÁX 40 CUPOS"` (`rounded-full bg-[#A0E1C9] text-[#065F46] text-xs font-bold px-3 py-1 ml-3`).
- **Carrusel / Cards:**
  - Tarjetas con esquinas redondeadas pronunciadas (`rounded-2xl` o `rounded-3xl`), imágenes bien cuadradas con `object-cover` y borde sutil.

---

### 3. REQUISITOS TÉCNICOS ESPECÍFICOS
- **Tecnología:** HTML5 semántico puro + Tailwind CSS CDN + JavaScript Vanilla.
- **Iconografía:** NO uses librerías de React. Proporciona los iconos (`Search`, `Clock`, `MapPin`, `ChevronLeft`, `ChevronRight`) en formato **SVG inline** optimizado y limpio.
- **Diseño Responsivo:** En móviles (`< 768px`), adapta el navbar y ajusta el tamaño tipográfico del banner para evitar desbordes.
- Entrega el código estructurado, modular y listo para ser integrado en el layout del servidor Express.