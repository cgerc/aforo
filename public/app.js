let map = null;
let markersLayer = null;
let eventosData = [];
let carruselIntervalo = null;
let currentIndex = 0;

// Función de ayuda para normalizar texto (evita errores con tildes y mayúsculas)
function normalizarTexto(texto) {
    return (texto || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

function renderizarSesion() {
    const contenedor = document.getElementById('contenedor-boton-sesion');
    if (!contenedor) return;

    const usuarioGuardado = localStorage.getItem('usuario_ticketera');
    let usuario = null;
    try {
        usuario = usuarioGuardado ? JSON.parse(usuarioGuardado) : null;
    } catch (error) {
        localStorage.removeItem('usuario_ticketera');
    }

    if (localStorage.getItem('token_ticketera')) {
        const nombre = usuario?.nombre || 'Organizador';
        contenedor.innerHTML = `<a href="dashboard.html" class="text-amber-400 hover:text-amber-300 transition">Hola, ${nombre}</a>`;
        return;
    }

    contenedor.innerHTML = '<a href="login.html" class="bg-amber-500 hover:bg-amber-600 text-zinc-950 font-black px-4 py-2 rounded-lg transition">Portal de organizadores</a>';
}

// Redirección al checkout
function irAlCheckout(id) {
    const eventoSeleccionado = eventosData.find(e => e.id === id);
    if (eventoSeleccionado) {
        localStorage.setItem('evento_seleccionado', JSON.stringify(eventoSeleccionado));
        window.location.href = 'checkout.html';
    } else {
        alert("Evento no encontrado.");
    }
}

// Formateador de fecha y hora
function formatearFechaLegible(fechaISO) {
    if (!fechaISO || fechaISO === "undefined" || fechaISO === "null") {
        return "📅 Fecha a confirmar";
    }
    try {
        if (typeof fechaISO === 'string' && fechaISO.includes('T')) {
            const [fechaPart, horaPart] = fechaISO.split('T');
            const [ano, mes, dia] = fechaPart.split('-');
            const horaLimpia = horaPart.substring(0, 5);
            return `📅 ${dia}/${mes}/${ano} - ⏰ ${horaLimpia} hrs`;
        }
        
        const fechaObj = new Date(fechaISO);
        if (isNaN(fechaObj.getTime())) return `📅 ${fechaISO}`;
        
        const fechaTexto = fechaObj.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const horaTexto = fechaObj.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
        return `📅 ${fechaTexto} - ⏰ ${horaTexto} hrs`;
    } catch (e) {
        return `📅 ${fechaISO}`;
    }
}

// 1. INICIALIZAR MAPA
function inicializarMapa() {
    const mapaContainer = document.getElementById('mapa');
    if (!mapaContainer) return;

    try {
        if (map !== null) map.remove();

        map = L.map('mapa').setView([-33.435, -70.620], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);

        // Capa dinámica para limpiar y agregar pines
        markersLayer = L.layerGroup().addTo(map);

        setTimeout(() => map.invalidateSize(), 300);
    } catch (err) {
        console.error("Error mapa:", err);
    }
}

// 2. RENDERIZAR MARCADORES DEL MAPA
function renderizarMarcadoresMapa(lista = eventosData) {
    if (!map || !markersLayer) return;

    // Limpia los pines anteriores
    markersLayer.clearLayers();

    const bounds = [];

    lista.forEach(ev => {
        if (ev.lat && ev.lng) {
            const precioMin = ev.categorias && ev.categorias.length > 0 ? ev.categorias[0].precio : 0;
            const fechaTxt = formatearFechaLegible(ev.fecha);

            const popupHTML = `
                <div class="text-zinc-900 font-sans p-1 min-w-[180px]">
                    <strong class="text-sm block font-bold mb-1">${ev.titulo}</strong>
                    <p class="text-xs text-zinc-600 mb-1">${fechaTxt}</p>
                    <p class="text-xs text-zinc-600 mb-2">📍 ${ev.direccion || ''} (${(ev.comuna || '').toUpperCase()})</p>
                    <p class="text-xs font-black text-zinc-900 mb-3">Desde $${precioMin.toLocaleString('es-CL')} CLP</p>
                    <button onclick="irAlCheckout(${ev.id})" class="w-full bg-amber-500 hover:bg-amber-600 text-zinc-950 font-black text-xs py-2 px-3 rounded-lg cursor-pointer uppercase tracking-wider transition shadow">
                        Comprar entradas
                    </button>
                </div>
            `;

            const marker = L.marker([ev.lat, ev.lng]).bindPopup(popupHTML);
            markersLayer.addLayer(marker);
            bounds.push([ev.lat, ev.lng]);
        }
    });

    // Si hay pines encontrados, auto-enfoca el mapa
    if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
    }
}

// 3. RENDERIZAR CARRUSEL COMPLETO
function renderizarCarruselSuperior() {
    const container = document.getElementById('carousel-inner');
    if (!container || eventosData.length === 0) return;

    container.innerHTML = '';
    
    eventosData.forEach((ev, idx) => {
        const flyer = ev.imagen || 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=1200';
        const fechaFormateada = formatearFechaLegible(ev.fecha);
        const slide = document.createElement('div');
        
        slide.className = `carousel-item absolute inset-0 w-full h-full transition-opacity duration-700 ease-in-out ${idx === 0 ? 'opacity-100 z-10' : 'opacity-0 z-0'} flex items-center justify-start px-12 md:px-24 bg-cover bg-center bg-no-repeat`;
        slide.style.backgroundImage = `linear-gradient(to right, rgba(0,0,0,0.85), rgba(0,0,0,0.3)), url('${flyer}')`;

        const precioMin = ev.categorias && ev.categorias.length > 0 ? ev.categorias[0].precio : 0;

        slide.innerHTML = `
            <div class="max-w-2xl text-white space-y-3">
                <span class="bg-amber-500 text-zinc-950 text-xs font-black px-3 py-1 rounded-full uppercase tracking-wider">${ev.categoria || 'Evento'}</span>
                <h1 class="text-4xl md:text-5xl font-extrabold tracking-tight">${ev.titulo}</h1>
                <p class="text-amber-400 font-bold text-sm flex items-center gap-1">${fechaFormateada}</p>
                <p class="text-sm text-gray-300 line-clamp-2">${ev.descripcion || ''}</p>
                <p class="text-md text-gray-200">📍 ${ev.direccion || ''} (${(ev.comuna || '').toUpperCase()}) — Desde $${precioMin.toLocaleString('es-CL')} CLP</p>
                
                <button onclick="irAlCheckout(${ev.id})" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-3 rounded-lg text-lg transition shadow-lg mt-2 cursor-pointer">
                    Comprar entradas
                </button>
            </div>
        `;
        container.appendChild(slide);
    });

    configurarControlesYAutoplayCarrusel();
}

// 4. LÓGICA DE ROTACIÓN AUTOMÁTICA Y FLECHAS
function cambiarDiapositiva(siguienteIndice) {
    const slides = document.querySelectorAll('.carousel-item');
    if (slides.length <= 1) return;

    slides[currentIndex].classList.replace('opacity-100', 'opacity-0');
    slides[currentIndex].classList.replace('z-10', 'z-0');

    currentIndex = siguienteIndice;
    slides[currentIndex].classList.replace('opacity-0', 'opacity-100');
    slides[currentIndex].classList.replace('z-0', 'z-10');
}

function configurarControlesYAutoplayCarrusel() {
    const slides = document.querySelectorAll('.carousel-item');
    if (slides.length <= 1) return;

    if (carruselIntervalo) clearInterval(carruselIntervalo);

    carruselIntervalo = setInterval(() => {
        const siguiente = (currentIndex + 1) % slides.length;
        cambiarDiapositiva(siguiente);
    }, 5000);

    const btnNext = document.getElementById('nextBtn');
    if (btnNext) {
        btnNext.onclick = () => {
            clearInterval(carruselIntervalo);
            const siguiente = (currentIndex + 1) % slides.length;
            cambiarDiapositiva(siguiente);
        };
    }

    const btnPrev = document.getElementById('prevBtn');
    if (btnPrev) {
        btnPrev.onclick = () => {
            clearInterval(carruselIntervalo);
            const anterior = (currentIndex - 1 + slides.length) % slides.length;
            cambiarDiapositiva(anterior);
        };
    }
}

// 5. RENDERIZAR TARJETAS DE CATEGORÍA
function renderizarGrillasPorCategoria() {
    const categorias = ["Salud mental", "Entretenimiento", "Educación", "Cultura"];

    categorias.forEach(cat => {
        const grid = document.getElementById(`grid-${cat}`);
        if (!grid) return;

        grid.innerHTML = '';
        const filtrados = eventosData.filter(e => e.categoria === cat);

        if (filtrados.length === 0) {
            grid.innerHTML = `<p class="text-gray-400 text-sm col-span-3">No hay eventos disponibles en esta categoría por el momento.</p>`;
            return;
        }

        filtrados.forEach(ev => {
            const precioMin = ev.categorias && ev.categorias.length > 0 ? ev.categorias[0].precio : 0;
            const fechaFormateada = formatearFechaLegible(ev.fecha);
            const flyerImg = ev.imagen || 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=500';

            const card = document.createElement('div');
            card.className = "bg-white rounded-2xl shadow-md border border-gray-100 p-6 flex flex-col items-center text-center transition-transform hover:scale-[1.02] duration-300";
            
            card.innerHTML = `
                <div class="w-full bg-zinc-100 rounded-xl h-64 flex items-center justify-center text-gray-400 font-bold mb-3 overflow-hidden relative">
                    <img src="${flyerImg}" class="w-full h-full object-cover rounded-xl" alt="${ev.titulo}">
                </div>
                
                <div class="bg-amber-50 text-amber-900 border border-amber-200/60 rounded-lg px-3 py-1.5 text-xs font-bold mb-4 w-full">
                    ${fechaFormateada}
                </div>
                
                <h3 class="text-2xl font-black text-zinc-900 mb-1">${ev.titulo}</h3>
                <p class="text-xs text-gray-500 mb-3 line-clamp-2">${ev.descripcion || 'Sin descripción'}</p>
                <p class="text-gray-900 font-black text-lg mb-6">$${precioMin.toLocaleString('es-CL')} CLP</p>
                <button onclick="irAlCheckout(${ev.id})" class="w-full bg-amber-500 hover:bg-amber-600 text-zinc-950 font-black py-3 rounded-xl uppercase tracking-wider text-sm transition-colors mt-auto shadow-sm cursor-pointer">
                    Comprar Entradas
                </button>
            `;
            grid.appendChild(card);
        });
    });
}

// 6. FUNCIONES DE FILTRADO (BUSCAR Y LIMPIAR)
function aplicarFiltrosBusqueda() {
    const inputComuna = document.getElementById('filtro-comuna');
    const inputFecha = document.getElementById('filtro-fecha');

    const comunaSeleccionada = normalizarTexto(inputComuna ? inputComuna.value : 'todas');
    const fechaSeleccionada = inputFecha ? inputFecha.value : ''; // Formato: YYYY-MM-DD

    const eventosFiltrados = eventosData.filter(ev => {
        // Coincidencia de comuna
        const comunaEv = normalizarTexto(ev.comuna);
        const matchComuna = (comunaSeleccionada === 'todas' || comunaEv === comunaSeleccionada);

        // Coincidencia de fecha
        let matchFecha = true;
        if (fechaSeleccionada) {
            const fechaEvFormato = (ev.fecha || '').slice(0, 10);
            matchFecha = (fechaEvFormato === fechaSeleccionada);
        }

        return matchComuna && matchFecha;
    });

    renderizarMarcadoresMapa(eventosFiltrados);
}

function limpiarFiltrosBusqueda() {
    const inputComuna = document.getElementById('filtro-comuna');
    const inputFecha = document.getElementById('filtro-fecha');

    if (inputComuna) inputComuna.value = 'todas';
    if (inputFecha) inputFecha.value = '';

    renderizarMarcadoresMapa(eventosData);
    if (map) {
        map.setView([-33.435, -70.620], 12);
    }
}

// 7. CARGAR DATOS DE INICIO
async function cargarDatosInicio() {
    inicializarMapa();

    try {
        const res = await fetch('/api/eventos', { headers: { Accept: 'application/json' } });
        const textoRespuesta = await res.text();

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${textoRespuesta.slice(0, 300)}`);
        }

        try {
            eventosData = JSON.parse(textoRespuesta || '[]');
        } catch (parseError) {
            console.error('La API de eventos no devolvió JSON válido:', textoRespuesta.slice(0, 500));
            eventosData = [];
        }
    } catch (error) {
        console.error('Error al cargar eventos:', error);
        eventosData = [];
    }

    renderizarCarruselSuperior();
    renderizarGrillasPorCategoria();
    renderizarMarcadoresMapa(eventosData);
}

document.addEventListener('DOMContentLoaded', () => {
    renderizarSesion();
    cargarDatosInicio();
});