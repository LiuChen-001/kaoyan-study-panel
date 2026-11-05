// Store only editable learning fields so undo cannot revert unrelated workbook edits.
export function createHistory(limit = 10) {
  const undo = [], redo = [];
  const fields = state => [
    ...Object.entries(state.memory).map(([id, value]) => [['memory', id], value]),
    ...Object.entries(state.wrongQuestions).map(([id, value]) => [['wrongQuestions', id], value]),
    ...Object.keys(state.wrongQuestions).map(id => [['wrongQuestionFormats', id], state.wrongQuestionFormats[id]]),
    ...state.english.articles.map(article => [['article-memory', article.id], article.memory]),
  ];
  return {
    record(before, after) {
      const previous = new Map(fields(before).map(([path, value]) => [JSON.stringify(path), value]));
      const changes = fields(after).flatMap(([path, value]) => {
        const key = JSON.stringify(path), old = previous.get(key);
        return previous.has(key) && JSON.stringify(old) !== JSON.stringify(value)
          ? [{ path, before: structuredClone(old), after: structuredClone(value) }] : [];
      });
      if (!changes.length) return;
      undo.push(changes);
      if (undo.length > limit) undo.shift();
      redo.length = 0;
    },
    restore(state, direction, validate) {
      const source = direction === 'undo' ? undo : redo;
      const target = direction === 'undo' ? redo : undo;
      const changes = source.at(-1);
      if (!changes) return null;
      const next = structuredClone(state);
      for (const { path: [field, id], ...values } of changes) {
        const value = structuredClone(values[direction === 'undo' ? 'before' : 'after']);
        if (field === 'article-memory') next.english.articles.find(article => article.id === id).memory = value;
        else if (value === undefined) delete next[field][id];
        else next[field][id] = value;
      }
      validate(next);
      source.pop(); target.push(changes);
      return next;
    },
  };
}
