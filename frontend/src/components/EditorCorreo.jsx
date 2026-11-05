import { useCallback, useEffect, useRef } from 'react';

// El cuerpo del correo, editable, con los campos como cajitas (2026-11-03).
//
// Sin librería: contentEditable, con cada campo en un <span contenteditable=false>.
// Así el navegador lo trata como una sola pieza, que se mueve o se borra completa y
// no se puede editar por dentro, y "[NOMBRE]" no se puede romper.
//
// El valor entra y sale como HTML con los campos en texto plano ("[NOMBRE]"): las
// cajitas solo existen aquí. No es controlado: React no debe volver a pintar el DOM
// mientras se escribe, o el cursor brinca. Para reemplazar el contenido desde fuera
// (cambiar de versión, restaurar el texto) quien lo usa cambia la `key`.

const TIPO_CAMPO = 'application/x-campo-aviso';

function nuevaCajita(campo) {
  const s = document.createElement('span');
  s.className = 'campo-cajita';
  s.contentEditable = 'false';
  s.draggable = true;
  s.dataset.campo = campo;
  s.textContent = campo;
  s.title = 'Haz clic para quitarla, o arrástrala para moverla';
  return s;
}

/** Convierte a cajitas los campos que estén como texto en los nodos de `raiz`. */
function textoACajitas(raiz, campos) {
  const patron = new RegExp(campos.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  const caminante = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
  const nodos = [];
  while (caminante.nextNode()) {
    if (!caminante.currentNode.parentElement.closest('.campo-cajita')) nodos.push(caminante.currentNode);
  }
  for (const nodo of nodos) {
    const texto = nodo.nodeValue;
    patron.lastIndex = 0;
    if (!patron.test(texto)) continue;
    patron.lastIndex = 0;
    const fragmento = document.createDocumentFragment();
    let desde = 0;
    let m;
    while ((m = patron.exec(texto))) {
      if (m.index > desde) fragmento.append(texto.slice(desde, m.index));
      fragmento.append(nuevaCajita(m[0]));
      desde = m.index + m[0].length;
    }
    if (desde < texto.length) fragmento.append(texto.slice(desde));
    nodo.replaceWith(fragmento);
  }
}

/** El DOM del editor como el HTML que se guarda: sin cajitas, con <p> en vez de <div>. */
function serializar(raiz) {
  const copia = raiz.cloneNode(true);
  copia.querySelectorAll('.campo-cajita').forEach((c) => c.replaceWith(c.dataset.campo));
  copia.querySelectorAll('div').forEach((d) => {
    const p = document.createElement('p');
    p.append(...d.childNodes);
    d.replaceWith(p);
  });
  // Un renglón vacío, como el que deja quitar una cajita que estaba sola, no va al correo.
  copia.querySelectorAll('p').forEach((p) => {
    if (!p.textContent.trim()) p.remove();
  });
  return copia.innerHTML;
}

/** El punto del texto bajo el cursor durante un arrastre. */
function rangoEnPunto(x, y) {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (!p) return null;
    const r = document.createRange();
    r.setStart(p.offsetNode, p.offset);
    r.collapse(true);
    return r;
  }
  return document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
}

