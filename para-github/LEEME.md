# Tuerca Store

Tienda online de singles de Magic: The Gathering.

- **Cartas**: se importan desde [Scryfall](https://scryfall.com) (imagen, edición, texto, rareza y colores).
- **Precios**: salen del listado público de [Card Kingdom](https://www.cardkingdom.com) (`api.cardkingdom.com/api/v2/pricelist`). Se cruzan con cada carta por su `scryfall_id`, teniendo en cuenta si es foil y la condición (NM/LP/MP/HP).
- **Acabados**: Normal, Foil y **Surge Foil**, cada uno con su propio stock y precio.
- **Formatos**: filtro por formato (Standard, Pioneer, Modern, Legacy, Vintage, Pauper, Commander, Pauper Commander, etc.) con los datos de legalidad de Scryfall. Las cartas baneadas o restringidas llevan un aviso.
- **Cuentas de clientes**: registro con mail y contraseña, verificado con un código que llega al mail. Los datos personales se guardan cifrados.
- **Vendé tus cartas**: los clientes cotizan y te venden cartas al **50% en dinero** o **75% en crédito de tienda**. Los porcentajes se configuran.
- **Crédito de tienda**: cada cliente tiene su saldo con historial de movimientos y lo puede usar al pagar sus pedidos.
- **Pedidos**: el cliente arma el carrito y el pedido llega a tu panel. Además se abre WhatsApp con el detalle listo para enviar. Para pedir hace falta tener cuenta.
- **Wishlist**: cada cliente anota las cartas que busca y se le avisa cuando entran en stock.

## Cómo usarla

1. Instalá [Node.js](https://nodejs.org) (versión LTS) si todavía no lo tenés.
2. Hacé doble clic en **`iniciar.bat`**. La primera vez instala las dependencias y después abre el navegador.
   - También podés hacerlo a mano: `npm install` y después `npm start`.
3. Tienda: <http://localhost:3000>
4. Panel de administración: <http://localhost:3000/admin>. La contraseña inicial es **`tuerca123`**; cambiala en *Configuración*.

La primera vez que arranca descarga la lista de precios de Card Kingdom (tiene varios MB y puede tardar un poco). Después se actualiza sola cada 12 horas o cuando tocás *Actualizar precios ahora*.

## Panel de administración

| Pestaña | Qué hace |
|---|---|
| **Agregar cartas** | Busca en Scryfall (acepta su sintaxis: `set:mh3`, `t:dragon c:r`, `!"Sol Ring"`…). Muestra el precio de Card Kingdom de cada acabado (normal, foil y surge foil), más el precio final estimado. Elegís acabado, condición, idioma y cantidad, y la agregás al stock. El botón *Ediciones* muestra todas las impresiones. |
| **Importar lista** | Pegás una lista en formato Moxfield/Arena/MTGO (`4 Sol Ring (C21) 263`, `2x Counterspell [MH2]`, `1 Ragavan (MH2) 138 *F*`), la previsualizás y la cargás de una vez. Al final de cada línea: `*F*`/`foil` = Foil, `*S*`/`surge` = Surge Foil. |
| **Inventario** | Editás cantidad, condición, idioma y acabado (Normal, Foil o Surge Foil). *Precio fijo* reemplaza el precio automático en una carta puntual. Exporta a CSV (Excel). |
| **Compras** | Solicitudes de clientes que te quieren vender cartas: revisás, ajustás cantidades o valores, y al *Completar* se acredita el crédito (si eligió crédito) y, si querés, las cartas entran al stock. |
| **Clientes** | Datos de cada cliente, verificación, **crédito de tienda** (saldo, movimientos y ajustes manuales con motivo), cambio de contraseña y bloqueo. |
| **Pedidos** | Ves los pedidos. Los marcás como pagado o entregado; si los cancelás, el stock vuelve solo. |
| **Configuración** | Nombre, WhatsApp, moneda (ARS/USD), cotización del dólar (con botón para traerla de dolarapi.com: oficial, blue, MEP, tarjeta, cripto), recargo o descuento sobre Card Kingdom, redondeo y precio mínimo. |

### Surge Foil

El Surge Foil se trata como un acabado aparte del Foil, con su propio stock y precio. Se detecta de dos maneras:

- **Por Scryfall**: la impresión viene marcada como `surgefoil`, como los Sol Ring ★ de Warhammer 40K o las versiones surge de Fallout, Doctor Who, etc. En ese caso el único foil de esa impresión es el Surge, y se carga como Surge Foil aunque elijas "foil".
- **Por Card Kingdom**: la entrada foil tiene "Surge Foil" en la variante. En ese caso el precio se toma de esa entrada y no del foil común.

Si Card Kingdom no tiene precio para un Surge Foil, solo se usa el de Scryfall cuando la impresión es surge. En cualquier otro caso queda "Sin precio" y lo podés fijar a mano.

### Formatos y baneos

La legalidad de cada carta en cada formato sale de Scryfall.

- **En la tienda:** al elegir un formato se ven las cartas legales en ese formato. Las baneadas aparecen al final, con el aviso "⚠ BANEADA EN …", y las restringidas llevan "⚠ RESTRINGIDA EN …". El detalle de cada carta muestra una tabla con todos los formatos.
- **Actualización:** los baneos cambian con el tiempo. Por eso los datos se actualizan solos al arrancar y una vez por día, o cuando tocás *Configuración → Actualizar legalidades ahora*.
- **Panel:** en el Inventario, debajo de cada carta, figuran los formatos en los que está baneada.

### Cuentas de clientes y seguridad

- **Registro:** los clientes se registran con su **mail** y una contraseña de 8 caracteres como mínimo. Con la cuenta, los datos se completan solos al comprar, y en *Mis pedidos* ven su historial y el estado de cada pedido.
- **Cuenta obligatoria:** para hacer un pedido hay que ingresar con una cuenta verificada. El servidor rechaza los pedidos sin cuenta. Ojo: en la tienda publicada, si el envío de mails no está configurado no se pueden crear cuentas nuevas, y por lo tanto nadie nuevo puede comprar.
- **Contraseñas:** se guardan como **hash scrypt**. No se pueden ver ni descifrar, ni siquiera desde el panel. Si alguien la olvida, en *Panel → Clientes → Nueva contraseña* le asignás una y se la pasás.
- **Mail, nombre y datos de los pedidos (nombre, teléfono, nota):** se guardan **cifrados con AES-256-GCM** en `usuarios.json` y `pedidos.json`. El panel los descifra solo para mostrártelos.
- **Clave de cifrado:** está en `data/clave-secreta.txt` y se crea sola la primera vez. **Guardala en un lugar seguro:** sin ella, esos datos no se pueden recuperar.
- **Mudar la tienda con clientes o pedidos:** para pasarla de tu PC a Railway, copiá el contenido de `clave-secreta.txt` en una variable de Railway llamada `TUERCA_SECRET` **antes** de restaurar el respaldo.
- **Verificación (persona real):** al registrarse, cada cliente recibe un **código de 6 dígitos** en su mail y tiene que escribirlo para activar la cuenta. Hasta entonces no puede comprar con la cuenta.
  - El código vence en 10 minutos, admite 5 intentos, y se puede reenviar después de 1 minuto (máximo 5 por hora).
  - Además hay una trampa anti-bots: un campo invisible y un control del tiempo que se tarda en completar el formulario.
  - **Configurar el envío:** en *Configuración → Verificación de cuentas (mail)* tocá *Usar Gmail* y completá tu Gmail y una [contraseña de aplicación](https://myaccount.google.com/apppasswords). Para crearla necesitás tener activada la verificación en 2 pasos. Es gratis, hasta 500 mails por día. Con *Enviar prueba* comprobás que funcione.
  - La contraseña de aplicación se guarda cifrada y nunca va en el respaldo.
  - **Modo prueba:** si no configurás el mail, en tu PC el código aparece en la ventana negra, para que puedas probar. En la tienda publicada, el registro queda desactivado hasta que lo configures.
  - **En Railway** también podés cargarlo como variables: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (y opcional `SMTP_FROM`).
  - **Panel → Clientes** muestra quién está verificado. Si confirmaste a alguien por otro medio, podés *Verificar a mano*.
- **Sesiones:** usan una cookie `HttpOnly` firmada que dura 30 días.
- **Protección contra intentos:** el ingreso y el registro tienen límite de intentos.

### Vendé tus cartas y crédito de tienda

- **Página** `/vender`, con acceso desde el menú *Vender cartas* y el aviso en la tienda.
- **Cotización:** el cliente busca la carta, elige edición, acabado (Normal, Foil o Surge Foil) y estado, y ve al instante cuánto le pagás. Se calcula así:
  ```
  oferta en dinero  = precio de venta de la tienda × 50%   (redondeado hacia abajo)
  oferta en crédito = precio de venta de la tienda × 75%
  ```
  El precio de venta es el mismo que usa la tienda (Card Kingdom + recargo + dólar), sin el precio mínimo.
- **Configuración** (*Configuración → Compra de cartas*): los dos porcentajes, una oferta mínima para no comprar cartas de muy poco valor, el redondeo, y la opción de apagar el módulo.
- **Solicitud:** el cliente arma su lista, elige dinero o crédito y envía la solicitud. Para eso necesita cuenta verificada. El servidor recalcula todos los valores, así que no se pueden manipular desde el navegador.
- **Cómo la resolvés** en *Panel → Compras*:
  - Revisás las cartas en persona y podés bajar la cantidad aceptada o el valor por carta.
  - Al tocar *Completar*, si eligió crédito se le acredita automáticamente (una sola vez), y con *Sumar las cartas al stock* entran al inventario.
  - Podés dejarle una nota, que el cliente ve en *Mis ventas*.
- **Fotos obligatorias:** con *Configuración → Compra de cartas → Exigir fotos de las cartas por mail* activado (viene activado), la venta no se puede completar hasta que el cliente mande fotos de las cartas, frente y dorso.
  - En *Mail donde recibís las fotos* ponés la dirección; si la dejás vacía se usa tu Gmail de envío.
  - El cliente lo ve antes de enviar la solicitud y, al enviarla, tiene un botón que le abre su correo con el destinatario, el asunto ("Fotos solicitud V-5001 - Nombre") y la lista de cartas ya escritos. Si configuraste el envío de mails, además le llega un mail con instrucciones que puede responder adjuntando las fotos.
  - En *Mis ventas* le queda el aviso "Faltan las fotos" hasta que las recibas.
  - En *Panel → Compras* la solicitud muestra "Esperando fotos" y el botón *Completar* queda deshabilitado hasta que tildes **Recibí las fotos**. El servidor también lo controla.
- **Crédito de tienda:**
  - Cada cliente ve su saldo y movimientos en *Mi crédito de tienda*.
  - Al hacer un pedido puede tildar *Usar mi crédito*: se descuenta del total y el mensaje de WhatsApp muestra cuánto queda por pagar.
  - Si cancelás el pedido, el crédito vuelve solo.
  - Desde *Panel → Clientes → Ver / ajustar* sumás o restás crédito con un motivo, por ejemplo premios de torneo o correcciones. El saldo nunca puede quedar negativo.
  - El saldo se calcula a partir de un libro de movimientos (`creditos.json`), nunca se pisa un número, y entra en el respaldo.

### Importar una lista o un mazo para cotizar

En **Vendé tus cartas**, "Importar una lista o un mazo" cotiza todo junto: el cliente pega una lista (formato Moxfield, Archidekt, Arena o MTGO, una carta por línea) o el link de un mazo **público de Archidekt**, elige el estado y ve cuánto se le ofrece por cada carta y por el total, con un botón para agregar todas a su lista. Los links de Moxfield no se pueden leer (Moxfield bloquea el acceso desde otras páginas): hay que pegar la lista exportada.

### Cotizar cartas (panel)

La pestaña **Cotizar cartas** del panel calcula cuánto pagar por las cartas de un cliente: escribís o pegás las cartas (o el link de un mazo público de Archidekt) y muestra, por carta y en total, el precio de venta, el valor en **dinero** y el valor en **crédito de tienda** según los porcentajes de Configuración (50% y 75% por defecto). Se puede cambiar acabado, estado y cantidad, y copiar el resumen para mandarlo por WhatsApp. No crea ninguna compra ni toca el stock.

### Pedidos: "preparado", avisos y chat

- La pestaña **Pedidos** es un tablero con columnas: **Nuevo pedido → En preparación → Preparado → Pagado → Entregado / Cancelado**. Cada pedido se minimiza o agranda con un clic (o todos juntos con los botones de arriba) y se mueve de etapa con el botón del siguiente paso, con el desplegable de estado o arrastrándolo a otra columna. Los cancelados quedan marcados en rojo.
- En **Pedidos**, el botón **✔ Marcar preparado** (o el estado `preparado`) le avisa al cliente: en la tienda le aparece un globito rojo en su cuenta y, en **Mis pedidos**, el cartel "¡Tu pedido está listo para retirar!". El panel te muestra si ya vio el aviso.
- Cada pedido tiene un **chat** para coordinar el retiro. Los mensajes nuevos del cliente se marcan con un número en la pestaña Pedidos; los tuyos, con el globito en la cuenta del cliente. Los mensajes se guardan cifrados.
- Los pedidos viejos hechos sin cuenta (de cuando no era obligatoria) no tienen avisos ni chat: coordiná por WhatsApp.

### Wishlist y avisos de stock

- **Cliente:** en su cuenta, *Mi wishlist*. Busca la carta por nombre y la agrega (hasta 100). Si busca en la tienda algo que no hay, el botón *Avisame cuando entre* la lleva directo ahí. Opcionalmente deja su **WhatsApp**.
- **Cuándo se avisa:** cuando una carta de su lista pasa de no tener stock a tenerlo (en cualquier edición, acabado o estado), sea porque la cargaste, la importaste, completaste una compra o se canceló un pedido. Si se agota y vuelve a entrar, se avisa de nuevo. Si la carta ya estaba en stock al agregarla, no se manda aviso: la ve como "En stock" en su lista.
- **Por mail:** sale solo, con el precio y el link a cada carta. Usa el mismo envío de mails que la verificación de cuentas; si no está configurado, no se manda.
- **Por WhatsApp:** WhatsApp no permite mandar mensajes automáticos sin la API paga de Meta, así que el aviso queda en *Panel → Clientes → Wishlists* (con un número en la pestaña) y lo mandás con un clic en *Avisar por WhatsApp*: se abre tu WhatsApp con el número del cliente y el mensaje ya escrito.
- **Cartas más buscadas:** en ese mismo recuadro ves qué cartas piden tus clientes y cuántos las quieren, para saber qué conviene conseguir.
- **Links de los avisos:** en Railway se arman solos. Si usás dominio propio, definí la variable `PUBLIC_URL` (por ejemplo `https://tuercastore.com`).

### Cómo se calcula el precio

```
precio = precio CK (según foil y condición) × (1 + recargo %) × dólar   → redondeado hacia arriba → mínimo
```

Si Card Kingdom no tiene la carta, se usa el precio en USD de Scryfall (se puede desactivar). En el inventario, cada carta indica de dónde salió su precio (CK / Scryfall / Manual).

## Datos

Todo se guarda en la carpeta `data/`:

- `inventario.json`: tu stock
- `pedidos.json`: pedidos
- `ventas.json`: cartas que te vendieron o te quieren vender los clientes
- `creditos.json`: movimientos del crédito de tienda
- `usuarios.json`: cuentas de clientes (datos cifrados)
- `config.json`: configuración
- `ck-pricelist.json`: copia local de los precios de Card Kingdom

**Hacé copia de seguridad de `data/`** (o usá *Exportar CSV*).

## ⚠ Seguridad con GitHub

**La carpeta `data/` NUNCA se sube a GitHub.** Tiene la clave de cifrado, tus clientes, pedidos y configuración. El archivo `.gitignore` se encarga de dejarla afuera, junto con `node_modules/` y `para-github/`. Contenido correcto de `.gitignore`:

```
node_modules/
data/
para-github/
*.log
.env
```

Antes de cada `git push`, ejecutá `git status` y revisá que no aparezca `data/`.

**Si alguna vez se subió `data/`:**
1. Poné el repositorio en privado. En GitHub: *Settings → Change visibility → Make private*.
2. Revocá la contraseña de aplicación de Gmail y creá una nueva.
3. Cerrá la tienda y hacé doble clic en **`rotar-clave.bat`**: genera una clave de cifrado nueva y vuelve a cifrar todo. Los clientes siguen entrando con su misma contraseña.
4. Abrí la tienda, cambiá la contraseña del panel y cargá la nueva contraseña de Gmail.
5. Borrá el repositorio de GitHub y crealo de nuevo, privado. El historial viejo sigue conteniendo los datos, por eso hay que empezar de cero.

La contraseña del panel se guarda como hash (scrypt), nunca legible.

## Publicarla en internet (Railway)

La carpeta `para-github` tiene solo el código, sin tus datos ni `node_modules`. Eso es lo que se sube.

1. **Subí el código a GitHub.** En github.com creá un repositorio **privado** llamado `tuerca-store`, sin README. Hacé clic en *uploading an existing file*, arrastrá **todo el contenido** de `para-github` (incluida la carpeta `public`) y tocá *Commit changes*.
2. **Creá el proyecto en Railway.** Entrá a railway.com con tu cuenta de GitHub y elegí el plan Hobby (≈ US$5/mes). Después *New Project → Deploy from GitHub repo → tuerca-store*. Si te lo pide, dale acceso a ese repositorio.
3. **Definí la contraseña del panel.** En el servicio, andá a *Variables → New Variable*: `ADMIN_PASSWORD` = una contraseña larga que no uses en otro lado. Sin esta variable, el panel publicado no deja entrar.
4. **Agregá el disco para tus datos.** En el lienzo del proyecto, clic derecho (o ⌘K / Ctrl+K) → *Volume* → conectalo al servicio con *Mount path* `/data`. Ahí se guardan inventario, pedidos y configuración.
5. **Obtené el link.** Andá a *Settings → Networking → Generate Domain* y te da una dirección `…up.railway.app`. Si tenés dominio propio, lo agregás en el mismo lugar.
6. **(Solo si ya tenés pedidos o clientes en tu PC)** Agregá en Railway la variable `TUERCA_SECRET` con el contenido de `data/clave-secreta.txt` de tu PC.
7. **Pasá tus cartas.** En la tienda de tu PC: *Panel → Configuración → Descargar respaldo*. En la tienda publicada: *Panel → Configuración → Restaurar desde un respaldo*, elegí ese archivo y tocá *Restaurar* dos veces.
8. **Revisá la configuración.** En la tienda publicada, confirmá que estén bien el WhatsApp, el dólar y el recargo.

Cada vez que subas cambios al repositorio, Railway republica sola. Tus datos no se pierden, porque están en el volumen.

---
Magic: The Gathering es marca de Wizards of the Coast. Imágenes y datos de cartas cortesía de Scryfall. Tuerca Store no está afiliada a Card Kingdom ni a Scryfall.
