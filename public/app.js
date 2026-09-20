let map = null;

let markersLayer = null;

let eventosData = [];

let publicidadesData = [];

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



    contenedor.innerHTML = '<a href="login.html" class="text-slate-800 hover:text-black font-bold transition">Portal de organizadores</a>';

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

                <div class="text-[#1E293B] font-sans p-1 min-w-[180px]">

                    <strong class="text-sm block font-bold mb-1">${ev.titulo}</strong>

                    <p class="text-xs text-[#64748B] mb-1">${fechaTxt}</p>

                    <p class="text-xs text-[#64748B] mb-2">📍 ${ev.direccion || ''} (${(ev.comuna || '').toUpperCase()})</p>

                    <a href="https://www.google.com/maps?q=${ev.lat},${ev.lng}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-[10px] font-bold text-[#26B488] hover:text-[#1FA078] underline mb-3 cursor-pointer">
                        Abrir en Google Maps
                    </a>

                    <p class="text-xs font-black text-[#1E293B] mb-3">Desde $${precioMin.toLocaleString('es-CL')} CLP</p>

                    <button onclick="irAlCheckout(${ev.id})" class="w-full bg-[#26B488] hover:bg-[#1FA078] text-white font-bold text-xs py-2 px-3 rounded-full cursor-pointer uppercase tracking-wider transition shadow active:scale-95">

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