export default function EditorCorreo({ valor, campos, onCambio, soloLectura = false }) {
  const editor = useRef(null);
  const rangoGuardado = useRef(null);
  const cajitaArrastrada = useRef(null);
  const arrastreInterno = useRef(false);
  const nombres = campos.map((c) => c.campo);

  const avisar = useCallback(() => {
    onCambio(serializar(editor.current));
  }, [onCambio]);

  // Se pinta una sola vez por montaje: ver el comentario de arriba.
  const inicial = useRef({ valor, nombres, soloLectura });
  useEffect(() => {
    const raiz = editor.current;
    raiz.innerHTML = inicial.current.valor;
    textoACajitas(raiz, inicial.current.nombres);
    if (inicial.current.soloLectura) {
      raiz.querySelectorAll('.campo-cajita').forEach((c) => {
        c.draggable = false;
        c.removeAttribute('title');
      });
    }
  }, []);

  // Clic en una cajita de la paleta: va donde estaba el cursor, y al arrastrarla el
  // punto sale del ratón. El cursor se recuerda porque al hacer clic fuera se pierde.
  useEffect(() => {
    const recordar = () => {
      const sel = window.getSelection();
      if (sel.rangeCount && editor.current?.contains(sel.anchorNode)) {
        rangoGuardado.current = sel.getRangeAt(0).cloneRange();
      }
    };
    document.addEventListener('selectionchange', recordar);
    return () => document.removeEventListener('selectionchange', recordar);
  }, []);

  function insertarEn(rango, campo) {
    const raiz = editor.current;
    const cajita = nuevaCajita(campo);
    // Encima de otra cajita va después de ella: anidada se perdería al guardar.
    const nodo = rango.startContainer;
    const encima = (nodo.nodeType === Node.ELEMENT_NODE ? nodo : nodo.parentElement).closest('.campo-cajita');
    if (encima) {
      rango.setStartAfter(encima);
      rango.collapse(true);
    }
    rango.deleteContents();
    rango.insertNode(cajita);
    // Un espacio si queda al final: sin él no se puede poner el cursor después.
    // El <br> del renglón que dejó vacío quitar otra cajita cumple el mismo papel.
    const siguiente = cajita.nextSibling;
    if (!siguiente) cajita.after(' ');
    else if (siguiente.nodeName === 'BR' && !siguiente.nextSibling) siguiente.replaceWith(' ');
    const sel = window.getSelection();
    const despues = document.createRange();
    despues.setStartAfter(cajita);
    despues.collapse(true);
    sel.removeAllRanges();
    sel.addRange(despues);
    raiz.focus();
    avisar();
  }

  function insertarCampo(campo) {
    let rango = rangoGuardado.current;
    if (!rango || !editor.current.contains(rango.startContainer)) {
      rango = document.createRange();
      rango.selectNodeContents(editor.current);
      rango.collapse(false);
    }
    insertarEn(rango, campo);
  }

  // Un clic quita la cajita y deja el cursor en su lugar, para poner otra ahí mismo.
  // Arrastrar no pasa por aquí: el navegador no dispara clic después de un arrastre.
  function quitarCajita(cajita) {
    const padre = cajita.parentNode;
    const rango = document.createRange();
    rango.setStartBefore(cajita);
    rango.collapse(true);
    cajita.remove();
    // Vacío no tendría altura y el cursor no podría quedarse en ese renglón.
    if (padre !== editor.current && !padre.textContent.trim() && !padre.querySelector('.campo-cajita')) {
      padre.replaceChildren(document.createElement('br'));
      rango.setStart(padre, 0);
      rango.collapse(true);
    }
    editor.current.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(rango);
    avisar();
  }

  function formato(comando) {
    editor.current.focus();
    document.execCommand(comando);
    avisar();
  }

  function alSoltar(e) {
    const campo = e.dataTransfer.getData(TIPO_CAMPO);
    if (!campo) {
      // Mover texto dentro del editor es normal; lo que venga de fuera, no: traería
      // formato de otro programa.
      if (!arrastreInterno.current) e.preventDefault();
      return;
    }
    e.preventDefault();
    const rango = rangoEnPunto(e.clientX, e.clientY);
    if (!rango || !editor.current.contains(rango.startContainer)) return;
    const origen = cajitaArrastrada.current;
    if (origen) {
      if (origen.contains(rango.startContainer)) return;
      origen.remove();
    }
    insertarEn(rango, campo);
  }

  function alPegar(e) {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    textoACajitas(editor.current, nombres);
    avisar();
  }

  if (soloLectura) {
    return (
      <div className="editor-correo">
        <div ref={editor} className="editor-cuerpo editor-solo-lectura" aria-label="Cuerpo del correo" />
      </div>
    );
  }

  return (
    <div className="editor-correo">
      <div className="editor-paleta" aria-label="Campos para arrastrar al correo">
        {campos.map(({ campo }) => (
          <button
            key={campo}
            type="button"
            className="campo-cajita"
            draggable
            title="Arrástrala al correo o haz clic para ponerla donde está el cursor"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insertarCampo(campo)}
            onDragStart={(e) => {
              e.dataTransfer.setData(TIPO_CAMPO, campo);
              e.dataTransfer.setData('text/plain', campo);
              e.dataTransfer.effectAllowed = 'copy';
            }}
          >
            {campo}
          </button>
        ))}
      </div>
      <div className="correo-herramientas">
        <button type="button" className="btn-secondary" onMouseDown={(e) => e.preventDefault()} onClick={() => formato('bold')}>
          <strong>Negritas</strong>
        </button>
        <button
          type="button"
          className="btn-secondary"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => formato('insertUnorderedList')}
        >
          Viñetas
        </button>
      </div>
      <div
        ref={editor}
        className="editor-cuerpo"
        role="textbox"
        aria-multiline="true"
        aria-label="Cuerpo del correo"
        contentEditable
        suppressContentEditableWarning
        onFocus={() => document.execCommand('defaultParagraphSeparator', false, 'p')}
        onInput={avisar}
        onPaste={alPegar}
        onClick={(e) => {
          const cajita = e.target.closest?.('.campo-cajita');
          if (cajita) quitarCajita(cajita);
        }}
        onDragStart={(e) => {
          arrastreInterno.current = true;
          const c = e.target.closest?.('.campo-cajita');
          cajitaArrastrada.current = c ?? null;
          if (c) {
            e.dataTransfer.setData(TIPO_CAMPO, c.dataset.campo);
            e.dataTransfer.setData('text/plain', c.dataset.campo);
            e.dataTransfer.effectAllowed = 'move';
          }
        }}
        onDragEnd={() => {
          arrastreInterno.current = false;
          cajitaArrastrada.current = null;
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(TIPO_CAMPO)) e.preventDefault();
        }}
        onDrop={(e) => {
          alSoltar(e);
          // El navegador puede soltar texto solo: que se guarde también.
          window.setTimeout(avisar, 0);
        }}
      />
    </div>
  );
}
