/* EnRuta-RV — data.js
 * Libro de Horarios: expone window.RV_HORARIOS directamente, extraído de las
 * fichas de circulación Adif (Horario 306). Ya no depende de HT_DATA/HT.
 *
 * Fuente: Horario 306 - Anejo n.º 13 (vigor 17/07/2026), marchas 6020, 6021,
 * 6078, 6088, 6089, 6108, 6118, 6139, 6149, 6158, 6159, 6168, 6189, 6199, 6208,
 * 6209. Es un anejo parcial — faltan el resto de servicios del horario base;
 * se irán añadiendo al incorporar más anejos.
 *
 * Los trenes 6020/6021 (Barcelona-Málaga) se dividen en dos servicios
 * comerciales cada uno, partidos en MADRID-P.ATOCHA-ALMUDENA GRANDES (cambio
 * de turno habitual), igual que hacía la versión anterior basada en HT_DATA.
 */
(function () {
  'use strict';

  window.RV_HORARIOS = [
    {
      servicio: '6020',
      origen: 'BARCELONA-SANTS',
      destino: 'MADRID-P.ATOCHA-ALMUDENA GRANDES',
      hSalida: '11:18',
      hDestino: '14:42',
      paradas: [
        { nombre: 'CAMP DE TARRAGONA', hora: '11:51', tParada: 2 },
        { nombre: 'ZARAGOZA-DELICIAS', hora: '12:53', tParada: 1 }
      ]
    },
    {
      servicio: '6020',
      origen: 'MADRID-P.ATOCHA-ALMUDENA GRANDES',
      destino: 'MALAGA MARIA ZAMBRANO',
      hSalida: '15:05',
      hDestino: '17:54',
      paradas: [
        { nombre: 'CORDOBA-JULIO ANGUITA', hora: '16:51', tParada: 2 }
      ]
    },
    {
      servicio: '6021',
      origen: 'MALAGA MARIA ZAMBRANO',
      destino: 'MADRID-P.ATOCHA-ALMUDENA GRANDES',
      hSalida: '11:34',
      hDestino: '14:22',
      paradas: [
        { nombre: 'CORDOBA-JULIO ANGUITA', hora: '12:28', tParada: 2 }
      ]
    },
    {
      servicio: '6021',
      origen: 'MADRID-P.ATOCHA-ALMUDENA GRANDES',
      destino: 'BARCELONA-SANTS',
      hSalida: '14:42',
      hDestino: '18:13',
      paradas: [
        { nombre: 'ZARAGOZA-DELICIAS', hora: '16:21', tParada: 1 },
        { nombre: 'CAMP DE TARRAGONA', hora: '17:29', tParada: 2 }
      ]
    },
    {
      servicio: '6078',
      origen: 'MADRID-P.ATOCHA-ALMUDENA GRANDES',
      destino: 'MALAGA MARIA ZAMBRANO',
      hSalida: '7:36',
      hDestino: '10:25',
      paradas: [
        { nombre: 'CORDOBA-JULIO ANGUITA', hora: '9:22', tParada: 2 }
      ]
    },
    {
      servicio: '6088',
      origen: 'MADRID-P.ATOCHA-ALMUDENA GRANDES',
      destino: 'MALAGA MARIA ZAMBRANO',
      hSalida: '8:55',
      hDestino: '11:44',
      paradas: [
        { nombre: 'CORDOBA-JULIO ANGUITA', hora: '10:41', tParada: 2 }
      ]
    },
    {
      servicio: '6089',
      origen: 'MALAGA MARIA ZAMBRANO',
      destino: 'MADRID-P.ATOCHA-ALMUDENA GRANDES',
      hSalida: '8:00',
      hDestino: '10:48',
      paradas: [
        { nombre: 'CORDOBA-JULIO ANGUITA', hora: '8:54', tParada: 2 }
      ]
    },
    {
      servicio: '6108',
      origen: 'MADRID-P.ATOCHA-ALMUDENA GRANDES',
      destino: 'MALAGA MARIA ZAMBRANO',
      hSalida: '9:50',
      hDestino: '12:39',
      paradas: [
        { nombre: 'CORDOBA-JULIO ANGUITA', hora: '11:36', tParada: 2 }
      ]
    },
    {
      servicio: '6118',
      origen: 'MADRID-P.ATOCHA-ALMUDENA GRANDES',
      destino: 'MALAGA MARIA ZAMBRANO',
      hSalida: '11:55',
      hDestino: '14:44',
      paradas: [
        { nombre: 'CORDOBA-JULIO ANGUITA', hora: '13:41', tParada: 2 }
      ]
    },
    {
      servicio: '6139',
      origen: 'MALAGA MARIA ZAMBRANO',
      destino: 'MADRID-P.ATOCHA-ALMUDENA GRANDES',
      hSalida: '12:50',
      hDestino: '15:39',
      paradas: [
        { nombre: 'CORDOBA-JULIO ANGUITA', hora: '13:44', tParada: 2 }
      ]
    },
    {
      servicio: '6149',
      origen: 'MALAGA MARIA ZAMBRANO',
      destino: 'MADRID-P.ATOCHA-ALMUDENA GRANDES',
      hSalida: '13:50',
      hDestino: '16:39',
      paradas: [
        { nombre: 'CORDOBA-JULIO ANGUITA', hora: '14:44', tParada: 2 }
      ]
    },
    {
      servicio: '6158',
      origen: 'MADRID-P.ATOCHA-ALMUDENA GRANDES',
      destino: 'MALAGA MARIA ZAMBRANO',
      hSalida: '16:18',
      hDestino: '19:07',
      paradas: [
        { nombre: 'CORDOBA-JULIO ANGUITA', hora: '18:04', tParada: 2 }
      ]
    },
    {
      servicio: '6159',
      origen: 'MALAGA MARIA ZAMBRANO',
      destino: 'MADRID-P.ATOCHA-ALMUDENA GRANDES',
      hSalida: '15:26',
      hDestino: '18:15',
      paradas: [
        { nombre: 'CORDOBA-JULIO ANGUITA', hora: '16:20', tParada: 2 }
      ]
    },
    {
      servicio: '6168',
      origen: 'MADRID-P.ATOCHA-ALMUDENA GRANDES',
      destino: 'MALAGA MARIA ZAMBRANO',
      hSalida: '16:55',
      hDestino: '19:46',
      paradas: [
        { nombre: 'CORDOBA-JULIO ANGUITA', hora: '18:41', tParada: 2 }
      ]
    },
    {
      servicio: '6189',
      origen: 'MALAGA MARIA ZAMBRANO',
      destino: 'MADRID-P.ATOCHA-ALMUDENA GRANDES',
      hSalida: '18:35',
      hDestino: '21:23',
      paradas: [
        { nombre: 'CORDOBA-JULIO ANGUITA', hora: '19:29', tParada: 2 }
      ]
    },
    {
      servicio: '6199',
      origen: 'MALAGA MARIA ZAMBRANO',
      destino: 'MADRID-P.ATOCHA-ALMUDENA GRANDES',
      hSalida: '19:53',
      hDestino: '22:41',
      paradas: [
        { nombre: 'CORDOBA-JULIO ANGUITA', hora: '20:47', tParada: 2 }
      ]
    },
    {
      servicio: '6208',
      origen: 'MADRID-P.ATOCHA-ALMUDENA GRANDES',
      destino: 'MALAGA MARIA ZAMBRANO',
      hSalida: '20:55',
      hDestino: '23:44',
      paradas: [
        { nombre: 'CORDOBA-JULIO ANGUITA', hora: '22:41', tParada: 2 }
      ]
    },
    {
      servicio: '6209',
      origen: 'MALAGA MARIA ZAMBRANO',
      destino: 'MADRID-P.ATOCHA-ALMUDENA GRANDES',
      hSalida: '20:35',
      hDestino: '23:23',
      paradas: [
        { nombre: 'CORDOBA-JULIO ANGUITA', hora: '21:29', tParada: 2 }
      ]
    }
  ];
})();
