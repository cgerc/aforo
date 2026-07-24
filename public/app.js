let map = null;
let eventosData = [];
let carruselIntervalo = null;
let currentIndex = 0;

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

        setTimeout(() => map.invalidateSize(), 300);
    } catch (err) {
        console.error("Error mapa:", err);
    }
}

// 2. RENDERIZAR MARCADORES DEL MAPA
function renderizarMarcadoresMapa() {
    if (!map || !eventosData) return;
    eventosData.forEach(ev => {
        if (ev.lat && ev.lng) {
            L.marker([ev.lat, ev.lng])
                .addTo(map)
                .bindPopup(`<b>${ev.titulo}</b><br>${ev.direccion || ev.comuna}`);
        }
    });
}

// 3. RENDERIZAR CARRUSEL COMPLETO SIN LÍMITE
function renderizarCarruselSuperior() {
    const container = document.getElementById('carousel-inner');
    if (!container || eventosData.length === 0) return;

    container.innerHTML = '';
    
    // Mostramos TODOS los eventos disponibles en lugar de recortarlos
    eventosData.forEach((ev, idx) => {
        const flyer = ev.imagen || 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=1200';
        const fechaFormateada = formatearFechaLegible(ev.fecha);
        const slide = document.createElement('div');
        
        // La primera diapositiva es visible (opacity-100 z-10) y las demás quedan ocultas (opacity-0 z-0)
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
                
                <button onclick="irAlCheckout(${ev.id})" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-3 rounded-lg text-lg transition shadow-lg mt-2">
                    Comprar entradas
                </button>
            </div>
        `;
        container.appendChild(slide);
    });

    // Activa la rotación automática y los controles de flecha
    configurarControlesYAutoplayCarrusel();
}

// 4. LÓGICA DE ROTACIÓN AUTOMÁTICA Y FLECHAS DE NAVEGACIÓN
function cambiarDiapositiva(siguienteIndice) {
    const slides = document.querySelectorAll('.carousel-item');
    if (slides.length <= 1) return;

    // Oculta la diapositiva actual
    slides[currentIndex].classList.replace('opacity-100', 'opacity-0');
    slides[currentIndex].classList.replace('z-10', 'z-0');

    // Muestra la nueva diapositiva
    currentIndex = siguienteIndice;
    slides[currentIndex].classList.replace('opacity-0', 'opacity-100');
    slides[currentIndex].classList.replace('z-0', 'z-10');
}

function configurarControlesYAutoplayCarrusel() {
    const slides = document.querySelectorAll('.carousel-item');
    if (slides.length <= 1) return;

    // Reinicia el temporizador si ya existía uno activo
    if (carruselIntervalo) clearInterval(carruselIntervalo);

    // Cambia automáticamente de evento cada 5 segundos (5000 ms)
    carruselIntervalo = setInterval(() => {
        const siguiente = (currentIndex + 1) % slides.length;
        cambiarDiapositiva(siguiente);
    }, 5000);

    // Botón Siguiente (Flecha Derecha)
    const btnNext = document.getElementById('nextBtn');
    if (btnNext) {
        btnNext.onclick = () => {
            clearInterval(carruselIntervalo);
            const siguiente = (currentIndex + 1) % slides.length;
            cambiarDiapositiva(siguiente);
        };
    }

    // Botón Anterior (Flecha Izquierda)
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
                <button onclick="irAlCheckout(${ev.id})" class="w-full bg-amber-500 hover:bg-amber-600 text-zinc-950 font-black py-3 rounded-xl uppercase tracking-wider text-sm transition-colors mt-auto shadow-sm">
                    Comprar Entradas
                </button>
            `;
            grid.appendChild(card);
        });
    });
}

// 6. CARGAR DATOS DE INICIO
async function cargarDatosInicio() {
    inicializarMapa();

    try {
        const res = await fetch('/api/eventos');
        eventosData = await res.json();
    } catch (error) {
        console.error("Error al cargar eventos:", error);
    }

    renderizarCarruselSuperior();
    renderizarGrillasPorCategoria();
    renderizarMarcadoresMapa();
}

document.addEventListener('DOMContentLoaded', cargarDatosInicio);