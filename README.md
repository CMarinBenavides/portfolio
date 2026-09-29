# Portafolio

Portafolio web de modelo con galería de fotos, eventos, shootings, ficha de medidas, redes sociales y modo claro/oscuro. Incluye un modo de edición protegido por contraseña para subir y borrar fotos, publicar eventos (imagen, título y descripción) y shootings (portada + collage de 4 imágenes), y elegir la portada.

Las fotos se guardan en [Cloudinary](https://cloudinary.com), un servicio de imágenes en la nube con plan gratuito. Así las fotos no se pierden al reiniciar o actualizar el hosting, y cada visitante recibe una versión optimizada: más pequeña y en el formato más ligero que admita su navegador.

## Requisitos

- Node.js 21 o superior
- Una cuenta gratuita de Cloudinary

## Puesta en marcha

1. Crea una cuenta en https://cloudinary.com y copia tus claves (*Cloud name*, *API Key* y *API Secret*). Están en la consola, en **Dashboard → API Keys**.
2. Copia el archivo de ejemplo y rellénalo con tus claves y una contraseña:
   ```bash
   cp .env.example .env
   ```
3. Instala las dependencias y arranca el servidor:
   ```bash
   npm install
   npm start
   ```
4. Abre http://localhost:3000. Para subir fotos, pulsa las iniciales de arriba a la izquierda → **Editar** e introduce la contraseña.

Durante el desarrollo, `npm run dev` reinicia el servidor al guardar cambios.

### Migrar las fotos de la versión anterior

Si subiste fotos antes de usar Cloudinary (carpeta `uploads/`), ejecuta **una sola vez**:

```bash
npm run migrar
```

El script conserva títulos, descripciones y portada, y no borra los archivos locales. Cuando compruebes que todo se ve bien, puedes borrar `uploads/` y `data/images.json`.

## Publicar en un hosting

No subas el archivo `.env`. En el panel del hosting, configura las mismas variables que tiene: `ADMIN_PASSWORD`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` y `CLOUDINARY_API_SECRET`. El servidor usa el puerto que indique la variable `PORT`, que normalmente define el hosting.

## Personalización

Edita [data/config.json](data/config.json):

| Campo      | Qué es                                                                 |
| ---------- | ---------------------------------------------------------------------- |
| `name`     | Nombre completo (se muestra en dos líneas en la portada)               |
| `tagline`  | Lema sobre el nombre                                                    |
| `location` | Ciudad                                                                  |
| `bio`      | Texto de "Sobre mí"                                                     |
| `email`    | Correo de contacto                                                      |
| `github`   | Enlace del botón flotante de GitHub (bórralo para ocultar el botón)     |
| `stats`    | Medidas; puedes añadir o quitar las que quieras                         |
| `social`   | Redes sociales. Tienen icono: Instagram, Facebook, X y TikTok           |

En modo edición, la sección **Eventos** muestra el botón **+ Añadir evento**. Si no hay eventos, los visitantes ven el aviso «No hay eventos registrados».

La sección **Shootings** funciona igual, con el botón **+ Añadir shooting**. Cada shooting lleva título, descripción, una portada y exactamente 4 imágenes: la tarjeta muestra la portada y, al avanzar con las flechas (o deslizando en el móvil), el collage de 4 imágenes.

La portada es la foto marcada con **Usar como portada** en modo edición. Si no marcas ninguna, se usa la foto más antigua.

## Estructura

```
server.js                      Servidor Express y API
lib/cloudinary.js              Conexión con Cloudinary (galería, eventos y shootings)
scripts/migrar-fotos-locales.js  Pasa las fotos locales antiguas a Cloudinary
data/config.json               Datos del perfil
public/                        Página web (HTML, CSS y JavaScript)
.env.example                   Plantilla de variables de entorno
```

## API

| Método | Ruta                    | Descripción                                |
| ------ | ----------------------- | ------------------------------------------ |
| GET    | /api/config             | Datos del perfil                           |
| GET    | /api/images             | Lista de fotos                             |
| POST   | /api/login              | Comprueba la contraseña                    |
| POST   | /api/images             | Sube una foto (requiere contraseña)        |
| PUT    | /api/images/:id/cover   | La marca como portada (requiere contraseña) |
| GET    | /api/events             | Lista de eventos                           |
| POST   | /api/events             | Publica un evento (requiere contraseña; el título es obligatorio) |
| DELETE | /api/events/:id         | Borra un evento (requiere contraseña)      |
| GET    | /api/shootings          | Lista de shootings                         |
| POST   | /api/shootings          | Publica un shooting: campos `cover` (1 imagen), `images` (4), `title` y `description` (requiere contraseña) |
| DELETE | /api/shootings/:id      | Borra un shooting con sus 5 imágenes (requiere contraseña) |
| DELETE | /api/images/:id         | La borra (requiere contraseña)             |

Las rutas protegidas esperan la cabecera `x-admin-password`. Formatos aceptados: JPG, PNG, WEBP y GIF, de hasta 10 MB.
