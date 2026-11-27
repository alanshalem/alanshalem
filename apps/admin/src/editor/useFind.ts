import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { applyEditKeepingFocus } from './applyEdit.ts';
import { findMatches, replaceAllEdit, replaceMatchEdit, stepMatch, type Match, type SearchOptions } from './search.ts';
import { measureRangeBox, scrollTextareaTo, type Box } from './textareaMetrics.ts';

export type FindMode = 'find' | 'replace';

/**
 * State of the find/replace panel. The current match stays selected in the textarea; since Chrome does not paint the
 * selection of an unfocused textarea (focus is in the search box), it is also marked with a measured box.
 * Every replacement goes through applyEdit, so Ctrl+Z undoes it like any other edit.
 */
export function useFind(textareaRef: RefObject<HTMLTextAreaElement | null>, value: string) {
  const [mode, setMode] = useState<FindMode | null>(null);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [options, setOptions] = useState<SearchOptions>({ caseSensitive: false, wholeWord: false });
  const [current, setCurrent] = useState(-1);
  const [replacedCount, setReplacedCount] = useState<number | null>(null);
  // The box is in content coordinates; subtracting the current scroll keeps it over the match.
  const [highlight, setHighlight] = useState<Box | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  /** Changes on every opening: the panel focuses and selects its field again. */
  const [focusToken, setFocusToken] = useState(0);
  // Where to search from when the query changes, or where to continue after replacing.
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

  // The query, the options or the text changed (or a replacement just happened): go to the first one from `fromRef`.
  useEffect(() => {
    if (fromRef.current === null) {
      // The text was typed into: the measured box is no longer where it was.
      setCurrent((index) => Math.min(index, matches.length - 1));
      setHighlight(null);
      return;
    }
    const position = fromRef.current;
    fromRef.current = null;
    select(stepMatch(matches, { start: position, end: position }, 1), matches);
    // `select` is stable in what matters (refs and the setter); depending on it would re-fire on every render.
  }, [matches]);

  const selection = () => {
    const textarea = textareaRef.current;
    return { start: textarea?.selectionStart ?? 0, end: textarea?.selectionEnd ?? 0 };
  };

  const open = (next: FindMode): void => {
    const textarea = textareaRef.current;
    const { start, end } = selection();
    const selected = textarea?.value.slice(start, end) ?? '';
    // The selection (if it is a single line) is what the user wants to search for.
    if (selected && !selected.includes('\n')) setQuery(selected);
    fromRef.current = start;
    setReplacedCount(null);
    setMode(next);
    setFocusToken((token) => token + 1);
  };

  const close = (): void => {
    setMode(null);
    setHighlight(null);
    textareaRef.current?.focus(); // with the current match selected: typing continues there
  };

  const step = (direction: 1 | -1): void => select(stepMatch(matches, selection(), direction));

  const replaceOne = (): void => {
    const textarea = textareaRef.current;
    const { start, end } = selection();
    const match = matches.find((candidate) => candidate.from === start && candidate.to === end);
    if (!textarea || !match) return step(1); // first show what is going to be replaced
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
    /** The box of the current match, already placed in the visible textarea (or null). */
    highlight: highlight && { ...highlight, top: highlight.top - scrollTop },
    onTextareaScroll: () => {
      if (highlight) setScrollTop(textareaRef.current?.scrollTop ?? 0);
    },
  };
}

export type FindState = ReturnType<typeof useFind>;