function renderizarCarruselSuperior(lista = eventosData) {

    const container = document.getElementById('carousel-inner');

    if (!container) return;


container.innerHTML = '';



    let slidesCarrusel = [];



    publicidadesData.forEach(pub => {

        slidesCarrusel.push({ tipo: 'publicidad', datos: pub });

    });



    lista.forEach(ev => {

        slidesCarrusel.push({ tipo: 'evento', datos: ev });

    });



    if (slidesCarrusel.length === 0) {

        return;

    }



    slidesCarrusel.forEach((slideDef, idx) => {



        const esPublicidad = slideDef.tipo === 'publicidad';

        const ev = slideDef.datos;



        if (esPublicidad) {

            const slidePub = document.createElement('div');

            slidePub.className = `carousel-item absolute inset-0 w-full h-full transition-opacity duration-700 ease-in-out ${idx === 0 ? 'opacity-100 z-10' : 'opacity-0 z-0'} overflow-hidden cursor-pointer`;

            slidePub.title = ev.titulo || 'Publicidad';

            const imagenPub = ev.imagen || 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=1200';

            slidePub.style.background = '#0d1117';

            slidePub.innerHTML = `

                <img src="${imagenPub}" class="absolute inset-0 w-full h-full object-contain object-center" alt="${ev.titulo || 'Publicidad'}">

            `;

            slidePub.onclick = (e) => {

                e.preventDefault();

                const mapa = document.getElementById('mapa');

                if (mapa) mapa.scrollIntoView({ behavior: 'smooth', block: 'center' });

            };

            container.appendChild(slidePub);

            return;

        }

        const flyer = ev.imagen || 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=1200';

        const fechaFormateada = formatearFechaLegible(ev.fecha);

        const slide = document.createElement('div');

       

        slide.className = `carousel-item absolute inset-0 w-full h-full transition-opacity duration-700 ease-in-out ${idx === 0 ? 'opacity-100 z-10' : 'opacity-0 z-0'} overflow-hidden`;

        slide.style.backgroundImage = '';
        slide.style.background = '#0d1117';


        const precioMin = ev.categorias && ev.categorias.length > 0 ? ev.categorias[0].precio : 0;



        slide.innerHTML = `

            <div class="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-transparent z-10"></div>

            <img src="${flyer}" class="absolute inset-0 w-full h-full object-cover object-center" alt="${ev.titulo}">

            <div class="relative z-20 px-8 md:px-16 max-w-2xl text-white carousel-content">

                <span class="inline-block bg-[#A0E1C9] text-[#065F46] text-sm font-bold uppercase tracking-wider px-7 py-3 rounded-full mb-3">${ev.categoria || 'Evento'}</span>

                <h1 class="text-3xl md:text-4xl font-extrabold text-white leading-tight mb-3">${ev.titulo}</h1>

                <div class="flex items-center gap-2 mb-2">
                    <svg class="w-4 h-4 text-slate-200 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    <span class="text-sm font-medium text-slate-100">${fechaFormateada.replace('📅 ', '').replace('⏰ ', '')}</span>
                </div>

                <div class="flex items-center gap-2 mb-4">
                    <svg class="w-4 h-4 text-slate-200 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/></svg>
                    <span class="text-sm font-medium text-slate-100">${ev.direccion || ''} (${(ev.comuna || '').toUpperCase()}) — Desde $${precioMin.toLocaleString('es-CL')} CLP</span>
                </div>

                <p class="text-sm text-slate-200 line-clamp-2 mb-6">${ev.descripcion || ''}</p>

                <button onclick="abrirModalInscripcion(${ev.id}, '${ev.titulo.replace(/'/g, "\\'")}')" class="rounded-full bg-[#26B488] hover:bg-[#1FA078] text-white font-bold px-7 py-3 text-sm uppercase tracking-wider transition-all shadow-md active:scale-95 cursor-pointer">
                    Próximamente — Recibe mayor información aquí
                </button>

            </div>

        `;

        container.appendChild(slide);

    });

    // Margen superior proporcional al total de texto: centra el bloque dentro de la imagen
    container.querySelectorAll('.carousel-content').forEach(bloque => {
        const slide = bloque.closest('.carousel-item');
        if (!slide) return;
        const altoImagen = slide.offsetHeight;
        const altoBloque = bloque.offsetHeight;
        bloque.style.marginTop = Math.max(24, Math.floor((altoImagen - altoBloque) / 2)) + 'px';
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

function renderizarGrillasPorCategoria(lista = eventosData) {

    const categorias = ["Salud mental", "Entretenimiento", "Educación", "Cultura"];

   

    categorias.forEach(cat => {

        const grid = document.getElementById(`grid-${cat}`);

        if (!grid) return;

   

        grid.innerHTML = '';

        const filtrados = lista.filter(e => e.categoria === cat);



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

                <div class="w-full bg-zinc-100 rounded-2xl h-64 flex items-center justify-center text-gray-400 font-bold mb-3 overflow-hidden relative">

                    <img src="${flyerImg}" class="w-full h-full object-cover rounded-2xl" alt="${ev.titulo}">

                </div>

               

                <div class="bg-[#A0E1C9]/30 text-[#065F46] rounded-full px-3 py-1.5 text-xs font-bold mb-4 w-fit">

                    ${fechaFormateada}

                </div>

               

                <h3 class="text-xl font-black text-slate-900 mb-1">${ev.titulo}</h3>

                <p class="text-slate-900 font-black text-lg mb-6">$${precioMin.toLocaleString('es-CL')} CLP</p>

                <div class="w-full space-y-2 mt-auto">
                    <button onclick="abrirModalInscripcion(${ev.id}, '${ev.titulo.replace(/'/g, "\\'")}')" class="w-full bg-[#A0E1C9]/20 hover:bg-[#A0E1C9]/40 text-[#1B5E4B] font-bold py-2.5 rounded-xl uppercase tracking-wider text-xs transition-colors border border-[#A0E1C9] cursor-pointer">
                        Próximamente — Recibe mayor información
                    </button>
                    <button onclick="irAlCheckout(${ev.id})" class="w-full bg-[#26B488] hover:bg-[#1FA078] text-white font-bold py-3 rounded-xl uppercase tracking-wider text-sm transition-colors shadow-md active:scale-95 cursor-pointer">
                        Comprar Entradas
                    </button>
                </div>

            `;

            grid.appendChild(card);

        });

    });

}



// 6. BUSCADOR GLOBAL DEL NAVBAR

function buscarEventosGlobally() {
    const input = document.getElementById('buscador-global');
    const termino = normalizarTexto(input ? input.value : '');

    if (!termino) {
        renderizarCarruselSuperior();
        renderizarGrillasPorCategoria();
        renderizarMarcadoresMapa(eventosData);
        if (map) map.setView([-33.435, -70.620], 12);
        return;
    }

    const palabrasTermino = termino.split(/\s+/);

    const eventosFiltrados = eventosData.filter(ev => {
        const textoEvento = normalizarTexto([
            ev.titulo,
            ev.descripcion,
            ev.categoria,
            ev.comuna,
            ev.direccion
        ].join(' '));

        return palabrasTermino.every(palabra => textoEvento.includes(palabra));
    });

    renderizarCarruselSuperior(eventosFiltrados);
    renderizarGrillasPorCategoria(eventosFiltrados);
    renderizarMarcadoresMapa(eventosFiltrados);

    const seccionCategorias = document.querySelector('#categorias-search');
    if (seccionCategorias) seccionCategorias.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// 7. FUNCIONES DE FILTRADO (BUSCAR Y LIMPIAR)

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

        const res = await fetch('/api/eventos', { cache: 'no-store', headers: { Accept: 'application/json' } });

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



    try {

        const resPub = await fetch('/api/publicidad', { cache: 'no-store', headers: { Accept: 'application/json' } });

        const textoPub = await resPub.text();

        if (resPub.ok) {

            try {

                publicidadesData = JSON.parse(textoPub || '[]');

            } catch (parseError) {

                console.error('La API de publicidad no devolvió JSON válido:', textoPub.slice(0, 500));

                publicidadesData = [];

            }

        } else {

            publicidadesData = [];

        }

    } catch (error) {

        console.error('Error al cargar publicidad:', error);

        publicidadesData = [];

    }



    renderizarCarruselSuperior();

    renderizarGrillasPorCategoria();

    renderizarMarcadoresMapa(eventosData);

}



// 8. MODAL DE INSCRIPCIÓN

function abrirModalInscripcion(eventoId, eventoNombre) {
    const modal = document.getElementById('modal-inscripcion');
    const titulo = document.getElementById('modal-inscripcion-titulo');
    const inputId = document.getElementById('insc-evento-id');
    const errorDiv = document.getElementById('insc-error');
    const exitoDiv = document.getElementById('insc-exito');
    const form = document.getElementById('form-inscripcion');

    if (!modal) return;

    titulo.textContent = eventoNombre;
    inputId.value = eventoId || '';
    errorDiv.classList.add('hidden');
    exitoDiv.classList.add('hidden');
    form.reset();
    inputId.value = eventoId || '';
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function cerrarModalInscripcion() {
    const modal = document.getElementById('modal-inscripcion');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

document.addEventListener('DOMContentLoaded', () => {
    renderizarSesion();
    cargarDatosInicio();

    const buscadorGlobal = document.getElementById('buscador-global');
    if (buscadorGlobal) {
        buscadorGlobal.addEventListener('input', buscarEventosGlobally);
    }

    const parametroBusqueda = new URLSearchParams(window.location.search).get('q');
    if (parametroBusqueda && buscadorGlobal) {
        buscadorGlobal.value = parametroBusqueda;
        buscarEventosGlobally();
    }

    const form = document.getElementById('form-inscripcion');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const btn = document.getElementById('btn-inscribir');
            const errorDiv = document.getElementById('insc-error');
            const exitoDiv = document.getElementById('insc-exito');

            const nombre = document.getElementById('insc-nombre').value.trim();
            const celular = document.getElementById('insc-celular').value.trim();
            const correo = document.getElementById('insc-correo').value.trim();
            const eventoId = document.getElementById('insc-evento-id').value;

            errorDiv.classList.add('hidden');
            exitoDiv.classList.add('hidden');

            if (!nombre || !celular || !correo) {
                errorDiv.innerText = 'Por favor completa todos los campos.';
                errorDiv.classList.remove('hidden');
                return;
            }

            btn.disabled = true;
            btn.innerText = 'Enviando...';

            try {
                const res = await fetch('/api/inscribir', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre, celular, correo, eventoId: eventoId ? Number(eventoId) : null })
                });

                const data = await res.json().catch(() => ({}));

                if (res.ok) {
                    exitoDiv.innerText = '¡Inscripción enviada correctamente! Te contactaremos pronto.';
                    exitoDiv.classList.remove('hidden');
                    form.reset();
                    setTimeout(() => cerrarModalInscripcion(), 3000);
                } else {
                    errorDiv.innerText = data.error || 'No se pudo procesar la inscripción.';
                    errorDiv.classList.remove('hidden');
                }
            } catch (err) {
                errorDiv.innerText = 'Error de conexión con el servidor.';
                errorDiv.classList.remove('hidden');
            } finally {
                btn.disabled = false;
                btn.innerText = 'Enviar inscripción';
            }
        });
    }
}); 

