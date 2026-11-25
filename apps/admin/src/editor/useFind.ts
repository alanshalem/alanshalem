import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { applyEditKeepingFocus } from './applyEdit.ts';
import { findMatches, replaceAllEdit, replaceMatchEdit, stepMatch, type Match, type SearchOptions } from './search.ts';
import { measureRangeBox, scrollTextareaTo, type Box } from './textareaMetrics.ts';

export type FindMode = 'find' | 'replace';

/**
 * Estado del panel buscar/reemplazar (S2). La coincidencia actual queda seleccionada en el textarea; como Chrome no
 * pinta la selección de un textarea sin foco (el foco está en el buscador), además se marca con una caja medida.
 * Cada reemplazo pasa por applyEdit, así Ctrl+Z lo deshace como cualquier otra edición.
 */
export function useFind(textareaRef: RefObject<HTMLTextAreaElement | null>, value: string) {
  const [mode, setMode] = useState<FindMode | null>(null);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [options, setOptions] = useState<SearchOptions>({ caseSensitive: false, wholeWord: false });
  const [current, setCurrent] = useState(-1);
  const [replacedCount, setReplacedCount] = useState<number | null>(null);
  // La caja va en coordenadas del contenido; restarle el scroll actual la mantiene sobre la coincidencia.
  const [highlight, setHighlight] = useState<Box | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  /** Cambia en cada apertura: el panel vuelve a enfocar y seleccionar su campo. */
  const [focusToken, setFocusToken] = useState(0);
  // Desde dónde buscar cuando cambia la consulta, o adónde seguir después de reemplazar.
  const fromRef = useRef<number | null>(null);

  const matches = useMemo(() => (mode ? findMatches(value, query, options) : []), [mode, value, query, options]);

  const select = (index: number, list: readonly Match[] = matches): void => {
    const textarea = textareaRef.current;
    const match = list[index];
    setCurrent(index);
    if (!textarea || !match) return setHighlight(null);
    textarea.setSelectionRange(match.from, match.to);
    const box = measureRangeBox(textarea, match.from, match.to);
    scrollTextareaTo(textarea, box.top);
    setHighlight(box);
    setScrollTop(textarea.scrollTop);
  };

  // La consulta, las opciones o el texto cambiaron (o se acaba de reemplazar): ir a la primera desde `fromRef`.
  useEffect(() => {
    if (fromRef.current === null) {
      // Se escribió en el texto: la caja medida ya no está donde estaba.
      setCurrent((index) => Math.min(index, matches.length - 1));
      setHighlight(null);
      return;
    }
    const position = fromRef.current;
    fromRef.current = null;
    select(stepMatch(matches, { start: position, end: position }, 1), matches);
    // `select` es estable en lo que importa (refs y el setter); depender de él re-dispararía en cada render.
  }, [matches]);

  const selection = () => {
    const textarea = textareaRef.current;
    return { start: textarea?.selectionStart ?? 0, end: textarea?.selectionEnd ?? 0 };
  };

  const open = (next: FindMode): void => {
    const textarea = textareaRef.current;
    const { start, end } = selection();
    const selected = textarea?.value.slice(start, end) ?? '';
    // Lo seleccionado (si es una sola línea) es lo que se quiere buscar.
    if (selected && !selected.includes('\n')) setQuery(selected);
    fromRef.current = start;
    setReplacedCount(null);
    setMode(next);
    setFocusToken((token) => token + 1);
  };

  const close = (): void => {
    setMode(null);
    setHighlight(null);
    textareaRef.current?.focus(); // con la coincidencia actual seleccionada: se sigue escribiendo ahí
  };

  const step = (direction: 1 | -1): void => select(stepMatch(matches, selection(), direction));

  const replaceOne = (): void => {
    const textarea = textareaRef.current;
    const { start, end } = selection();
    const match = matches.find((candidate) => candidate.from === start && candidate.to === end);
    if (!textarea || !match) return step(1); // primero se ve qué se va a reemplazar
    fromRef.current = match.from + replacement.length;
    applyEditKeepingFocus(textarea, replaceMatchEdit(match, replacement));
    setReplacedCount(1);
  };

  const replaceAll = (): void => {
    const textarea = textareaRef.current;
    const edit = replaceAllEdit(value, matches, replacement);
    if (!textarea || !edit) return;
    applyEditKeepingFocus(textarea, edit);
    setReplacedCount(matches.length);
  };

  return {
    mode,
    open,
    close,
    query,
    setQuery: (next: string) => {
      fromRef.current = selection().start;
      setQuery(next);
    },
    replacement,
    setReplacement,
    options,
    toggleOption: (option: keyof SearchOptions) => {
      fromRef.current = selection().start;
      setOptions((currentOptions) => ({ ...currentOptions, [option]: !currentOptions[option] }));
    },
    total: matches.length,
    current,
    next: () => step(1),
    previous: () => step(-1),
    replaceOne,
    replaceAll,
    replacedCount,
    focusToken,
    /** La caja de la coincidencia actual, ya ubicada en el textarea visible (o null). */
    highlight: highlight && { ...highlight, top: highlight.top - scrollTop },
    onTextareaScroll: () => {
      if (highlight) setScrollTop(textareaRef.current?.scrollTop ?? 0);
    },
  };
}

export type FindState = ReturnType<typeof useFind>;
