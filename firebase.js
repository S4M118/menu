/* =========================================================
   Carta · Capa de sincronización con Firebase (Firestore)
   Carga los módulos oficiales por CDN (sin build tools).
   Solo se activa servida la página por http/https;
   abriendo el archivo con doble clic (file://) la app
   sigue funcionando con la copia local de localStorage.
   ========================================================= */

(function () {
  'use strict';

  var VERSION = '11.0.0';
  /* Identificador fijo del dueño (no es secreto; la clave vive en Firebase) */
  var USUARIO_DUENO = 'admin@carta.resesm';
  var URL_APP = 'https://www.gstatic.com/firebasejs/' + VERSION + '/firebase-app.js';
  var URL_DB = 'https://www.gstatic.com/firebasejs/' + VERSION + '/firebase-firestore.js';
  var URL_AUTH = 'https://www.gstatic.com/firebasejs/' + VERSION + '/firebase-auth.js';
  var fa = null;
  var auth = null;
  var COLECCION = 'platos';

  /* Configuración del proyecto (identificadores públicos del cliente).
     La seguridad real vive en las reglas de Firestore. */
  var firebaseConfig = {
    apiKey: 'AIzaSyAv9WUr2ob2s5LmhxKOszI5WBycjVZCnVo',
    authDomain: 'menu-res-8a799.firebaseapp.com',
    projectId: 'menu-res-8a799',
    storageBucket: 'menu-res-8a799.firebasestorage.app',
    messagingSenderId: '938910970526',
    appId: '1:938910970526:web:034fa392e5b77e2378818f',
    measurementId: 'G-WT2P6SZNES'
  };

  var fs = null;   // módulo firestore del CDN
  var refColeccion = null;

  /* Acepta documentos escritos con el esquema de la app
     (name/price/icon/desc) o con el esquema español (nombre/precio/...). */
  function mapearDoc(snapshot) {
    var d = snapshot.data() || {};
    var precio = d.price !== undefined ? d.price : d.precio;
    return {
      id: snapshot.id,
      name: typeof d.name === 'string' ? d.name : (typeof d.nombre === 'string' ? d.nombre : ''),
      price: Number.isFinite(Number(precio)) ? Number(precio) : 0,
      icon: typeof d.icon === 'string' ? d.icon : (typeof d.icono === 'string' ? d.icono : 'auto'),
      desc: typeof d.desc === 'string' ? d.desc : (typeof d.descripcion === 'string' ? d.descripcion : '')
    };
  }

  function aDocumento(item) {
    return {
      name: String(item.name || '').slice(0, 80),
      price: Math.round(Number(item.price) || 0),
      icon: typeof item.icon === 'string' && item.icon ? item.icon : 'auto',
      desc: String(item.desc || '').slice(0, 140)
    };
  }

  function conectar(opciones) {
    opciones = opciones || {};

    /* Doble clic sobre el archivo: sin servidor no hay sincronización */
    if (window.location.protocol === 'file:') {
      if (opciones.onEstado) opciones.onEstado('local');
      return Promise.resolve(null);
    }

    return Promise.all([import(URL_APP), import(URL_DB), import(URL_AUTH)])
      .then(function (mods) {
        var appMod = mods[0];
        fs = mods[1];
        fa = mods[2];

        var app = appMod.initializeApp(firebaseConfig);

        var db;
        try {
          db = fs.initializeFirestore(app, {
            localCache: fs.persistentLocalCache()
          });
        } catch (err) {
          db = fs.getFirestore(app);
        }

        refColeccion = fs.collection(db, COLECCION);

        try {
          auth = fa.getAuth(app);
        } catch (errAuth) {
          auth = null;
          console.warn('Authentication no disponible:', errAuth);
        }

        var sembrada = false;
        var avisoError = false;

        return fs.onSnapshot(refColeccion, function (snap) {
          if (opciones.onEstado) opciones.onEstado('sincronizado');

          /* Primera carga: si la nube está vacía y hay una carta local, se sube */
          if (!sembrada) {
            sembrada = true;
            var semilla = opciones.semilla || [];
            if (snap.empty && semilla.length) {
              var tareas = semilla.map(function (item) {
                return fs.addDoc(refColeccion, aDocumento(item)).catch(function (err) {
                  console.warn('No se pudo subir «' + item.name + '»:', err);
                });
              });
              Promise.all(tareas).then(function () {
                if (opciones.onEstado) opciones.onEstado('sembrada');
              });
            }
          }

          avisoError = false;
          if (opciones.onCambio) {
            opciones.onCambio(snap.docs.map(mapearDoc));
          }
        }, function (err) {
          console.warn('Firestore:', err && err.message ? err.message : err);
          if (!avisoError && opciones.onEstado) {
            avisoError = true;
            opciones.onEstado('error');
          }
        });
      })
      .then(function () {
        var sesion = auth ? {
          usuario: function () {
            return auth.currentUser && auth.currentUser.email;
          },
          iniciarSesion: function (correo, clave) {
            return fa.signInWithEmailAndPassword(auth, correo, clave);
          },
          cerrarSesion: function () {
            return fa.signOut(auth);
          }
        } : {};

        return Object.assign({
          crear: function (item) {
            return fs.addDoc(refColeccion, aDocumento(item)).then(function (ref) {
              return ref.id;
            });
          },
          actualizar: function (id, item) {
            return fs.updateDoc(fs.doc(refColeccion, id), aDocumento(item));
          },
          borrar: function (id) {
            return fs.deleteDoc(fs.doc(refColeccion, id));
          }
        }, sesion);
      })
      .catch(function (err) {
        console.warn('Firebase no disponible:', err && err.message ? err.message : err);
        if (opciones.onEstado) opciones.onEstado('error');
        return null;
      });
  }

  window.CartaCloud = {
    conectar: conectar,
    USUARIO_DUENO: USUARIO_DUENO
  };
})();
