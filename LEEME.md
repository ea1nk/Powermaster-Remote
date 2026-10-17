# Clase NodeJS para Powermaster
2023 SCQ Devices - EA1NK

### Descripción

Clase JavaScript sencilla para controlar de forma remota el medidor de ROE (VSWR) PowerMaster de Array Solutions desde una aplicación NodeJS.

### Instalación

```
npm install
```

### Uso

```js
const PowerMaster = require("./powermaster.js");
const pm = new PowerMaster("/dev/ttyUSB0", 38400); // 38400 es la velocidad por defecto del medidor

pm.sendCommand("v?").then(console.log);   // versión del firmware
pm.on("realtime", (d) => console.log(d)); // {forwardPower, reflectedPower, vswr, ...}
pm.setRealtime(3);                        // D3: datos en tiempo real cada 140 ms
```

Los comandos se envían empaquetados automáticamente como `STX + comando + ETX + CRC + CR` y de uno en uno, porque el medidor no acepta un comando nuevo hasta devolver la respuesta anterior. `sendCommand` devuelve una promesa con la respuesta; si el medidor no contesta en 2 segundos, la promesa falla por timeout.

### Eventos

- `realtime`: paquete de datos en tiempo real (`Dx`) ya interpretado.
- `message`: mensaje espontáneo del medidor, por ejemplo un cambio hecho desde su menú.
- `error`: error del puerto serie.

### Pruebas

No necesitan el medidor conectado:

```
npm test
```

### Aviso

Los comandos que cambian opciones de menú solo deben enviarse a petición del operador, no de forma automática: la EEPROM del medidor admite unos 1.000.000 de escrituras.
