# Reservas · Control de gastos

App de control de gastos personales por reservas de categoría, con seguimiento de tarjeta de crédito.

## Requisitos

- [Node.js](https://nodejs.org) 18 o superior (incluye `npm`).

## Cómo correrla en tu computadora

1. Descomprimí este proyecto en una carpeta.
2. Abrí una terminal en esa carpeta.
3. Instalá las dependencias:

   ```bash
   npm install
   ```

4. Levantá el servidor de desarrollo:

   ```bash
   npm run dev
   ```

5. Se va a abrir automáticamente en `http://localhost:5173` (si no, entrá manualmente a esa dirección).

## Persistencia de datos

Los datos (categorías, gastos, umbrales de alerta) se guardan en el **localStorage** del navegador. Van a seguir ahí aunque cierres la pestaña o reinicies la compu, siempre que uses el mismo navegador y no borres los datos de sitios.

Si más adelante querés sincronizar entre dispositivos, el siguiente paso natural es reemplazar el shim de `src/App.jsx` (la constante `storage`, al principio del archivo) por llamadas a un backend propio.

## Publicarla en internet (opcional)

Para tener la app accesible desde tu celular sin correr nada local, generá el build de producción:

```bash
npm run build
```

Esto crea una carpeta `dist/` que podés subir gratis a servicios como [Vercel](https://vercel.com), [Netlify](https://netlify.com) o [GitHub Pages](https://pages.github.com). En Vercel o Netlify, conectando el repo, ni siquiera hace falta configurar nada: detectan Vite automáticamente (comando de build `npm run build`, carpeta de salida `dist`).

## Estructura

```
├── index.html
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx     # punto de entrada de React
    ├── App.jsx      # toda la lógica y la interfaz de la app
    └── index.css    # reset mínimo
```
